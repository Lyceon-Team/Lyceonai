#!/usr/bin/env bash
# ============================================================================
# SCL-206 gate — real exams feed the score projection (Doc 05C §5.7 / §8.3)
# ============================================================================
# @spec [Doc-05C_V1 §5.7, §8.3, §13.1; SCL-206] | @implemented [2026-10-03]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/projection-full-length-gates.sql: exams sat, scored and their seams
# consumed as the API does, then the projection refreshed through the outbox
# (J1-J6, see the .sql header). Every expected check id must print "ok   [ID]".
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=projection_full_length_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="J1 J2 J3 J4 J5 J6"

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

echo "==> projection full-length checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/projection-full-length-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|PFL FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "PROJECTION FULL-LENGTH GATES: FAIL — red:$RED"
  exit 1
fi
echo "PROJECTION FULL-LENGTH GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
