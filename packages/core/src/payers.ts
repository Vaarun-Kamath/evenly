import { CoreError } from "./errors";
import { assertSafeInteger, assertWithinMaxAmount } from "./money";

export interface PayerEntry {
  memberId: string;
  amountMinor: number;
}

/**
 * Checks who paid for an expense: at least one payer, each a known member listed once with an
 * amount above zero, and the amounts adding up to exactly `totalMinor`.
 */
export function validatePayers(
  totalMinor: number,
  payers: readonly PayerEntry[],
  canonicalOrder: readonly string[],
): void {
  if (payers.length === 0) {
    throw new CoreError("NO_PAYERS", "An expense needs at least one payer");
  }
  const members = new Set(canonicalOrder);
  const seen = new Set<string>();
  let paid = 0n;
  for (const { memberId, amountMinor } of payers) {
    if (!members.has(memberId)) {
      throw new CoreError("UNKNOWN_MEMBER", `Payer "${memberId}" is not in this group`, {
        memberId,
      });
    }
    if (seen.has(memberId)) {
      throw new CoreError("DUPLICATE_MEMBER", `Payer "${memberId}" appears twice`, { memberId });
    }
    seen.add(memberId);
    assertSafeInteger(amountMinor, "payer amount");
    if (amountMinor <= 0) {
      throw new CoreError("NON_POSITIVE_AMOUNT", `Payer "${memberId}" must have paid above zero`, {
        memberId,
      });
    }
    assertWithinMaxAmount(amountMinor, "payer amount");
    paid += BigInt(amountMinor);
  }
  if (paid !== BigInt(totalMinor)) {
    throw new CoreError(
      "PAYER_TOTAL_MISMATCH",
      `The payers paid ${String(paid)}, but the expense is ${String(totalMinor)}`,
      { expected: totalMinor, actual: Number(paid) },
    );
  }
}
