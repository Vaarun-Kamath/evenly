#!/usr/bin/env bash
# Builds the Docker image and checks it end to end at the site root and under /evenly
# (PLATFORM.md section 9). Needs Docker and curl. Used locally and by CI.
set -euo pipefail

cd "$(dirname "$0")/.."
export APP_PORT="${APP_PORT:-3000}"
project="evenly-smoke"

cleanup() { docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; docker compose -p "$project" logs --tail=50 >&2 || true; exit 1; }

check() {
  local url="$1" expect_status="$2" expect_body="${3:-}"
  local status body
  body="$(mktemp)"
  status="$(curl -sS -o "$body" -w '%{http_code}' "$url")" || fail "curl $url"
  [[ "$status" == "$expect_status" ]] || fail "$url returned $status, expected $expect_status"
  if [[ -n "$expect_body" ]]; then
    grep -qF -- "$expect_body" "$body" || fail "$url body does not contain: $expect_body"
  fi
  rm -f "$body"
  echo "ok  $url -> $status"
}

for base in "" "/evenly"; do
  export PUBLIC_URL="http://localhost:${APP_PORT}${base}"
  echo "== PUBLIC_URL=$PUBLIC_URL"
  cleanup
  docker compose -p "$project" up -d --build --wait --wait-timeout 180 || fail "compose up"

  check "$PUBLIC_URL/healthz" 200 '"status":"ok"'
  check "$PUBLIC_URL/readyz" 200 '"status":"ready"'
  check "$PUBLIC_URL/api/v1/ping" 200 '"name":"evenly"'
  check "$PUBLIC_URL/" 200 "<base href=\"${base}/\">"
  # A reload on a nested client route must get the same page (ADR-0002).
  check "$PUBLIC_URL/status" 200 "content=\"${base}\""
  check "$PUBLIC_URL/g/0192f0c4/settle" 200 "<base href=\"${base}/\">"
  check "$PUBLIC_URL/api/v1/nope" 404 '"status":404'
  if [[ -n "$base" ]]; then
    check "http://localhost:${APP_PORT}/healthz" 404
  fi

  asset="$(curl -sS "$PUBLIC_URL/" | grep -o 'assets/[^"]*\.js' | head -1)"
  [[ -n "$asset" ]] || fail "no script asset found in index.html"
  check "$PUBLIC_URL/$asset" 200

  # The container's own HEALTHCHECK (which reads PUBLIC_URL) must report healthy.
  [[ "$(docker compose -p "$project" ps app --format '{{.Health}}')" == "healthy" ]] || fail "app container is not healthy"
done

echo "Smoke test passed."
