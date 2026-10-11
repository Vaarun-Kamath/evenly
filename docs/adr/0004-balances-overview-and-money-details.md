# ADR-0004: Overview, settle-up with simplify off, money details, CSV, migrations

Status: Accepted (approved by the owner, 2026-10-11)

## Decisions

1. **Cross-group overview** (SPEC §4.6) always uses the pairwise method of ARCHITECTURE §5.5, whatever the
   group's `simplify_debts` setting, because a simplified plan can route a debt through a third person.
   It runs in application code over each group's expenses and settlements (not as one SQL query): for each
   person who has a `user_id`, the combined `d` between me and them per currency, over every non-deleted group
   including archived ones. Placeholders without a `user_id` are not aggregated across groups. Computed on
   request in v1; add caching only if profiling shows a need.
2. **Settle-up suggestions** (SPEC §4.5). With "simplify debts" on, they come from the simplified plan. With it
   off, they come from the pairwise list (each pair where `d > 0`, amount pre-filled).
3. **Currency exponents** come from a static ISO 4217 table in `packages/core`, not from ICU at runtime, so stored
   minor units never change meaning when ICU data changes. A test compares the table with `Intl` and fails on an
   unexplained difference. Only currencies in the table are accepted.
4. **Amount cap.** `amount_minor <= 1_000_000_000_000` (10^12) for expenses, payers, shares and settlements, in the zod schema
   and as a `CHECK`. This keeps sums and `BigInt` products comfortably inside safe-integer handling.
5. **`expense_shares.input_value`** is `numeric(20,2)` (was `numeric(12,2)`, too small for exact amounts in minor units).
6. **CSV export.** UTF-8 with a BOM so spreadsheets read non-ASCII text; amounts as decimal strings using the
   currency exponent; any text cell starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'`
   (spreadsheet formula injection).
7. **Migrations.** drizzle-kit cannot emit the `citext` extension or the deferred sum-check constraint trigger, so
   those go in `drizzle-kit generate --custom` SQL migrations. The startup advisory lock is taken on one connection
   reserved with postgres.js `sql.reserve()` and held for the whole migration run. An optional
   `MIGRATION_DATABASE_URL` allows a direct (non-PgBouncer) connection, since session locks do not survive
   PgBouncer transaction mode.

## Consequences

- M1 includes the exponent table and its `Intl` test. M2 includes the custom migrations. M4 implements 1, 2 and 6.
