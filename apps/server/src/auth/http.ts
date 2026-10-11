import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "../http/errors";
import { originGuard } from "../http/origin";
import type { Auth } from "./auth";
import { CLIENT_IP_HEADER } from "./auth";

export type SessionUser = Auth["$Infer"]["Session"]["user"];

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user; set by `requireSession`, null on public routes. */
    sessionUser: SessionUser | null;
  }
}

/**
 * Request headers as a Fetch `Headers`, with the client IP as Fastify resolved it (so honouring
 * TRUST_PROXY) in a header the auth library trusts. Anything a client sent under that name is replaced.
 */
export function toFetchHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

/**
 * Mounts the auth library at `<BASE_PATH>/api/auth/*`. The scope this is registered in must carry
 * the base path prefix, and nothing parses the body before the auth library sees it.
 */
export function registerAuthRoutes(
  scope: FastifyInstance,
  options: { auth: Auth; publicOrigin: string; allowedOrigins: ReadonlySet<string> },
): void {
  const { auth, publicOrigin, allowedOrigins } = options;
  scope.register(
    (authScope, _options, done) => {
      // The auth library only checks Origin on requests that carry cookies, so a cookie-less
      // cross-site sign-in or sign-up would get through. Every non-GET needs an allowed Origin.
      authScope.addHook("onRequest", originGuard(allowedOrigins));
      // The auth library reads the raw body itself, so skip Fastify's JSON/form parsing here.
      authScope.removeAllContentTypeParsers();
      authScope.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
        done(null, body);
      });

      authScope.route({
        method: ["GET", "POST"],
        url: "/*",
        handler: async (request, reply) => {
          // Built from the configured origin, never from the Host header.
          const url = new URL(request.url, publicOrigin);
          const hasBody = request.method !== "GET" && Buffer.isBuffer(request.body);
          const response = await auth.handler(
            new Request(url, {
              method: request.method,
              headers: toFetchHeaders(request),
              ...(hasBody && { body: new Uint8Array(request.body as Buffer) }),
            }),
          );

          reply.status(response.status);
          const cookies = response.headers.getSetCookie();
          response.headers.forEach((value, name) => {
            // Fastify recomputes the length; Set-Cookie is sent once with every value, below.
            if (name !== "set-cookie" && name !== "content-length") reply.header(name, value);
          });
          if (cookies.length > 0) reply.header("set-cookie", cookies);
          return reply.send(Buffer.from(await response.arrayBuffer()));
        },
      });
      done();
    },
    { prefix: "/api/auth" },
  );
}

/** A preHandler that rejects requests without a valid session and exposes the user. */
export function requireSession(auth: Auth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: toFetchHeaders(request) });
    if (session === null) {
      return sendProblem(reply, 401, {
        type: "urn:evenly:problem:unauthenticated",
        detail: "Sign in to continue.",
      });
    }
    request.sessionUser = session.user;
  };
}
