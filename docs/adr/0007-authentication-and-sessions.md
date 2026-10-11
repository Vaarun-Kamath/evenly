# ADR-0007: Authentication, sessions and the session secret

Status: Accepted (2026-10-11). Builds on ADR-0001 and ADR-0002; deviates from PLATFORM.md section 6 in one place (point 3).

## Context

M2 adds the database and authentication with Better Auth 1.7. Building it showed several places where the
library's defaults, or the documents, needed a decision.

## Decisions

1. **Mounting.** The auth library is served at `<BASE_PATH>/api/auth/*`. Better Auth is configured with
   `baseURL` = the origin only and an explicit `basePath`; a path inside `baseURL` would replace the auth
   path instead of prefixing it. The request URL given to it is built from the configured origin, never from
   the `Host` header.
2. **Cookies.** `evenly.session_token`, `HttpOnly`, `SameSite=Lax`, `Path=<BASE_PATH>` (or `/`), and `Secure`
   (with the library's `__Secure-` prefix) only when `PUBLIC_URL` is https. Tested at `/` over http and at
   `/evenly` over https.
3. **Session tokens are stored as-is in the database** (the `session.token` column). PLATFORM.md section 6 asks
   for only a hash to be stored; Better Auth does not offer that. The cookie carries `token.signature` signed
   with the session secret, so reading the database alone does not let anyone forge a cookie. When the secret is
   also stored in that database (point 4), a database leak would allow forging. Mitigation: the hosted
   instance sets `SESSION_SECRET` in its environment, and the README recommends it for any public instance.
   Revisit if the library gains token hashing.
4. **`SESSION_SECRET` is optional.** When unset, the server generates 32 random bytes on first start and stores
   them in `instance_secrets` (race-safe across replicas), so `docker compose up` needs no configuration. When
   set, the variable wins. Changing the secret signs everyone out.
5. **Origin check on every non-GET, including the auth endpoints.** The library only checks `Origin` on requests
   that carry cookies, so a cookie-less cross-site sign-in or sign-up (login CSRF) would pass. Our guard runs
   in front of both `/api/auth` and `/api/v1` and compares against `PUBLIC_URL`'s origin plus `TRUSTED_ORIGINS`.
6. **Client IP.** Rate limits use the address Fastify resolves (honouring `TRUST_PROXY`), passed to the library
   in a private header (`x-evenly-client-ip`) that overwrites anything a client sent. `X-Forwarded-For` from a
   client is never read by the auth library.
7. **Rate limits** (ARCHITECTURE.md section 7): per IP and path from the library (sign-in 10/min, sign-up 5/min,
   password-reset request 3/hour, reset 10/hour) and per account from `SlidingWindowLimiter` (sign-in 10/min and
   reset requests 3/hour per email address, whatever the IP). Both are in memory, which is right for one
   replica; for several replicas use the library's database storage and move the account limiter there.
8. **Passwords.** The library's default scrypt hashing (allowed by PLATFORM.md section 6), 10 to 128 characters.
   Sign-up names are 1 to 100 characters.
9. **Account enumeration.** Sign-in answers identically for a wrong password and an unknown account, and
   password-reset requests answer identically for known and unknown addresses. Sign-up reports an existing email
   (the library's behaviour with automatic sign-in); accepted for v1, since invites by email reveal the same.
10. **Sign-up policy** (`ALLOW_SIGNUPS`): `true`, `false`, or `invite-only`. Until invites exist (M3), invite-only
    accepts no sign-ups; M3 supplies the `InviteGate`. Existing users can always sign in.
11. **Password reset.** By email only when SMTP is configured; otherwise
    `node dist/cli.js reset-password <email>` prints a single-use link (valid one hour) to
    `<PUBLIC_URL>/reset?token=...`. A reset signs out every session.
12. **Telemetry** of the library is explicitly disabled (PLATFORM.md section 1).
13. **Profile.** `PATCH /api/v1/me` changes the name and the default currency, validated by the shared
    contracts. The library's own `defaultCurrency` field is not client-writable.

## Consequences

- M3 supplies the invite gate and keeps `group_members.display_name` in step when a user renames themselves.
- `apps/server/better-auth.config.ts` must stay in step with `src/auth/auth.ts` for schema-affecting options;
  regenerate with `pnpm --filter @evenly/server auth:generate` and `pnpm --filter @evenly/server db:generate`.
