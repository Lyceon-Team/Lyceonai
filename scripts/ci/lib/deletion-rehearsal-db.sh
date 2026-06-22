# shellcheck shell=bash
# ============================================================================
# Shared throwaway-DB setup for the deletion-deidentify rehearsal + its negative
# control. Sourced (not executed). Provisions a fresh Postgres DB with the genesis
# pipeline applied (which now INCLUDES 20260621000000_account_deletion_lifecycle —
# reconciled into supabase/migrations/), so both gates run the REAL schema + REAL
# deidentify_user.
#
# Provides: setup_deletion_rehearsal_db <dbname>
# Requires: PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD) + psql on PATH.
# ============================================================================

# repo root, resolved from this file's location (scripts/ci/lib/ -> ../../..)
_deletion_rehearsal_root() { (cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd); }

setup_deletion_rehearsal_db() {
  local db="$1"
  local root mig f
  root="$(_deletion_rehearsal_root)"
  mig="$root/supabase/migrations"

  psql -v ON_ERROR_STOP=1 -d postgres \
    -c "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;" >/dev/null

  # Supabase-provided roles + auth schema stub (a non-Supabase Postgres lacks them) —
  # identical to scripts/ci/genesis-fresh-apply.sh.
  psql -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

  for f in "$mig"/*.sql; do psql -v ON_ERROR_STOP=1 -d "$db" -q -f "$f" >/dev/null; done
}

drop_deletion_rehearsal_db() {
  psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $1;" >/dev/null
}
