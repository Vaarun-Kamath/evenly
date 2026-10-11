# ADR-0006: Split validation and `packages/core` API rules

Status: Accepted (2026-10-11). Fills gaps in ARCHITECTURE.md section 5 found while building M1.

## Context

ARCHITECTURE.md §5 fixes the algorithms but leaves some input rules and edge cases open. These
decisions are implemented and tested in `packages/core`.

## Decisions

1. **Value formats.** `equal`: no value. `exact`: whole minor units, each between 0 and the 10^12 cap.
   `percent`: a decimal with at most two places, above zero, totalling exactly 100.00. `shares`: a decimal
   with at most two places, above zero, at most 1,000,000.00. Percentages become basis points
   (x100) and shares become weights (x100) by exact decimal parsing, so "round(share x 100)" in §5.2 is
   exact and never rounds.
2. **Zero.** A percentage or share of zero is rejected (leave the member out instead). An exact amount of
   zero is allowed, because the database allows `amount_minor = 0` for shares.
3. **Never round user input.** Extra decimal digits are accepted only when they are zeros (`"100.00"` for
   JPY); any other extra digit is `TOO_MANY_DECIMALS`. Parsing never uses floating point.
4. **Members.** Unknown members, duplicates and an empty list are rejected. Output is always in canonical
   order (the order of the `canonicalOrder` argument: `joined_at`, then `id`), not input order. Rejoining
   keeps `joined_at` (ADR-0003), so stored rounding never depends on who rejoined.
5. **Payers** are validated by `validatePayers`: at least one, known, listed once, each above zero and within
   the cap, adding up to exactly the total.
6. **Settlements** are validated by `validateSettlements`: known members, two different people, amount above
   zero.
7. **Balances.** `computeNets` rejects an expense whose payers and shares differ (`SHARES_TOTAL_MISMATCH`)
   and any negative amount. It sums with `BigInt`, so many large expenses cannot overflow silently; a net
   outside the safe-integer range is an error. It returns one entry per member, in member order, zeros
   included.
8. **Simplify.** The exact-opposite pass of §5.4 step 1 visits creditors in canonical order and pairs each with
   the canonically earliest debtor whose debt is exactly equal. The greedy pass then picks the largest
   remaining debtor and the largest remaining creditor, the earlier member winning ties.
9. **Pairwise.** Debts are reported once per pair, ordered by the earlier member of the pair, then the later one.
   A settlement larger than the debt flips the direction of the pair.
10. **`allocate`** accepts weights of zero (they receive zero) as long as the weights do not all sum to zero.
11. **Errors.** Every rejection is a `CoreError` with a stable `code` (see `packages/core/src/errors.ts`); the API
    layer maps codes to problem+json in M4.
12. **Currency table.** `CURRENCY_EXPONENTS` lists active ISO 4217 currencies with an exponent of 0, 2 or 3.
    Excluded on purpose: fund and special codes, and the two currencies with an exponent of 4 (CLF, UYW),
    plus currencies being withdrawn (BGN after the euro changeover, HRK). ICU differs from ISO for a known
    set of codes (listed in `test/currency.test.ts`); stored values follow ISO. A currency can be added with
    one line.

## Consequences

- The API (M4) and the web form (M5) reuse these functions and error codes, so the browser preview and the
  server agree.
