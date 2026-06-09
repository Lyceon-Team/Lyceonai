#!/usr/bin/env bash
# ============================================================================
# Mastery formula PARITY gate (Doc 05A §12 / §12.4a / §12.5) — HARD CI GATE
# ============================================================================
# Proves, against a THROWAWAY Postgres, that the PL/pgSQL compute_mastery_for_entity
# matches the INDEPENDENT Python reference (scripts/reference/mastery_reference.py) AND
# the Doc 05A §12 published expected values, bit-exact within tolerances, across all 31
# stress-test fixtures (B1-B23, S1-S8); and that recompute_skill_mastery agrees with
# compute_mastery_for_entity (§12.5 equivalence).
#
#   Python reference == §12 expected   : enforced by `mastery_reference.py --selfcheck`
#   PL/pgSQL          == both           : enforced here (the three-way comparator)
#
# canonical_mastery_events is Lane C and absent from migrations; the harness supplies a
# fixture-backed stand-in over a fixture event table (TEST-ONLY — never committed as a
# migration). Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=mastery_parity_ci
GEN_SQL="$(mktemp /tmp/parity_fixtures.XXXX.sql)"
PSQL_OUT="$(mktemp /tmp/parity_psql.XXXX.out)"

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; rm -f "$GEN_SQL" "$PSQL_OUT"; }
trap cleanup EXIT

echo "==> 1/5 Python reference self-check (reference == Doc 05A §12 expected)"
python3 "$ROOT/scripts/reference/mastery_reference.py" --selfcheck

echo "==> 2/5 fresh DB + Supabase role/auth stub"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

echo "==> 3/5 apply migration pipeline (genesis → config → mastery)"
for f in "$MIG_DIR"/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done

echo "==> 4/5 load 31 fixtures + run compute/recompute"
python3 "$ROOT/scripts/ci/mastery_parity.py" gen > "$GEN_SQL"
psql_db "$DB" -q -f "$GEN_SQL" > "$PSQL_OUT"

echo "==> 5/5 three-way parity comparison"
python3 "$ROOT/scripts/ci/mastery_parity.py" check --psql-out "$PSQL_OUT"

echo "MASTERY PARITY GATE: PASS"
