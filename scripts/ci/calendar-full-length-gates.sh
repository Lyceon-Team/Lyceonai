#!/usr/bin/env bash
# ============================================================================
# E9b gate — the calendar's full-length seam (G-08-02)
# ============================================================================
# @spec [Doc_05F §7.4, §9.4, §10.1; formula sheet §2 step 4, §6; SCL-167 .. SCL-170]
#        | @implemented [2026-09-25]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/calendar-full-length-gates.sql: whole exams walked through the E6
# runtime functions and drained as the API does, then the calendar's reading
# of them (FL1-FL11, see the .sql header).
# Every expected check id must print "ok   [ID ...]"; anything else is red.
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=calendar_full_length_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="FL1 FL2 FL3 FL4 FL5 FL6 FL7 FL8 FL9 FL10 FL11"

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

echo "==> calendar full-length checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/calendar-full-length-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|E9BG FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "CALENDAR FULL-LENGTH GATES: FAIL — red:$RED"
  exit 1
fi
echo "CALENDAR FULL-LENGTH GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
