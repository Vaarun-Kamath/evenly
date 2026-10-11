# Evenly

A free, open-source, self-hostable app for splitting shared expenses with friends and groups. No
paywalls, no limits on groups, expenses or members, and no tracking.

> **Status: early development.** Right now this is the project skeleton: it serves a "hello" page
> and a health check. The expense features arrive milestone by milestone, see
> [the build plan](docs/lib-001-split/BUILD_PLAN.md).

Evenly is an open-source alternative to apps like Splitwise. It is a clean-room implementation built
from publicly observable behaviour; it is not affiliated with any commercial product.

## Try it

You need Docker.

```bash
docker compose up
```

Then open <http://localhost:3000>. The bundled Postgres is only reachable from the app container.

Settings go in a `.env` file next to `docker-compose.yml`; see [`.env.example`](.env.example). If you
serve the app from another address or under a sub-path (for example `https://example.com/evenly`),
set `PUBLIC_URL` to match.

## Develop

You need Node.js 24 (see `.nvmrc`), pnpm 12 (`npm install -g pnpm@12.11.2`) and Docker.

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres on localhost:5432
cp .env.example .env
pnpm dev          # API on :3000, web app on :5173 (proxies /api)
pnpm check        # lint, format check, typecheck, tests
./scripts/smoke.sh  # builds the Docker image and checks it at / and /evenly
```

Layout: `apps/server` (Fastify API), `apps/web` (React SPA), `packages/core` (pure money and split
logic), `packages/contracts` (zod schemas shared by both). Design documents are in [`docs/`](docs/).

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified version as a public service, you must publish your
changes.
