import { sql, type SQL } from "drizzle-orm";

/**
 * The `joined_at` for a person joining `groupId` now. It is the database clock, but never earlier than the
 * latest member already in the group (plus a microsecond), so the canonical member order (`joined_at`,
 * then `id`), which decides who receives the odd minor units, always follows who joined first, even if the
 * database clock steps backwards. Call it in a transaction that holds the group's row lock, so two people
 * joining at once take turns.
 */
export function nextJoinedAt(groupId: string): SQL<Date> {
  return sql<Date>`greatest(
    now(),
    coalesce((select max(joined_at) from group_members where group_id = ${groupId}), 'epoch'::timestamptz)
      + interval '1 microsecond'
  )`;
}
