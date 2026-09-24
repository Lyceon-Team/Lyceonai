#!/usr/bin/env bash
# ============================================================================
# Scoring engine gates — Doc 04B V4.3 §9-§12 (+ v1.0 activation, SCL-128/129)
# ============================================================================
# @spec [Doc-04B_V4.3, §5.16, §5.17, §7.2, §8.4, §9.1, §9.2, §9.4, §10.1,
#        §11.2, §12.1, §14.4, §15.2, §16.1, §19, §21.1]
# @implemented [2026-09-24]
#
# plain English: applies the genesis pipeline (ending with the v1.0
#   activation) to a THROWAWAY database, then runs scripts/ci/scoring-engine-
#   gates.sql, which makes every scoring-engine constraint fire against a
#   synthetic published form. The gate passes only if EVERY expected check id
#   prints its own `ok` line and no ERROR appears; a check that errors for an
#   unrelated reason prints no `ok` and is reported red by name.
#
# expected outcome: "SCORING ENGINE GATES: PASS (N checks)" and exit 0;
#   otherwise each red check is listed and the exit is 1.
#
# Connection via standard PG* env, defaulting to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=scoring_engine_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="V1 H1 G1 AC1 SEAL1 K1 K2 K3 HP1 PS0a PS0b PS1 ID1 ID2 VG1 VG2 PI1 BL1 NS1 MS1 IO1 IO2 IO5 IO3 IO4 IO6 DEL1"

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

echo "==> scoring engine checks"
psql -X -d "$DB" -f "$ROOT/scripts/ci/scoring-engine-gates.sql" > "$WORK/sql.out" 2>&1 || true
grep -E 'ok   \[|SEG FAIL|ERROR' "$WORK/sql.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id " "$WORK/sql.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/sql.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "SCORING ENGINE GATES: FAIL — red:$RED"
  exit 1
fi
echo "SCORING ENGINE GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
