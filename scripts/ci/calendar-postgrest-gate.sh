#!/usr/bin/env bash
# ============================================================================
# Calendar launch crash-retry — REAL PostgREST gate (INV-08-18)
# ============================================================================
# Stands up the stack that
# tests/ci/calendar.launch-crash-retry.postgrest.ci.test.ts needs, and then
# proves the test actually RAN.
#
#   Postgres (genesis + all migrations)
#     <- PostgREST, with anon/authenticated/service_role and a JWT secret
#       <- the test`s path-shim proxy exposing PostgREST under /rest/v1 (the
#          prefix supabase-js appends), so the app`s OWN supabase-js clients are
#          used unmodified
#         <- the real CalendarLaunchService over its real liveLaunchDeps
#
# Nothing in the data path is mocked. Exactly one thing is substituted: the
# first linkLaunch fails, which IS the crash the proof exists to survive, and
# is the one event a test cannot produce by asking politely.
#
# WHY THIS GATE GREPS ITS OWN OUTPUT. The suite self-skips when its env is
# absent (describe.skip), and a skipped vitest file exits 0. A green job is
# exactly what a suite that never ran looks like from the outside. So a green
# exit is not accepted as proof of execution: the run must emit the EXECUTING
# marker and report the full case count with nothing skipped. Job colour is not
# evidence. Modelled on scripts/ci/mastery-postgrest-gate.sh, which made that
# argument first.
#
# Requires: psql, postgrest, node/pnpm, standard PG* env. The shared lib refuses
# non-ephemeral hosts.
#
# @spec [Doc-05F_V1.0 §15.1 (INV-08-18), §18 "Created but link failed"]
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

DB="${CALENDAR_PGRST_DB:-calendar_postgrest_ci}"
PGRST_PORT="${CALENDAR_PGRST_PORT:-3998}"
# Test-only signing secret. PostgREST requires >= 32 chars for HS256.
JWT_SECRET="${CALENDAR_PGRST_JWT_SECRET:-lyceon-calendar-gate-test-secret-0123456789}"
TEST_FILE="tests/ci/calendar.launch-crash-retry.postgrest.ci.test.ts"
EXPECTED_CASES=4
WORKDIR="$(mktemp -d)"
PGRST_PID=""

cleanup() {
  [ -n "$PGRST_PID" ] && kill "$PGRST_PID" 2>/dev/null
  rm -rf "$WORKDIR"
  drop_deletion_rehearsal_db "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v postgrest >/dev/null 2>&1 || {
  echo "FAIL: postgrest not on PATH — this gate needs the real transport, not a stub"
  exit 1
}
[ -f "$ROOT/$TEST_FILE" ] || {
  echo "FAIL: $TEST_FILE does not exist — the gate cannot pass by running nothing"
  exit 1
}

echo "==> provision DB (genesis + all migrations)"
setup_genesis_db "$DB" || { echo "FAIL: could not provision $DB"; exit 1; }

echo "==> create the PostgREST authenticator role and role grants"
psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator';
  END IF;
END \$\$;
GRANT anon, authenticated, service_role TO authenticator;

-- Supabase creates service_role WITH BYPASSRLS, and the shared provisioning lib does
-- not. That single missing attribute is not cosmetic here: every calendar table has RLS
-- ENABLED, so a service_role without it holds the SELECT privilege and still reads zero
-- rows. Matching production role attributes is part of standing up the real transport.
ALTER ROLE service_role BYPASSRLS;

-- The proof launches the same block three times in a row. The shipped ceiling is lower,
-- and a 429 would red the INV-08-18 assertions for a reason that has nothing to do with
-- launching.
UPDATE public.practice_runtime_config SET value = '200' WHERE key = 'answer_rate_limit_max';
SQL

echo "==> start PostgREST on :$PGRST_PORT"
cat > "$WORKDIR/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@${PGHOST}:${PGPORT}/${DB}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = ${PGRST_PORT}
CONF

postgrest "$WORKDIR/pgrst.conf" > "$WORKDIR/pgrst.log" 2>&1 &
PGRST_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${PGRST_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -fsS "http://localhost:${PGRST_PORT}/" >/dev/null 2>&1; then
  echo "FAIL: PostgREST did not become ready"
  tail -20 "$WORKDIR/pgrst.log"
  exit 1
fi
echo "    PostgREST ready"

echo "==> run the proof against the real stack"
cd "$ROOT"
OUT_FILE="$WORKDIR/vitest.out"
CALENDAR_PGRST_URL="http://localhost:${PGRST_PORT}" \
CALENDAR_PGRST_JWT_SECRET="$JWT_SECRET" \
CALENDAR_PGRST_DB="$DB" \
  pnpm exec vitest run "$TEST_FILE" 2>&1 | tee "$OUT_FILE"
RC=${PIPESTATUS[0]}

echo
echo "==> EXECUTION PROOF (a green exit is not evidence that anything ran)"

# ANSI is stripped before matching: vitest emits plain text to a non-TTY locally but
# COLOURS its summary on the GitHub runner, and a literal match on the summary line
# fails against a run where every case passed. The mastery gate learned that the hard
# way on 5a06e64 -- it failed CLOSED, which is the safe direction, but a check that
# cannot read a pass is not a check.
OUT="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$OUT_FILE")"

fail() { echo "    $1"; echo "CALENDAR POSTGREST GATE: FAIL"; exit 1; }

case "$OUT" in
  *"CALENDAR-POSTGREST-PROOF: SKIPPED"*)
    fail "the suite SKIPPED itself — its env was not visible to the vitest process" ;;
esac
case "$OUT" in
  *"CALENDAR-POSTGREST-PROOF: EXECUTING"*)
    echo "    OK  EXECUTING marker present — the suite ran, it did not skip" ;;
  *)
    fail "no EXECUTING marker in the output — the suite did not run" ;;
esac
case "$OUT" in
  *"Tests  ${EXPECTED_CASES} passed (${EXPECTED_CASES})"*)
    echo "    OK  all ${EXPECTED_CASES} cases passed, none skipped" ;;
  *)
    fail "did not observe exactly '${EXPECTED_CASES} passed (${EXPECTED_CASES})' — a case was skipped, added or removed without updating EXPECTED_CASES" ;;
esac

if [ "$RC" -ne 0 ]; then
  echo
  echo "--- PostgREST log (last 30 lines) ---"
  tail -30 "$WORKDIR/pgrst.log"
  echo "CALENDAR POSTGREST GATE: FAIL"
  exit "$RC"
fi

echo "CALENDAR POSTGREST GATE: PASS"
