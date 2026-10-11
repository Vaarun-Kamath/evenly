import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** The built web app, ready to serve: its directory and the index.html with the base path injected. */
export interface Spa {
  root: string;
  basePath: string;
  html: string;
}

/**
 * Puts the runtime base path into the built index.html (ADR-0002, ADR-0005):
 *  - `<base href>` so the relative asset URLs Vite emits resolve on nested client routes;
 *  - a meta tag that the SPA reads for its router and API client (an inline script would
 *    need a CSP exception).
 * `basePath` is validated by normalizeBasePath, so it is safe to write into HTML as is.
 */
export function injectBasePath(template: string, basePath: string): string {
  const head = /<head[^>]*>/i;
  if (!head.test(template)) throw new Error("index.html has no <head> element");
  const tags =
    `<base href="${basePath}/">\n    ` + `<meta name="evenly-base-path" content="${basePath}">`;
  return template.replace(head, (match) => `${match}\n    ${tags}`);
}

/** Where the built web app lives: `STATIC_DIR`, else `./public` (Docker), else `../web/dist` (dev). */
export function resolveStaticDir(
  configured: string | undefined,
  cwd = process.cwd(),
): string | undefined {
  if (configured !== undefined) return resolve(cwd, configured);
  return [resolve(cwd, "public"), resolve(cwd, "../web/dist")].find((dir) =>
    existsSync(join(dir, "index.html")),
  );
}

/** Reads index.html once at startup. Fails fast when the web app has not been built. */
export async function loadSpa(root: string, basePath: string): Promise<Spa> {
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `Cannot serve the web app: ${indexPath} does not exist (build apps/web first).`,
    );
  }
  return { root, basePath, html: injectBasePath(await readFile(indexPath, "utf8"), basePath) };
}

export function sendIndex(spa: Spa, reply: FastifyReply) {
  return reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(spa.html);
}

/**
 * True for a request the SPA should answer with index.html: a GET under the base path that is
 * not the API and does not look like a file.
 */
export function isSpaRoute(spa: Spa, request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const path = request.url.split("?")[0] ?? "";
  const { basePath } = spa;
  if (basePath !== "" && path !== basePath && !path.startsWith(`${basePath}/`)) return false;
  const local = path.slice(basePath.length) || "/";
  if (local === "/api" || local.startsWith("/api/")) return false;
  // A dot in the last segment means "a file" (e.g. /assets/missing.js): that is a real 404.
  const last = local.split("/").pop() ?? "";
  return !last.includes(".");
}

/** Registers the static files and the index route inside the base-path scope. */
export async function registerSpaRoutes(scope: FastifyInstance, spa: Spa): Promise<void> {
  await scope.register(fastifyStatic, {
    root: spa.root,
    index: false,
    decorateReply: false,
    cacheControl: false,
    setHeaders(res, filePath) {
      const hashed = relative(spa.root, filePath).split(sep)[0] === "assets";
      res.header("cache-control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  scope.get("/", (_request, reply) => sendIndex(spa, reply));
}
