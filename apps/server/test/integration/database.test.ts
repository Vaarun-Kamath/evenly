import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/db/ids";
import { getOrCreateSessionSecret } from "../../src/db/secret";
import { startHarness, uniqueEmail, type Harness } from "./harness";

/** Rows to hang expenses on: a user, a group and two members. */
async function seedGroup(h: Harness) {
  const sql = h.db.sql;
  const [user] = await sql<{ id: string }[]>`
    insert into "user" (name, email) values ('Seed User', ${uniqueEmail()}) returning id
  `;
  const groupId = newId();
  await sql`insert into groups (id, name, currency, created_by) values (${groupId}, 'Trip', 'INR', ${user!.id})`;
  const a = newId();
  const b = newId();
  await sql`insert into group_members (id, group_id, user_id, display_name) values (${a}, ${groupId}, ${user!.id}, 'A')`;
  await sql`insert into group_members (id, group_id, display_name) values (${b}, ${groupId}, 'B')`;
  return { userId: user!.id, groupId, a, b };
}

describe("database constraints", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const expenseRow = (groupId: string, createdBy: string, amount: number, id = newId()) => ({
    id,
    groupId,
    createdBy,
    amount,
  });

  describe("expense totals (deferred trigger)", () => {
    it("accepts payers and shares that add up, written in one transaction", async () => {
      const { groupId, a, b } = await seedGroup(h);
      const e = expenseRow(groupId, a, 100000);
      await h.db.sql.begin(async (tx) => {
        await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                 values (${e.id}, ${groupId}, 'Dinner', ${e.amount}, 'INR', '2026-10-10', 'equal', ${a})`;
        await tx`insert into expense_payers (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 100000)`;
        await tx`insert into expense_shares (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 50000), (${e.id}, ${b}, 50000)`;
      });
      const [row] = await h.db.sql`select 1 from expenses where id = ${e.id}`;
      expect(row).toBeDefined();
    });

    it("rejects payers that do not add up to the amount, at commit", async () => {
      const { groupId, a, b } = await seedGroup(h);
      const e = expenseRow(groupId, a, 100000);
      await expect(
        h.db.sql.begin(async (tx) => {
          await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                   values (${e.id}, ${groupId}, 'Dinner', ${e.amount}, 'INR', '2026-10-10', 'equal', ${a})`;
          await tx`insert into expense_payers (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 99999)`;
          await tx`insert into expense_shares (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 50000), (${e.id}, ${b}, 50000)`;
        }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await h.db.sql`select 1 from expenses where id = ${e.id}`).toHaveLength(0);
    });

    it("rejects shares that do not add up, and an expense with no payers or shares", async () => {
      const { groupId, a, b } = await seedGroup(h);
      const shortShares = expenseRow(groupId, a, 1000);
      await expect(
        h.db.sql.begin(async (tx) => {
          await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                   values (${shortShares.id}, ${groupId}, 'X', 1000, 'INR', '2026-10-10', 'equal', ${a})`;
          await tx`insert into expense_payers (expense_id, member_id, amount_minor) values (${shortShares.id}, ${a}, 1000)`;
          await tx`insert into expense_shares (expense_id, member_id, amount_minor) values (${shortShares.id}, ${b}, 999)`;
        }),
      ).rejects.toMatchObject({ code: "23514" });

      const empty = expenseRow(groupId, a, 1000);
      await expect(
        h.db.sql.begin(async (tx) => {
          await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                   values (${empty.id}, ${groupId}, 'Empty', 1000, 'INR', '2026-10-10', 'equal', ${a})`;
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("keeps an existing expense consistent when its rows or amount change", async () => {
      const { groupId, a, b } = await seedGroup(h);
      const e = expenseRow(groupId, a, 1000);
      await h.db.sql.begin(async (tx) => {
        await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                 values (${e.id}, ${groupId}, 'Taxi', 1000, 'INR', '2026-10-10', 'equal', ${a})`;
        await tx`insert into expense_payers (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 1000)`;
        await tx`insert into expense_shares (expense_id, member_id, amount_minor) values (${e.id}, ${a}, 500), (${e.id}, ${b}, 500)`;
      });

      // Changing only the amount, or removing one share, is caught.
      await expect(
        h.db.sql`update expenses set amount_minor = 2000 where id = ${e.id}`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        h.db.sql`delete from expense_shares where expense_id = ${e.id} and member_id = ${b}`,
      ).rejects.toMatchObject({ code: "23514" });

      // Changing the amount together with payers and shares is fine.
      await h.db.sql.begin(async (tx) => {
        await tx`update expenses set amount_minor = 2000, version = version + 1 where id = ${e.id}`;
        await tx`update expense_payers set amount_minor = 2000 where expense_id = ${e.id}`;
        await tx`update expense_shares set amount_minor = 1000 where expense_id = ${e.id}`;
      });
      const [row] = await h.db.sql<
        { amount_minor: string }[]
      >`select amount_minor::text from expenses where id = ${e.id}`;
      expect(row?.amount_minor).toBe("2000");

      // Soft delete and hard delete (cascade) are not blocked.
      await h.db.sql`update expenses set deleted_at = now() where id = ${e.id}`;
      await h.db.sql`delete from expenses where id = ${e.id}`;
      expect(await h.db.sql`select 1 from expense_payers where expense_id = ${e.id}`).toHaveLength(
        0,
      );
    });
  });

  describe("value constraints", () => {
    it("reject amounts outside 1 to 10^12 and a settlement to yourself", async () => {
      const { groupId, a, b } = await seedGroup(h);
      const insertExpense = (amount: number) =>
        h.db
          .sql`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                 values (${newId()}, ${groupId}, 'X', ${amount}, 'INR', '2026-10-10', 'equal', ${a})`;
      await expect(insertExpense(0)).rejects.toMatchObject({ code: "23514" });
      await expect(insertExpense(-5)).rejects.toMatchObject({ code: "23514" });
      await expect(insertExpense(1_000_000_000_001)).rejects.toMatchObject({ code: "23514" });

      const settle = (from: string, to: string, amount: number) =>
        h.db
          .sql`insert into settlements (id, group_id, from_member_id, to_member_id, amount_minor, currency, settled_on, created_by)
                 values (${newId()}, ${groupId}, ${from}, ${to}, ${amount}, 'INR', '2026-10-10', ${a})`;
      await expect(settle(a, a, 100)).rejects.toMatchObject({ code: "23514" });
      await expect(settle(a, b, 0)).rejects.toMatchObject({ code: "23514" });
      await expect(settle(a, b, 100)).resolves.toBeDefined();
    });

    it("reject empty or over-long names and descriptions, and zero invite uses", async () => {
      const { groupId, a } = await seedGroup(h);
      await expect(
        h.db.sql`insert into groups (id, name, currency) values (${newId()}, '', 'INR')`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        h.db
          .sql`insert into groups (id, name, currency) values (${newId()}, ${"x".repeat(101)}, 'INR')`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        h.db
          .sql`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
                 values (${newId()}, ${groupId}, ${"x".repeat(201)}, 100, 'INR', '2026-10-10', 'equal', ${a})`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        h.db.sql`insert into group_invites (id, group_id, token_hash, created_by, max_uses)
                 values (${newId()}, ${groupId}, ${Buffer.from("hash-1")}, ${a}, 0)`,
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("memberships", () => {
    it("allow one row per user per group, but any number of placeholders", async () => {
      const { userId, groupId } = await seedGroup(h);
      await expect(
        h.db
          .sql`insert into group_members (id, group_id, user_id, display_name) values (${newId()}, ${groupId}, ${userId}, 'Again')`,
      ).rejects.toMatchObject({ code: "23505" });
      await h.db
        .sql`insert into group_members (id, group_id, display_name) values (${newId()}, ${groupId}, 'Placeholder 1')`;
      await h.db
        .sql`insert into group_members (id, group_id, display_name) values (${newId()}, ${groupId}, 'Placeholder 2')`;
    });

    it("compare email case-insensitively (citext)", async () => {
      const { groupId } = await seedGroup(h);
      await h.db
        .sql`insert into group_members (id, group_id, display_name, email) values (${newId()}, ${groupId}, 'P', 'Mixed.Case@Example.com')`;
      const rows = await h.db
        .sql`select 1 from group_members where email = 'mixed.case@example.com'`;
      expect(rows).toHaveLength(1);
    });

    it("keep their history when the user is deleted: user ids become NULL (ADR-0003)", async () => {
      const { userId, groupId, a } = await seedGroup(h);
      await h.db.sql`delete from "user" where id = ${userId}`;
      const [member] = await h.db.sql<
        { user_id: string | null }[]
      >`select user_id from group_members where id = ${a}`;
      const [group] = await h.db.sql<
        { created_by: string | null }[]
      >`select created_by from groups where id = ${groupId}`;
      expect(member?.user_id).toBeNull();
      expect(group?.created_by).toBeNull();
    });

    it("sessions go away with their user", async () => {
      const session = await h.signUp();
      expect(
        await h.db.sql`select 1 from session where user_id = ${session.userId}`,
      ).not.toHaveLength(0);
      await h.db.sql`delete from "user" where id = ${session.userId}`;
      expect(await h.db.sql`select 1 from session where user_id = ${session.userId}`).toHaveLength(
        0,
      );
    });
  });
});

describe("instance secret and ids", () => {
  it("creates the session secret once, even when several replicas ask at the same time", async () => {
    const h = await startHarness();
    try {
      const values = await Promise.all(
        Array.from({ length: 6 }, () => getOrCreateSessionSecret(h.db.orm)),
      );
      expect(new Set(values).size).toBe(1);
      expect(values[0]?.length).toBeGreaterThanOrEqual(43);
      expect(await getOrCreateSessionSecret(h.db.orm)).toBe(values[0]);
      expect(await h.db.sql`select 1 from instance_secrets`).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it("generates time-ordered UUIDv7 ids", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
  });
});
