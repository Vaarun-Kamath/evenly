# ADR-0001: Stack adjustments to ARCHITECTURE.md §2

Status: Accepted (approved by the owner, 2026-10-11)

## Context

The library versions in ARCHITECTURE.md were checked against the npm registry and vendor docs on
2026-10-11. Most choices hold; the points below do not, or are missing.

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| Fastify type provider | `@fastify/type-provider-zod` (official, 1.x) with zod 4.2+. Add `@fastify/swagger` and `@fastify/swagger-ui` for `/api/docs`. | Maintained under the Fastify org; supports OpenAPI generation. The swagger packages were missing from the stack table. |
| TypeScript | Pin to the 5.9 line (`~5.9`). Do not adopt TypeScript 7. | typescript-eslint supports `typescript <6.1.0` only (checked 2026-10-11). Revisit when it supports 7. |
| Drizzle | `drizzle-orm` and `drizzle-kit` 0.45.x / 0.31.x (stable). Do not use the `1.0.0-beta` tags. | 1.0 is still beta. Revisit after a stable 1.0 release. |
| Auth ids | Better Auth with `advanced.database.generateId: "uuid"`. `user.id` is therefore `uuid`, and the app's foreign keys to it are `uuid` too. | One id type everywhere instead of `text` plus `uuid`. |
| Extra dependencies | `nodemailer` (SMTP, optional features), `uuid` (UUIDv7; also used in the browser for client-generated expense ids). | `crypto.randomUUID()` only produces v4. |
| pnpm | pnpm 12.x, pinned through the `packageManager` field. Install with `npm install -g pnpm@<version>` (in the Dockerfile as well), not `corepack enable`. | Corepack 0.33 (bundled with Node 22.18) fails to run pnpm 12 (`Cannot find module .../pnpm.cjs`), and Node is moving away from bundling Corepack. `pnpm deploy` works without `injectWorkspacePackages` since pnpm 12.2. |
| Node | Node 24 LTS for CI and the Docker image. `.nvmrc` = 24. Node 26 becomes LTS in late October 2026; move later, deliberately. | The owner's machine currently has Node 22.18, which is used for local development until Node 24 is installed; CI and Docker are the source of truth. |
| Postgres | Stay on 18 (PG 19 GA is scheduled for 2026-10-29). | Same version locally and in production (PLATFORM §4). |

## Consequences

- ARCHITECTURE.md §2, §4 and §9 were edited to match. Where an ADR and ARCHITECTURE.md disagree, the ADR wins.
