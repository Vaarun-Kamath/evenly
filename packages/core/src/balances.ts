import { CoreError } from "./errors";
import { assertSafeInteger } from "./money";

export interface PartyAmount {
  memberId: string;
  amountMinor: number;
}

/** What balances need to know about an expense: who paid what, and who owes what. */
export interface ExpenseEntry {
  payers: readonly PartyAmount[];
  shares: readonly PartyAmount[];
}

/** `fromMemberId` paid `toMemberId` (money moved from the first to the second). */
export interface SettlementEntry {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
}

export interface Net {
  memberId: string;
  /** Positive: the member is owed money. Negative: the member owes money. */
  netMinor: number;
}

function toLedger(memberOrder: readonly string[]): Map<string, bigint> {
  return new Map(memberOrder.map((memberId) => [memberId, 0n]));
}

function adjust(
  ledger: Map<string, bigint>,
  memberId: string,
  amountMinor: number,
  sign: 1n | -1n,
) {
  const current = ledger.get(memberId);
  if (current === undefined) {
    throw new CoreError("UNKNOWN_MEMBER", `Member "${memberId}" is not in this group`, {
      memberId,
    });
  }
  assertSafeInteger(amountMinor, "amount");
  if (amountMinor < 0) {
    throw new CoreError("NON_POSITIVE_AMOUNT", `Amounts must not be negative, got ${amountMinor}`, {
      memberId,
      amountMinor,
    });
  }
  ledger.set(memberId, current + BigInt(amountMinor) * sign);
}

/** Checks settlements: known members, two different people, an amount above zero. */
export function validateSettlements(
  memberOrder: readonly string[],
  settlements: readonly SettlementEntry[],
): void {
  const members = new Set(memberOrder);
  for (const { fromMemberId, toMemberId, amountMinor } of settlements) {
    for (const memberId of [fromMemberId, toMemberId]) {
      if (!members.has(memberId)) {
        throw new CoreError("UNKNOWN_MEMBER", `Member "${memberId}" is not in this group`, {
          memberId,
        });
      }
    }
    if (fromMemberId === toMemberId) {
      throw new CoreError("SELF_SETTLEMENT", "A settlement needs two different members", {
        memberId: fromMemberId,
      });
    }
    assertSafeInteger(amountMinor, "settlement amount");
    if (amountMinor <= 0) {
      throw new CoreError("NON_POSITIVE_AMOUNT", "A settlement must be above zero", {
        amountMinor,
      });
    }
  }
}

/**
 * Net balance of every member (ARCHITECTURE.md section 5.3):
 * `net = paid - owed share + settlements sent - settlements received`.
 *
 * Pass only live (not deleted) rows. Returns one entry per member of `memberOrder`, in that order,
 * including members whose net is zero. Because every expense's payers add up to its shares, and a
 * settlement moves money between two members, the nets always add up to exactly zero.
 */
export function computeNets(
  memberOrder: readonly string[],
  expenses: readonly ExpenseEntry[],
  settlements: readonly SettlementEntry[],
): Net[] {
  const ledger = toLedger(memberOrder);
  for (const expense of expenses) {
    let paid = 0n;
    let owed = 0n;
    for (const { memberId, amountMinor } of expense.payers) {
      adjust(ledger, memberId, amountMinor, 1n);
      paid += BigInt(amountMinor);
    }
    for (const { memberId, amountMinor } of expense.shares) {
      adjust(ledger, memberId, amountMinor, -1n);
      owed += BigInt(amountMinor);
    }
    if (paid !== owed) {
      throw new CoreError(
        "SHARES_TOTAL_MISMATCH",
        `An expense's payers paid ${String(paid)} but its shares add up to ${String(owed)}`,
        { paid: Number(paid), owed: Number(owed) },
      );
    }
  }
  validateSettlements(memberOrder, settlements);
  for (const { fromMemberId, toMemberId, amountMinor } of settlements) {
    adjust(ledger, fromMemberId, amountMinor, 1n);
    adjust(ledger, toMemberId, amountMinor, -1n);
  }
  return [...ledger].map(([memberId, net]) => ({
    memberId,
    netMinor: assertSafeInteger(Number(net), "net balance"),
  }));
}
