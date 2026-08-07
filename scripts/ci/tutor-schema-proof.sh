#!/usr/bin/env bash
# ============================================================================
# Tutor schema-proof gate (AUD-519-008 closure — Doc 03A §18.1–§18.7)
# ============================================================================
# Proves, against a THROWAWAY Postgres (no prod creds), that the tutor schema
# matches the locked spec expectations: required columns, types, enum values,
# RLS enabled, and correct student-scoped policies across all 9 tutor_* tables.
#
# Reuses the same Postgres container + migration pipeline pattern as
# genesis-fresh-apply, practice-integration, and deletion-deidentify-rehearsal.
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD).
# @spec  [Doc-03A_V3.0, §18.1–§18.7]
# @implemented [2026-08-06]
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=tutor_schema_proof_ci

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

cleanup() { psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> create throwaway DB"
cleanup
psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $DB;" >/dev/null

echo "==> stub auth schema + apply migration pipeline"
stub "$DB"
for f in "$MIG_DIR"/*.sql; do
  psql_db "$DB" -q -f "$f" >/dev/null
done

echo "==> run tutor schema-proof (vitest)"
DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}" \
  pnpm vitest run tests/ci/tutor.schema-proof.contract.test.ts

echo "==> PASS: tutor schema-proof gate green"
