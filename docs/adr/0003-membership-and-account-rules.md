# ADR-0003: Membership, ownership, account deletion, idempotency

Status: Accepted (approved by the owner, 2026-10-11)

## Context

SPEC.md and ARCHITECTURE.md leave several membership edge cases open, and one schema constraint
(`groups.created_by NOT NULL REFERENCES "user"`) makes account deletion impossible as written.

## Decisions

1. **Owner rules.** The owner cannot leave or be removed. They must transfer ownership first, or delete
   the group (all balances zero). Exactly one owner per group at all times.
2. **Account deletion** (SPEC §4.1) is blocked while the user (a) has a non-zero balance in any group,
   archived groups included, or (b) owns any non-deleted group. Otherwise, in one transaction: each of the
   user's memberships gets `left_at = now()`, `display_name = 'Deleted user'`, `email = NULL`, and
   `user_id = NULL`; then the user row is deleted. A membership with `left_at` set is never claimable,
   so a deleted user's row cannot be mistaken for a placeholder.
3. **Schema.** `groups.created_by` becomes nullable `uuid REFERENCES "user"(id) ON DELETE SET NULL`.
   `group_members.user_id` becomes `uuid REFERENCES "user"(id) ON DELETE SET NULL`.
4. **Claim invites** (SPEC §4.3). The target must be a placeholder: `user_id IS NULL AND left_at IS NULL`.
   The server forces `max_uses = 1` for claim invites. Accepting is refused with 409 and an explanation when the
   accepting user already has any membership row in that group (active or left). Merging two memberships is out of scope for v1.
5. **Normal invites with a former membership.** A user who left and accepts a normal invite reactivates
   their existing row (`left_at = NULL`), as ARCHITECTURE §4 already says. `joined_at` is kept, so the
   canonical member order for rounding does not change.
6. **Idempotent expense and settlement create.** Same `id`, same group, same normalised body: return the existing
   row (200; 201 on first create). Same `id` with a different body, an `id` that exists in another group, or an
   `id` whose row is soft-deleted: 409 `problem+json`. A soft-deleted row is never resurrected by a create.

## Consequences

- M3 implements 1 to 5 and tests them; M4 implements 6.
- ARCHITECTURE.md §4 was edited for point 3.
