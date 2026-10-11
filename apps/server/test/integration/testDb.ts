import { randomBytes } from "node:crypto";
import postgres from "postgres";

/** The migrated database every test database is copied from (see globalSetup.ts). */
export const TEMPLATE_DB = "evenly_test_template";
const CREATE_LOCK_KEY = 727_001_002;

/** A login that may create databases, on the `postgres` maintenance database. */
export function adminUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "postgres://lib001:lib001@localhost:5432/postgres";
}

export function urlForDatabase(name: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function withAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl(), { max: 1, onnotice: () => undefined, connect_timeout: 5 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

/** A fresh, migrated copy of the template: isolation per test file without re-running migrations. */
export async function createTestDatabase(
  options: { migrated?: boolean } = {},
): Promise<TestDatabase> {
  const name = `evenly_test_${randomBytes(6).toString("hex")}`;
  await withAdmin(async (sql) => {
    // CREATE DATABASE ... TEMPLATE needs the template idle; take turns when files start together.
    await sql`select pg_advisory_lock(${CREATE_LOCK_KEY})`;
    try {
      await sql.unsafe(
        options.migrated === false
          ? `CREATE DATABASE ${name}`
          : `CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`,
      );
    } finally {
      await sql`select pg_advisory_unlock(${CREATE_LOCK_KEY})`;
    }
  });
  return {
    name,
    url: urlForDatabase(name),
    drop: () =>
      withAdmin(async (sql) => {
        await sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      }),
  };
}

export async function recreateTemplateDatabase(): Promise<void> {
  try {
    await withAdmin(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
      await sql.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
    });
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres at ${adminUrl().replace(/:[^:@/]*@/, ":***@")} for the integration tests.\n` +
        "Start one with:\n" +
        "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db\n" +
        "or set TEST_DATABASE_URL to a login that can create databases.\n" +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
