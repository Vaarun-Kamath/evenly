import { exponentOf } from "./currency";
import { CoreError } from "./errors";

/** Largest amount accepted for an expense, payer, share or settlement: 10^12 minor units (ADR-0004). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/**
 * Money is an integer count of minor units held in a `number`. This guard keeps it exact: anything
 * that is not a safe integer would silently lose precision.
 */
export function assertSafeInteger(value: number, label = "value"): number {
  if (!Number.isSafeInteger(value)) {
    throw new CoreError("UNSAFE_INTEGER", `${label} must be a safe integer, got ${String(value)}`, {
      label,
      value,
    });
  }
  return value;
}

/**
 * Parses a non-negative decimal string ("12", "12.5", ".5") into integer units with `decimals`
 * places, exactly (no floating point). Extra fractional digits are accepted only when they are
 * zeros ("100.00" is fine for JPY); anything else is rejected rather than rounded.
 */
export function parseDecimalToUnits(input: string, decimals: number, label = "amount"): number {
  const text = input.trim();
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (whole === "" && fraction === "")) {
    throw new CoreError("INVALID_AMOUNT", `${label} "${input}" is not a valid number`, { input });
  }
  if (/[1-9]/.test(fraction.slice(decimals))) {
    throw new CoreError(
      "TOO_MANY_DECIMALS",
      `${label} "${input}" has more than ${String(decimals)} decimal places`,
      { input, decimals },
    );
  }
  const units = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CoreError("UNSAFE_INTEGER", `${label} "${input}" is too large`, { input });
  }
  return Number(units);
}

/** Parses a user-entered amount ("1000", "333.34") into minor units of `currency`. */
export function parseAmount(input: string, currency: string): number {
  return parseDecimalToUnits(input, exponentOf(currency));
}

/** Rejects amounts above {@link MAX_AMOUNT_MINOR}. */
export function assertWithinMaxAmount(amountMinor: number, label = "amount"): number {
  if (amountMinor > MAX_AMOUNT_MINOR) {
    throw new CoreError(
      "AMOUNT_TOO_LARGE",
      `${label} may not exceed ${String(MAX_AMOUNT_MINOR)} minor units`,
      { label, amountMinor },
    );
  }
  return amountMinor;
}

/** Exact decimal text for `units` with `decimals` places: (33334, 2) gives "333.34". */
export function unitsToDecimalString(units: number, decimals: number): string {
  assertSafeInteger(units, "units");
  const digits = BigInt(Math.abs(units))
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${units < 0 ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

/** Exact decimal text for an amount in minor units of `currency`. */
export function minorToDecimalString(amountMinor: number, currency: string): string {
  return unitsToDecimalString(amountMinor, exponentOf(currency));
}

/**
 * Formats an amount for display with `Intl.NumberFormat`, always showing the currency's own number
 * of decimals. The exact decimal string is passed to `Intl`, so no floating point is involved.
 */
export function formatMinor(
  amountMinor: number,
  currency: string,
  locale?: string | readonly string[],
): string {
  const exponent = exponentOf(currency);
  return new Intl.NumberFormat(locale as string | string[] | undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(unitsToDecimalString(amountMinor, exponent) as Intl.StringNumericLiteral);
}
