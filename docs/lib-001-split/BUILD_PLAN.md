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
- [ ] CI: lint, typecheck, test, docker build. (Workflow written, and `scripts/smoke.sh` passes locally; tick this when the first run on GitHub is green.)

**Done when** a fresh clone followed by `docker compose up` gives a page, and CI is green.

## M1: Core money logic (`packages/core`), no I/O
- [ ] Money parsing and formatting using currency exponents; `assertSafeInteger`.
- [ ] `allocate()` exactly as in ARCHITECTURE.md §5.2.
- [ ] Split calculators: equal, exact, percent, shares, with typed validation errors.
- [ ] `computeNets()`, `simplify()`, `pairwise()` (§5.3–5.5).
- [ ] Static ISO 4217 exponent table plus a test against `Intl`; amount cap of 10^12 minor units (ADR-0004).
- [ ] Unit tests and **all** the property tests in §5.6; 100% branch coverage on `packages/core`.

**Done when** the property tests pass with 10k runs each, and SPEC.md scenarios 2–4 pass as unit tests.

## M2: Database and auth
- [ ] Drizzle schema matching ARCHITECTURE.md §4, the first migration, the deferred sum-check trigger.
- [ ] Migrations at startup under an advisory lock; `node dist/migrate.js`.
- [ ] Custom SQL migrations (`drizzle-kit generate --custom`) for `citext` and the deferred sum-check trigger; the migration lock uses one reserved connection (ADR-0004).
- [ ] Decide `SESSION_SECRET`: required, or generated and stored, keeping `docker compose up` zero-config.
- [ ] Auth library: sign up, log in, log out, log out everywhere, sessions; `ALLOW_SIGNUPS`; rate limits; Origin check.
- [ ] Auth cookie `Path=BASE_PATH`, `Secure` only for an https `PUBLIC_URL`, Origin check against `PUBLIC_URL` (ADR-0002); assert the `Set-Cookie` header in a test.
- [ ] CLI: `reset-password <email>`.
- [ ] Integration test setup against a real Postgres (each test in its own transaction, or a fresh schema per file).

**Done when** integration tests cover sign up → log in → `GET /me` → log out, plus rate limiting and the Origin check.

## M3: Groups, members, invites
- [ ] Group CRUD, archive, `simplify_debts` setting, roles and `requireMember`.
- [ ] Placeholder members; invite links (expiry, max uses, revoke); preview; accept; claiming a placeholder.
- [ ] Owner, claim-invite, account-deletion and rejoin rules from ADR-0003, each with a test.
- [ ] Leave/remove only with a zero balance (wired up properly once M4 exists; until then, check that no expenses exist).
- [ ] Non-members get 404 on every group route (one parameterised test covering all routes).
- [ ] Activity rows for every change.

## M4: Expenses, settlements, balances
- [ ] Expense create (idempotent via client `id`), read, list with filters and cursor, update with `version`, soft delete and restore.
- [ ] Settlements, with the same behaviour.
- [ ] `GET /balances` → nets, simplified plan, pairwise.
- [ ] `GET /me/overview`: totals and cross-group per-person nets (always pairwise, ADR-0004).
- [ ] Idempotent create rules (ADR-0003 point 6).
- [ ] CSV export (streamed): BOM, decimal amounts by exponent, formula-injection escaping (ADR-0004).
- [ ] Integration tests for SPEC.md scenarios 2–4 and 6–9 at the API level.

## M5: Web UI
- [ ] Auth pages, dashboard, create group, group page (expenses + balances), add/edit expense with the live split preview,
      settle-up (one tap per suggested payment), settings (members, invites, roles), invite landing page, account page.
- [ ] Mobile-first layouts, checked at 375px wide; keyboard navigation; visible focus; AA contrast.
- [ ] Empty, loading and error states on every screen; conflict (409) dialog on expense edit.
- [ ] Settle-up screen suggests from the pairwise list when simplify is off (ADR-0004).
- [ ] Playwright: SPEC.md scenarios 1–10 against the built Docker image, at `BASE_PATH=/` and `BASE_PATH=/evenly` (behind a proxy), including a reload on a deep link such as `/evenly/g/<id>/settle`.

## M6: Release
- [ ] README: screenshots, features, a "Self-host in 2 minutes" section (`docker compose up`), configuration table, an honest comparison with commercial alternatives, roadmap.
- [ ] `release.yml` → multi-arch image on GHCR; tag `v0.1.0`.
- [ ] Deploy to the hosted instance (PLATFORM.md §5): create the `lib001` database and role, set the environment variables, point the domain at it.
- [ ] Back up the hosted database and test a restore.
- [ ] Tell the portfolio owner the repo URL, version and upstream URL, so the portfolio can add the `/evenly`
      rewrite and update `content/liberated/lib-001.json`. (That change is made in the portfolio repo, not this one.)

## Definition of done (every milestone)
- Lint, typecheck and tests are green in CI; no `any` without a comment explaining why.
- New behaviour has tests; any money path has property tests.
- Docs updated (README, ARCHITECTURE.md, an ADR for any deviation from these docs).
- `docker compose up` from a clean clone still works.
