# Evenly (LIB-001): notes for Claude sessions

Free, open-source, self-hostable expense-splitting app (clean-room alternative to Splitwise-style
apps). AGPL-3.0-only. Repo: <https://github.com/Vaarun-Kamath/evenly>. Part of the "Liberated
Software" initiative; this repo lives at `liberated-split/evenly` next to other projects.

## Where things are

- `docs/PLATFORM.md`: conventions shared by all Liberated Software projects.
- `docs/lib-001-split/SPEC.md`: what to build. `ARCHITECTURE.md`: how. `BUILD_PLAN.md`: milestones M0 to M6.
- `docs/adr/`: decisions that deviate from or fill gaps in those docs. **An ADR wins over the older docs.**
  Read all of them (0001 to 0010) before changing the stack, auth, base path, membership or money details.
- The portfolio repo (`../../Portfolio`) is the master copy of the handoff docs. Never modify it from here.

## Status

See the checkboxes in `docs/lib-001-split/BUILD_PLAN.md`; keep them current. Do not start a milestone
until the previous one meets its "Done when" and is committed. End each milestone with a short summary
for the owner: what works, how to run it, what is next, decisions needed.

## Layout

```
apps/server     Fastify 5 API; also serves the built web app (src/spa.ts). Bundled by esbuild (build.mjs).
apps/web        React 19 + Vite + TanStack Router/Query + Tailwind 4.
e2e             Playwright against the built Docker image (not part of `pnpm test`); run `scripts/e2e.sh`.
packages/core   Pure money/split/balance logic. No I/O, no runtime dependencies. 100% coverage enforced by `pnpm test`.
packages/contracts  zod schemas + types shared by server and web.
```

Server layout (`apps/server/src`): `db/` (Drizzle schema, migrations runner, client), `auth/` (Better Auth
config, HTTP bridge, limiter), `http/` (errors, Origin guard), `modules/<feature>/{routes,service}.ts` (me, groups, members, invites,
activity, balances, expenses, settlements, export, ledger, common), `cli/`, `mail/`. Services throw `ProblemError` (`http/problem.ts`); every group service
starts with `requireMember` (`modules/common/access.ts`) and writes inside one transaction that also calls
`recordActivity`. A new group route must be added to the list in `test/integration/access.test.ts`.
Money maths lives only in `@evenly/core`; the server calls `computeSplit`/`validatePayers`/`computeNets`/`simplify`/
`pairwise`. Timestamps the app writes use `sql`now()`` (the database clock), not `new Date()` (ADR-0009).
Migrations are SQL in `apps/server/drizzle/` (`pnpm --filter @evenly/server db:generate`; hand-written ones with
`--custom`). `src/db/auth-schema.ts` is generated; do not edit it.

Web layout (`apps/web/src`): `lib/` (api client, queries, auth calls, format, base path), `components/` (`ui.tsx`
primitives, `AppShell.tsx`), `features/<area>/` (auth, groups, expenses, settle, invite, account), `router.tsx`.
Form logic is pure functions in `features/expenses/formState.ts` on top of `@evenly/core`. Modals are native `<dialog>`
(`Dialog`, `ConfirmDialog`); no component library, no react-hook-form, no optimistic updates (ADR-0010). A new screen
goes on the axe and 375px lists in `e2e/tests/scenarios.spec.ts`. A bare `href="#x"` leaves the page because of
`<base href>`; handle in-page links in JS.

Workspace packages export TypeScript source directly (no per-package build). The server bundles them.

## Commands

```bash
pnpm install
pnpm check            # lint + format:check + typecheck + test (what CI runs)
pnpm dev              # server :3000 and web :5173 (needs Postgres, see README)
pnpm --filter @evenly/server test:unit          # no database needed
pnpm --filter @evenly/server test:integration   # needs Postgres (see README); one database per test file
pnpm build
./scripts/smoke.sh    # builds the Docker image, checks it at / and /evenly (needs Docker running)
./scripts/e2e.sh      # builds the image, runs the Playwright scenarios at / and /evenly (needs Docker; first run:
                      # pnpm --filter @evenly/e2e exec playwright install chromium). APP_PORT=3300 if 3000 is taken.
```

## Rules that must not be broken

- **Money** is integer minor units only; no floats in money paths. One rounding rule: `allocate()` in
  ARCHITECTURE.md section 5.2 (largest remainder, ties by canonical member order = `joined_at`, then `id`).
  Pairwise method: section 5.5. Required property tests: section 5.6. Static currency exponent table (ADR-0004).
- **Clean-room:** never copy code, assets, text or branding from Splitwise or any other product.
- **BASE_PATH:** the app must work at `/` and at `/evenly`. The base path is derived from `PUBLIC_URL`
  (ADR-0002); the server injects `<base href>` + a meta tag into `index.html` (ADR-0005). Never hard-code `/`
  in routes, links or API calls; use `lib/basePath.ts` in the web app.
- Non-members get **404** (not 403) for every group route.
- Every write goes through a service in one transaction that also inserts its activity row.
- No `any` without a comment saying why. No telemetry, no phone-home.
- Library choices were checked on 2026-10-11 (ADR-0001). Check current docs before adopting anything new.
- `packages/core` API (ADR-0006): `computeSplit` (all four methods), `validatePayers`, `computeNets`, `simplify`,
  `pairwise`, `allocate`, money parse/format. Rejections are `CoreError` with a stable `code`. Use these from the
  server and the web form; never re-implement money maths elsewhere. Property tests run 10k cases each
  (`FAST_CHECK_RUNS=500 pnpm --filter @evenly/core test` for a quick loop).

## Environment gotchas

- The owner's machine runs Node 22.18 locally; CI and Docker use Node 24 (`.nvmrc`). pnpm 12 is installed with
  `npm install -g pnpm@12.11.2` because Corepack 0.33 cannot run it.
- Files use LF (`.gitattributes`). The Windows shell here is Git Bash; there is no `python`.
- Docker Desktop must be running for `scripts/smoke.sh`.
- Gate every commit and push on `pnpm check` passing; a flaky run is a bug to find, not to retry.
- `SESSION_SECRET` is optional until M2. Decide in M2 whether it is required or auto-generated and stored,
  keeping `docker compose up` working with zero configuration.
