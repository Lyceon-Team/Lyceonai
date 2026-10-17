#!/usr/bin/env bash
# ============================================================================
# SCL-236 gate — the stored diagnostic projection and the one completion path
# ============================================================================
# @spec [SCL-236; SCL-235; owner rulings 2026-10-16 and 2026-10-17] | @implemented [2026-10-17]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/diagnostic-projection-gates.sql (D1-D12, see its header), then D13: two
# connections call complete_diagnostic_session on the SAME session at the same moment.
# Exactly one may complete it, exactly two rows may exist, and both calls must report the
# same stored projection. Every expected id must print "ok   [ID]".
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=diagnostic_projection_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; psql -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true' EXIT

EXPECTED_IDS="D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13-setup D13 D14 D15"

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

echo "==> fresh DB"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> Supabase role + auth stub"
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

echo "==> apply pipeline"
for f in "$MIG_DIR"/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null 2>&1 || { echo "FAIL: $f did not apply"; psql_db "$DB" -q -f "$f" 2>&1 | tail -5; exit 1; }; done

echo "==> diagnostic projection checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/diagnostic-projection-gates.sql" > "$WORK/sql.out" 2>&1 || true

echo "==> D13 race: two connections complete the same session at once"
RACE_SQL="SELECT public.complete_diagnostic_session((SELECT session_id FROM public._dpg_race), timestamptz '2026-10-01 11:00Z');"
psql -X -tAq -d "$DB" -c "$RACE_SQL" > "$WORK/race1.out" 2>&1 &
P1=$!
psql -X -tAq -d "$DB" -c "$RACE_SQL" > "$WORK/race2.out" 2>&1 &
P2=$!
wait "$P1" || true
wait "$P2" || true
NOW_TRUE=$(grep -h -o '"completed_now": true' "$WORK/race1.out" "$WORK/race2.out" | wc -l | tr -d ' ')
COMPUTED=$(cat "$WORK/race1.out" "$WORK/race2.out" | grep -o "\"projection\": \"computed\"" | wc -l | tr -d " ")
ROWS=$(psql -X -tAq -d "$DB" -c "SELECT count(*) FROM public.student_diagnostic_projections WHERE practice_session_id = (SELECT session_id FROM public._dpg_race);")
if [ "$NOW_TRUE" = "1" ] && [ "$COMPUTED" = "2" ] && [ "$ROWS" = "2" ]; then
  echo "ok   [D13] race: exactly one call completed the session, both report the stored projection, 2 rows" >> "$WORK/sql.out"
else
  echo "DPG FAIL [D13] completed_now=true x$NOW_TRUE, computed x$COMPUTED, rows=$ROWS" >> "$WORK/sql.out"
  cat "$WORK/race1.out" "$WORK/race2.out" >> "$WORK/sql.out"
fi

echo "==> D14/D15 the owner-run files, in console mode (psql -c, as pasted)"
PRE="$(PGOPTIONS='-c client_min_messages=warning' psql -X -tA -d "$DB" -c "$(cat "$ROOT/scripts/prod-verify/diagnostic-projection-preflight.sql")" 2>&1)"
case "$PRE" in
  "OK: no student holds two in-flight diagnostics"*) echo "ok   [D14] preflight verdict: OK on a database with one in-flight diagnostic per student" >> "$WORK/sql.out" ;;
  *) echo "DPG FAIL [D14] preflight: $PRE" >> "$WORK/sql.out" ;;
esac
BF="$(PGOPTIONS='-c client_min_messages=warning' psql -X -tA -F '|' -d "$DB" -c "$(cat "$ROOT/scripts/prod-verify/diagnostic-projection-backfill.sql")" 2>&1)"
# Every completed diagnostic in this database is reported; none MISSING; the fresh student's row
# carries both the stored new values and STORED.
if printf '%s\n' "$BF" | grep -q 'MISSING'; then
  echo "DPG FAIL [D15] backfill reported a MISSING row: $BF" >> "$WORK/sql.out"
elif printf '%s\n' "$BF" | grep -q '^dpg-fresh|.*|STORED$' && printf '%s\n' "$BF" | grep -q '^dpg-skipper' ; then
  echo "DPG FAIL [D15] the anonymized skipper should no longer be listed: $BF" >> "$WORK/sql.out"
elif printf '%s\n' "$BF" | grep -q '^dpg-fresh|.*|STORED$' && printf '%s\n' "$BF" | grep -q '^dpg-historic|.*|STORED$'; then
  echo "ok   [D15] backfill runs in console mode; every completed diagnostic reported STORED (fresh, historic, prior, canonical, racer), none MISSING" >> "$WORK/sql.out"
else
  echo "DPG FAIL [D15] backfill report unexpected: $BF" >> "$WORK/sql.out"
fi

grep -E 'ok   \[|DPG FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

if [ -n "$RED" ]; then
  echo "DIAGNOSTIC PROJECTION GATES: FAIL — red:$RED"
  exit 1
fi
echo "DIAGNOSTIC PROJECTION GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
