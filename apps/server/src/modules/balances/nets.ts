import { sql, type SQL } from "drizzle-orm";
import { assertSafeInteger } from "@evenly/core";
import type { DbOrTx } from "../common/db";

/**
 * Net balance per member: `paid - owed share + settlements sent - settlements received`, live rows
 * only (ARCHITECTURE.md section 5.3), as one SQL statement. It is the same rule as `computeNets` in
 * @evenly/core, which the tests use to cross-check this query.
 */
function netsQuery(filter: SQL): SQL {
  return sql`
    select m.id as member_id,
           (
             coalesce((
               select sum(p.amount_minor) from expense_payers p
               join expenses e on e.id = p.expense_id
               where e.group_id = m.group_id and e.deleted_at is null and p.member_id = m.id
             ), 0)
             - coalesce((
               select sum(s.amount_minor) from expense_shares s
               join expenses e on e.id = s.expense_id
               where e.group_id = m.group_id and e.deleted_at is null and s.member_id = m.id
             ), 0)
             + coalesce((
               select sum(t.amount_minor) from settlements t
               where t.group_id = m.group_id and t.deleted_at is null and t.from_member_id = m.id
             ), 0)
             - coalesce((
               select sum(t.amount_minor) from settlements t
               where t.group_id = m.group_id and t.deleted_at is null and t.to_member_id = m.id
             ), 0)
           )::text as net
    from group_members m
    where ${filter}`;
}

async function run(db: DbOrTx, filter: SQL): Promise<Map<string, number>> {
  const rows = await db.execute<{ member_id: string; net: string }>(netsQuery(filter));
  return new Map(
    rows.map((row) => [row.member_id, assertSafeInteger(Number(row.net), "net balance")]),
  );
}

/** Net balance of every member (active or not) of one group. */
export function netsForGroup(db: DbOrTx, groupId: string): Promise<Map<string, number>> {
  return run(db, sql`m.group_id = ${groupId}`);
}

/** Net balance of the given memberships (each in its own group). */
export function netsForMembers(
  db: DbOrTx,
  memberIds: readonly string[],
): Promise<Map<string, number>> {
  if (memberIds.length === 0) return Promise.resolve(new Map<string, number>());
  return run(
    db,
    sql`m.id in (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
}
