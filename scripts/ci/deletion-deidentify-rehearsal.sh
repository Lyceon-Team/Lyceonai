#!/usr/bin/env bash
# ============================================================================
# Destructive-path rehearsal gate — deidentify_user + §40.5 cron selection
# ============================================================================
# Proves, against a THROWAWAY Postgres (no prod creds), that the IRREVERSIBLE
# §40.5 hard-delete RPC and its cron eligibility filter behave exactly as
# intended BEFORE the owner-run migration is ever applied to prod:
#   * exact-target: anonymizes only the eligible row, others byte-identical;
#   * idempotency / re-entrancy: re-run is a PII-safe no-op; completed rows are
#     excluded from cron re-selection.
# This is genesis-fresh-apply discipline extended to the destructive path: a
# mocked unit suite cannot prove a WHERE clause against the real schema.
#
# Unlike the genesis gate, this one ALSO applies the staged (owner-run) migration
# supabase/migrations-pending/20260621000000_account_deletion_lifecycle.sql, so the
# rehearsal runs the real RPC. It does NOT touch supabase/migrations/ or the
# committed genesis snapshot — the pending migration stays staged.
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD). Defaults to a
# local cluster on :5432. The auth schema + roles are stubbed (a non-Supabase
# Postgres lacks them) exactly as scripts/ci/genesis-fresh-apply.sh does.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
PENDING="$ROOT/supabase/migrations-pending/20260621000000_account_deletion_lifecycle.sql"
REHEARSAL="$ROOT/scripts/ci/deletion-deidentify-rehearsal.sql"
DB=deletion_rehearsal_ci

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

stub() {  # $1 = db name — Supabase-provided roles + auth schema stub
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

[ -f "$PENDING" ]   || { echo "FAIL: pending migration not found ($PENDING)"; exit 1; }
[ -f "$REHEARSAL" ] || { echo "FAIL: rehearsal sql not found ($REHEARSAL)"; exit 1; }

echo "==> fresh DB"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> stub auth + apply genesis pipeline + staged deletion-lifecycle migration"
stub "$DB"
for f in "$MIG_DIR"/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done
psql_db "$DB" -q -f "$PENDING" >/dev/null

echo "==> run destructive-path rehearsal"
psql_db "$DB" -f "$REHEARSAL"

echo "==> drop throwaway DB"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
echo "    OK"
