import type {
  AcceptInviteResponse,
  CreateInviteRequest,
  CreatedInvite,
  Invite,
  InvitePreview,
} from "@evenly/contracts";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Orm } from "../../db/client";
import { newId } from "../../db/ids";
import { groupInvites, groupMembers, groups } from "../../db/schema";
import type { Env } from "../../env";
import { conflict, gone, notFound, ProblemError } from "../../http/problem";
import type { Mailer } from "../../mail/mailer";
import { assertWritable, isUuid, requireMember, type MemberRow } from "../common/access";
import { recordActivity } from "../common/activity";
import { toIso, toIsoOrNull, type Actor, type DbOrTx, type Tx } from "../common/db";
import { hashInviteToken, isWellFormedToken, newInviteToken } from "./token";

export interface InviteContext {
  orm: Orm;
  env: Pick<Env, "PUBLIC_URL" | "INVITE_DEFAULT_TTL_DAYS">;
  /** Present only when SMTP is configured. */
  mailer?: Mailer | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS = { "1d": 1, "7d": 7, "30d": 30 } as const;

type InviteRow = typeof groupInvites.$inferSelect;
const creator = alias(groupMembers, "creator");
const claimTarget = alias(groupMembers, "claim_target");

type InviteStatus = Invite["status"];

function statusOf(row: InviteRow, now: Date): InviteStatus {
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt !== null && row.expiresAt <= now) return "expired";
  if (row.maxUses !== null && row.useCount >= row.maxUses) return "used-up";
  return "active";
}

function inviteUrl(env: InviteContext["env"], token: string): string {
  return `${env.PUBLIC_URL.replace(/\/+$/, "")}/invite/${token}`;
}

async function loadInviteDto(db: DbOrTx, groupId: string, inviteId: string): Promise<Invite> {
  const [invite] = await listInviteRows(db, groupId, inviteId);
  if (invite === undefined) throw notFound();
  return invite;
}

async function listInviteRows(db: DbOrTx, groupId: string, onlyId?: string): Promise<Invite[]> {
  const now = new Date();
  const rows = await db
    .select({
      invite: groupInvites,
      creatorName: creator.displayName,
      claimName: claimTarget.displayName,
    })
    .from(groupInvites)
    .innerJoin(creator, eq(creator.id, groupInvites.createdBy))
    .leftJoin(claimTarget, eq(claimTarget.id, groupInvites.claimMemberId))
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        onlyId === undefined ? undefined : eq(groupInvites.id, onlyId),
      ),
    )
    .orderBy(desc(groupInvites.createdAt), desc(groupInvites.id));
  return rows.map(({ invite, creatorName, claimName }) => ({
    id: invite.id,
    createdBy: { memberId: invite.createdBy, displayName: creatorName },
    createdAt: toIso(invite.createdAt),
    expiresAt: toIsoOrNull(invite.expiresAt),
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    revokedAt: toIsoOrNull(invite.revokedAt),
    email: invite.email,
    claimMember:
      invite.claimMemberId === null || claimName === null
        ? null
        : { memberId: invite.claimMemberId, displayName: claimName },
    status: statusOf(invite, now),
  }));
}

/** Anyone in the group: create an invite link (and email it, if asked and possible). */
export async function createInvite(
  ctx: InviteContext,
  actor: Actor,
  groupId: string,
  input: CreateInviteRequest,
): Promise<CreatedInvite> {
  if (input.email !== undefined && ctx.mailer === undefined) {
    throw conflict(
      "email-not-configured",
      "This instance cannot send email, so it cannot email an invitation. Create a link and share it yourself.",
    );
  }
  const { token, hash } = newInviteToken();
  const inviteId = newId();

  const { groupName, inviterName } = await ctx.orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);

    let claimMemberId: string | null = null;
    let claimName: string | null = null;
    if (input.claimMemberId !== undefined) {
      const target = await findMemberRow(tx, groupId, input.claimMemberId);
      if (!isClaimable(target)) {
        throw conflict("claim-unavailable", "That person is not a placeholder in this group.");
      }
      claimMemberId = target.id;
      claimName = target.displayName;
    }

    const expiresAt = expiryDate(ctx.env, input.expiresIn);
    await tx.insert(groupInvites).values({
      id: inviteId,
      groupId,
      tokenHash: hash,
      createdBy: member.id,
      email: input.email ?? null,
      claimMemberId,
      expiresAt,
      // A link that claims a placeholder works once: after that the placeholder has an owner.
      maxUses: claimMemberId === null ? (input.maxUses ?? null) : 1,
    });
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "invite.created",
      entityId: inviteId,
      diff: {
        ...(claimName !== null && { claim: claimName }),
        ...(input.email !== undefined && { email: input.email }),
      },
    });
    return { groupName: group.name, inviterName: member.displayName };
  });

  const url = inviteUrl(ctx.env, token);
  if (input.email !== undefined && ctx.mailer !== undefined) {
    try {
      await ctx.mailer.send({
        to: input.email,
        subject: `${inviterName} invited you to ${groupName} on Evenly`,
        text:
          `${inviterName} invited you to join "${groupName}" on Evenly, an app for splitting ` +
          `shared expenses.\n\nOpen this link to join:\n${url}\n\n` +
          `The link is meant for this email address only.`,
      });
    } catch (error) {
      // The link was never delivered and nobody else knows it: do not leave a live invite behind.
      await ctx.orm
        .update(groupInvites)
        .set({ revokedAt: new Date() })
        .where(eq(groupInvites.id, inviteId));
      throw new ProblemError(502, "email-failed", "The invitation email could not be sent.", {
        cause: error,
      });
    }
  }
  return { ...(await loadInviteDto(ctx.orm, groupId, inviteId)), url };
}

/** A placeholder that is still in the group: someone an invite can let a person become. */
function isClaimable(row: MemberRow | null | undefined): row is MemberRow {
  return row?.userId === null && row.leftAt === null;
}

async function findMemberRow(
  db: DbOrTx,
  groupId: string,
  memberId: string,
): Promise<MemberRow | undefined> {
  if (!isUuid(memberId)) return undefined;
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)))
    .limit(1);
  return row;
}

function expiryDate(
  env: InviteContext["env"],
  expiresIn: CreateInviteRequest["expiresIn"],
): Date | null {
  if (expiresIn === "never") return null;
  const days = expiresIn === undefined ? env.INVITE_DEFAULT_TTL_DAYS : EXPIRY_DAYS[expiresIn];
  return new Date(Date.now() + days * DAY_MS);
}

/** Anyone in the group: its invites, newest first. The links themselves are never stored. */
export async function listInvites(orm: Orm, actor: Actor, groupId: string): Promise<Invite[]> {
  await requireMember(orm, groupId, actor.userId);
  return listInviteRows(orm, groupId);
}

/** Admin: stop an invite from working. */
export async function revokeInvite(
  orm: Orm,
  actor: Actor,
  groupId: string,
  inviteId: string,
): Promise<void> {
  await orm.transaction(async (tx) => {
    const { member } = await requireMember(tx, groupId, actor.userId, "admin", { lock: true });
    if (!isUuid(inviteId)) throw notFound();
    const [invite] = await tx
      .select()
      .from(groupInvites)
      .where(and(eq(groupInvites.id, inviteId), eq(groupInvites.groupId, groupId)))
      .limit(1);
    if (invite === undefined) throw notFound();
    if (invite.revokedAt !== null) return;
    await tx
      .update(groupInvites)
      .set({ revokedAt: new Date() })
      .where(eq(groupInvites.id, inviteId));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "invite.revoked",
      entityId: inviteId,
    });
  });
}

interface LoadedInvite {
  invite: InviteRow;
  group: typeof groups.$inferSelect;
  inviterName: string;
  claimTarget: MemberRow | null;
}

/**
 * The invite behind a link, if it can still be used. Unknown links and deleted groups are 404; links
 * that existed but no longer work say why (410), so the page can tell people what to do.
 */
async function loadUsableInvite(
  db: DbOrTx,
  token: string,
  options: { lock?: boolean } = {},
): Promise<LoadedInvite> {
  if (!isWellFormedToken(token)) throw notFound();
  const query = db
    .select({ invite: groupInvites, group: groups, inviterName: creator.displayName })
    .from(groupInvites)
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .innerJoin(creator, eq(creator.id, groupInvites.createdBy))
    .where(eq(groupInvites.tokenHash, hashInviteToken(token)))
    .limit(1);
  const [row] =
    options.lock === true ? await query.for("update", { of: groupInvites }) : await query;
  if (row?.group.deletedAt !== null) throw notFound();

  switch (statusOf(row.invite, new Date())) {
    case "revoked":
      throw gone("invite-revoked", "This invitation link was cancelled.");
    case "expired":
      throw gone("invite-expired", "This invitation link has expired.");
    case "used-up":
      throw gone("invite-used-up", "This invitation link has already been used.");
    case "active":
      break;
  }
  if (row.group.archivedAt !== null) {
    throw gone("group-archived", "This group is archived and cannot take new people.");
  }

  let target: MemberRow | null = null;
  if (row.invite.claimMemberId !== null) {
    target = (await findMemberRow(db, row.group.id, row.invite.claimMemberId)) ?? null;
    if (!isClaimable(target)) {
      throw gone("claim-unavailable", "The person this link was made for is no longer available.");
    }
  }
  return {
    invite: row.invite,
    group: row.group,
    inviterName: row.inviterName,
    claimTarget: target,
  };
}

/** Public: what a link is for, shown before anyone signs up or logs in. */
export async function previewInvite(orm: Orm, token: string): Promise<InvitePreview> {
  const { invite, group, inviterName, claimTarget: target } = await loadUsableInvite(orm, token);
  const [counted] = await orm
    .select({ value: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), isNull(groupMembers.leftAt)));
  return {
    group: { name: group.name, emoji: group.emoji, memberCount: counted?.value ?? 0 },
    invitedBy: inviterName,
    claim: target === null ? null : { displayName: target.displayName },
    expiresAt: toIsoOrNull(invite.expiresAt),
  };
}

/**
 * Whether an invite-only instance may create an account for `email` on the strength of this link
 * (ALLOW_SIGNUPS=invite-only). It does not use the invite up; accepting it does.
 */
export async function inviteAllowsSignup(
  orm: Orm,
  token: string,
  email: string | undefined,
): Promise<boolean> {
  try {
    const { invite } = await loadUsableInvite(orm, token);
    return invite.email === null || invite.email.toLowerCase() === email?.toLowerCase();
  } catch (error) {
    if (error instanceof ProblemError) return false;
    throw error;
  }
}

/** Signed-in user: join the group, or take over a placeholder, with an invite link. */
export async function acceptInvite(
  orm: Orm,
  actor: Actor,
  token: string,
): Promise<AcceptInviteResponse> {
  return orm.transaction(async (tx) => {
    const {
      invite,
      group,
      claimTarget: target,
    } = await loadUsableInvite(tx, token, { lock: true });
    if (invite.email !== null && invite.email.toLowerCase() !== actor.email.toLowerCase()) {
      throw new ProblemError(
        403,
        "invite-email-mismatch",
        "This invitation was sent to a different email address. Sign in with that address to accept it.",
      );
    }

    const [existing] = await tx
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, actor.userId)))
      .limit(1);

    // ADR-0003: merging two memberships is out of scope, so a claim needs a clean slate.
    if (target !== null && existing !== undefined) {
      throw conflict(
        "already-member",
        "You already have a place in this group, so this link cannot be used to claim another one.",
      );
    }
    if (target === null && existing?.leftAt === null) {
      return { groupId: group.id, memberId: existing.id, claimed: false, alreadyMember: true };
    }

    await consumeUse(tx, invite.id);

    if (target !== null) {
      await tx
        .update(groupMembers)
        .set({ userId: actor.userId, displayName: actor.name, email: null })
        .where(eq(groupMembers.id, target.id));
      await recordActivity(tx, {
        groupId: group.id,
        actorId: target.id,
        kind: "member.claimed",
        entityId: target.id,
        diff: { displayName: [target.displayName, actor.name] },
      });
      return { groupId: group.id, memberId: target.id, claimed: true, alreadyMember: false };
    }

    if (existing !== undefined) {
      // Coming back reactivates the old row (and its place in the canonical order), as a plain member.
      await tx
        .update(groupMembers)
        .set({ leftAt: null, role: "member", displayName: actor.name })
        .where(eq(groupMembers.id, existing.id));
      await recordActivity(tx, {
        groupId: group.id,
        actorId: existing.id,
        kind: "member.joined",
        entityId: existing.id,
        diff: { rejoined: true },
      });
      return { groupId: group.id, memberId: existing.id, claimed: false, alreadyMember: false };
    }

    const memberId = newId();
    await tx.insert(groupMembers).values({
      id: memberId,
      groupId: group.id,
      userId: actor.userId,
      displayName: actor.name,
      role: "member",
    });
    await recordActivity(tx, {
      groupId: group.id,
      actorId: memberId,
      kind: "member.joined",
      entityId: memberId,
      diff: { invitedBy: invite.createdBy },
    });
    return { groupId: group.id, memberId, claimed: false, alreadyMember: false };
  });
}

/** Counts one use, atomically and only while the invite is still usable and under its limit. */
async function consumeUse(tx: Tx, inviteId: string): Promise<void> {
  const now = new Date();
  const used = await tx
    .update(groupInvites)
    .set({ useCount: sql`${groupInvites.useCount} + 1` })
    .where(
      and(
        eq(groupInvites.id, inviteId),
        isNull(groupInvites.revokedAt),
        or(isNull(groupInvites.maxUses), lt(groupInvites.useCount, groupInvites.maxUses)),
        or(isNull(groupInvites.expiresAt), gt(groupInvites.expiresAt, now)),
      ),
    )
    .returning({ id: groupInvites.id });
  if (used.length === 0)
    throw gone("invite-used-up", "This invitation link has already been used.");
}
