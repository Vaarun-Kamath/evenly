import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/app";
import { createDatabase, type Database } from "../../src/db/client";
import { loadEnv } from "../../src/env";

export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Evenly</title>
    <script type="module" src="./assets/app-abc123.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

/** Creates a throwaway directory that looks like a built apps/web/dist. */
export async function makeStaticDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "evenly-static-"));
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), INDEX_HTML);
  await writeFile(join(dir, "assets", "app-abc123.js"), "console.log('hi');");
  await writeFile(join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  return dir;
}

/**
 * A database object that never connects (the pool is lazy), with the probes replaceable, for tests
 * that do not need a real Postgres.
 */
export function makeDatabase(overrides: Partial<Database> = {}): Database {
  return { ...createDatabase("postgres://lib001:lib001@127.0.0.1:1/unused"), ...overrides };
}

interface AppOptions {
  publicUrl?: string;
  staticDir?: string;
  dbReachable?: boolean;
  migrated?: boolean;
}

export async function makeApp({
  publicUrl,
  staticDir,
  dbReachable = true,
  migrated = true,
}: AppOptions = {}) {
  const env = loadEnv({
    DATABASE_URL: "postgres://lib001:lib001@localhost:5432/lib001",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    ...(publicUrl !== undefined && { PUBLIC_URL: publicUrl }),
    ...(staticDir !== undefined && { STATIC_DIR: staticDir }),
  });
  const db = makeDatabase({
    ping: () => (dbReachable ? Promise.resolve() : Promise.reject(new Error("connection refused"))),
    migrationsApplied: () => Promise.resolve(migrated),
  });
  const app = await buildApp({ env, db, secret: "unit-test-secret-unit-test-secret-1234" });
  await app.ready();
  return app;
}
