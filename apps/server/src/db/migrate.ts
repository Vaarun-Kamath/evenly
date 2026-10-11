import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

/** Arbitrary constant key of the Postgres advisory lock that serialises migrations across replicas. */
const MIGRATION_LOCK_KEY = 727_001_001;

/** Finds the `drizzle/` folder: next to `src/` in development, next to `dist/` in the Docker image. */
export function findMigrationsFolder(
  from: string = dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = from;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, "drizzle");
    if (existsSync(join(candidate, "meta", "_journal.json"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`Cannot find the migrations folder (looked upwards from ${from})`);
}

/** How many migrations this build of the server ships. */
export function expectedMigrationCount(folder: string = findMigrationsFolder()): number {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/** True when every shipped migration has been applied (the database is not behind this server). */
export async function migrationsApplied(sql: Sql, expected: number): Promise<boolean> {
  try {
    const rows = await sql<
      { count: string }[]
    >`select count(*)::text as count from drizzle.__drizzle_migrations`;
    return Number(rows[0]?.count ?? 0) >= expected;
  } catch {
    // The migrations table does not exist yet: nothing has been applied.
    return false;
  }
}

/**
 * Applies pending migrations. A session-level advisory lock, held on one reserved connection for the
 * whole run, makes several replicas starting at once take turns instead of racing (ADR-0004). Use a
 * direct connection URL: session locks do not survive PgBouncer's transaction pooling.
 */
export async function runMigrations(
  url: string,
  options: { folder?: string; log?: (message: string) => void } = {},
): Promise<void> {
  const folder = options.folder ?? findMigrationsFolder();
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  const lockConnection = await sql.reserve();
  try {
    options.log?.("waiting for the migration lock");
    await lockConnection`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      options.log?.("applying migrations");
      await migrate(drizzle(sql), { migrationsFolder: folder });
    } finally {
      await lockConnection`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    lockConnection.release();
    await sql.end({ timeout: 5 });
  }
}
