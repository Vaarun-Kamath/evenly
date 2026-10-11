import type {
  CreateSettlementRequest,
  ListSettlementsQuery,
  Settlement,
  UpdateSettlementRequest,
} from "@evenly/contracts";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { settlements } from "../../db/schema";
import { ProblemError, conflict, notFound } from "../../http/problem";
import {
  assertWritable,
  isUuid,
  requireMember,
  type GroupRow,
  type MemberRow,
} from "../common/access";
import { recordActivity } from "../common/activity";
import { decodeDateCursor, encodeDateCursor } from "../common/cursor";
import { toIso, toIsoOrNull, type Actor, type DbOrTx } from "../common/db";
import {
  assertKnownMembers,
  assertLeftMembersUnaffected,
  settlementEffects,
} from "../ledger/effects";
import { loadMembers } from "../ledger/loader";

type SettlementRow = typeof settlements.$inferSelect;
type Fields = Pick<
  CreateSettlementRequest,
  "fromMemberId" | "toMemberId" | "amountMinor" | "currency" | "settledOn" | "note"
>;

function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.groupId,
    fromMemberId: row.fromMemberId,
    toMemberId: row.toMemberId,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    settledOn: row.settledOn,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
    version: row.version,
  };
}

async function findRow(
  db: DbOrTx,
  groupId: string,
  settlementId: string,
  options: { lock?: boolean } = {},
): Promise<SettlementRow> {
  if (!isUuid(settlementId)) throw notFound();
  const query = db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  const [row] = options.lock === true ? await query.for("update") : await query;
  if (row === undefined) throw notFound();
  return row;
}

/** Currency, who is named, and that the payer and the receiver are two different people. */
function check(group: GroupRow, members: MemberRow[], input: Fields): void {
  if (input.currency !== group.currency) {
    throw new ProblemError(
      422,
      "currency-mismatch",
      `This group uses ${group.currency}, but the settlement is in ${input.currency}.`,
    );
  }
  assertKnownMembers(members, [input.fromMemberId, input.toMemberId]);
  if (input.fromMemberId === input.toMemberId) {
    throw new ProblemError(422, "self-settlement", "A settlement needs two different people.");
  }
}

/** The fields that make two requests "the same settlement", for retries and the activity diff. */
const fieldsOf = (input: Fields) => ({
  fromMemberId: input.fromMemberId,
  toMemberId: input.toMemberId,
  amountMinor: input.amountMinor,
  settledOn: input.settledOn,
  note: input.note ?? null,
});
const fieldsOfRow = (row: SettlementRow) => ({
  fromMemberId: row.fromMemberId,
  toMemberId: row.toMemberId,
  amountMinor: row.amountMinor,
  settledOn: row.settledOn,
  note: row.note,
});

/**
 * Any member: record that one person paid another. Like expenses, the id is the client's, so a retry
 * returns the existing settlement (`created: false`) and a different body under the same id is a 409.
 */
export async function createSettlement(
  orm: Orm,
  actor: Actor,
  groupId: string,
  input: CreateSettlementRequest,
): Promise<{ settlement: Settlement; created: boolean }> {
  return orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const members = await loadMembers(tx, groupId);
    check(group, members, input);
    assertLeftMembersUnaffected(
      members,
      new Map(),
      settlementEffects(input.fromMemberId, input.toMemberId, input.amountMinor),
    );

    const inserted = await tx
      .insert(settlements)
      .values({
        id: input.id,
        groupId,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        amountMinor: input.amountMinor,
        currency: group.currency,
        settledOn: input.settledOn,
        note: input.note ?? null,
        createdBy: member.id,
      })
      .onConflictDoNothing()
      .returning();
    const [row] = inserted;
    if (row === undefined) {
      const [existing] = await tx
        .select()
        .from(settlements)
        .where(eq(settlements.id, input.id))
        .limit(1);
      if (
        existing?.groupId !== groupId ||
        existing.deletedAt !== null ||
        JSON.stringify(fieldsOfRow(existing)) !== JSON.stringify(fieldsOf(input))
      ) {
        throw conflict(
          "idempotency-conflict",
          "A settlement with this id already exists with different content. Use a new id for a new settlement.",
        );
      }
      return { settlement: toSettlement(existing), created: false };
    }
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "settlement.created",
      entityId: row.id,
      diff: {
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        amountMinor: input.amountMinor,
      },
    });
    return { settlement: toSettlement(row), created: true };
  });
}

export async function getSettlement(
  orm: Orm,
  actor: Actor,
  groupId: string,
  settlementId: string,
): Promise<Settlement> {
  await requireMember(orm, groupId, actor.userId);
  return toSettlement(await findRow(orm, groupId, settlementId));
}

/** Any member: change a settlement; stale versions are a 409 holding the current one. */
export async function updateSettlement(
  orm: Orm,
  actor: Actor,
  groupId: string,
  settlementId: string,
  input: UpdateSettlementRequest,
): Promise<Settlement> {
  return orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, settlementId, { lock: true });
    if (row.deletedAt !== null) {
      throw conflict(
        "settlement-deleted",
        "This settlement was deleted. Restore it before changing it.",
      );
    }
    if (row.version !== input.version) {
      throw new ProblemError(
        409,
        "version-conflict",
        "Someone else changed this settlement while you were editing it. Review their version and try again.",
        { extensions: { current: toSettlement(row) } },
      );
    }
    const members = await loadMembers(tx, groupId);
    check(group, members, input);
    assertLeftMembersUnaffected(
      members,
      settlementEffects(row.fromMemberId, row.toMemberId, row.amountMinor),
      settlementEffects(input.fromMemberId, input.toMemberId, input.amountMinor),
    );

    const before = fieldsOfRow(row);
    const after = fieldsOf(input);
    const diff: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(after) as (keyof typeof after)[]) {
      if (before[key] !== after[key]) diff[key] = [before[key], after[key]];
    }
    if (Object.keys(diff).length === 0) return toSettlement(row);

    const [updated] = await tx
      .update(settlements)
      .set({ ...after, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(settlements.id, row.id))
      .returning();
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "settlement.updated",
      entityId: row.id,
      diff,
    });
    return toSettlement(updated!);
  });
}

/** Any member: delete a settlement (soft). Deleting twice changes nothing. */
export async function deleteSettlement(
  orm: Orm,
  actor: Actor,
  groupId: string,
  settlementId: string,
): Promise<void> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, settlementId, { lock: true });
    if (row.deletedAt !== null) return;
    const members = await loadMembers(tx, groupId);
    assertLeftMembersUnaffected(
      members,
      settlementEffects(row.fromMemberId, row.toMemberId, row.amountMinor),
      new Map(),
    );
    await tx
      .update(settlements)
      .set({ deletedAt: sql`now()`, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(settlements.id, row.id));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "settlement.deleted",
      entityId: row.id,
      diff: {
        fromMemberId: row.fromMemberId,
        toMemberId: row.toMemberId,
        amountMinor: row.amountMinor,
      },
    });
  });
}

/** Admin: bring a deleted settlement back. */
export async function restoreSettlement(
  orm: Orm,
  actor: Actor,
  groupId: string,
  settlementId: string,
): Promise<Settlement> {
  return orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "admin", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, settlementId, { lock: true });
    if (row.deletedAt === null) return toSettlement(row);
    const members = await loadMembers(tx, groupId);
    assertLeftMembersUnaffected(
      members,
      new Map(),
      settlementEffects(row.fromMemberId, row.toMemberId, row.amountMinor),
    );
    const [restored] = await tx
      .update(settlements)
      .set({ deletedAt: null, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(settlements.id, row.id))
      .returning();
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "settlement.restored",
      entityId: row.id,
      diff: {
        fromMemberId: row.fromMemberId,
        toMemberId: row.toMemberId,
        amountMinor: row.amountMinor,
      },
    });
    return toSettlement(restored!);
  });
}

/** Any member: the group's live settlements, newest first, with filters and a cursor. */
export async function listSettlements(
  orm: Orm,
  actor: Actor,
  groupId: string,
  query: ListSettlementsQuery,
): Promise<{ items: Settlement[]; nextCursor: string | null }> {
  await requireMember(orm, groupId, actor.userId);
  const cursor = query.cursor === undefined ? undefined : decodeDateCursor(query.cursor);
  const memberId = query.memberId;
  const memberFilter =
    memberId === undefined
      ? undefined
      : isUuid(memberId)
        ? or(eq(settlements.fromMemberId, memberId), eq(settlements.toMemberId, memberId))
        : sql`false`;
  const rows = await orm
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        isNull(settlements.deletedAt),
        query.from === undefined ? undefined : gte(settlements.settledOn, query.from),
        query.to === undefined ? undefined : lte(settlements.settledOn, query.to),
        memberFilter,
        cursor === undefined
          ? undefined
          : sql`(${settlements.settledOn}, ${settlements.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(settlements.settledOn), desc(settlements.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSettlement),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeDateCursor({ date: last.settledOn, id: last.id })
        : null,
  };
}
