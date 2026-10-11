# Evenly (LIB-001): notes for Claude sessions

Free, open-source, self-hostable expense-splitting app (clean-room alternative to Splitwise-style
apps). AGPL-3.0-only. Repo: <https://github.com/Vaarun-Kamath/evenly>. Part of the "Liberated
Software" initiative; this repo lives at `liberated-split/evenly` next to other projects.

## Where things are

- `docs/PLATFORM.md`: conventions shared by all Liberated Software projects.
- `docs/lib-001-split/SPEC.md`: what to build. `ARCHITECTURE.md`: how. `BUILD_PLAN.md`: milestones M0 to M6.
- `docs/adr/`: decisions that deviate from or fill gaps in those docs. **An ADR wins over the older docs.**
  Read all of them (0001 to 0006) before changing the stack, auth, base path, membership or money details.
- The portfolio repo (`../../Portfolio`) is the master copy of the handoff docs. Never modify it from here.

## Status

See the checkboxes in `docs/lib-001-split/BUILD_PLAN.md`; keep them current. Do not start a milestone
until the previous one meets its "Done when" and is committed. End each milestone with a short summary
for the owner: what works, how to run it, what is next, decisions needed.

## Layout

```
apps/server     Fastify 5 API; also serves the built web app (src/spa.ts). Bundled by esbuild (build.mjs).
apps/web        React 19 + Vite + TanStack Router/Query + Tailwind 4.
packages/core   Pure money/split/balance logic. No I/O, no runtime dependencies. 100% coverage enforced by `pnpm test`.
packages/contracts  zod schemas + types shared by server and web.
```

Workspace packages export TypeScript source directly (no per-package build). The server bundles them.

## Commands

```bash
pnpm install
pnpm check            # lint + format:check + typecheck + test (what CI runs)
pnpm dev              # server :3000 and web :5173 (needs Postgres, see README)
pnpm build
./scripts/smoke.sh    # builds the Docker image, checks it at / and /evenly (needs Docker running)
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
- Do not push to GitHub without the owner's go-ahead.
- `SESSION_SECRET` is optional until M2. Decide in M2 whether it is required or auto-generated and stored,
  keeping `docker compose up` working with zero configuration.
