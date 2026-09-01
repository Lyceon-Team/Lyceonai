#!/usr/bin/env bash
# ============================================================================
# guardian_view_decision gate — ONE derivation, proved on REAL guardian_links rows.
# ============================================================================
# @spec [Doc 01 V8 §35/§38.1; Doc 05B §10.1/§10.3/§10.4; owner rulings 2026-08-26
#        R3/R6 and 2026-08-27 OQ1]
#
# Applies the genesis pipeline to a THROWAWAY database (no prod creds) and runs
# scripts/ci/guardian-view-decision-gate.sql against it.
#
# WHY THIS EXISTS. Every guardian test in the repo mocks the link layer away, and
# `guardian_links` has never held a row in production, so guardian code that
# addressed non-existent columns passed CI for ten weeks. This gate inserts real
# rows and asserts what the gate actually decides.
#
# Connection via standard PG* env, defaulting to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=guardian_gate_ci

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
for f in "$MIG_DIR"/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done

echo "==> run gate"
psql_db "$DB" -f "$ROOT/scripts/ci/guardian-view-decision-gate.sql"

echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
echo "GUARDIAN-VIEW-DECISION GATE: PASS"
