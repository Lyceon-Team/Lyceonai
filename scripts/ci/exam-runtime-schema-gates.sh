#!/usr/bin/env bash
# ============================================================================
# Exam runtime schema gates — Doc 04A V2.2 §5/§6/§9 + ruled 04B §13
# ============================================================================
# @spec [Doc-04A_V2.2, §4 #3/#4/#5/#15, §5, §6.1-§6.3, §9.2, §11.2]
#       [Doc-04B_V4.3, §13 as amended by owner ruling 2026-09-24 (SCL-121)]
# @implemented [2026-09-24]
#
# plain English: applies the genesis pipeline to a THROWAWAY database (no prod
#   creds), then runs scripts/ci/exam-runtime-schema-gates.sql, which makes
#   every exam-runtime constraint fire against synthetic fixtures. The gate
#   passes only if EVERY expected check id prints its own `ok` line and no
#   ERROR appears. A check that errors for an unrelated reason prints no `ok`
#   and is reported red by name — it cannot pass by accident.
#
# expected outcome: "EXAM RUNTIME SCHEMA GATES: PASS (N checks)" and exit 0;
#   otherwise each red check is listed and the exit is 1.
#
# edge cases: the fixtures are synthetic (CI cannot reach production). The
#   composition function was also exercised against the real bank metadata
#   locally; that evidence lives in the E3 PR body.
#
# Connection via standard PG* env, defaulting to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=exam_runtime_schema_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="G1 C4 C1 C2 C3 C5 C6 P1 P2 P3 P4 P5 C7 F1 F2 F3 F4 I1 I2 I3 U1 U2 R1 R2 A1a A1b A1 D1"

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

echo "==> exam runtime checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/exam-runtime-schema-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|EXG FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id " "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "EXAM RUNTIME SCHEMA GATES: FAIL — red:$RED"
  exit 1
fi
echo "EXAM RUNTIME SCHEMA GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
