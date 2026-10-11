import type { Group } from "@evenly/contracts";
import type { CreateGroupRequest, UpdateGroupRequest } from "@evenly/contracts";
import { and, count, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { newId } from "../../db/ids";
import { groupMembers, groups } from "../../db/schema";
import { conflict } from "../../http/problem";
import { netsForGroup, netsForMembers } from "../balances/nets";
import { assertWritable, requireMember, type GroupRow, type MemberRow } from "../common/access";
import { diffOf, recordActivity } from "../common/activity";
import { toIso, toIsoOrNull, type Actor, type DbOrTx } from "../common/db";

function toGroup(group: GroupRow, member: MemberRow, memberCount: number, net: number): Group {
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    emoji: group.emoji,
    simplifyDebts: group.simplifyDebts,
    createdAt: toIso(group.createdAt),
    archivedAt: toIsoOrNull(group.archivedAt),
    myRole: member.role,
    memberCount,
    myBalance: { amountMinor: net, currency: group.currency },
  };
}

async function activeMemberCount(db: DbOrTx, groupId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  return row?.value ?? 0;
}

/** One group as the caller sees it. */
export async function loadGroup(db: DbOrTx, groupId: string, actor: Actor): Promise<Group> {
  const { group, member } = await requireMember(db, groupId, actor.userId);
  const [memberCount, nets] = await Promise.all([
    activeMemberCount(db, groupId),
    netsForMembers(db, [member.id]),
  ]);
  return toGroup(group, member, memberCount, nets.get(member.id) ?? 0);
}

/** The caller's groups, with their role and net balance in each. */
export async function listGroups(
  orm: Orm,
  actor: Actor,
  archived: "exclude" | "only" | "include",
): Promise<Group[]> {
  const rows = await orm
    .select({
      group: groups,
      member: groupMembers,
      memberCount: sql<number>`(
        select count(*)::int from group_members x
        where x.group_id = ${groups.id} and x.left_at is null
      )`,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, actor.userId),
        isNull(groupMembers.leftAt),
        isNull(groups.deletedAt),
        archived === "exclude" ? isNull(groups.archivedAt) : undefined,
        archived === "only" ? isNotNull(groups.archivedAt) : undefined,
      ),
    )
    .orderBy(sql`${groups.createdAt} desc, ${groups.id} desc`);
  const nets = await netsForMembers(
    orm,
    rows.map((row) => row.member.id),
  );
  return rows.map((row) =>
    toGroup(row.group, row.member, row.memberCount, nets.get(row.member.id) ?? 0),
  );
}

/** Creates a group; its creator becomes the owner. */
export async function createGroup(
  orm: Orm,
  actor: Actor,
  input: CreateGroupRequest,
): Promise<Group> {
  const groupId = newId();
  await orm.transaction(async (tx) => {
    await tx.insert(groups).values({
      id: groupId,
      name: input.name,
      currency: input.currency,
      emoji: input.emoji ?? null,
      simplifyDebts: input.simplifyDebts ?? true,
      createdBy: actor.userId,
    });
    const memberId = newId();
    await tx.insert(groupMembers).values({
      id: memberId,
      groupId,
      userId: actor.userId,
      displayName: actor.name,
      role: "owner",
    });
    await recordActivity(tx, {
      groupId,
      actorId: memberId,
      kind: "group.created",
      entityId: groupId,
      diff: { name: input.name, currency: input.currency },
    });
  });
  return loadGroup(orm, groupId, actor);
}

/** Admin: rename, change the emoji or the simplify-debts setting. The currency never changes. */
export async function updateGroup(
  orm: Orm,
  actor: Actor,
  groupId: string,
  input: UpdateGroupRequest,
): Promise<Group> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "admin", {
      lock: true,
    });
    assertWritable(group);
    const diff = diffOf(
      { name: group.name, emoji: group.emoji, simplifyDebts: group.simplifyDebts },
      {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.emoji !== undefined && { emoji: input.emoji }),
        ...(input.simplifyDebts !== undefined && { simplifyDebts: input.simplifyDebts }),
      },
    );
    if (Object.keys(diff).length === 0) return;
    await tx
      .update(groups)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.emoji !== undefined && { emoji: input.emoji }),
        ...(input.simplifyDebts !== undefined && { simplifyDebts: input.simplifyDebts }),
        updatedAt: sql`now()`,
      })
      .where(eq(groups.id, groupId));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "group.updated",
      entityId: groupId,
      diff,
    });
  });
  return loadGroup(orm, groupId, actor);
}

/** Admin: archive (read-only, off the main list) or unarchive. Doing it twice changes nothing. */
export async function setArchived(
  orm: Orm,
  actor: Actor,
  groupId: string,
  archived: boolean,
): Promise<Group> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "admin", {
      lock: true,
    });
    if ((group.archivedAt !== null) === archived) return;
    await tx
      .update(groups)
      .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
      .where(eq(groups.id, groupId));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: archived ? "group.archived" : "group.unarchived",
      entityId: groupId,
    });
  });
  return loadGroup(orm, groupId, actor);
}

/** Owner: delete the group, only when every balance in it is zero. */
export async function deleteGroup(orm: Orm, actor: Actor, groupId: string): Promise<void> {
  await orm.transaction(async (tx) => {
    const { member } = await requireMember(tx, groupId, actor.userId, "owner", { lock: true });
    const nets = await netsForGroup(tx, groupId);
    if ([...nets.values()].some((net) => net !== 0)) {
      throw conflict(
        "non-zero-balance",
        "A group can be deleted only when everyone is settled up. Record the remaining settlements first.",
      );
    }
    await tx
      .update(groups)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(groups.id, groupId));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "group.deleted",
      entityId: groupId,
    });
  });
}
