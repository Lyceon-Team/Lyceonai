#!/usr/bin/env bash
# ============================================================================
# Mastery emission — REAL PostgREST gate
# ============================================================================
# Stands up the stack that tests/ci/mastery-emission.postgrest.ci.test.ts needs,
# and then proves the test actually RAN.
#
#   Postgres (genesis + all migrations)
#     <- PostgREST, with anon/authenticated/service_role and a JWT secret
#       <- the test's path-shim proxy exposing PostgREST under /rest/v1 (the
#          prefix supabase-js appends), so the app's OWN supabase-js clients are
#          used unmodified
#         <- the REAL Express app, driven over HTTP by supertest
#
# Nothing in the data path is mocked. The app's clients are lazy and read
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at first use, so pointing them is
# configuration, not substitution. Only auth and CSRF are mocked, inside the test.
#
# WHY THIS GATE GREPS ITS OWN OUTPUT. The suite self-skips when its env is absent
# (`describe.skip`), and a skipped vitest file exits 0. Ten test files in this repo
# were found executing under no trigger at all while reading as coverage, and a
# green job is exactly what that looks like from the outside. So a green exit is
# not accepted as proof of execution: the run must emit the EXECUTING marker, and
# must report the full case count with nothing skipped. Job colour is not evidence.
#
# Requires: psql, postgrest, node/pnpm, standard PG* env. The shared lib refuses
# non-ephemeral hosts.
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

DB="${MASTERY_PGRST_DB:-mastery_postgrest_ci}"
PGRST_PORT="${PGRST_PORT:-3999}"
# Test-only signing secret. PostgREST requires >= 32 chars for HS256.
JWT_SECRET="${MASTERY_PGRST_JWT_SECRET:-lyceon-postgrest-gate-test-secret-0123456789}"
TEST_FILE="tests/ci/mastery-emission.postgrest.ci.test.ts"
EXPECTED_CASES=6
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
# `authenticator` is the login role PostgREST connects as; it SETs ROLE to the
# role named in the JWT. The three Supabase roles already exist (created by the
# shared lib) but are NOLOGIN, exactly as in a real Supabase project.
psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator';
  END IF;
END \$\$;
GRANT anon, authenticated, service_role TO authenticator;

-- Supabase creates service_role WITH BYPASSRLS. The shared provisioning lib creates a
-- plain NOLOGIN role, and that single missing attribute changes what the app sees:
-- practice_runtime_config has RLS ENABLED with ZERO policies, so a service_role without
-- BYPASSRLS holds the SELECT privilege and still reads 0 rows (denial by absence of
-- policy). loadPracticeConfigFromDb then throws on a missing key and POST
-- /api/practice/answer fail-closes with 503 CONFIG_UNAVAILABLE -- correct app behaviour
-- against a harness that does not match production. Matching production's role
-- attributes is part of standing up the real transport, not a workaround.
ALTER ROLE service_role BYPASSRLS;

-- The proof submits five answers back to back to cross MIN_EVENTS_FOR_MASTERY. The
-- shipped ceiling is lower than that, and a 429 would red the mastery assertions for a
-- reason that has nothing to do with mastery.
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
MASTERY_PGRST_URL="http://localhost:${PGRST_PORT}" \
MASTERY_PGRST_JWT_SECRET="$JWT_SECRET" \
MASTERY_PGRST_DB="$DB" \
  pnpm exec vitest run "$TEST_FILE" 2>&1 | tee "$OUT_FILE"
RC=${PIPESTATUS[0]}

echo
echo "==> EXECUTION PROOF (a green exit is not evidence that anything ran)"

# Captured to a variable and matched with `case`. NOT `grep -q`, which closes the
# pipe at the first match and can kill the producer on SIGPIPE before it flushes.
OUT="$(cat "$OUT_FILE")"

fail() { echo "    $1"; echo "MASTERY POSTGREST GATE: FAIL"; exit 1; }

case "$OUT" in
  *"MASTERY-POSTGREST-PROOF: SKIPPED"*)
    fail "the suite SKIPPED itself — its env was not visible to the vitest process" ;;
esac
case "$OUT" in
  *"MASTERY-POSTGREST-PROOF: EXECUTING"*)
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
  echo "MASTERY POSTGREST GATE: FAIL"
  exit "$RC"
fi

echo "MASTERY POSTGREST GATE: PASS"
