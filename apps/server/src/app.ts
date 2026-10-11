import { randomUUID } from "node:crypto";
import { pingResponseSchema, probeResponseSchema } from "@evenly/contracts";
import helmet from "@fastify/helmet";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { DbHandle } from "./db/client";
import type { Env } from "./env";
import { registerErrorHandling, sendProblem } from "./http/errors";
import { isSpaRoute, loadSpa, registerSpaRoutes, resolveStaticDir, sendIndex } from "./spa";

export interface AppDeps {
  env: Env;
  db: DbHandle;
}

/**
 * Fastify accepts a hop count at runtime (proxy-addr), but its types do not, so express "trust the
 * first n hops" as the equivalent function.
 */
function toFastifyTrustProxy(value: Env["TRUST_PROXY"]): FastifyServerOptions["trustProxy"] {
  return typeof value === "number" ? (_address, hop) => hop < value : value;
}

/** Builds the Fastify instance without listening, so tests can drive it with `app.inject`. */
export async function buildApp({ env, db }: AppDeps) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
    },
    trustProxy: toFastifyTrustProxy(env.TRUST_PROXY),
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

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
            return { status: "ready" as const };
          } catch (error) {
            request.log.warn({ err: error }, "database not reachable");
            return reply.code(503).send({ status: "unavailable" as const });
          }
        },
      );

      routes.get("/api/v1/ping", { schema: { response: { 200: pingResponseSchema } } }, () => ({
        status: "ok" as const,
        name: "evenly" as const,
      }));

      if (spa !== undefined) await registerSpaRoutes(scope, spa);
    },
    { prefix: env.basePath },
  );

  return app;
}
