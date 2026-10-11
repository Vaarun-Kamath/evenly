import { CoreError } from "./errors";
import { assertSafeInteger } from "./money";

/**
 * The one rounding rule (ARCHITECTURE.md section 5.2): splits `total` into integer parts in
 * proportion to `weights`, so that the parts add up to exactly `total`.
 *
 *  1. W = sum(weights); base_i = floor(total * w_i / W); rem_i = (total * w_i) mod W.
 *  2. left = total - sum(base_i). This is always smaller than the number of members.
 *  3. The `left` members with the largest rem_i get one more unit. Ties go to the member that
 *     comes first in the canonical order.
 *
 * `order[i]` is the canonical position of member i (smaller comes first); without it the array
 * index is used. BigInt is used for the products, so large totals cannot overflow.
 *
 * Every part differs from the exact proportional value by less than one unit. A member with
 * weight 0 always gets 0, because at least `left` members have a non-zero remainder.
 */
export function allocate(
  total: number,
  weights: readonly number[],
  order?: readonly number[],
): number[] {
  assertSafeInteger(total, "total");
  if (total < 0) {
    throw new CoreError("INVALID_TOTAL", `total must not be negative, got ${String(total)}`, {
      total,
    });
  }
  if (weights.length === 0) {
    throw new CoreError("INVALID_WEIGHTS", "weights must not be empty");
  }
  for (const weight of weights) {
    assertSafeInteger(weight, "weight");
    if (weight < 0) {
      throw new CoreError(
        "INVALID_WEIGHTS",
        `weights must not be negative, got ${String(weight)}`,
        {
          weight,
        },
      );
    }
  }
  const keys = order ?? weights.map((_, index) => index);
  if (keys.length !== weights.length || new Set(keys).size !== keys.length) {
    throw new CoreError("INVALID_ORDER", "order must hold one distinct position per weight");
  }

  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (weightSum === 0n) {
    throw new CoreError("INVALID_WEIGHTS", "weights must not all be zero");
  }

  const bigTotal = BigInt(total);
  const members = weights.map((weight, index) => {
    const product = bigTotal * BigInt(weight);
    // `keys` has one entry per weight (checked above), so the lookup cannot be undefined.
    return { index, base: product / weightSum, rem: product % weightSum, key: keys[index]! };
  });
  const left = Number(bigTotal - members.reduce((sum, member) => sum + member.base, 0n));

  const byClaim = [...members].sort((a, b) =>
    a.rem === b.rem ? a.key - b.key : a.rem > b.rem ? -1 : 1,
  );
  const winners = new Set(byClaim.slice(0, left).map((member) => member.index));
  return members.map((member) => Number(member.base) + (winners.has(member.index) ? 1 : 0));
}
