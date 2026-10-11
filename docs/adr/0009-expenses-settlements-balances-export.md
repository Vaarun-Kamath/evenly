# ADR-0009: Expenses, settlements, balances and export (M4)

Status: Accepted (2026-10-11). Fills gaps in SPEC.md sections 4.4 to 4.8 and ARCHITECTURE.md section 6; builds on ADR-0003, 0004 and 0006.

## Decisions

### Writing expenses and settlements

1. **Create** takes a client-generated UUID. First time: 201. A retry with the same id, group and content: 200 with the
   existing row. Same id with different content, from another group, or for a deleted row: 409
   `idempotency-conflict` (ADR-0003). "Same content" means the same fields, payers and computed shares, whatever order
   the members were listed in. Concurrent duplicates are safe: the group row is locked and the insert is
   `ON CONFLICT DO NOTHING`.
2. **Money rules** are `@evenly/core`'s (ADR-0006). A `CoreError` is answered as 422 with the problem type
   `urn:evenly:problem:<code>` (kebab case) and the code in the body; malformed requests stay 400. A currency other than
   the group's is 422 `currency-mismatch`; a member id that is not in the group is 422 `unknown-member`.
3. **Edit** is a `PATCH` carrying the whole expense and the `version` it started from. A stale version is 409
   `version-conflict` with the current row in `current`. An edit that changes nothing keeps the version and writes no
   activity. Delete and restore also bump the version, so an edit that started before them is refused. Delete is
   idempotent; restore is for admins and idempotent; editing a deleted row is 409 (`expense-deleted`,
   `settlement-deleted`). Settlements follow the same rules, with restore too.
4. **People who left stay at zero.** Leaving requires a zero balance, so nothing may give a left member a balance again.
   A left member may not be added to a new expense or settlement. An existing expense they are in can still be edited,
   deleted or restored, but only if what it does to their balance (paid minus owed) does not change; otherwise 409
   `member-left`.
5. **Archived groups** refuse every write (ADR-0008).
6. **Timestamps** that the app writes (`updated_at`, `deleted_at`, `left_at`, `archived_at`, `revoked_at`) use the
   database clock (`now()`), like the `created_at` defaults, so they cannot disagree because two machines' clocks differ.
   Invite expiry is the one exception: it is set and compared by the app.
   **Join order is monotonic.** The canonical member order (`joined_at`, then `id`) decides who receives the odd minor
   units, so it must follow who joined first even if a clock steps back (the Postgres container on a developer's
   Windows machine was seen stepping back by up to 0.5 s under load). A new member's `joined_at` is therefore the
   database clock, but never earlier than the latest member of the same group plus a microsecond, chosen while the
   group row is locked (`nextJoinedAt` in `modules/common/joined.ts`).

### Reading

7. **Lists** are newest first by `(date, id)` with an opaque cursor of that pair. Filters: date range, category, member
   (paid or shares), and a text search of the description that treats `%`, `_` and `\` literally. Deleted rows are left
   out, but one can be fetched by id (the activity feed links to them).
8. **Balances** (`GET /groups/:gid/balances`): `nets` (all members, canonical order, zeros included), the `simplified`
   plan, the `pairwise` debts, and `suggested`, which is `simplified` when the group simplifies debts and `pairwise`
   otherwise (ADR-0004). The pairwise view is the real debt graph: if a group that simplifies settles up along the
   simplified plan, the nets reach zero but the pairwise view can keep offsetting leftovers. That is expected.
9. **Overview** (`GET /me/overview`) totals are summed per counterparty, so they agree with the per-person list: for
   each currency, `owedToYou` adds what each counterparty owes you and `youOwe` adds what you owe each counterparty, and
   `net` is their difference (your total net). A real person is one counterparty across all groups; a placeholder or a
   deleted user counts separately in each group (they cannot be matched across groups), and appears in totals but not in
   the people list.

### Export

10. **CSV** (`GET /groups/:gid/export.csv`): UTF-8 with a byte order mark, CRLF line ends, one table, one row per live
    expense (oldest first) and then per live settlement. Columns: type, date, description, category, amount, currency,
    paid by, split, notes, then for each member (canonical order, former members marked "(left)") a **share** column and a
    **net effect** column. The net-effect columns of all rows add up, per member, to the balance in the section below the
    table, so totals can be checked in a spreadsheet; a final row shows that the balances add up to zero. Amounts are
    plain decimals with the currency's own decimals. Free text that could be read as a formula (starting `=`, `+`, `-`, `@`,
    tab or carriage return, after any spaces) gets a leading `'`; numbers the server formats are never altered.
11. **Streaming**: the file is produced in pages of 500 rows inside one read-only repeatable-read transaction, so memory
    stays flat and the rows and balances come from the same snapshot.

## Consequences

- M5's expense form posts `{ id, ..., split }` and uses `@evenly/core` for the live preview; the settle-up screen reads
  `suggested`; a 409 `version-conflict` carries what the conflict dialog needs.
