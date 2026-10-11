import type { Net } from "./balances";
import { CoreError } from "./errors";
import { assertSafeInteger } from "./money";

/** `fromMemberId` pays `toMemberId` `amountMinor`. */
export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
}

interface Party {
  memberId: string;
  remaining: number;
}

function largest(parties: readonly Party[]): Party | undefined {
  // Strict ">" keeps the earlier party on a tie, and parties are in canonical order.
  return parties.reduce<Party | undefined>(
    (best, party) =>
      party.remaining > 0 && (best === undefined || party.remaining > best.remaining)
        ? party
        : best,
    undefined,
  );
}

/**
 * Turns net balances into payments that settle everyone to exactly zero.
 *
 * `nets` must be in canonical member order (that order breaks every tie, so the result is
 * deterministic) and must add up to zero. With `pairExactFirst`, a debtor and a creditor whose
 * amounts are exactly opposite are matched first. Then, repeatedly, the largest remaining debtor
 * pays the largest remaining creditor `min(debt, credit)`. Each payment settles at least one of
 * the two, so there are at most (people with a balance - 1) payments.
 *
 * Finding the true minimum number of payments is NP-hard; greedy matching is the standard
 * practical answer (ARCHITECTURE.md section 5.4).
 */
export function settleGreedily(
  nets: readonly Net[],
  options: { pairExactFirst: boolean },
): Transfer[] {
  let total = 0n;
  for (const { netMinor } of nets) {
    total += BigInt(assertSafeInteger(netMinor, "net balance"));
  }
  if (total !== 0n) {
    throw new CoreError("UNBALANCED", `Net balances must add up to zero, got ${String(total)}`, {
      total: Number(total),
    });
  }

  const debtors: Party[] = nets.flatMap(({ memberId, netMinor }) =>
    netMinor < 0 ? [{ memberId, remaining: -netMinor }] : [],
  );
  const creditors: Party[] = nets.flatMap(({ memberId, netMinor }) =>
    netMinor > 0 ? [{ memberId, remaining: netMinor }] : [],
  );
  const transfers: Transfer[] = [];
  const pay = (debtor: Party, creditor: Party, amountMinor: number) => {
    transfers.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountMinor });
    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;
  };

  if (options.pairExactFirst) {
    for (const creditor of creditors) {
      // A debtor that was already matched has 0 remaining, which never equals a creditor's amount.
      const match = debtors.find((debtor) => debtor.remaining === creditor.remaining);
      if (match !== undefined) pay(match, creditor, creditor.remaining);
    }
  }

  for (;;) {
    const debtor = largest(debtors);
    const creditor = largest(creditors);
    if (debtor === undefined || creditor === undefined) break;
    pay(debtor, creditor, Math.min(debtor.remaining, creditor.remaining));
  }
  return transfers;
}

/** The "simplify debts" plan: few, deterministic payments that settle every balance. */
export function simplify(nets: readonly Net[]): Transfer[] {
  return settleGreedily(nets, { pairExactFirst: true });
}
