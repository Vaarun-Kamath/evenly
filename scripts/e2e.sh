#!/usr/bin/env bash
# Builds the Docker image and runs the Playwright acceptance scenarios (SPEC.md section 7) against it,
# at the site root and under /evenly (PLATFORM.md section 9). Needs Docker, and Chromium for
# Playwright once: pnpm --filter @evenly/e2e exec playwright install chromium
# Used locally and by CI. Pass "root" or "subpath" to run just one of the two.
set -euo pipefail

cd "$(dirname "$0")/.."
export APP_PORT="${APP_PORT:-3000}"
project="evenly-e2e"

cleanup() { docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; docker compose -p "$project" logs --tail=80 >&2 || true; exit 1; }

case "${1:-both}" in
  root) bases=("") ;;
  subpath) bases=("/evenly") ;;
  both) bases=("" "/evenly") ;;
  *) echo "usage: scripts/e2e.sh [root|subpath]" >&2; exit 2 ;;
esac

for base in "${bases[@]}"; do
  export PUBLIC_URL="http://localhost:${APP_PORT}${base}"
  echo "== PUBLIC_URL=$PUBLIC_URL"
  cleanup
  docker compose -p "$project" up -d --build --wait --wait-timeout 180 || fail "compose up"
  E2E_BASE_URL="$PUBLIC_URL" pnpm --filter @evenly/e2e e2e || fail "the scenarios failed at $PUBLIC_URL"
done

echo "End-to-end scenarios passed."
