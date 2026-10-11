#!/usr/bin/env bash
# Proves that a pg_dump backup restores into a working app (BUILD_PLAN M6, PLATFORM.md section 4).
# Builds the image, creates an account, a group and some money, dumps the database, drops it, restores the
# dump into a fresh database and checks that the old session cookie still works and the balances and every
# table are identical. Needs Docker and curl. Used locally and by CI. APP_PORT=3300 if 3000 is taken.
set -euo pipefail

cd "$(dirname "$0")/.."
export APP_PORT="${APP_PORT:-3000}"
export PUBLIC_URL="http://localhost:${APP_PORT}"
project="evenly-backup"
work="$(mktemp -d)"

stack_down() { docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap 'stack_down; rm -rf "$work"' EXIT

fail() { echo "FAIL: $*" >&2; docker compose -p "$project" logs --tail=50 >&2 || true; exit 1; }

compose() { docker compose -p "$project" "$@"; }
psql_db() { compose exec -T db psql -v ON_ERROR_STOP=1 -U lib001 "$@"; }

# One line per table: its name, row count and a checksum of its rows. Equal output means equal data.
# (psql reads /dev/null so that it does not swallow the list of tables the loop is reading.)
fingerprint() {
  local tables table
  tables="$(psql_db -d lib001 -Atc "select tablename from pg_tables where schemaname = 'public' order by 1")"
  while read -r table; do
    [[ -n "$table" ]] || continue
    psql_db -d lib001 -Atc "select '$table', count(*), coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') from \"$table\" t" </dev/null
  done <<<"$tables"
}

stack_down
compose up -d --build --wait --wait-timeout 180 || fail "compose up"

jar="$work/cookies"
origin="$PUBLIC_URL"
json() { curl -sS -b "$jar" -c "$jar" -H 'Content-Type: application/json' -H "Origin: $origin" "$@"; }

email="backup-${RANDOM}${RANDOM}@example.com"
status="$(json -o /dev/null -w '%{http_code}' -d "{\"email\":\"$email\",\"name\":\"Backup\",\"password\":\"correct horse battery staple\"}" "$PUBLIC_URL/api/auth/sign-up/email")"
[[ "$status" == "200" ]] || fail "sign-up returned $status"

# The first "id" in a JSON answer; the answer itself is shown when there is none.
first_id() {
  local answer id
  answer="$(json "$@")"
  id="$(grep -o '"id":"[^"]*"' <<<"$answer" | head -1 | cut -d'"' -f4 || true)"
  [[ -n "$id" ]] || fail "no id in the answer to $*: $answer"
  echo "$id"
}

group_id="$(first_id -d '{"name":"Backup trip","currency":"INR"}' "$PUBLIC_URL/api/v1/groups")"
me="$(first_id "$PUBLIC_URL/api/v1/groups/$group_id/members")"
other="$(first_id -d '{"displayName":"Friend"}' "$PUBLIC_URL/api/v1/groups/$group_id/members")"
for n in 1 2 3; do
  expense="{\"id\":\"0192f0c4-0000-7000-8000-$(printf '%012d' "$n")\",\"description\":\"Expense $n\",\"amountMinor\":$((n * 33333)),\"currency\":\"INR\",\"expenseDate\":\"2026-10-10\",\"payers\":[{\"memberId\":\"$me\",\"amountMinor\":$((n * 33333))}],\"split\":{\"method\":\"equal\",\"entries\":[{\"memberId\":\"$me\"},{\"memberId\":\"$other\"}]}}"
  answer="$(json -w ' %{http_code}' -d "$expense" "$PUBLIC_URL/api/v1/groups/$group_id/expenses")"
  [[ "$answer" == *" 201" ]] || fail "creating expense $n: $answer"
done
balances_before="$(json "$PUBLIC_URL/api/v1/groups/$group_id/balances")"
grep -q '"nets"' <<<"$balances_before" || fail "no balances before the backup"
fingerprint_before="$(fingerprint)"
echo "ok  created an account, a group and three expenses ($(wc -l <<<"$fingerprint_before" | tr -d ' ') tables)"

# The backup: a custom-format dump, as PLATFORM.md section 4 describes.
compose exec -T db pg_dump -U lib001 -Fc lib001 >"$work/lib001.dump"
[[ -s "$work/lib001.dump" ]] || fail "the dump is empty"
echo "ok  pg_dump wrote $(wc -c <"$work/lib001.dump" | tr -d ' ') bytes"

# Lose the database, then restore it from the dump alone.
compose stop app >/dev/null
psql_db -d postgres -c "DROP DATABASE lib001 WITH (FORCE)" >/dev/null
psql_db -d postgres -c "CREATE DATABASE lib001 OWNER lib001" >/dev/null
compose exec -T db pg_restore -U lib001 -d lib001 --no-owner --exit-on-error <"$work/lib001.dump" || fail "pg_restore"
compose up -d --wait --wait-timeout 120 || fail "the app did not come back after the restore"
echo "ok  restored into a fresh database and the app started (migrations were already applied)"

[[ "$(fingerprint)" == "$fingerprint_before" ]] || fail "the restored tables differ from the originals"
echo "ok  every table has the same rows"

# The session cookie from before the backup still works, because sessions and the signing secret are in the database.
status="$(json -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/me")"
[[ "$status" == "200" ]] || fail "the old session cookie returned $status after the restore"
balances_after="$(json "$PUBLIC_URL/api/v1/groups/$group_id/balances")"
[[ "$balances_after" == "$balances_before" ]] || fail "the balances changed across the restore"
echo "ok  the old session and the balances survived"

echo "Backup and restore test passed."
