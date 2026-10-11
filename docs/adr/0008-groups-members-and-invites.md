# ADR-0008: Groups, members and invites (M3)

Status: Accepted (2026-10-11). Fills gaps in SPEC.md section 4 and ARCHITECTURE.md section 6; builds on ADR-0003.

## Decisions

### Access

1. **404 for anyone not in the group.** `requireMember(groupId, userId, minRole)` runs first in every group
   service. A user who is not an _active_ member of an existing, non-deleted group gets the same 404 as for a
   group that does not exist (a malformed id too, with an identical body), so ids cannot be probed. This includes
   people who left, were removed or deleted their account. A member whose role is too low gets 403.
   `access.test.ts` lists every group route and fails if a registered route is missing from the list.
2. **Archived groups are read-only.** Every write except `unarchive` and `DELETE` is refused with 409
   `group-archived`, including leaving the group and creating invites. Invite links to an archived group answer 410.
3. **The currency of a group never changes** (the update schema rejects it): every expense in it uses it.

### Members and roles

4. **Placeholders** can be added by any member. Only placeholders are renamed by hand (an admin); an account's
   display name follows its profile and is updated in all of that user's memberships when they rename themselves.
5. **Roles.** Only the owner changes roles. Not your own, not a placeholder's, not someone who left. Setting
   `role: "owner"` hands the group over and makes the former owner an admin, in one transaction under a row lock on
   the group, so there is always exactly one owner.
6. **Removing people.** Anyone may leave (not the owner, ADR-0003). An admin removes members and placeholders; only
   the owner removes an admin. Always with a zero balance, computed from the live expenses and settlements. The row
   stays, marked `left_at`. Claim links aimed at a removed placeholder are revoked.
7. **Member lists** include people who left (with `leftAt`), in canonical order (`joined_at`, then `id`), each with
   their net balance. Account emails are not shown; a placeholder's email is.

### Invites

8. **Links** are `<PUBLIC_URL>/invite/<token>`; the token is 32 random bytes in base64url and only its sha256 is
   stored. The link is returned once, at creation. Default lifetime is `INVITE_DEFAULT_TTL_DAYS` (7); options 1, 7,
   30 days or never; optional `maxUses`.
9. **Why a link does not work is told** (410 with a type): `invite-revoked`, `invite-expired`, `invite-used-up`,
   `group-archived`, `claim-unavailable`. An unknown or malformed link, or a deleted group, is 404. The preview
   (`GET /invites/:token`) is public and limited to 30 requests a minute per client IP.
10. **Accepting** runs in one transaction with a lock on the invite row; the use is counted atomically against
    `max_uses` and the expiry, so concurrent accepts cannot exceed the limit. Already a member: nothing changes and no
    use is spent. Left earlier: the old row is reactivated as a plain member (same place in the canonical order).
11. **Email.** An invite with `email` is bound to that address (matched case-insensitively when accepting) and is
    emailed; this needs SMTP (409 `email-not-configured` otherwise). If the email cannot be sent, the invite is
    revoked rather than left live and unknown.
12. **Claims** follow ADR-0003: only a placeholder that is still in the group, always single-use, refused for anyone
    who has any membership row in the group. The claimed row keeps its id (so its history), takes the account's
    name, and loses the placeholder email.
13. **Invite-only sign-ups.** The sign-up request carries the token in an `x-evenly-invite` header; it passes when
    the link is usable (and, if email-bound, the sign-up email matches). Signing up does not use the link up;
    accepting it does.
14. **The first account on a fresh instance is always allowed**, whatever `ALLOW_SIGNUPS` says. A private instance
    could otherwise never get the account that creates the first invite. After that the policy applies.

### Data

15. **Net balances** come from one SQL statement (live rows only), a second implementation of the rule in
    `@evenly/core`; `nets.test.ts` checks that both agree on 40 random groups with soft-deleted rows. Lookups use
    new indexes on `group_members`, `settlements` and `group_invites` by `group_id`.
16. **Activity** has one row per change, written in the same transaction (kinds: `group.created|updated|archived|
unarchived|deleted`, `member.added|joined|claimed|left|removed|updated|role_changed`, `invite.created|revoked`).
    The feed (`GET /groups/:gid/activity`) pages by id: ids are UUIDv7, so they sort by time and the last id of a page
    is the cursor. Invite tokens are never written to it.
17. **Account deletion** is `DELETE /api/v1/me` with the password in the body (ADR-0003 rules); it also clears the
    session cookie.

## Consequences

- M4 adds expenses and settlements to the same ledger; the balance query and the deletion/leave rules need no change.
