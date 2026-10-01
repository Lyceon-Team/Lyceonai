#!/usr/bin/env bash
# ============================================================================
# E6 gate — full-length exam runtime API (Doc 04A V2.2 §4, §7-§16; E6 rulings)
# ============================================================================
# @spec [Doc-04A_V2.2, §4, §7-§16] | @implemented [2026-09-24]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/exam-runtime-api-gates.sql: RLS on every exam table as
# `authenticated`, server-time expiry, routing lock, idempotent replay, the
# strict/lenient break and pause, inline + swept finalisation with scoring.
# Every expected check id must print "ok   [ID ...]"; anything else is red.
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=exam_runtime_api_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="W1 OB1 L1 L2 L3 L4 L5 L6 L8 L7 L9 CR1 OWN1 ID1 AL1 EX1 EX2 SUB2 PATH1 M2L GR1 GR2 GR3 BR1 BR2 LN1 LS1 SW1 FIN1"

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

echo "==> exam runtime API checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/exam-runtime-api-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|E6G FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "EXAM RUNTIME API GATES: FAIL — red:$RED"
  exit 1
fi
echo "EXAM RUNTIME API GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
