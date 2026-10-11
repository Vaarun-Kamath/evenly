import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as authSchema from "./auth-schema";
import { expectedMigrationCount, migrationsApplied } from "./migrate";
import * as appSchema from "./schema";

export const schema = { ...appSchema, ...authSchema };
export type Orm = PostgresJsDatabase<typeof schema>;

/** The database as the app uses it. Tests can replace the probes with fakes. */
export interface Database {
  sql: Sql;
  orm: Orm;
  /** Rejects when the database cannot be reached. */
  ping(): Promise<void>;
  /** True when every migration this build ships has been applied. */
  migrationsApplied(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(url: string): Database {
  // postgres.js connects lazily, so a database that is still starting does not stop the server
  // booting; /readyz reports 503 until it is reachable and migrated.
  const sql = postgres(url, {
    max: 10,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  const expected = expectedMigrationCount();
  return {
    sql,
    orm: drizzle(sql, { schema }),
    async ping() {
      await sql`select 1`;
    },
    migrationsApplied: () => migrationsApplied(sql, expected),
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
