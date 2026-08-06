#!/usr/bin/env bash
# ============================================================================
# Negative control for tutor schema-proof gate — proves the gate FAILS
# ============================================================================
# A positive-only gate can rot into a vacuous check. This drops a required
# column (student_id from tutor_conversations) from a throwaway DB and asserts
# the schema-proof vitest suite FAILS. If the suite passes against a broken
# schema, or fails for a reason other than the missing column, THIS gate fails.
#
# "The green means something" is now CI-enforced.
#
# @spec  [Doc-03A_V3.0, §18.1]
# @implemented [2026-08-06]
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=tutor_schema_negctl_ci
OUT="$(mktemp)"
trap 'rm -f "$OUT"; psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true' EXIT

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

echo "==> create throwaway DB for negative control"
psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> stub + apply migrations"
stub "$DB"
for f in "$MIG_DIR"/*.sql; do
  psql_db "$DB" -q -f "$f" >/dev/null
done

echo "==> MUTATE schema: drop student_id from tutor_conversations (required column)"
psql_db "$DB" -c "ALTER TABLE public.tutor_conversations DROP COLUMN student_id;" >/dev/null

echo "==> run schema-proof against broken schema (it MUST fail)"
if DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}" \
  pnpm vitest run tests/ci/tutor.schema-proof.contract.test.ts >"$OUT" 2>&1; then
  echo "!!! NEGATIVE CONTROL FAILED: schema-proof PASSED against a schema missing student_id."
  echo "    The gate cannot detect column drift — it is vacuous."
  sed 's/^/    | /' "$OUT"
  exit 1
fi

echo "==> schema-proof correctly failed against broken schema"
echo "==> PASS: negative control confirms the gate is load-bearing"
