#!/usr/bin/env bash
# ============================================================================
# INV-05E-03 actor_id coverage guard (PR-5a stub)
# ============================================================================
# Spins up a throwaway Postgres, applies the full genesis pipeline, then runs
# the actor-id-coverage-guard.sql assertions. Same pattern as genesis-fresh-apply.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
GUARD_SQL="$ROOT/scripts/ci/actor-id-coverage-guard.sql"
DB=actor_id_guard_ci

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

stub() {
  psql_db "$1" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
}

echo "==> setup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> apply genesis pipeline"
stub "$DB"
for f in "$MIG_DIR"/*.sql; do
  psql_db "$DB" -q -f "$f" >/dev/null
done

echo "==> run INV-05E-03 coverage guard"
psql_db "$DB" -f "$GUARD_SQL"

echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
echo "INV-05E-03 ACTOR_ID COVERAGE GUARD: PASS"
