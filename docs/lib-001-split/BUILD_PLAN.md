# LIB-001: Build plan

Work through the milestones in order. Each one ends in a working, tested state and its own PR (or
commits on `main` if you're working alone). Check items off in this file as you go.

---

## M0: Repository skeleton
- [x] pnpm workspace: `apps/server`, `apps/web`, `packages/core`, `packages/contracts`; shared tsconfig, ESLint and Prettier.
- [x] `CLAUDE.md`: short notes for future sessions (commands, layout, the money rules from ARCHITECTURE.md §5, where the docs are).
- [x] `LICENSE` (AGPL-3.0-only), `README.md` stub, `.env.example`, `.gitignore`, `SECURITY.md`, `CONTRIBUTING.md`.
- [x] Fastify server with `/healthz` and `/readyz`, zod-validated env, pino logging, graceful shutdown.
- [x] Vite + React app served by Fastify in production; Vite dev server proxies `/api` in development.
- [x] `Dockerfile` and `docker-compose.yml`; `docker compose up` serves a "hello" page on :3000.
- [x] `BASE_PATH` support from day one (PLATFORM.md §9): the hello page and `/healthz` work at both `/` and `/evenly`.
- [x] CI: lint, typecheck, test, docker build. (First green run on GitHub: both jobs, including the smoke test at `/` and `/evenly`.)

**Done when** a fresh clone followed by `docker compose up` gives a page, and CI is green.

## M1: Core money logic (`packages/core`), no I/O
- [x] Money parsing and formatting using currency exponents; `assertSafeInteger`.
- [x] `allocate()` exactly as in ARCHITECTURE.md §5.2.
- [x] Split calculators: equal, exact, percent, shares, with typed validation errors (plus payer and settlement validation, ADR-0006).
- [x] `computeNets()`, `simplify()`, `pairwise()` (§5.3–5.5).
- [x] Static ISO 4217 exponent table plus a test against `Intl`; amount cap of 10^12 minor units (ADR-0004).
- [x] Unit tests and **all** the property tests in §5.6; 100% branch coverage on `packages/core` (enforced by `pnpm test`; 10k runs per property, `FAST_CHECK_RUNS` lowers it locally).

**Done when** the property tests pass with 10k runs each, and SPEC.md scenarios 2–4 pass as unit tests.

## M2: Database and auth
- [x] Drizzle schema matching ARCHITECTURE.md §4, the first migration, the deferred sum-check trigger.
- [x] Migrations at startup under an advisory lock; `node dist/migrate.js`.
- [x] Custom SQL migrations (`drizzle-kit generate --custom`) for `citext` and the deferred sum-check trigger; the migration lock uses one reserved connection (ADR-0004).
- [x] Decide `SESSION_SECRET`: optional; generated and stored in the database when unset, keeping `docker compose up` zero-config (ADR-0007).
- [x] Auth library: sign up, log in, log out, log out everywhere, sessions; `ALLOW_SIGNUPS`; rate limits; Origin check. Also `GET`/`PATCH /api/v1/me` and password reset by email when SMTP is set (ADR-0007).
- [x] Auth cookie `Path=BASE_PATH`, `Secure` only for an https `PUBLIC_URL`, Origin check against `PUBLIC_URL` (ADR-0002); assert the `Set-Cookie` header in a test.
- [x] CLI: `reset-password <email>`.
- [x] Integration test setup against a real Postgres (a fresh database per test file, copied from a migrated template; `pnpm --filter @evenly/server test:integration`).

**Done when** integration tests cover sign up → log in → `GET /me` → log out, plus rate limiting and the Origin check.

## M3: Groups, members, invites
- [x] Group CRUD, archive, `simplify_debts` setting, roles and `requireMember`.
- [x] Placeholder members; invite links (expiry, max uses, revoke); preview; accept; claiming a placeholder.
- [x] Owner, claim-invite, account-deletion and rejoin rules from ADR-0003, each with a test (`DELETE /api/v1/me`).
- [x] Provide the `InviteGate` that lets `ALLOW_SIGNUPS=invite-only` accept a sign-up with a valid invite (ADR-0007, ADR-0008).
- [x] Keep `group_members.display_name` of real members in step when a user renames themselves (`PATCH /me`).
- [x] Leave/remove only with a zero balance (from the live expenses and settlements; the balance query already exists).
- [x] Non-members get 404 on every group route (one parameterised test covering all routes, with a check that no route is missing from it).
- [x] Activity rows for every change (and `GET /groups/:gid/activity`).

## M4: Expenses, settlements, balances
- [x] Expense create (idempotent via client `id`), read, list with filters and cursor, update with `version`, soft delete and restore.
- [x] Settlements, with the same behaviour.
- [x] `GET /balances` → nets, simplified plan, pairwise (and `suggested`, the plan the settle-up screen offers).
- [x] `GET /me/overview`: totals and cross-group per-person nets (always pairwise, ADR-0004).
- [x] Idempotent create rules (ADR-0003 point 6).
- [x] CSV export (streamed): BOM, decimal amounts by exponent, formula-injection escaping (ADR-0004, ADR-0009).
- [x] Integration tests for SPEC.md scenarios 2–4 and 6–9 at the API level (`scenarios.test.ts` plays 1 to 10 as one story).

## M5: Web UI
- [x] Auth pages, dashboard, create group, group page (expenses + balances), add/edit expense with the live split preview,
      settle-up (one tap per suggested payment), settings (members, invites, roles), invite landing page, account page.
- [x] Mobile-first layouts, checked at 375px wide; keyboard navigation; visible focus; AA contrast.
- [x] Empty, loading and error states on every screen; conflict (409) dialog on expense edit.
- [x] Settle-up screen suggests from the pairwise list when simplify is off (ADR-0004).
- [x] Playwright: SPEC.md scenarios 1–10 against the built Docker image, at `BASE_PATH=/` and `BASE_PATH=/evenly` (the app serves the prefix itself, ADR-0002, so no stripping proxy is needed), including a reload on a deep link such as `/evenly/g/<id>/settle`. (`scripts/e2e.sh`; also axe-core on every main screen and a 375px overflow check. ADR-0010.)

## M6: Release
- [x] README: screenshots, features, a "Self-host in 2 minutes" section (`docker compose up`), configuration table, an honest comparison with commercial alternatives, roadmap.
- [x] `release.yml` → multi-arch image on GHCR; tag `v0.1.0`. (Published 2026-10-11. Checked afterwards: the GitHub release
      carries the CHANGELOG notes; `ghcr.io/vaarun-kamath/evenly:0.1.0` is a linux/amd64 + linux/arm64 index that can be pulled
      without logging in; `docker compose pull && docker compose up -d` from the bare `docker-compose.yml` starts a healthy app.)
- [ ] Deploy to the hosted instance (PLATFORM.md §5): create the `lib001` database and role, set the environment variables, point the domain at it.
      (The runbook is `DEPLOY.md`. Its database provisioning and the app's start-up against that least-privilege role were checked
      on a throwaway Postgres 18; running it on the real server is the owner's step.)
- [ ] Back up the hosted database and test a restore. (The procedure is in the README and is tested on a throwaway stack by
      `scripts/backup-restore-test.sh`, which CI runs; what remains is doing it on the hosted instance.)
- [ ] Tell the portfolio owner the repo URL, version and upstream URL, so the portfolio can add the `/evenly`
      rewrite and update `content/liberated/lib-001.json`. (That change is made in the portfolio repo, not this one.)

## Definition of done (every milestone)
- Lint, typecheck and tests are green in CI; no `any` without a comment explaining why.
- New behaviour has tests; any money path has property tests.
- Docs updated (README, ARCHITECTURE.md, an ADR for any deviation from these docs).
- `docker compose up` from a clean clone still works.
