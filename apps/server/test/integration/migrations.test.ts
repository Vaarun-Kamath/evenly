import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  expectedMigrationCount,
  findMigrationsFolder,
  migrationsApplied,
  runMigrations,
} from "../../src/db/migrate";
import { createDatabase } from "../../src/db/client";
import { createTestDatabase } from "./testDb";
import { startHarness } from "./harness";

describe("migrations", () => {
  it("find their folder and know how many there are", () => {
    expect(findMigrationsFolder()).toMatch(/drizzle$/);
    expect(expectedMigrationCount()).toBeGreaterThanOrEqual(3);
    expect(() => findMigrationsFolder(tmpdir())).toThrow(/Cannot find the migrations folder/);
  });

  it("apply to an empty database, and again without changing anything", async () => {
    const database = await createTestDatabase({ migrated: false });
    const db = createDatabase(database.url);
    try {
      const expected = expectedMigrationCount();
      expect(await migrationsApplied(db.sql, expected)).toBe(false);

      await runMigrations(database.url);
      expect(await migrationsApplied(db.sql, expected)).toBe(true);
      const tables = await db.sql<{ table_name: string }[]>`
        select table_name from information_schema.tables where table_schema = 'public' order by 1
      `;
      expect(tables.map((t) => t.table_name)).toEqual(
        expect.arrayContaining([
          "user",
          "session",
          "account",
          "verification",
          "groups",
          "group_members",
          "group_invites",
          "expenses",
          "expense_payers",
          "expense_shares",
          "settlements",
          "activity",
          "instance_secrets",
        ]),
      );
      const [extension] = await db.sql`select 1 from pg_extension where extname = 'citext'`;
      expect(extension).toBeDefined();

      await runMigrations(database.url);
      const [{ count } = { count: "missing" }] = await db.sql<{ count: string }[]>`
        select count(*)::text as count from drizzle.__drizzle_migrations
      `;
      expect(Number(count)).toBe(expected);
    } finally {
      await db.close();
      await database.drop();
    }
  });

  it("take turns when several replicas start at once (advisory lock)", async () => {
    const database = await createTestDatabase({ migrated: false });
    const db = createDatabase(database.url);
    try {
      const results = await Promise.allSettled([
        runMigrations(database.url),
        runMigrations(database.url),
        runMigrations(database.url),
        runMigrations(database.url),
      ]);
      expect(results.map((r) => r.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      const [{ count } = { count: "missing" }] = await db.sql<{ count: string }[]>`
        select count(*)::text as count from drizzle.__drizzle_migrations
      `;
      expect(Number(count)).toBe(expectedMigrationCount());
    } finally {
      await db.close();
      await database.drop();
    }
  });

  it("make /readyz wait: 503 on an unmigrated database, 200 once migrated", async () => {
    const h = await startHarness({ migrated: false });
    try {
      expect((await h.app.inject({ url: "/healthz" })).statusCode).toBe(200);
      expect((await h.app.inject({ url: "/readyz" })).statusCode).toBe(503);
      await runMigrations(h.database.url);
      expect((await h.app.inject({ url: "/readyz" })).statusCode).toBe(200);
    } finally {
      await h.close();
    }
  });

  it("report 503 on /readyz when the database is unreachable", async () => {
    const h = await startHarness();
    try {
      await h.db.sql.end({ timeout: 1 });
      // The pool is closed, so any query fails: the same as a database that went away.
      expect((await h.app.inject({ url: "/readyz" })).statusCode).toBe(503);
      expect((await h.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    } finally {
      await h.app.close();
      await h.database.drop();
    }
  });
});
