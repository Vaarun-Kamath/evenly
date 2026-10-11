# LIB-001: Product spec

**Working name:** Evenly (placeholder; final name not chosen yet).
**One-liner:** A free, open-source, self-hostable app for splitting shared expenses with friends and groups.
**Liberates:** Splitwise-style expense splitting, whose free tier has become increasingly limited.
Do not use the Splitwise name or branding in the product (see PLATFORM.md §1). "Open-source
alternative to Splitwise" is acceptable only in the README and marketing copy.

---

## 1. Goals

- Track shared expenses in groups and always show, correctly, who owes whom.
- Reduce a group's debts to the fewest practical payments ("simplify debts").
- No paywalls and no artificial limits: unlimited groups, expenses and members.
- One `docker compose up` to self-host.

## 2. Non-goals for v1

- Real payment processing (UPI, PayPal and so on). We only *record* settlements.
- Native mobile apps. The web app must work well on phones; a PWA comes in v2.
- Bank or card imports. Receipt scanning and OCR.

## 3. Roles

| Role | Can |
| --- | --- |
| Visitor | Sign up, log in, open an invite link (and sees a group preview before joining) |
| Member | View the group; add, edit and delete expenses and settlements; invite people; leave (only if their balance is zero) |
| Admin | Everything a member can do, plus rename the group, change its settings, remove members (zero balance only), revoke invites, restore deleted items |
| Owner | Everything an admin can do, plus promote/demote admins, transfer ownership, delete the group |

The group creator becomes the owner.

## 4. Features: v1 (MVP)

### 4.1 Accounts
- Sign up with name, email and password; log in; log out; log out of all sessions.
- Edit profile: display name and default currency.
- Password reset by email, **only if SMTP is configured**. Otherwise the server CLI command
  `reset-password <email>` prints a single-use reset link for the instance administrator.
- Delete account. Blocked while the user has any non-zero balance; after deletion the user's
  memberships become anonymised placeholder members ("Deleted user") so that group history stays intact.

### 4.2 Groups
- Create a group: name, currency (ISO 4217), optional emoji or icon, "simplify debts" setting (on by default).
- Dashboard listing my groups, each with my net balance, plus overall totals ("you owe X / you are owed Y", per currency).
- Archive and unarchive a group (it becomes read-only and drops off the main list). The owner can delete a group only when every balance is zero.

### 4.3 Members, invites and joining
- **Invite link:** an admin or member creates a link with an expiry (default 7 days; options 1 day / 7 days / 30 days / never)
  and optionally a maximum number of uses. Admins can revoke links. Anyone with the link sees a preview
  (group name, member count, who invited them), then signs up or logs in and joins.
- **Email invite** (only if SMTP is configured): sends the same kind of link, bound to that email address.
- **Placeholder members:** add someone by name (and optionally email) before they have an account,
  so expenses can include them straight away. Their invite link carries `claim=<memberId>`; when they
  accept, the placeholder becomes their real membership and keeps its full history.
- Leaving a group, or removing a member, is allowed only when that member's balance in the group is zero.
  Former members stay visible in history as "(left)".

### 4.4 Expenses
- Fields: description (required), amount, date (default today), category (fixed list: food, groceries,
  transport, rent, utilities, entertainment, travel, shopping, other), notes, and who paid.
- **Payers:** one or several members, each with the amount they paid. The amounts must add up to the total.
- **Split methods** (each one must account for the total exactly, to the cent):
  - **Equal** among the selected members.
  - **Exact amounts** per member.
  - **Percentages** per member (must total 100%, up to 2 decimal places).
  - **Shares** per member (e.g. 2 : 1 : 1; whole numbers or up to 2 decimal places).
- Rounding: cents that don't divide evenly are handed out one at a time in a fixed, repeatable order
  (see ARCHITECTURE.md §5.2), so the split always adds up to the exact total.
- The form shows a live preview of each member's share, and validation errors before saving.
- Any member can edit or delete an expense. Deletes are soft: admins can restore. Every change is recorded in the activity feed.
- Edits use optimistic locking: if someone else changed the expense first, the editor is told and shown the latest version.

### 4.5 Settlements ("Settle up")
- Record a payment from member A to member B (amount, date, note).
- On the "Settle up" screen, each suggested payment from the simplified plan (§4.6) can be recorded with one tap, amount pre-filled.
- A settlement can be edited or soft-deleted like an expense.

### 4.6 Balances and consolidation
- **Per-member net balance** in the group (positive means they are owed money).
- **Simplified plan** (when "simplify debts" is on): the shortest practical list of "A pays B ₹X"
  payments that settles every balance. It never needs more than (members − 1) payments.
- **Pairwise view** (when "simplify debts" is off): the actual debts between each pair of members,
  built from the individual expenses and settlements.
- **Cross-group overview** on the dashboard: for each person you share groups with, your combined net balance across all those groups (per currency).
- Balance invariant: the members' net balances in a group always sum to exactly zero.

### 4.7 Activity and history
- A per-group activity feed: created/edited/deleted expense, settlement, member joined/left, settings changed.
  Edits show what changed (old value → new value).
- Expense list with filters (date range, category, member, text search on description) and cursor pagination.

### 4.8 Export
- A group's CSV export: every expense and settlement, with per-member shares, plus a balances summary.

### 4.9 Currency
- v1: each group has one currency and every expense in it uses that currency.
- The database schema already stores a currency on every expense and settlement, so v2 can add multiple currencies without a data migration.

## 5. Features: v2 (after launch)

Prioritise the features that commercial splitting apps tend to put behind a paid plan, since they best demonstrate the point of the project:
- Expenses in other currencies with **free conversion** (daily ECB rates, e.g. via frankfurter.app, cached; the rate used is stored on the expense).
- Charts: spending by category, member and month.
- Recurring expenses (rent, subscriptions).
- Receipt photo attachments (S3-compatible storage; optional).
- Itemised bills (split each line item between different people).
- Search across all groups.
- 1:1 expenses with a friend outside any group.
- Email notifications and weekly digests (SMTP); PWA with offline expense entry.
- OAuth login (Google, GitHub); passkeys.
- Translations; locale-aware number and currency formatting (formatting itself is in v1 via `Intl`).

## 6. UX notes

- Mobile-first. The most common action, "add expense", must be one tap from the group screen and fully usable with one thumb.
- Amounts appear in the group currency with `Intl.NumberFormat`. Owed amounts and amounts you owe are
  told apart by a sign and a label ("you owe" / "owes you"), not by colour alone.
- Every destructive action asks for confirmation; restore is available from the activity feed.
- Accessibility: semantic HTML, keyboard navigable, visible focus, WCAG AA contrast.
- Design: clean and minimal. A visual identity in line with the portfolio (monochrome) is fine but optional.

## 7. Acceptance scenarios (must pass end-to-end)

1. A signs up, creates "Goa Trip" (INR), and invites B with a link. B signs up through the link and lands in the group.
2. A adds placeholder member C. A adds "Dinner ₹1,000" paid by A, split equally between A, B and C → shares are
   ₹333.34 / ₹333.33 / ₹333.33 (the extra paisa goes to the member who joined first, A), and the balances are
   A +₹666.66, B −₹333.33, C −₹333.33.
3. B adds "Cab ₹600" paid by B, split by shares A:1, B:1, C:2. The balances update and still sum to 0.
4. With simplify debts on, the settle-up plan has at most 2 payments and settles everyone to exactly 0.
5. C accepts a claim invite: C's placeholder becomes a real account with the same history.
6. B records the suggested settlement. B's balance becomes 0, and the activity feed shows the settlement.
7. Two users edit the same expense at the same time: the second save gets a conflict and sees the latest version.
8. Leaving the group with a non-zero balance is refused with an explanation.
9. CSV export opens in a spreadsheet, and its totals match the in-app balances.
10. A user who isn't a member gets 404 (not 403) for every route of that group.
