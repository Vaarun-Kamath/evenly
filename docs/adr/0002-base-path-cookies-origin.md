# ADR-0002: Base path, cookies, Origin check and proxy trust

Status: Accepted (approved by the owner, 2026-10-11)

## Context

PLATFORM.md §9 and ARCHITECTURE.md §7 contradict each other on the cookie path, and four details
of running behind the portfolio's `/evenly` rewrite were not covered.

## Decisions

1. **Relative assets need a `<base>` tag.** Vite builds with `base: './'`. A relative `./assets/x.js`
   would resolve under `/g/abc/` on a nested client route, so the server injects, into `index.html` at
   request time, both `<base href="{BASE_PATH}/">` (first element in `<head>`) and
   `<script>window.__BASE_PATH__="{BASE_PATH}"</script>`. TanStack Router's `basepath` and the API
   client read `window.__BASE_PATH__`. In-page anchors must not use bare `href="#..."`.
2. **One source of truth for the path.** `PUBLIC_URL` includes the path (`https://example.com/evenly`).
   `BASE_PATH` is derived from `PUBLIC_URL`'s pathname (normalised: no trailing slash, `""` for the root).
   The `BASE_PATH` variable is optional; if set it must equal the derived value, or startup fails with a clear message.
3. **Cookie `Path` is `BASE_PATH`** (or `/` at the root), following PLATFORM §9, so the app's cookies
   are not sent to the portfolio's other routes. Set through Better Auth `advanced.defaultCookieAttributes`;
   an integration test in M2 asserts the `Set-Cookie` header.
4. **`Secure` follows the `PUBLIC_URL` scheme.** `https` gives `Secure`; `http` (local or LAN
   self-hosting) does not. Otherwise login silently fails on a plain-HTTP LAN address.
5. **The Origin check compares against `PUBLIC_URL`'s origin**, not the `Host` header, because the
   portfolio's rewrite changes `Host`. An optional `TRUSTED_ORIGINS` (comma-separated) adds more.
   Better Auth's `trustedOrigins` is fed from the same values; our own hook covers `/api/v1`.
6. **`TRUST_PROXY` accepts** `false` (default) | `true` | an integer hop count | a comma-separated CIDR list,
   passed to Fastify's `trustProxy`. The hosted instance uses a hop count. Blind `true` lets clients spoof
   `X-Forwarded-For` and evade per-IP limits, so per-account limits stay on as a backstop.
7. **Rate-limit ownership.** Better Auth's limiter owns `/api/auth/*`; `@fastify/rate-limit` owns
   everything else (`/api/v1/invites/:token`, etc.). No endpoint is configured twice. Better Auth storage is
   `memory` for a single replica and `database` when more than one replica is run.

## Consequences

- CI end-to-end tests at `/` and `/evenly` must include a deep-link reload (e.g. `/evenly/g/<id>/settle`).
- `.env.example` documents `PUBLIC_URL`, `BASE_PATH` (optional), `TRUSTED_ORIGINS`, `TRUST_PROXY`.
