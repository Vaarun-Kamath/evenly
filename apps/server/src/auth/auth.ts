import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { schema, type Orm } from "../db/client";
import type { Env } from "../env";
import type { Mailer } from "../mail/mailer";
import { SlidingWindowLimiter } from "./limiter";

/** The header through which the HTTP layer hands the trusted client IP to the auth library. */
export const CLIENT_IP_HEADER = "x-evenly-client-ip";

interface Rule {
  /** Window length in seconds. */
  window: number;
  max: number;
}

/**
 * Rate limits (ARCHITECTURE.md section 7). `perIp` is enforced by the auth library per client IP
 * and path; `perAccount` throttles attempts on one email address whatever the IP.
 */
export interface RateLimits {
  perIp: Record<string, Rule>;
  perAccount: { login: Rule; passwordReset: Rule };
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  perIp: {
    "/sign-in/email": { window: 60, max: 10 },
    "/sign-up/email": { window: 60, max: 5 },
    "/request-password-reset": { window: 3600, max: 3 },
    "/reset-password": { window: 3600, max: 10 },
  },
  perAccount: {
    login: { window: 60, max: 10 },
    passwordReset: { window: 3600, max: 3 },
  },
};

/** Decides whether an invite-only instance lets this sign-up request through. Wired up in M3. */
export type InviteGate = (headers: Headers) => Promise<boolean>;

export interface AuthDeps {
  env: Env;
  orm: Orm;
  /** Signs session cookies. */
  secret: string;
  /** Present only when SMTP is configured; enables password reset by email. */
  mailer?: Mailer | undefined;
  /** Replaces emailing the reset link (used by the `reset-password` command to print it instead). */
  deliverResetToken?: (email: string, token: string) => Promise<void>;
  rateLimits?: RateLimits;
  /** Until invites exist (M3), an invite-only instance accepts no sign-ups. */
  inviteGate?: InviteGate;
  onMailError?: (error: unknown) => void;
}

const SESSION_DAYS = 30;
const MAX_NAME_LENGTH = 100;

/** The link that lets a user choose a new password; the SPA's /reset page reads the token. */
export function resetLink(env: Pick<Env, "PUBLIC_URL">, token: string): string {
  return `${env.PUBLIC_URL.replace(/\/+$/, "")}/reset?token=${encodeURIComponent(token)}`;
}

function bodyOf(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function emailOf(body: unknown): string | undefined {
  const email = bodyOf(body).email;
  return typeof email === "string" ? email.trim().toLowerCase() : undefined;
}

export function createAuth(deps: AuthDeps) {
  const { env, orm, secret, mailer } = deps;
  const deliverResetToken: ((email: string, token: string) => Promise<void>) | undefined =
    deps.deliverResetToken ??
    (mailer === undefined
      ? undefined
      : (email, token) =>
          mailer.send({
            to: email,
            subject: "Reset your Evenly password",
            text:
              `Someone asked to reset the password of your Evenly account.

` +
              `Choose a new password here (the link works once, for one hour):
` +
              `${resetLink(env, token)}

` +
              `If this was not you, you can ignore this email.`,
          }));
  const limits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  const inviteGate: InviteGate = deps.inviteGate ?? (() => Promise.resolve(false));
  const loginLimiter = new SlidingWindowLimiter(
    limits.perAccount.login.max,
    limits.perAccount.login.window * 1000,
  );
  const resetLimiter = new SlidingWindowLimiter(
    limits.perAccount.passwordReset.max,
    limits.perAccount.passwordReset.window * 1000,
  );

  return betterAuth({
    appName: "Evenly",
    // The auth library is mounted at <BASE_PATH>/api/auth; baseURL is only the origin so that a
    // path in it is not mistaken for the auth path (ADR-0002).
    baseURL: env.publicOrigin,
    basePath: `${env.basePath}/api/auth`,
    secret,
    database: drizzleAdapter(orm, { provider: "pg", schema }),
    trustedOrigins: [env.publicOrigin, ...env.TRUSTED_ORIGINS],
    telemetry: { enabled: false },
    logger: { level: "warn" },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      // Password reset by email exists only when SMTP is configured (SPEC section 4.1). Without it,
      // the instance administrator uses `reset-password <email>` on the server.
      ...(deliverResetToken !== undefined && {
        sendResetPassword: ({ user, token }: { user: { email: string }; token: string }) => {
          // Not awaited, so that response time does not reveal whether the address exists.
          deliverResetToken(user.email, token).catch((error: unknown) => deps.onMailError?.(error));
          return Promise.resolve();
        },
      }),
    },

    user: {
      additionalFields: {
        // Set through PATCH /api/v1/me (which validates it), never through the auth endpoints.
        defaultCurrency: { type: "string", required: false, input: false },
      },
    },

    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },

    advanced: {
      cookiePrefix: "evenly",
      // https only when PUBLIC_URL is https: a plain-http self-hosted instance (LAN, localhost) could
      // not log in with Secure cookies (ADR-0002).
      useSecureCookies: env.PUBLIC_URL.startsWith("https:"),
      defaultCookieAttributes: {
        // Scoped to the base path so the cookies are not sent to the rest of the host's site.
        path: env.basePath === "" ? "/" : env.basePath,
        httpOnly: true,
        sameSite: "lax",
      },
      database: { generateId: "uuid" },
      // Only the address our HTTP layer vouches for; X-Forwarded-For from a client is never trusted.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      storage: "memory",
      customRules: { ...limits.perIp, "/get-session": false },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          if (env.ALLOW_SIGNUPS === "false") {
            throw new APIError("FORBIDDEN", { message: "Sign-ups are disabled on this instance." });
          }
          if (
            env.ALLOW_SIGNUPS === "invite-only" &&
            !(await inviteGate(ctx.headers ?? new Headers()))
          ) {
            throw new APIError("FORBIDDEN", {
              message: "This instance accepts new accounts only through an invitation link.",
            });
          }
          const name = bodyOf(ctx.body).name;
          if (typeof name !== "string" || name.trim() === "" || name.length > MAX_NAME_LENGTH) {
            throw new APIError("BAD_REQUEST", {
              message: `Name must be 1 to ${String(MAX_NAME_LENGTH)} characters.`,
            });
          }
        }

        const email = emailOf(ctx.body);
        if (ctx.path === "/sign-in/email" && email !== undefined && !loginLimiter.allow(email)) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many sign-in attempts for this account. Try again in a minute.",
          });
        }
        if (
          ctx.path === "/request-password-reset" &&
          email !== undefined &&
          !resetLimiter.allow(email)
        ) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many password reset requests for this account. Try again later.",
          });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
