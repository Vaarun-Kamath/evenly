# Liberated Software: platform conventions

These rules apply to every Liberated Software project (LIB-001, LIB-002, ...). Each project is its
own public repository, ships as its own Docker image, and stores data in its own database on a
shared Postgres server. The portfolio site (`Vaarun-Kamath/Portfolio`) is the public front door for
all of them: same domain, shared look, every app mounted under its own path (§9).

**Where things live**

```
Documents/Github/
  Portfolio/          ← portfolio site (Next.js). Front door + project pages. Never contains project code.
    handoff/          ← source of these docs; copied into each project repo
  liberated-split/    ← workspace folder for all Liberated Software projects (not itself a git repo)
    evenly/           ← LIB-001 repo (AGPL-3.0), its own git repo and GitHub repo (Vaarun-Kamath/evenly)
    <next>/           ← LIB-002, ... each its own repo
    infra/            ← (later) hosting config: Postgres, reverse proxy, backups
```

---

## 1. Principles

1. **Clean-room.** Build from the target product's *public behavior* only: using the app, public docs,
   marketing pages and reviews. Never copy its source code, decompiled code, private APIs, UI assets,
   icons, copy text, name or branding. Pick a distinct product name and visual identity.
   Describing the product as "an open-source alternative to X" is fine; implying you are X or
   affiliated with X is not.
2. **Self-hostable first.** A stranger must be able to run the project with `docker compose up`
   and nothing else. No mandatory third-party services. Email, OAuth, object storage and similar
   are optional and switched on by environment variables.
3. **No telemetry.** No analytics, no phone-home, no license checks.
4. **Boring, durable tech.** Prefer well-maintained libraries with large communities.

## 2. Repository layout (per project)

Each project is a separate git repository in its own folder under `liberated-split/` (see above),
laid out as a pnpm-workspaces monorepo:

```
<project>/
  apps/
    server/            # API (Fastify); in production also serves the built web UI
    web/               # React SPA (Vite)
  packages/
    core/              # Pure domain logic, no I/O. Heavily unit/property tested.
    contracts/         # zod schemas + TypeScript types shared by server and web
  docs/                # PLATFORM.md, SPEC.md, ARCHITECTURE.md, BUILD_PLAN.md, ADRs
  Dockerfile           # one image: server + built web assets
  docker-compose.yml   # postgres + app, for local dev and self-hosting
  .env.example
  .github/workflows/   # ci.yml, release.yml
  LICENSE              # AGPL-3.0-only for server apps (see §8)
  README.md  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
  CLAUDE.md            # notes for future Claude sessions working on the repo
```

Toolchain: Node.js LTS (24 at time of writing), pnpm, TypeScript strict mode, ESLint and Prettier,
Vitest (with fast-check for property tests), and Playwright for end-to-end tests.

## 3. Docker

- **One image per project**, multi-stage build: `deps → build → runtime`.
- The runtime stage is `node:<lts>-slim` (or distroless), runs as a non-root user, and contains no dev dependencies.
- The server serves:
  - `/api/*`: JSON API
  - `/healthz` (process is up) and `/readyz` (database reachable, migrations applied)
  - `/*`: the built SPA, with a fallback to `index.html` for client-side routes
- Configuration comes **only** from environment variables (12-factor). Every variable is listed in
  `.env.example` and validated at startup with zod; the process exits with a clear message if any is invalid.
- **Migrations** run automatically at startup, behind a Postgres advisory lock so that several
  replicas can't race. They can also be run on their own with `node dist/migrate.js`.
- The process handles `SIGTERM` by stopping new requests, draining in-flight ones, then closing the database pool.
- Images are published to GitHub Container Registry: `ghcr.io/<owner>/<project>:<semver>` and `:latest`.

Standard environment variables (every project):

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://lib001:***@db:5432/lib001` | Must point at the project's own database |
| `PUBLIC_URL` | `https://split.example.com` | Used for links in invites and emails |
| `PORT` | `3000` | |
| `SESSION_SECRET` | 32+ random bytes | |
| `LOG_LEVEL` | `info` | pino |
| `SMTP_URL` | `smtp://user:pass@host:587` | Optional; enables email features |
| `TRUST_PROXY` | `true` | When behind Caddy, Railway, etc. |

## 4. Shared Postgres: one server, one database per project

"Common database" means **one Postgres server** (a single container or managed instance) that hosts a
**separate database and login role for each project**. It never means shared tables.

Why:
- Projects stay independently self-hostable, since each one only ever sees its own `DATABASE_URL`.
- A bad migration in one project cannot touch another project's data.
- Projects can be moved to a different server later with a plain `pg_dump`/`pg_restore`.
- You pay for one Postgres process instead of N.

Provisioning a new project (run once as the superuser):

```sql
CREATE ROLE lib001 LOGIN PASSWORD '<generated>';
CREATE DATABASE lib001 OWNER lib001;
REVOKE CONNECT ON DATABASE lib001 FROM PUBLIC;
-- inside lib001:
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

Naming: database name = role name = project code in lower case (`lib001`, `lib002`, ...).

Rules:
- Use the latest stable Postgres major version (18 at time of writing), the same version locally and in production.
- Each app opens a small connection pool (default max 10). Put PgBouncer in front of the server once
  the total of all pools gets close to `max_connections`.
- **Backups:** a nightly `pg_dump` of each database, compressed and uploaded to S3-compatible
  storage (Cloudflare R2 or Backblaze B2), kept for 14 days. Test a restore once a month.
- Self-hosters ignore all of this: each project's own `docker-compose.yml` includes its own Postgres.

## 5. Hosting: what to use and when

Everything is a Docker image plus a `DATABASE_URL`, so switching hosts is a configuration change plus
a database dump and restore. Start cheap and simple, and move when costs or limits demand it.

### Prices checked 2026-10-10 (verify before buying)

| Option | Pricing model | Fits |
| --- | --- | --- |
| **Railway Hobby** | $5/month, which includes $5 of usage. RAM about $10 per GB-month, vCPU about $20 per vCPU-month, volumes about $0.15 per GB-month, egress $0.05/GB. Billed per second. | 1–2 small projects with zero ops work |
| **Single VPS** (e.g. Hetzner CX23: 2 vCPU, 4 GB RAM, about €4–5/month; CPX22 about €8/month) | Fixed monthly price | 3+ projects; cheapest at scale, but you handle updates, backups and security |
| **Neon free tier** (database only) | 0.5 GB storage and 100 compute-hours per project per month; scales to zero when idle | A managed database you don't pay RAM for; not "in a Docker container" |

Rough Railway estimate for LIB-001: Postgres idles at around 150–250 MB of RAM (about $1.50–2.50 a
month) and a Node app at around 100–150 MB (about $1–1.50 a month), plus pennies of storage. That
should roughly fit inside the $5 included usage. These are estimates; check the Railway usage page after a week.

A JVM service would idle at roughly 3× the memory of the Node one, which is the main reason these
projects use TypeScript.

### Recommendation

1. **Now:** Railway Hobby with one Postgres service (holding one database per project) and one service per project image.
2. **At 3+ projects, or when Railway passes about $15 a month:** move to one VPS running a
   `liberated-infra` repo: `docker compose` with Postgres, Caddy (automatic HTTPS, one subdomain per
   project), each project image pulled from GHCR, a backup job, and Watchtower or a deploy webhook for updates.

## 6. Security baseline

- Passwords hashed with argon2id or scrypt via a maintained auth library. Never write your own crypto.
- Sessions are opaque tokens in `HttpOnly; Secure; SameSite=Lax` cookies; only a hash of the token is stored in the database.
- Mutating requests check the `Origin` header. The SPA and API share an origin, so there are no CORS or third-party-cookie problems.
- Validate every request body, query and parameter with zod. Never build SQL by concatenating strings.
- Rate-limit authentication, invite and password-reset endpoints.
- Every query is scoped by the caller's membership (authorization checks happen in the service layer, not only in the UI).
- Secrets come only from the environment. `.env` is gitignored, and `.env.example` contains no real values.
- Dependabot or Renovate is on, and CI fails on high-severity `pnpm audit` findings.
- `SECURITY.md` explains how to report a vulnerability privately.

## 7. CI/CD (GitHub Actions)

- `ci.yml` on every PR: install, lint, typecheck, unit and property tests, integration tests against a
  Postgres service container, build the Docker image, then run Playwright against the built image.
- `release.yml` on tags `v*`: build a multi-arch image (amd64 and arm64), push to GHCR, and create a GitHub release with notes from CHANGELOG.
- Deployment: Railway deploys automatically from the GHCR tag; on a VPS, a webhook or Watchtower pulls the new tag.

## 8. Licensing

- Server apps: **AGPL-3.0-only**. Anyone may use, modify and self-host them; anyone running a
  modified version as a public service must publish their changes. This prevents a closed fork from re-paywalling the software.
- Pure libraries extracted from a project (e.g. `packages/core`) may be MIT if wider reuse helps.
- Third-party code and assets must be license-compatible. Track notable ones in `THIRD_PARTY.md`.

## 9. The portfolio as the front door

Visitors use every app **on the portfolio's domain**, e.g. `https://<domain>/evenly`, while each app
still lives in its own repo and container.

How it works:
- The portfolio (Next.js) proxies each app's path to that app's container using **rewrites**
  (Next.js "multi-zones"): `/evenly/:path*` → `${EVENLY_UPSTREAM}/evenly/:path*`. The browser only ever
  sees the portfolio's domain, so the app's cookies are first-party and there is no CORS.
- The portfolio owns the landing page for each project (`/liberated/<slug>`: what it is, status,
  screenshots, "Open app", GitHub link, self-hosting instructions), driven by `content/liberated/<code>.json`.
- The apps share the portfolio's visual language (monochrome palette, Inter + JetBrains Mono, soft
  easing). Until there is a shared package, copy the tokens from the portfolio's `tailwind.config.js`.

What every project must support for this:
- **Runs under a sub-path chosen at runtime:** `BASE_PATH` (default `/`; hosted: `/evenly`).
  - The server registers every route (`/api`, `/healthz`, static files) under `BASE_PATH`.
  - The SPA is built with relative asset URLs. The server injects the base path into `index.html` at
    request time (e.g. `<script>window.__BASE_PATH__="/evenly"</script>`), and the router and API client read it.
  - Cookies use `Path=BASE_PATH`. Auth callback URLs are built from `PUBLIC_URL`, which includes the path
    (`https://<domain>/evenly`).
  - CI runs the end-to-end tests twice: at `/` and at `/evenly` behind a small proxy.
- **Self-hosters are unaffected:** `docker compose up` serves the app at `/` on its own.

Releasing: when a project gets a public repo or a release, update `content/liberated/<code>.json` in the
portfolio repo (`status`, `repo`, `eta`, `stack`, and the app's mount path and upstream URL).

Later, optional: one account across all apps (a shared OIDC identity service). It is out of scope for
now, because every app must stay self-hostable on its own.
