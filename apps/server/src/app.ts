import { randomUUID } from "node:crypto";
import { pingResponseSchema, probeResponseSchema } from "@evenly/contracts";
import helmet from "@fastify/helmet";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyServerOptions } from "fastify";
import { createAuth, INVITE_HEADER, type InviteGate, type RateLimits } from "./auth/auth";
import { registerAuthRoutes, requireSession } from "./auth/http";
import type { Database } from "./db/client";
import type { Env } from "./env";
import { registerErrorHandling, sendProblem } from "./http/errors";
import { originGuard } from "./http/origin";
import type { Mailer } from "./mail/mailer";
import { registerActivityRoutes } from "./modules/activity/routes";
import { registerBalanceRoutes } from "./modules/balances/routes";
import { registerConfigRoutes } from "./modules/config/routes";
import { registerExpenseRoutes } from "./modules/expenses/routes";
import { registerExportRoutes } from "./modules/export/routes";
import { registerGroupRoutes } from "./modules/groups/routes";
import { registerInviteRoutes, registerPublicInviteRoutes } from "./modules/invites/routes";
import { inviteAllowsSignup } from "./modules/invites/service";
import { registerMemberRoutes } from "./modules/members/routes";
import { registerMeRoutes } from "./modules/me/routes";
import { registerSettlementRoutes } from "./modules/settlements/routes";
import { isSpaRoute, loadSpa, registerSpaRoutes, resolveStaticDir, sendIndex } from "./spa";

export interface AppDeps {
  env: Env;
  db: Database;
  /** Signs session cookies: SESSION_SECRET, or the one stored in the database (ADR-0007). */
  secret: string;
  /** Present only when SMTP is configured. */
  mailer?: Mailer | undefined;
  /** Overrides for tests. */
  rateLimits?: RateLimits;
  /** Called for every route as it is registered (the tests check that every route is covered). */
  onRoute?: (route: { method: string | string[]; url: string }) => void;
  inviteGate?: InviteGate;
}

/**
 * Fastify accepts a hop count at runtime (proxy-addr), but its types do not, so express "trust the
 * first n hops" as the equivalent function.
 */
function toFastifyTrustProxy(value: Env["TRUST_PROXY"]): FastifyServerOptions["trustProxy"] {
  return typeof value === "number" ? (_address, hop) => hop < value : value;
}

/** Builds the Fastify instance without listening, so tests can drive it with `app.inject`. */
export async function buildApp({
  env,
  db,
  secret,
  mailer,
  rateLimits,
  inviteGate,
  onRoute,
}: AppDeps) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
    },
    trustProxy: toFastifyTrustProxy(env.TRUST_PROXY),
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  if (onRoute !== undefined) {
    app.addHook("onRoute", (route) => onRoute({ method: route.method, url: route.url }));
  }
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  app.decorateRequest("sessionUser", null);

  const staticDir = resolveStaticDir(env.STATIC_DIR);
  const spa = staticDir === undefined ? undefined : await loadSpa(staticDir, env.basePath);
  if (spa === undefined) app.log.warn("No built web app found; serving the API only.");

  // Client-side routes (a reload on /g/<id>/settle) get index.html; everything else is a real 404.
  app.setNotFoundHandler((request, reply) =>
    spa !== undefined && isSpaRoute(spa, request) ? sendIndex(spa, reply) : sendProblem(reply, 404),
  );

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      // Self-hosters may serve plain http (LAN, localhost); upgrading would break the page.
      directives: { "upgrade-insecure-requests": null },
    },
  });

  const auth = createAuth({
    env,
    orm: db.orm,
    secret,
    mailer,
    ...(rateLimits !== undefined && { rateLimits }),
    inviteGate:
      inviteGate ??
      (({ headers, email }) => {
        const token = headers.get(INVITE_HEADER);
        return token === null ? Promise.resolve(false) : inviteAllowsSignup(db.orm, token, email);
      }),
    onMailError: (error) => app.log.error({ err: error }, "could not send email"),
  });
  const allowedOrigins: ReadonlySet<string> = new Set([env.publicOrigin, ...env.TRUSTED_ORIGINS]);

  // Everything lives under BASE_PATH (ADR-0002). At the site root the prefix is empty.
  await app.register(
    async (scope) => {
      const routes = scope.withTypeProvider<ZodTypeProvider>();

      routes.get("/healthz", { schema: { response: { 200: probeResponseSchema } } }, () => ({
        status: "ok" as const,
      }));

      routes.get(
        "/readyz",
        { schema: { response: { 200: probeResponseSchema, 503: probeResponseSchema } } },
        async (request, reply) => {
          try {
            await db.ping();
            if (!(await db.migrationsApplied())) {
              request.log.warn("database is reachable but migrations are not applied");
              return await reply.code(503).send({ status: "unavailable" as const });
            }
            return { status: "ready" as const };
          } catch (error) {
            request.log.warn({ err: error }, "database not reachable");
            return reply.code(503).send({ status: "unavailable" as const });
          }
        },
      );

      registerAuthRoutes(scope, { auth, publicOrigin: env.publicOrigin, allowedOrigins });

      await scope.register(
        async (api) => {
          api.addHook("onRequest", originGuard(allowedOrigins));
          const apiRoutes = api.withTypeProvider<ZodTypeProvider>();

          apiRoutes.get("/ping", { schema: { response: { 200: pingResponseSchema } } }, () => ({
            status: "ok" as const,
            name: "evenly" as const,
          }));

          registerConfigRoutes(api, { orm: db.orm, env, emailEnabled: mailer !== undefined });
          const invites = { orm: db.orm, env, mailer };
          await registerPublicInviteRoutes(api, invites);

          await api.register((authed, _options, done) => {
            authed.addHook("preHandler", requireSession(auth));
            registerMeRoutes(authed, db.orm, auth);
            registerGroupRoutes(authed, db.orm);
            registerMemberRoutes(authed, db.orm);
            registerInviteRoutes(authed, invites);
            registerActivityRoutes(authed, db.orm);
            registerExpenseRoutes(authed, db.orm);
            registerSettlementRoutes(authed, db.orm);
            registerBalanceRoutes(authed, db.orm);
            registerExportRoutes(authed, db.orm);
            done();
          });
        },
        { prefix: "/api/v1" },
      );

      if (spa !== undefined) await registerSpaRoutes(scope, spa);
    },
    { prefix: env.basePath },
  );

  return app;
}
