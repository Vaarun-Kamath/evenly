import type { FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF defence next to SameSite=Lax cookies (PLATFORM.md section 6): every request that changes
 * something must come from an allowed origin. The check is against `PUBLIC_URL`'s origin (plus
 * `TRUSTED_ORIGINS`), never the Host header, because a reverse proxy such as the portfolio's
 * rewrites changes Host (ADR-0002). Falls back to Referer when a browser sends no Origin.
 */
export function originGuard(allowed: ReadonlySet<string>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin ?? originOf(request.headers.referer);
    if (origin === undefined || !allowed.has(origin)) {
      return sendProblem(reply, 403, {
        type: "urn:evenly:problem:forbidden-origin",
        detail: "This request did not come from this site.",
      });
    }
  };
}
