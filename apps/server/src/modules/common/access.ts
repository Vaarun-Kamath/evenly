import { and, eq, isNull } from "drizzle-orm";
import { groupMembers, groups } from "../../db/schema";
import { conflict, forbidden, notFound } from "../../http/problem";
import type { DbOrTx } from "./db";

const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_RANK;

export type GroupRow = typeof groups.$inferSelect;
export type MemberRow = typeof groupMembers.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export interface Access {
  group: GroupRow;
  /** The caller's own active membership. */
  member: MemberRow;
}

/**
 * Authorization for every group operation, run first (ARCHITECTURE.md section 3). A user who is not
 * an active member of an existing group gets the same 404 as for a group that does not exist, so
 * group ids cannot be probed; a member with too low a role gets 403.
 *
 * With `lock`, the group row is locked for the rest of the transaction, so concurrent changes to
 * membership and roles take turns.
 */
export async function requireMember(
  db: DbOrTx,
  groupId: string,
  userId: string,
  minRole: Role = "member",
  options: { lock?: boolean } = {},
): Promise<Access> {
  if (!isUuid(groupId)) throw notFound();
  const query = db
    .select({ group: groups, member: groupMembers })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
        isNull(groups.deletedAt),
      ),
    )
    .limit(1);
  const [row] = options.lock === true ? await query.for("update", { of: groups }) : await query;
  if (row === undefined) throw notFound();
  if (ROLE_RANK[row.member.role] < ROLE_RANK[minRole]) {
    throw forbidden(`This needs the ${minRole} role or higher.`);
  }
  return row;
}

export const outranks = (a: Role, b: Role): boolean => ROLE_RANK[a] > ROLE_RANK[b];

/** An archived group is read-only. */
export function assertWritable(group: GroupRow): void {
  if (group.archivedAt !== null) {
    throw conflict("group-archived", "This group is archived and read-only.");
  }
}
