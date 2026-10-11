import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../../src/app";
import type { RateLimits } from "../../src/auth/auth";
import { createDatabase, type Database } from "../../src/db/client";
import { loadEnv, type Env } from "../../src/env";
import type { Mail, Mailer } from "../../src/mail/mailer";
import { createTestDatabase, type TestDatabase } from "./testDb";

export const TEST_PASSWORD = "correct horse battery staple";
export const SECRET = "integration-test-secret-integration-test-secret";

/** Limits high enough that ordinary tests never trip them; rate-limit tests use the real defaults. */
export const HIGH_RATE_LIMITS: RateLimits = {
  perIp: {
    "/sign-in/email": { window: 60, max: 1000 },
    "/sign-up/email": { window: 60, max: 1000 },
    "/request-password-reset": { window: 60, max: 1000 },
    "/reset-password": { window: 60, max: 1000 },
  },
  perAccount: {
    login: { window: 60, max: 1000 },
    passwordReset: { window: 60, max: 1000 },
  },
};

export interface HarnessOptions {
  publicUrl?: string;
  /** Extra environment variables (ALLOW_SIGNUPS, TRUSTED_ORIGINS, ...). */
  env?: Record<string, string>;
  rateLimits?: RateLimits;
  /** Capture email instead of sending it. */
  withMailer?: boolean;
  /** Start from an empty database instead of the migrated template. */
  migrated?: boolean;
}

export interface Session {
  /** `Cookie` header value for the signed-in user. */
  cookie: string;
  userId: string;
  email: string;
}

export interface Harness {
  app: FastifyInstance;
  db: Database;
  env: Env;
  database: TestDatabase;
  /** Email "sent" so far (needs `withMailer`). */
  mail: Mail[];
  /** The path prefix everything is mounted under: "" or "/evenly". */
  base: string;
  origin: string;
  /** `app.inject` with the app's Origin header filled in (override it by passing `headers.origin`). */
  request(options: InjectOptions): Promise<LightMyRequestResponse>;
  signUp(overrides?: { email?: string; name?: string; password?: string }): Promise<Session>;
  signIn(email: string, password?: string): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

/** The `Cookie` header for a response's Set-Cookie headers (dropping cookies that were cleared). */
export function cookieHeaderOf(response: LightMyRequestResponse): string {
  return response.cookies
    .filter((cookie) => cookie.value !== "")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const database = await createTestDatabase(
    options.migrated === undefined ? {} : { migrated: options.migrated },
  );
  const env = loadEnv({
    DATABASE_URL: database.url,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    PUBLIC_URL: options.publicUrl ?? "http://localhost:3000",
    ...options.env,
  });
  const mail: Mail[] = [];
  const mailer: Mailer | undefined = options.withMailer
    ? {
        send: (message) => {
          mail.push(message);
          return Promise.resolve();
        },
      }
    : undefined;
  const db = createDatabase(database.url);
  const app = await buildApp({
    env,
    db,
    secret: SECRET,
    mailer,
    rateLimits: options.rateLimits ?? HIGH_RATE_LIMITS,
  });
  await app.ready();

  const base = env.basePath;
  const origin = env.publicOrigin;
  const request = (injectOptions: InjectOptions) =>
    app.inject({
      ...injectOptions,
      headers: { origin, ...injectOptions.headers },
    } as InjectOptions);

  const harness: Harness = {
    app,
    db,
    env,
    database,
    mail,
    base,
    origin,
    request,
    async signUp(overrides = {}) {
      const email = overrides.email ?? uniqueEmail();
      const response = await request({
        method: "POST",
        url: `${base}/api/auth/sign-up/email`,
        payload: {
          email,
          name: overrides.name ?? "Test User",
          password: overrides.password ?? TEST_PASSWORD,
        },
      });
      if (response.statusCode !== 200) {
        throw new Error(`sign-up failed: ${String(response.statusCode)} ${response.body}`);
      }
      const body = response.json<{ user: { id: string } }>();
      return { cookie: cookieHeaderOf(response), userId: body.user.id, email };
    },
    signIn: (email, password = TEST_PASSWORD) =>
      request({
        method: "POST",
        url: `${base}/api/auth/sign-in/email`,
        payload: { email, password },
      }),
    async close() {
      await app.close();
      await db.close();
      await database.drop();
    },
  };
  return harness;
}
