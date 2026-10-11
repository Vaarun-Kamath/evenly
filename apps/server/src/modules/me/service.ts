import type { MeResponse, UpdateMeRequest } from "@evenly/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { user } from "../../db/auth-schema";
import type { Orm } from "../../db/client";
import { groupMembers, groups } from "../../db/schema";
import { conflict } from "../../http/problem";
import { netsForMembers } from "../balances/nets";
import { recordActivity } from "../common/activity";
import type { Actor } from "../common/db";

const DELETED_USER_NAME = "Deleted user";

export function toMe(row: {
  id: string;
  name: string;
  email: string;
  defaultCurrency?: string | null | undefined;
  createdAt: Date;
}): MeResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    defaultCurrency: row.defaultCurrency ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Edits the profile. A new name is also copied to the person's memberships, so groups show it
 * straight away (a member's display name follows their account; only placeholders are named by hand).
 */
export async function updateProfile(
  orm: Orm,
  userId: string,
  input: UpdateMeRequest,
): Promise<MeResponse> {
  return orm.transaction(async (tx) => {
    const [updated] = await tx
      .update(user)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.defaultCurrency !== undefined && { defaultCurrency: input.defaultCurrency }),
      })
      .where(eq(user.id, userId))
      .returning();
    if (updated === undefined) throw new Error("The signed-in user does not exist");
    if (input.name !== undefined) {
      await tx
        .update(groupMembers)
        .set({ displayName: input.name })
        .where(eq(groupMembers.userId, userId));
    }
    return toMe(updated);
  });
}

/**
 * Deletes the account (ADR-0003). Refused while the user owns a group (they must hand it over or
 * delete it) or has an unsettled balance in any group, archived ones included. Otherwise their
 * memberships stay, anonymised as "Deleted user" and marked as left, so group history stays intact,
 * and the account (with its sessions) goes away.
 */
export async function deleteAccount(orm: Orm, actor: Actor): Promise<void> {
  await orm.transaction(async (tx) => {
    const active = await tx
      .select({ member: groupMembers, group: groups })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.userId, actor.userId),
          isNull(groupMembers.leftAt),
          isNull(groups.deletedAt),
        ),
      );

    const owned = active.filter(({ member }) => member.role === "owner");
    if (owned.length > 0) {
      throw conflict(
        "owns-groups",
        `You own ${owned.map(({ group }) => `"${group.name}"`).join(", ")}. ` +
          "Hand each group over to someone else, or delete it, before deleting your account.",
      );
    }

    const nets = await netsForMembers(
      tx,
      active.map(({ member }) => member.id),
    );
    const unsettled = active.filter(({ member }) => (nets.get(member.id) ?? 0) !== 0);
    if (unsettled.length > 0) {
      throw conflict(
        "non-zero-balance",
        `You still have an unsettled balance in ${unsettled.map(({ group }) => `"${group.name}"`).join(", ")}. ` +
          "Settle up before deleting your account.",
      );
    }

    const now = new Date();
    for (const { member, group } of active) {
      await recordActivity(tx, {
        groupId: group.id,
        actorId: member.id,
        kind: "member.left",
        entityId: member.id,
        diff: { displayName: member.displayName, reason: "account-deleted" },
      });
    }
    await tx
      .update(groupMembers)
      .set({ userId: null, displayName: DELETED_USER_NAME, email: null, leftAt: now })
      .where(and(eq(groupMembers.userId, actor.userId), isNull(groupMembers.leftAt)));
    await tx
      .update(groupMembers)
      .set({ userId: null, displayName: DELETED_USER_NAME, email: null })
      .where(eq(groupMembers.userId, actor.userId));
    await tx.delete(user).where(eq(user.id, actor.userId));
  });
}
