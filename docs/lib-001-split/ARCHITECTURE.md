# LIB-001: Architecture

Read PLATFORM.md first; this document only adds what is specific to LIB-001.
**Deviations are recorded in `docs/adr/` (ADR-0001 to 0004); where an ADR and this document disagree, the ADR wins.**
Library choices below are recommendations. If one turns out to be a poor fit when you check its
current docs (for example, it isn't maintained or doesn't integrate cleanly), choose an equivalent and
record the change in `docs/adr/`.

---

## 1. Overview

```
          browser (React SPA)  at https://<domain>/evenly
                 │
                 ▼
   portfolio (Next.js) rewrites /evenly/* ──► Evenly container
   (self-hosters skip this layer and hit the container directly at /)
                 │  same origin: cookies are first-party, no CORS
                 ▼
 ┌──────────── one Docker image ────────────┐
 │ Fastify server                           │
 │  /api/auth/*   auth library handler      │
 │  /api/v1/*     JSON API (zod-validated)  │
 │  /healthz /readyz                        │
 │  /*            static SPA + index.html   │
 │        │                                 │
 │  packages/core (pure money/split/balance logic)
 └────────┼─────────────────────────────────┘
          ▼
   Postgres: database `lib001` (shared server, own role)
```

## 2. Stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS, TypeScript 5.9 (strict; pinned below 6.1, see ADR-0001) |
| HTTP | Fastify 5, with `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/cookie` |
| Validation and types | zod 4 schemas in `packages/contracts`, wired into Fastify with `@fastify/type-provider-zod`; OpenAPI document (`@fastify/swagger` + `@fastify/swagger-ui`) served at `/api/docs` (ADR-0001) |
| Auth | Better Auth (email and password, Postgres-backed sessions, Drizzle adapter, uuid ids), mounted at `/api/auth/*` under `BASE_PATH`. Fallback: hand-rolled sessions following the Lucia/Oslo guide, with `@node-rs/argon2` |
| Database | Postgres 18, Drizzle ORM 0.45.x (stable), SQL migrations from drizzle-kit, `postgres` (postgres.js) driver |
| Logging | pino (JSON); request id in every log line |
| Web | Vite, React 19, TanStack Router, TanStack Query, react-hook-form with zod, Tailwind CSS, shadcn/ui |
| Tests | Vitest, fast-check (property tests), real Postgres for integration tests (CI service container or Testcontainers), Playwright for end-to-end |

## 3. Code layout

```
apps/server/src/
  env.ts               # zod-validated environment variables
  app.ts               # builds the Fastify instance (exported for tests)
  server.ts            # entrypoint: migrate (under advisory lock) → listen → graceful shutdown
  migrate.ts  cli.ts   # `node dist/cli.js reset-password <email>`, `create-admin`, etc.
  db/schema.ts  db/client.ts
  auth/                # auth library config + `requireUser` preHandler
  http/errors.ts       # RFC 9457 problem+json error handler
  modules/
    groups/ members/ invites/ expenses/ settlements/ balances/ activity/ export/
      routes.ts        # HTTP layer only: parse → call service → shape response
      service.ts       # authorization + business rules + transactions
      repo.ts          # SQL (Drizzle)
  spa.ts               # serves apps/web/dist with an index.html fallback
apps/web/src/
  routes/  components/  lib/api.ts (typed client built from contracts)  lib/money.ts
packages/core/src/
  money.ts  allocate.ts  splits.ts  balances.ts  simplify.ts  pairwise.ts
packages/contracts/src/
  groups.ts expenses.ts settlements.ts balances.ts invites.ts errors.ts
```

Rules:
- `packages/core` has **no I/O and no dependencies**, and has 100% branch coverage. The server and
  the web app both use it: the web app for the live split preview, the server as the source of truth.
- Every write goes through `service.ts` inside a single transaction that also inserts its activity row.
- Authorization: `requireMember(groupId, userId, minRole)` runs first in every group service method.
  A user who isn't a member gets **404**, so that group IDs can't be probed.

## 4. Data model

Identifiers are UUIDv7, generated in the application so that IDs sort by time. The auth library owns
its own tables (`user`, `session`, `account`, `verification`); this app references `user.id`, which is a `uuid` (ADR-0001).

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE split_method AS ENUM ('equal', 'exact', 'percent', 'shares');
CREATE TYPE expense_category AS ENUM
  ('food','groceries','transport','rent','utilities','entertainment','travel','shopping','other');

CREATE TABLE groups (
  id              uuid PRIMARY KEY,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  currency        char(3) NOT NULL,                 -- ISO 4217
  emoji           text,
  simplify_debts  boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES "user"(id) ON DELETE SET NULL,  -- ADR-0003
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  deleted_at      timestamptz
);

CREATE TABLE group_members (
  id            uuid PRIMARY KEY,
  group_id      uuid NOT NULL REFERENCES groups(id),
  user_id       uuid REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = placeholder member (or a deleted user, who also has left_at set; ADR-0003)
  display_name  text NOT NULL,
  email         citext,                              -- optional, for placeholders
  role          member_role NOT NULL DEFAULT 'member',
  joined_at     timestamptz NOT NULL DEFAULT now(),  -- defines the canonical member order
  left_at       timestamptz
);
-- A user has at most one membership row per group; rejoining reactivates it.
CREATE UNIQUE INDEX group_members_user_uq ON group_members (group_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX group_members_user_idx ON group_members (user_id);

CREATE TABLE group_invites (
  id               uuid PRIMARY KEY,
  group_id         uuid NOT NULL REFERENCES groups(id),
  token_hash       bytea NOT NULL UNIQUE,            -- sha256 of a 32-byte random token
  created_by       uuid NOT NULL REFERENCES group_members(id),
  email            citext,                           -- set for email invites
  claim_member_id  uuid REFERENCES group_members(id),-- set to claim a placeholder
  expires_at       timestamptz,
  max_uses         int CHECK (max_uses > 0),
  use_count        int NOT NULL DEFAULT 0,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id            uuid PRIMARY KEY,                    -- client-generated (idempotent create)
  group_id      uuid NOT NULL REFERENCES groups(id),
  description   text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  amount_minor  bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),  -- cap: ADR-0004
  currency      char(3) NOT NULL,
  category      expense_category NOT NULL DEFAULT 'other',
  expense_date  date NOT NULL,
  notes         text,
  split_method  split_method NOT NULL,
  created_by    uuid NOT NULL REFERENCES group_members(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  version       int NOT NULL DEFAULT 1               -- optimistic locking
);
CREATE INDEX expenses_group_date_idx ON expenses (group_id, expense_date DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE expense_payers (
  expense_id    uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES group_members(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE expense_shares (
  expense_id    uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES group_members(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  input_value   numeric(20,2),   -- the user's input: percent, share weight or exact amount; NULL for equal
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE settlements (
  id              uuid PRIMARY KEY,
  group_id        uuid NOT NULL REFERENCES groups(id),
  from_member_id  uuid NOT NULL REFERENCES group_members(id),   -- the one who paid
  to_member_id    uuid NOT NULL REFERENCES group_members(id),   -- the one who received
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL,
  settled_on      date NOT NULL,
  note            text,
  created_by      uuid NOT NULL REFERENCES group_members(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  version         int NOT NULL DEFAULT 1,
  CHECK (from_member_id <> to_member_id)
);

CREATE TABLE activity (
  id           uuid PRIMARY KEY,
  group_id     uuid NOT NULL REFERENCES groups(id),
  actor_id     uuid REFERENCES group_members(id),
  kind         text NOT NULL,          -- 'expense.created' | 'expense.updated' | 'settlement.deleted' | 'member.joined' | ...
  entity_id    uuid,
  diff         jsonb,                  -- { field: [old, new] } for updates; a snapshot for deletes
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_group_idx ON activity (group_id, created_at DESC);
```

Database-level safety net: a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `expense_payers`
and `expense_shares` checks at commit time that `SUM(payers) = SUM(shares) = expenses.amount_minor`.
The service layer validates first; the trigger catches bugs.

## 5. Money and algorithms (`packages/core`)

### 5.1 Representation
- Amounts are **integers in minor units** (paise, cents). No floating-point values anywhere in money paths.
- In TypeScript use `number` with an `assertSafeInteger` guard, and convert Postgres `bigint` strings
  at the repository boundary. Use `BigInt` for intermediate products in allocation (`total × weight`) to avoid overflow.
- Currency exponents come from `Intl.NumberFormat(…).resolvedOptions().maximumFractionDigits`
  (JPY = 0, INR = 2, KWD = 3). Parsing user input converts decimal strings to minor units exactly (no `parseFloat`).

### 5.2 Allocation: the one rounding rule
`allocate(total, weights[], order[])` → integer parts that **sum exactly to `total`**:
1. `W = Σ weights`; `base_i = floor(total × w_i / W)`; `rem_i = (total × w_i) mod W`.
2. `left = total − Σ base_i` (always less than the number of members).
3. Give +1 to the `left` members with the largest `rem_i`; **ties are broken by canonical member
   order**, i.e. `group_members.joined_at` and then `id`.

How each split method uses it:
- **Equal:** every weight is 1. Example: ₹1,000 among A, B, C (in joining order) → 33334 / 33333 / 33333 paise.
- **Percent:** weights are basis points and must sum to exactly 10,000.
- **Shares:** weights are `round(share × 100)`, all greater than 0.
- **Exact:** no allocation; validate that the amounts sum to the total.

### 5.3 Net balances
For each member in the group:
`net = Σ paid − Σ owed share + Σ settlements sent − Σ settlements received`
(deleted rows excluded). Positive means the member is owed money. **Invariant: Σ net = 0.**
Compute this with one SQL query per request (aggregate CTEs). Add a cached balances table only if profiling shows a need.

### 5.4 Simplified plan ("simplify debts")
Input: the non-zero nets. Output: a list of `{from, to, amount}`.
1. Remove zeros. First pair off any debtor and creditor with exactly opposite amounts (fewer transfers in common cases).
2. Greedy: repeatedly match the largest remaining debtor with the largest remaining creditor and
   transfer `min(|debt|, credit)`. Break ties by canonical member order so the result is deterministic.
3. This produces at most `n − 1` transfers and settles every net to exactly 0. (Finding the true minimum
   number of transfers is NP-hard; greedy is the standard practical answer. Say so in the code comments.)

### 5.5 Pairwise debts (when "simplify debts" is off)
Build each expense's debts from **that expense's own nets**, so that rounding can never make the
pairwise view disagree with §5.3:
1. For each expense, compute `e_m = paid_m − share_m` for every member involved (these sum to 0).
2. Settle that expense on its own with the same deterministic greedy matching as §5.4 (no
   exact-pair pass needed). Add each resulting transfer `from → to` to `owes[from][to]`.
3. For each settlement `from → to` (the payer of the settlement is `from`), subtract its amount from `owes[from][to]`.
4. Report each pair once as `d = owes[i][j] − owes[j][i]`: if `d > 0`, i owes j `d`; if `d < 0`, j owes i `−d`.

With a single payer this is simply "each sharer owes the payer their share". With several payers the
matching is deterministic and exact, which matters more than strict proportionality.
(Do **not** split each person's share across payers with `allocate()`: rounding each row separately
can leave a payer's column off by a paisa, and the pairwise view would then disagree with the net balances.)

### 5.6 Property tests (fast-check), required
- Allocation: the parts sum to the total; every part ≥ 0; parts differ from the exact proportional value by less than 1; output is deterministic.
- Splits: every method sums to the expense amount; invalid inputs (percentages not totalling 100, a share of 0, exact amounts that don't add up) are rejected.
- Balances: Σ net = 0 for any random sequence of expenses and settlements.
- Simplify: applying the transfers sets every net to 0; transfer count ≤ n − 1; same input gives the same output.
- Pairwise: the per-member sum of pairwise debts equals that member's net.

## 6. API (`/api/v1`, JSON)

Errors use RFC 9457 `application/problem+json`: `{ type, title, status, detail, errors? }`.
Lists use cursor pagination: `?limit=50&cursor=<opaque>` → `{ items, nextCursor }`.
Money in the API is always `{ amountMinor: number, currency: "INR" }`; the UI handles formatting.

| Method and path | Purpose | Min. role |
| --- | --- | --- |
| `GET /me` | Current user, default currency | user |
| `PATCH /me` | Update profile | user |
| `GET /me/overview` | Totals across all groups and per-person cross-group nets | user |
| `GET /groups` / `POST /groups` | List my groups (with my net) / create | user |
| `GET /groups/:gid` / `PATCH` / `DELETE` | Read / update settings / delete (all balances must be zero) | member / admin / owner |
| `POST /groups/:gid/archive` / `unarchive` | | admin |
| `GET /groups/:gid/members` | Members with role and net | member |
| `POST /groups/:gid/members` | Add a placeholder member `{ displayName, email? }` | member |
| `PATCH /groups/:gid/members/:mid` | Change role / rename placeholder | owner (roles) / admin |
| `DELETE /groups/:gid/members/:mid` | Remove (zero balance only) | admin, or self to leave |
| `GET /groups/:gid/invites` / `POST` / `DELETE /:iid` | List / create `{ expiresIn, maxUses?, email?, claimMemberId? }` → `{ url }` / revoke | member (create), admin (revoke) |
| `GET /invites/:token` | Preview: group name, inviter, member count, claim target | public (rate-limited) |
| `POST /invites/:token/accept` | Join the group, or claim a placeholder | user |
| `GET /groups/:gid/expenses` | Filters: `from`, `to`, `category`, `memberId`, `q` | member |
| `POST /groups/:gid/expenses` | Create (`id` supplied by the client; repeating the same `id` + body returns the existing row) | member |
| `GET/PATCH/DELETE /groups/:gid/expenses/:eid` | PATCH needs `version`; a stale version gets 409 with the current row | member |
| `POST /groups/:gid/expenses/:eid/restore` | | admin |
| `GET/POST /groups/:gid/settlements`, `PATCH/DELETE /:sid` | Same rules as expenses | member |
| `GET /groups/:gid/balances` | `{ nets[], simplified[], pairwise[] }` | member |
| `GET /groups/:gid/activity` | Paginated feed | member |
| `GET /groups/:gid/export.csv` | Streamed CSV | member |

Expense request body (shape shared via `packages/contracts`):

```jsonc
{
  "id": "0192f0c4-…",               // UUIDv7 from the client
  "description": "Dinner",
  "amountMinor": 100000,
  "currency": "INR",                 // must equal the group currency in v1
  "category": "food",
  "expenseDate": "2026-10-10",
  "notes": null,
  "payers": [{ "memberId": "…", "amountMinor": 100000 }],
  "split": {
    "method": "shares",              // equal | exact | percent | shares
    "entries": [{ "memberId": "…", "value": "2" }, { "memberId": "…", "value": "1" }]
    // equal: entries list the members, no values; exact: value = minor units; percent: value = "33.33"
  }
}
```
The server recomputes the shares with `packages/core` and stores both the input and the computed `amount_minor`.

## 7. Auth and sessions

- Email and password via the auth library; sessions in Postgres; cookie `HttpOnly; SameSite=Lax; Path=BASE_PATH`, with `Secure` when `PUBLIC_URL` is https (ADR-0002).
- `ALLOW_SIGNUPS=true|false|invite-only` (`invite-only`: you can only sign up through a valid invite link). This is useful for private self-hosted instances.
- Rate limits (per IP and per account): login 10/min, signup 5/min, invite preview 30/min, password reset 3/hour.
- CSRF protection: SameSite=Lax cookies plus an `Origin` check on all non-GET requests.
- Invite tokens: 32 random bytes, base64url in the URL; only `sha256(token)` is stored. Accepting an invite
  checks it isn't revoked or expired, increments `use_count` atomically (guarded by `max_uses`), and if
  the invite is bound to an email, that email must match the account.

## 8. Web app

Routes: `/login`, `/signup`, `/reset`, `/` (dashboard), `/groups/new`, `/g/:gid` (expenses and balances),
`/g/:gid/expenses/new`, `/g/:gid/expenses/:eid`, `/g/:gid/settle`, `/g/:gid/settings` (members, invites),
`/invite/:token`, `/account`.

- TanStack Query for server state; optimistic updates for creating expenses and settlements.
- The expense form uses `packages/core` for the live split preview and the same zod schema as the server.
- An unsaved expense draft is kept in `sessionStorage` so it survives a reload.
- Every route and API call is relative to the runtime base path (`window.__BASE_PATH__`, see PLATFORM.md §9).
  The UI must work both at `/` (self-hosted) and at `/evenly` (behind the portfolio).
- Visual style: follow the portfolio's monochrome tokens (PLATFORM.md §9).

## 9. Docker

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.11.2   # not corepack: see ADR-0001

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm -r build && pnpm --filter server deploy --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

`docker-compose.yml` (local development and self-hosting): a `db` service (`postgres:18`, a volume,
a `pg_isready` healthcheck) and an `app` service (build `.` or image `ghcr.io/<owner>/<repo>`, `depends_on: db: condition: service_healthy`).

## 10. Environment variables (in addition to PLATFORM.md §3)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_PATH` | derived | Optional. Derived from the path of `PUBLIC_URL`; if set it must match (ADR-0002). The hosted instance uses `/evenly`, behind the portfolio's rewrites (PLATFORM.md §9) |
| `TRUSTED_ORIGINS` | none | Extra allowed `Origin` values, comma-separated (ADR-0002) |
| `MIGRATION_DATABASE_URL` | `DATABASE_URL` | Optional direct connection for migrations when PgBouncer is in front (ADR-0004) |
| `ALLOW_SIGNUPS` | `true` | `true` / `false` / `invite-only` |
| `INVITE_DEFAULT_TTL_DAYS` | `7` | |
| `SMTP_FROM` | none | Sender address for invite and reset emails |
