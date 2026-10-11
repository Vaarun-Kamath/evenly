import type { AddPlaceholderRequest, Member, UpdateMemberRequest } from "@evenly/contracts";
import { formatMinor } from "@evenly/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { newId } from "../../db/ids";
import { groupInvites, groupMembers } from "../../db/schema";
import { conflict, forbidden, notFound } from "../../http/problem";
import { netsForGroup } from "../balances/nets";
import {
  assertWritable,
  isUuid,
  outranks,
  requireMember,
  type GroupRow,
  type MemberRow,
} from "../common/access";
import { diffOf, recordActivity } from "../common/activity";
import { nextJoinedAt } from "../common/joined";
import { toIso, toIsoOrNull, type Actor, type DbOrTx, type Tx } from "../common/db";

function toMember(row: MemberRow, group: GroupRow, actor: Actor, net: number): Member {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    isPlaceholder: row.userId === null && row.leftAt === null,
    isYou: row.userId === actor.userId,
    email: row.userId === null ? row.email : null,
    joinedAt: toIso(row.joinedAt),
    leftAt: toIsoOrNull(row.leftAt),
    net: { amountMinor: net, currency: group.currency },
  };
}

/** A member of the group by id, whether or not they are still active. */
async function findMember(db: DbOrTx, groupId: string, memberId: string): Promise<MemberRow> {
  if (!isUuid(memberId)) throw notFound();
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
    .limit(1);
  if (row === undefined) throw notFound();
  return row;
}

/** Every member of the group in canonical order (joined first), former members included. */
export async function listMembers(orm: Orm, actor: Actor, groupId: string): Promise<Member[]> {
  const { group } = await requireMember(orm, groupId, actor.userId);
  const [rows, nets] = await Promise.all([
    orm
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id)),
    netsForGroup(orm, groupId),
  ]);
  return rows.map((row) => toMember(row, group, actor, nets.get(row.id) ?? 0));
}

/** Anyone in the group: add a person who has no account yet, so expenses can include them at once. */
export async function addPlaceholder(
  orm: Orm,
  actor: Actor,
  groupId: string,
  input: AddPlaceholderRequest,
): Promise<Member> {
  const memberId = newId();
  const group = await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    await tx.insert(groupMembers).values({
      id: memberId,
      groupId,
      userId: null,
      displayName: input.displayName,
      email: input.email ?? null,
      role: "member",
      joinedAt: nextJoinedAt(groupId),
    });
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "member.added",
      entityId: memberId,
      diff: { displayName: input.displayName },
    });
    return group;
  });
  const row = await findMember(orm, groupId, memberId);
  return toMember(row, group, actor, 0);
}

/**
 * Owner: change a role or hand the group over. Admin: rename a placeholder or change their email.
 * Accounts' names come from their profile, so only placeholders can be renamed.
 */
export async function updateMember(
  orm: Orm,
  actor: Actor,
  groupId: string,
  memberId: string,
  input: UpdateMemberRequest,
): Promise<Member> {
  const group = await orm.transaction(async (tx) => {
    const { group, member: me } = await requireMember(
      tx,
      groupId,
      actor.userId,
      input.role === undefined ? "admin" : "owner",
      { lock: true },
    );
    assertWritable(group);
    const target = await findMember(tx, groupId, memberId);
    if (target.leftAt !== null) {
      throw conflict("member-left", "This person is no longer in the group.");
    }

    if (input.role !== undefined && input.role !== target.role) {
      await changeRole(tx, group, me, target, input.role);
    }
    if (input.displayName !== undefined || input.email !== undefined) {
      if (me.role === "member") throw forbidden("This needs the admin role or higher.");
      if (target.userId !== null) {
        throw conflict(
          "not-a-placeholder",
          "Only people without an account can be renamed; accounts use their own name.",
        );
      }
      const changes = {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.email !== undefined && { email: input.email }),
      };
      const diff = diffOf({ displayName: target.displayName, email: target.email }, changes);
      if (Object.keys(diff).length > 0) {
        await tx.update(groupMembers).set(changes).where(eq(groupMembers.id, target.id));
        await recordActivity(tx, {
          groupId,
          actorId: me.id,
          kind: "member.updated",
          entityId: target.id,
          diff,
        });
      }
    }
    return group;
  });
  const [row, nets] = await Promise.all([
    findMember(orm, groupId, memberId),
    netsForGroup(orm, groupId),
  ]);
  return toMember(row, group, actor, nets.get(row.id) ?? 0);
}

async function changeRole(
  tx: Tx,
  group: GroupRow,
  me: MemberRow,
  target: MemberRow,
  role: MemberRow["role"],
): Promise<void> {
  if (target.id === me.id) {
    throw conflict("own-role", "You cannot change your own role. Hand the group over instead.");
  }
  if (target.userId === null) {
    throw conflict("placeholder-role", "Only people with an account can be admins or owners.");
  }
  await tx.update(groupMembers).set({ role }).where(eq(groupMembers.id, target.id));
  await recordActivity(tx, {
    groupId: group.id,
    actorId: me.id,
    kind: "member.role_changed",
    entityId: target.id,
    diff: { role: [target.role, role] },
  });
  if (role === "owner") {
    // Handing the group over: exactly one owner at all times (ADR-0003).
    await tx.update(groupMembers).set({ role: "admin" }).where(eq(groupMembers.id, me.id));
    await recordActivity(tx, {
      groupId: group.id,
      actorId: me.id,
      kind: "member.role_changed",
      entityId: me.id,
      diff: { role: ["owner", "admin"] },
    });
  }
}

/**
 * Leave the group (yourself), or remove someone (an admin removes members and placeholders; the owner
 * also removes admins). Only with a zero balance, and never the owner (ADR-0003). The member row stays,
 * marked as left, so history keeps its names.
 */
export async function removeMember(
  orm: Orm,
  actor: Actor,
  groupId: string,
  memberId: string,
): Promise<void> {
  await orm.transaction(async (tx) => {
    const { group, member: me } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const target = await findMember(tx, groupId, memberId);
    if (target.leftAt !== null) throw notFound();

    const leaving = target.id === me.id;
    if (target.role === "owner") {
      throw conflict(
        "owner-cannot-leave",
        "The owner cannot leave or be removed. Hand the group over to someone else first, or delete it.",
      );
    }
    if (!leaving && (me.role === "member" || !outranks(me.role, target.role))) {
      throw forbidden(
        me.role === "member"
          ? "This needs the admin role or higher."
          : "Only the owner can remove an admin.",
      );
    }

    const nets = await netsForGroup(tx, groupId);
    const net = nets.get(target.id) ?? 0;
    if (net !== 0) {
      const who = leaving ? "You still have" : `${target.displayName} still has`;
      throw conflict(
        "non-zero-balance",
        `${who} an unsettled balance of ${formatMinor(Math.abs(net), group.currency)}. ` +
          "Settle up before leaving the group.",
      );
    }

    const now = sql`now()`;
    await tx.update(groupMembers).set({ leftAt: now }).where(eq(groupMembers.id, target.id));
    // A link that would let someone claim this person no longer has anything to claim.
    await tx
      .update(groupInvites)
      .set({ revokedAt: now })
      .where(and(eq(groupInvites.claimMemberId, target.id), isNull(groupInvites.revokedAt)));
    await recordActivity(tx, {
      groupId,
      actorId: me.id,
      kind: leaving ? "member.left" : "member.removed",
      entityId: target.id,
      diff: { displayName: target.displayName },
    });
  });
}
