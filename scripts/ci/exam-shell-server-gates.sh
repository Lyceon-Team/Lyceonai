#!/usr/bin/env bash
# ============================================================================
# E7a gate — exam shell server: workspace, resume position, forms list, report
# ============================================================================
# @spec [Doc-04A_V2.2 §8.3, §15.1, §16 (SCL-145, SCL-146, SCL-147); Doc-04C_V1.0 §5.3, §15.2, §16.6] | @implemented [2026-09-25]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/exam-shell-server-gates.sql: the item workspace (served tokens only,
# offsets inside the passage, active module only, owner only), the heartbeat's
# resume position, the forms list, the 04C report source (one 403 for missing and
# foreign sessions, the failure stand-in, the v1.0 disclosure verbatim) and grants.
# Every expected check id must print "ok   [ID ...]"; anything else is red.
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=exam_shell_server_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="W1 W2 W3 W4 H1 H2 F1 R1 R2 G1"

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

echo "==> exam shell server checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/exam-shell-server-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|E7A FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "EXAM SHELL SERVER GATES: FAIL — red:$RED"
  exit 1
fi
echo "EXAM SHELL SERVER GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
