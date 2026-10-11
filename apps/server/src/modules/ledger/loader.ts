import type { ExpenseEntry, PartyAmount, SettlementEntry } from "@evenly/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { expensePayers, expenseShares, expenses, groupMembers, settlements } from "../../db/schema";
import type { DbOrTx } from "../common/db";

/** Every member of a group, left or not, in canonical order: who joined first, then by id. */
export async function loadMembers(db: DbOrTx, groupId: string) {
  return db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.id));
}

export interface Ledger {
  /** Member ids in canonical order, left members included. */
  memberOrder: string[];
  members: Awaited<ReturnType<typeof loadMembers>>;
  /** Live (not deleted) expenses. */
  expenses: ExpenseEntry[];
  /** Live (not deleted) settlements. */
  settlements: SettlementEntry[];
}

/** The live rows of a group in the shape @evenly/core computes balances from. */
export async function loadLedger(db: DbOrTx, groupId: string): Promise<Ledger> {
  const [members, payerRows, shareRows, settlementRows] = await Promise.all([
    loadMembers(db, groupId),
    db
      .select({
        expenseId: expensePayers.expenseId,
        memberId: expensePayers.memberId,
        amountMinor: expensePayers.amountMinor,
      })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    db
      .select({
        expenseId: expenseShares.expenseId,
        memberId: expenseShares.memberId,
        amountMinor: expenseShares.amountMinor,
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    db
      .select({
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountMinor: settlements.amountMinor,
      })
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
      .orderBy(asc(settlements.id)),
  ]);

  const byExpense = new Map<string, { payers: PartyAmount[]; shares: PartyAmount[] }>();
  const entry = (expenseId: string) => {
    let existing = byExpense.get(expenseId);
    if (existing === undefined) {
      existing = { payers: [], shares: [] };
      byExpense.set(expenseId, existing);
    }
    return existing;
  };
  for (const { expenseId, ...row } of payerRows) entry(expenseId).payers.push(row);
  for (const { expenseId, ...row } of shareRows) entry(expenseId).shares.push(row);

  return {
    memberOrder: members.map((member) => member.id),
    members,
    expenses: [...byExpense.values()],
    settlements: settlementRows,
  };
}
