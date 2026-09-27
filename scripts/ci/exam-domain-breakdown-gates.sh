#!/usr/bin/env bash
# ============================================================================
# G1 gate — the exam report's per-domain breakdown (exam_domain_breakdown)
# ============================================================================
# @spec [Doc 04C §8.1/§9.1, §2.3, §2.6 rule 7; Doc 04 Parent Q9 as amended by the G1
#        SCL; SCL-160 (the routing premise, gated as D3)] | @implemented [2026-09-27]
# Applies every migration to a THROWAWAY Postgres (no prod creds) and runs
# scripts/ci/exam-domain-breakdown-gates.sql: exams walked through the E6 runtime
# functions and scored as the API does, then every G1 check (D1-D6, see the .sql
# header): ownership, agreement with score_runs, routing-invariance of the totals,
# the key allowlist, partial/unscored rows, grants.
# Every expected check id must print "ok   [ID ...]"; anything else is red.
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=exam_domain_breakdown_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="D1 D2 D3 D4 D5 D6"

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

echo "==> exam domain breakdown checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/exam-domain-breakdown-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|G1 FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id\]" "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "EXAM DOMAIN BREAKDOWN GATES: FAIL — red:$RED"
  exit 1
fi
echo "EXAM DOMAIN BREAKDOWN GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
