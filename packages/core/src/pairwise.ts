import {
  computeNets,
  validateSettlements,
  type ExpenseEntry,
  type SettlementEntry,
} from "./balances";
import { settleGreedily } from "./simplify";

/** `debtorId` owes `creditorId` `amountMinor`. */
export interface PairDebt {
  debtorId: string;
  creditorId: string;
  amountMinor: number;
}

type Owes = Map<string, Map<string, bigint>>;

function bump(owes: Owes, fromId: string, toId: string, delta: bigint): void {
  const row = owes.get(fromId) ?? new Map<string, bigint>();
  row.set(toId, (row.get(toId) ?? 0n) + delta);
  owes.set(fromId, row);
}

function owed(owes: Owes, fromId: string, toId: string): bigint {
  return owes.get(fromId)?.get(toId) ?? 0n;
}

/**
 * Who owes whom, pair by pair, for groups that do not simplify debts (ARCHITECTURE.md section 5.5).
 *
 * Each expense is settled on its own, from that expense's own nets, with the same deterministic
 * greedy matching as the simplified plan, so rounding can never make this view disagree with the net
 * balances. Settlements then reduce what the payer owes the receiver. Each pair is reported once, as
 * the difference between the two directions; zero pairs are left out. The result is ordered by the
 * earlier member of the pair in `memberOrder`, then the later one.
 *
 * For any member, (sum of debts they are owed) - (sum of debts they owe) equals their net balance.
 */
export function pairwise(
  memberOrder: readonly string[],
  expenses: readonly ExpenseEntry[],
  settlements: readonly SettlementEntry[],
): PairDebt[] {
  const owes: Owes = new Map();
  for (const expense of expenses) {
    const nets = computeNets(memberOrder, [expense], []);
    for (const { fromMemberId, toMemberId, amountMinor } of settleGreedily(nets, {
      pairExactFirst: false,
    })) {
      bump(owes, fromMemberId, toMemberId, BigInt(amountMinor));
    }
  }
  validateSettlements(memberOrder, settlements);
  for (const { fromMemberId, toMemberId, amountMinor } of settlements) {
    bump(owes, fromMemberId, toMemberId, -BigInt(amountMinor));
  }

  const debts: PairDebt[] = [];
  memberOrder.forEach((earlier, index) => {
    for (const later of memberOrder.slice(index + 1)) {
      const difference = owed(owes, earlier, later) - owed(owes, later, earlier);
      if (difference > 0n) {
        debts.push({ debtorId: earlier, creditorId: later, amountMinor: Number(difference) });
      } else if (difference < 0n) {
        debts.push({ debtorId: later, creditorId: earlier, amountMinor: Number(-difference) });
      }
    }
  });
  return debts;
}
