#!/usr/bin/env bash
# ============================================================================
# Scoring PARITY gate — Python reference == PL/pgSQL production, per deploy
# ============================================================================
# @spec [Doc-04B_V4.3, §3.1, §6, §18.3, §21.1 "Reference parity tests", §28]
#       OWNER RULING 2026-09-24: run on every CI run, overriding §21.2 (which
#       retires the per-deploy gate in favour of lock-time validation only).
# @implemented [2026-09-24]
#
# plain English: applies the migration pipeline (which ends with v1.0 active)
#   to a THROWAWAY database, then scripts/ci/scoring_parity.py drives all 1,313
#   sweep scenarios and all 60 targeted fixtures of the committed evidence
#   packet through BOTH the pure formula function and a real session scored by
#   score_test_session_from_outbox(), plus every Doc 04B §28 worked example,
#   and fails on ANY disagreement with the Python reference, printing the first
#   mismatches.
#
# COVERAGE LIMIT, stated plainly: this gate catches changes made IN THIS REPO
#   (migrations, the formula, the difficulty mapping, the fixtures). It cannot
#   see production: a function or constant edited in the Supabase SQL editor
#   is invisible to a CI database built from migrations. The owner deferred a
#   production-side drift check.
#
# Connection via standard PG* env, defaulting to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=scoring_parity_ci
WORK="$(mktemp -d)"

psql_db() { psql -X -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -q -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> 1/4 fresh DB + Supabase role/auth stub"
psql_db postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
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

echo "==> 2/4 apply migration pipeline (ends with v1.0 activation)"
for f in "$MIG_DIR"/*.sql; do
  psql_db "$DB" -q -f "$f" >/dev/null 2>"$WORK/mig.err" || { echo "FAIL: $f did not apply"; tail -5 "$WORK/mig.err"; exit 1; }
done
STATUS="$(psql_db "$DB" -tAc "SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0'")"
[ "$STATUS" = "active" ] || { echo "FAIL: v1.0 is '$STATUS' after the pipeline (expected active)"; exit 1; }

echo "==> 3/4 drive 1313 sweep + 60 targeted + §28 through the formula AND the session path"
python3 "$ROOT/scripts/ci/scoring_parity.py" gen > "$WORK/parity.sql"
if ! psql_db "$DB" -qtA -F'|' -f "$WORK/parity.sql" > "$WORK/parity.out" 2> "$WORK/parity.err"; then
  echo "FAIL: the production scoring path raised:"
  grep -v '^psql.*NOTICE' "$WORK/parity.err" | head -20
  echo "SCORING PARITY: FAIL (production path errored)"
  exit 1
fi

echo "==> 4/4 compare"
python3 "$ROOT/scripts/ci/scoring_parity.py" check --psql-out "$WORK/parity.out"
