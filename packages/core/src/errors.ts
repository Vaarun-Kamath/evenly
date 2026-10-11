/** Machine-readable reason for a rejected input. The API layer maps these to problem+json. */
export type CoreErrorCode =
  // numbers and money
  | "UNSAFE_INTEGER"
  | "INVALID_AMOUNT"
  | "TOO_MANY_DECIMALS"
  | "AMOUNT_TOO_LARGE"
  | "UNKNOWN_CURRENCY"
  // allocation
  | "INVALID_TOTAL"
  | "INVALID_WEIGHTS"
  | "INVALID_ORDER"
  // splits and payers
  | "NO_ENTRIES"
  | "DUPLICATE_MEMBER"
  | "UNKNOWN_MEMBER"
  | "MISSING_VALUE"
  | "UNEXPECTED_VALUE"
  | "NON_POSITIVE_VALUE"
  | "PERCENT_TOTAL_MISMATCH"
  | "EXACT_TOTAL_MISMATCH"
  | "NO_PAYERS"
  | "NON_POSITIVE_AMOUNT"
  | "PAYER_TOTAL_MISMATCH"
  // balances
  | "SHARES_TOTAL_MISMATCH"
  | "SELF_SETTLEMENT"
  | "UNBALANCED";

export class CoreError extends Error {
  override name = "CoreError";

  constructor(
    readonly code: CoreErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
