import { allocate } from "./allocate";
import { CoreError } from "./errors";
import {
  assertSafeInteger,
  assertWithinMaxAmount,
  parseDecimalToUnits,
  unitsToDecimalString,
} from "./money";

export type SplitMethod = "equal" | "exact" | "percent" | "shares";

/**
 * One member's line in a split. `value` is a decimal string whose meaning depends on the method:
 * absent for `equal`; minor units (an integer) for `exact`; a percentage such as "33.33" for
 * `percent`; a share weight such as "2" or "1.5" for `shares`.
 */
export interface SplitEntry {
  memberId: string;
  value?: string | undefined;
}

export interface SplitInput {
  method: SplitMethod;
  entries: readonly SplitEntry[];
}

export interface ComputedShare {
  memberId: string;
  /** What the member owes for this expense, in minor units. */
  amountMinor: number;
  /** The user's input, normalised: "33.33" percent, "2.00" shares, minor units for exact, null for equal. */
  inputValue: string | null;
}

/** Percentages are held as basis points (hundredths of a percent): 100% is 10,000. */
const FULL_PERCENT_BASIS_POINTS = 10_000n;
/** Share weights have two decimals and may not exceed 1,000,000.00 (ADR-0006). */
const MAX_SHARE_UNITS = 100_000_000;

interface RankedEntry {
  entry: SplitEntry;
  rank: number;
}

/** Validates the member list and puts it in canonical order (the order that breaks rounding ties). */
function rankEntries(
  entries: readonly SplitEntry[],
  canonicalOrder: readonly string[],
): RankedEntry[] {
  if (entries.length === 0) {
    throw new CoreError("NO_ENTRIES", "A split needs at least one member");
  }
  const ranks = new Map(canonicalOrder.map((memberId, rank) => [memberId, rank]));
  const seen = new Set<string>();
  const ranked = entries.map((entry) => {
    const rank = ranks.get(entry.memberId);
    if (rank === undefined) {
      throw new CoreError("UNKNOWN_MEMBER", `Member "${entry.memberId}" is not in this group`, {
        memberId: entry.memberId,
      });
    }
    if (seen.has(entry.memberId)) {
      throw new CoreError("DUPLICATE_MEMBER", `Member "${entry.memberId}" appears twice`, {
        memberId: entry.memberId,
      });
    }
    seen.add(entry.memberId);
    return { entry, rank };
  });
  return ranked.sort((a, b) => a.rank - b.rank);
}

function requireValue(entry: SplitEntry): string {
  if (entry.value === undefined) {
    throw new CoreError("MISSING_VALUE", `Member "${entry.memberId}" needs a value`, {
      memberId: entry.memberId,
    });
  }
  return entry.value;
}

function requirePositive(units: number, entry: SplitEntry): number {
  if (units <= 0) {
    throw new CoreError(
      "NON_POSITIVE_VALUE",
      `Member "${entry.memberId}" needs a value above zero; leave the member out instead`,
      { memberId: entry.memberId },
    );
  }
  return units;
}

function sum(values: readonly number[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function toShares(
  ranked: readonly RankedEntry[],
  amounts: readonly number[],
  inputValues: readonly (string | null)[],
): ComputedShare[] {
  // All three arrays have one element per ranked entry, so these lookups cannot be undefined.
  return ranked.map(({ entry }, index) => ({
    memberId: entry.memberId,
    amountMinor: amounts[index]!,
    inputValue: inputValues[index]!,
  }));
}

/**
 * Splits `totalMinor` between members by one of the four methods. The result always adds up to
 * exactly `totalMinor`, lists members in canonical order, and uses the single rounding rule in
 * {@link allocate}. Invalid input throws a {@link CoreError}.
 *
 * `canonicalOrder` lists the group's member ids in canonical order (joined_at, then id); it decides
 * who receives the odd minor units.
 */
export function computeSplit(
  totalMinor: number,
  split: SplitInput,
  canonicalOrder: readonly string[],
): ComputedShare[] {
  assertSafeInteger(totalMinor, "total");
  if (totalMinor < 1) {
    throw new CoreError("INVALID_TOTAL", "The total must be above zero", { totalMinor });
  }
  assertWithinMaxAmount(totalMinor, "total");
  const ranked = rankEntries(split.entries, canonicalOrder);
  const order = ranked.map(({ rank }) => rank);

  switch (split.method) {
    case "equal": {
      for (const { entry } of ranked) {
        if (entry.value !== undefined) {
          throw new CoreError(
            "UNEXPECTED_VALUE",
            `An equal split takes no value, but "${entry.memberId}" has one`,
            { memberId: entry.memberId },
          );
        }
      }
      const amounts = allocate(
        totalMinor,
        ranked.map(() => 1),
        order,
      );
      return toShares(
        ranked,
        amounts,
        ranked.map(() => null),
      );
    }

    case "exact": {
      const amounts = ranked.map(({ entry }) => {
        const amount = parseDecimalToUnits(requireValue(entry), 0, "exact amount");
        return assertWithinMaxAmount(amount, "exact amount");
      });
      const actual = sum(amounts);
      if (actual !== BigInt(totalMinor)) {
        throw new CoreError(
          "EXACT_TOTAL_MISMATCH",
          `The exact amounts add up to ${String(actual)}, not ${String(totalMinor)}`,
          { expected: totalMinor, actual: Number(actual) },
        );
      }
      return toShares(
        ranked,
        amounts,
        amounts.map((amount) => String(amount)),
      );
    }

    case "percent": {
      const basisPoints = ranked.map(({ entry }) =>
        requirePositive(parseDecimalToUnits(requireValue(entry), 2, "percentage"), entry),
      );
      const actual = sum(basisPoints);
      if (actual !== FULL_PERCENT_BASIS_POINTS) {
        throw new CoreError(
          "PERCENT_TOTAL_MISMATCH",
          `The percentages add up to ${unitsToDecimalString(Number(actual), 2)}, not 100`,
          { actualBasisPoints: Number(actual) },
        );
      }
      return toShares(
        ranked,
        allocate(totalMinor, basisPoints, order),
        basisPoints.map((units) => unitsToDecimalString(units, 2)),
      );
    }

    case "shares": {
      const weights = ranked.map(({ entry }) => {
        const units = requirePositive(parseDecimalToUnits(requireValue(entry), 2, "share"), entry);
        if (units > MAX_SHARE_UNITS) {
          throw new CoreError(
            "AMOUNT_TOO_LARGE",
            `A share may not exceed ${unitsToDecimalString(MAX_SHARE_UNITS, 2)}`,
            { memberId: entry.memberId },
          );
        }
        return units;
      });
      return toShares(
        ranked,
        allocate(totalMinor, weights, order),
        weights.map((units) => unitsToDecimalString(units, 2)),
      );
    }
  }
}
