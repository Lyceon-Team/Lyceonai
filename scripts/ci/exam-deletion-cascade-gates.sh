#!/usr/bin/env bash
# ============================================================================
# E6b gate — exam tables in the account-deletion cascade (Doc 05E, 05D §10)
# ============================================================================
# @spec [Doc-05E §1, §5.1, §6 INV-05E-07; Doc-05D §10.5; Doc-04B_V4.3 §9.4; SCL-143] | @implemented [2026-09-24]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/exam-deletion-cascade-gates.sql: whole exams walked through the
# E6 runtime functions and scored, then execute_account_deletion_cascade in both
# modes — anonymize retains and severs, hard_delete removes and counts, the
# INV-05E-07 sentinel refuses an ungrouped row, a re-run is a no-op, the
# insert-once trigger still refuses every caller UPDATE/DELETE. The result JSON
# of each run is printed (evidence).
# Every expected check id must print "ok   [ID ...]"; anything else is red.
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=exam_deletion_cascade_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="S1 W1 N1 T1 SN1 SN2 A1 A2 A3 P1 P2 H1 R1 C1 L1 L2 L3 L4"

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

echo "==> exam deletion cascade checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/exam-deletion-cascade-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|EDC FAIL|ERROR|^psql.*result ' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "EXAM DELETION CASCADE GATES: FAIL — red:$RED"
  exit 1
fi
echo "EXAM DELETION CASCADE GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
