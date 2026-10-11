import type {
  CreateExpenseRequest,
  Expense,
  ListExpensesQuery,
  UpdateExpenseRequest,
} from "@evenly/contracts";
import { computeSplit, validatePayers, type ComputedShare } from "@evenly/core";
import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { expensePayers, expenseShares, expenses, groupMembers } from "../../db/schema";
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
import { toIso, toIsoOrNull, type Actor, type DbOrTx, type Tx } from "../common/db";
import { assertKnownMembers, assertLeftMembersUnaffected, expenseEffects } from "../ledger/effects";
import { loadMembers } from "../ledger/loader";

type ExpenseRow = typeof expenses.$inferSelect;
type Fields = Pick<
  CreateExpenseRequest,
  | "description"
  | "amountMinor"
  | "currency"
  | "category"
  | "expenseDate"
  | "notes"
  | "payers"
  | "split"
>;

/** What an expense request works out to, after the money rules of @evenly/core have been applied. */
interface Plan {
  payers: { memberId: string; amountMinor: number }[];
  shares: ComputedShare[];
}

/** Expenses as the API shows them: payers and shares in canonical member order. */
export async function toExpenses(db: DbOrTx, rows: ExpenseRow[]): Promise<Expense[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [payerRows, shareRows] = await Promise.all([
    db
      .select({
        expenseId: expensePayers.expenseId,
        memberId: expensePayers.memberId,
        amountMinor: expensePayers.amountMinor,
      })
      .from(expensePayers)
      .innerJoin(groupMembers, eq(groupMembers.id, expensePayers.memberId))
      .where(inArray(expensePayers.expenseId, ids))
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id)),
    db
      .select({
        expenseId: expenseShares.expenseId,
        memberId: expenseShares.memberId,
        amountMinor: expenseShares.amountMinor,
        inputValue: expenseShares.inputValue,
      })
      .from(expenseShares)
      .innerJoin(groupMembers, eq(groupMembers.id, expenseShares.memberId))
      .where(inArray(expenseShares.expenseId, ids))
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    description: row.description,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    category: row.category,
    expenseDate: row.expenseDate,
    notes: row.notes,
    splitMethod: row.splitMethod,
    payers: payerRows
      .filter((payer) => payer.expenseId === row.id)
      .map(({ memberId, amountMinor }) => ({ memberId, amountMinor })),
    shares: shareRows
      .filter((share) => share.expenseId === row.id)
      .map(({ memberId, amountMinor, inputValue }) => ({ memberId, amountMinor, inputValue })),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
    version: row.version,
  }));
}

async function loadExpense(db: DbOrTx, groupId: string, expenseId: string): Promise<Expense> {
  const [expense] = await toExpenses(db, [await findRow(db, groupId, expenseId)]);
  if (expense === undefined) throw notFound();
  return expense;
}

async function findRow(
  db: DbOrTx,
  groupId: string,
  expenseId: string,
  options: { lock?: boolean } = {},
): Promise<ExpenseRow> {
  if (!isUuid(expenseId)) throw notFound();
  const query = db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);
  const [row] = options.lock === true ? await query.for("update") : await query;
  if (row === undefined) throw notFound();
  return row;
}

/** The money rules, applied to a request: currency, who is named, who paid, how it is split. */
function plan(group: GroupRow, members: MemberRow[], input: Fields): Plan {
  if (input.currency !== group.currency) {
    throw new ProblemError(
      422,
      "currency-mismatch",
      `This group uses ${group.currency}, but the expense is in ${input.currency}.`,
    );
  }
  const order = members.map((member) => member.id);
  assertKnownMembers(members, [
    ...input.payers.map((payer) => payer.memberId),
    ...input.split.entries.map((entry) => entry.memberId),
  ]);
  validatePayers(input.amountMinor, input.payers, order);
  const shares = computeSplit(input.amountMinor, input.split, order);
  const payers = [...input.payers].sort(
    (a, b) => order.indexOf(a.memberId) - order.indexOf(b.memberId),
  );
  return { payers, shares };
}

/** The fields that make two requests "the same expense", for retries and for the activity diff. */
function snapshot(
  fields: {
    description: string;
    amountMinor: number;
    category: string;
    expenseDate: string;
    notes: string | null;
    splitMethod: string;
  },
  payers: readonly { memberId: string; amountMinor: number }[],
  shares: readonly { memberId: string; amountMinor: number; inputValue: string | null }[],
): Record<string, unknown> {
  return {
    ...fields,
    payers: Object.fromEntries(payers.map((p) => [p.memberId, p.amountMinor])),
    shares: Object.fromEntries(
      shares.map((s) => [
        s.memberId,
        [s.amountMinor, s.inputValue === null ? null : Number(s.inputValue)],
      ]),
    ),
  };
}

const snapshotOfExpense = (e: Expense) =>
  snapshot(
    {
      description: e.description,
      amountMinor: e.amount.amountMinor,
      category: e.category,
      expenseDate: e.expenseDate,
      notes: e.notes,
      splitMethod: e.splitMethod,
    },
    e.payers,
    e.shares,
  );

const snapshotOfRequest = (input: Fields, planned: Plan) =>
  snapshot(
    {
      description: input.description,
      amountMinor: input.amountMinor,
      category: input.category,
      expenseDate: input.expenseDate,
      notes: input.notes ?? null,
      splitMethod: input.split.method,
    },
    planned.payers,
    planned.shares,
  );

function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      diff[key] = [before[key], after[key]];
  }
  return diff;
}

async function writeRows(tx: Tx, expenseId: string, planned: Plan): Promise<void> {
  await tx.insert(expensePayers).values(
    planned.payers.map((payer) => ({
      expenseId,
      memberId: payer.memberId,
      amountMinor: payer.amountMinor,
    })),
  );
  await tx.insert(expenseShares).values(
    planned.shares.map((share) => ({
      expenseId,
      memberId: share.memberId,
      amountMinor: share.amountMinor,
      inputValue: share.inputValue,
    })),
  );
}

/**
 * Any member: record an expense. The id is the client's, so a retry is safe (ADR-0003): the same id
 * with the same content returns the expense that already exists (`created: false`); the same id with
 * different content, from another group, or for a deleted expense is a 409.
 */
export async function createExpense(
  orm: Orm,
  actor: Actor,
  groupId: string,
  input: CreateExpenseRequest,
): Promise<{ expense: Expense; created: boolean }> {
  const created = await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const members = await loadMembers(tx, groupId);
    const planned = plan(group, members, input);
    assertLeftMembersUnaffected(members, new Map(), expenseEffects(planned.payers, planned.shares));

    const inserted = await tx
      .insert(expenses)
      .values({
        id: input.id,
        groupId,
        description: input.description,
        amountMinor: input.amountMinor,
        currency: group.currency,
        category: input.category,
        expenseDate: input.expenseDate,
        notes: input.notes ?? null,
        splitMethod: input.split.method,
        createdBy: member.id,
      })
      .onConflictDoNothing()
      .returning({ id: expenses.id });

    if (inserted.length === 0) {
      const [existing] = await tx.select().from(expenses).where(eq(expenses.id, input.id)).limit(1);
      const [dto] = existing === undefined ? [] : await toExpenses(tx, [existing]);
      if (
        dto?.groupId !== groupId ||
        dto.deletedAt !== null ||
        JSON.stringify(snapshotOfExpense(dto)) !== JSON.stringify(snapshotOfRequest(input, planned))
      ) {
        throw conflict(
          "idempotency-conflict",
          "An expense with this id already exists with different content. Use a new id for a new expense.",
        );
      }
      return false;
    }

    await writeRows(tx, input.id, planned);
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "expense.created",
      entityId: input.id,
      diff: { description: input.description, amountMinor: input.amountMinor },
    });
    return true;
  });
  return { expense: await loadExpense(orm, groupId, input.id), created };
}

/** Any member: one expense, deleted ones included (the activity feed links to them). */
export async function getExpense(
  orm: Orm,
  actor: Actor,
  groupId: string,
  expenseId: string,
): Promise<Expense> {
  await requireMember(orm, groupId, actor.userId);
  return loadExpense(orm, groupId, expenseId);
}

/**
 * Any member: change an expense. The request carries the whole expense and the version it started
 * from; if someone else changed it first, the answer is a 409 holding the current expense, so the
 * editor can see what changed (optimistic locking).
 */
export async function updateExpense(
  orm: Orm,
  actor: Actor,
  groupId: string,
  expenseId: string,
  input: UpdateExpenseRequest,
): Promise<Expense> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, expenseId, { lock: true });
    const current = (await toExpenses(tx, [row]))[0]!;
    if (row.deletedAt !== null) {
      throw conflict("expense-deleted", "This expense was deleted. Restore it before changing it.");
    }
    if (row.version !== input.version) {
      throw new ProblemError(
        409,
        "version-conflict",
        "Someone else changed this expense while you were editing it. Review their version and try again.",
        { extensions: { current } },
      );
    }

    const members = await loadMembers(tx, groupId);
    const planned = plan(group, members, input);
    assertLeftMembersUnaffected(
      members,
      expenseEffects(current.payers, current.shares),
      expenseEffects(planned.payers, planned.shares),
    );
    const diff = diffSnapshots(snapshotOfExpense(current), snapshotOfRequest(input, planned));
    if (Object.keys(diff).length === 0) return;

    await tx.delete(expensePayers).where(eq(expensePayers.expenseId, row.id));
    await tx.delete(expenseShares).where(eq(expenseShares.expenseId, row.id));
    await tx
      .update(expenses)
      .set({
        description: input.description,
        amountMinor: input.amountMinor,
        category: input.category,
        expenseDate: input.expenseDate,
        notes: input.notes ?? null,
        splitMethod: input.split.method,
        version: row.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(expenses.id, row.id));
    await writeRows(tx, row.id, planned);
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "expense.updated",
      entityId: row.id,
      diff,
    });
  });
  return loadExpense(orm, groupId, expenseId);
}

/** Any member: delete an expense (soft: an admin can restore it). Deleting twice changes nothing. */
export async function deleteExpense(
  orm: Orm,
  actor: Actor,
  groupId: string,
  expenseId: string,
): Promise<void> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "member", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, expenseId, { lock: true });
    if (row.deletedAt !== null) return;
    const current = (await toExpenses(tx, [row]))[0]!;
    const members = await loadMembers(tx, groupId);
    assertLeftMembersUnaffected(members, expenseEffects(current.payers, current.shares), new Map());
    await tx
      .update(expenses)
      .set({ deletedAt: sql`now()`, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(expenses.id, row.id));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "expense.deleted",
      entityId: row.id,
      diff: { description: row.description, amountMinor: row.amountMinor },
    });
  });
}

/** Admin: bring a deleted expense back. Restoring one that is not deleted changes nothing. */
export async function restoreExpense(
  orm: Orm,
  actor: Actor,
  groupId: string,
  expenseId: string,
): Promise<Expense> {
  await orm.transaction(async (tx) => {
    const { group, member } = await requireMember(tx, groupId, actor.userId, "admin", {
      lock: true,
    });
    assertWritable(group);
    const row = await findRow(tx, groupId, expenseId, { lock: true });
    if (row.deletedAt === null) return;
    const current = (await toExpenses(tx, [row]))[0]!;
    const members = await loadMembers(tx, groupId);
    assertLeftMembersUnaffected(members, new Map(), expenseEffects(current.payers, current.shares));
    await tx
      .update(expenses)
      .set({ deletedAt: null, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(expenses.id, row.id));
    await recordActivity(tx, {
      groupId,
      actorId: member.id,
      kind: "expense.restored",
      entityId: row.id,
      diff: { description: row.description, amountMinor: row.amountMinor },
    });
  });
  return loadExpense(orm, groupId, expenseId);
}

/** `%`, `_` and `\` have a meaning in LIKE patterns; a search should match them literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** Any member: the group's live expenses, newest first, with filters and a cursor. */
export async function listExpenses(
  orm: Orm,
  actor: Actor,
  groupId: string,
  query: ListExpensesQuery,
): Promise<{ items: Expense[]; nextCursor: string | null }> {
  await requireMember(orm, groupId, actor.userId);
  const cursor = query.cursor === undefined ? undefined : decodeDateCursor(query.cursor);
  const memberId = query.memberId;
  // Expenses this member paid for or shares in; an id that cannot exist matches nothing.
  const memberFilter =
    memberId === undefined
      ? undefined
      : isUuid(memberId)
        ? or(
            exists(
              orm
                .select({ one: sql`1` })
                .from(expensePayers)
                .where(
                  and(
                    eq(expensePayers.expenseId, expenses.id),
                    eq(expensePayers.memberId, memberId),
                  ),
                ),
            ),
            exists(
              orm
                .select({ one: sql`1` })
                .from(expenseShares)
                .where(
                  and(
                    eq(expenseShares.expenseId, expenses.id),
                    eq(expenseShares.memberId, memberId),
                  ),
                ),
            ),
          )
        : sql`false`;
  const rows = await orm
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        query.from === undefined ? undefined : gte(expenses.expenseDate, query.from),
        query.to === undefined ? undefined : lte(expenses.expenseDate, query.to),
        query.category === undefined ? undefined : eq(expenses.category, query.category),
        query.q === undefined ? undefined : ilike(expenses.description, likePattern(query.q)),
        memberFilter,
        cursor === undefined
          ? undefined
          : sql`(${expenses.expenseDate}, ${expenses.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await toExpenses(orm, page),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeDateCursor({ date: last.expenseDate, id: last.id })
        : null,
  };
}
