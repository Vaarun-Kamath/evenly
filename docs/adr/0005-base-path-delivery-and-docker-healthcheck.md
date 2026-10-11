# ADR-0005: Base path delivered in a meta tag; Docker healthcheck follows the base path

Status: Accepted (2026-10-11). Amends ADR-0002 decision 1.

## Context

ADR-0002 (following PLATFORM.md §9) had the server inject `<script>window.__BASE_PATH__="/evenly"</script>`
into `index.html`. Helmet's default Content-Security-Policy (`script-src 'self'`) blocks inline scripts, so
that would need `'unsafe-inline'` or a per-request nonce. Separately, the `HEALTHCHECK` in ARCHITECTURE.md §9
requests `http://localhost:3000/healthz`, which is a 404 when the app is mounted under `/evenly`.

## Decisions

1. The server injects `<base href="{BASE_PATH}/">` and `<meta name="evenly-base-path" content="{BASE_PATH}">`
   as the first elements of `<head>`. The SPA reads the meta tag (`apps/web/src/lib/basePath.ts`); there is no
   inline script, so the CSP stays strict (`script-src 'self'`).
2. The CSP keeps Helmet's defaults except that `upgrade-insecure-requests` is removed, because self-hosters may
   serve plain http (localhost, LAN).
3. The image's `HEALTHCHECK` runs `node dist/healthcheck.js`, which derives the base path from `PUBLIC_URL` (the
   same code as the server) and requests `/healthz` there.
4. `scripts/smoke.sh` builds the image and checks it at `/` and at `/evenly`, including a deep-link reload and
   the container's own health status. CI runs it.

## Consequences

- PLATFORM.md §9's example script tag is superseded; use the meta tag.
