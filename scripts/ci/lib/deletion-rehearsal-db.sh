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

# ---------------------------------------------------------------------------
# Destructive-target guard (audit M-10).
#
# Every rehearsal runner reaches Postgres through this file, and both functions
# below issue DROP DATABASE. The runners take PGHOST from the ambient
# environment with no target check, and deletion-cascade-rehearsal.sql inserts
# fabricated rows into mastery_event_audit_log, student_skill_mastery and
# student_domain_mastery. That combination is the probable origin of the six
# unattributable 'seedhash' audit rows found in prod (2026-06-26/27).
#
# Guard placement is deliberate: here, not in each runner. This is the single
# chokepoint — a new rehearsal script inherits the guard by construction rather
# than by remembering to copy it.
#
# Allowed: loopback only, or an explicit opt-in via
# LYCEON_ALLOW_DESTRUCTIVE_DB_HOST (comma-separated exact hostnames) for
# self-hosted ephemeral runners. Managed-Postgres hostnames are refused
# unconditionally — they are never a legitimate target and the opt-in must not
# be able to name one.
# ---------------------------------------------------------------------------
_assert_ephemeral_db_target() {
  local host="${PGHOST:-localhost}"
  local allowed entry

  case "$host" in
    *.supabase.co|*.supabase.com|*.rds.amazonaws.com|*.neon.tech|*.render.com)
      echo "FATAL: REHEARSAL_TARGET_REFUSED — '$host' is a managed-Postgres host." >&2
      echo "       These scripts DROP DATABASE and seed fabricated mastery rows." >&2
      echo "       They must never run against a hosted database. Refusing before any DDL." >&2
      return 1
      ;;
  esac

  case "$host" in
    localhost|127.0.0.1|::1|"") return 0 ;;
  esac

  allowed="${LYCEON_ALLOW_DESTRUCTIVE_DB_HOST:-}"
  if [ -n "$allowed" ]; then
    local IFS=','
    for entry in $allowed; do
      # trim surrounding whitespace
      entry="${entry#"${entry%%[![:space:]]*}"}"
      entry="${entry%"${entry##*[![:space:]]}"}"
      if [ "$entry" = "$host" ]; then return 0; fi
    done
  fi

  echo "FATAL: REHEARSAL_TARGET_REFUSED — PGHOST='$host' is not a recognised ephemeral target." >&2
  echo "       Allowed without opt-in: localhost, 127.0.0.1, ::1." >&2
  echo "       For a self-hosted ephemeral runner, set LYCEON_ALLOW_DESTRUCTIVE_DB_HOST='$host'." >&2
  echo "       Refusing before any DDL." >&2
  return 1
}

# ---------------------------------------------------------------------------
# setup_genesis_db <dbname> [stop_before_basename]
#
# Provisions a fresh DB with the Supabase role/auth stubs and applies
# supabase/migrations in filename order. This is the general primitive; the
# deletion-rehearsal entry point below is a thin alias so the four existing
# rehearsal runners keep their name and behaviour.
#
# stop_before_basename (optional): apply migrations with a basename strictly
# LESS THAN this value, in the same lexicographic order psql applies them. The
# timestamp-prefixed naming convention makes that a clean "state as of just
# before migration X" cut. A gate that must prove a migration CHANGES something
# needs to seed the pre-state first, which is impossible if every migration is
# already applied — this is what makes red-before/green-after provable rather
# than asserted.
# ---------------------------------------------------------------------------
setup_genesis_db() {
  local db="$1"
  local stop_before="${2:-}"
  local root mig f base

  _assert_ephemeral_db_target || return 1

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

  for f in "$mig"/*.sql; do
    if [ -n "$stop_before" ]; then
      base="$(basename "$f")"
      # shellcheck disable=SC2071  # string comparison is intended, not numeric
      if [[ ! "$base" < "$stop_before" ]]; then continue; fi
    fi
    psql -v ON_ERROR_STOP=1 -d "$db" -q -f "$f" >/dev/null
  done
}

# apply_migration <dbname> <basename> — apply one migration by filename.
apply_migration() {
  local db="$1" base="$2" root
  root="$(_deletion_rehearsal_root)"
  psql -v ON_ERROR_STOP=1 -d "$db" -q -f "$root/supabase/migrations/$base"
}

setup_deletion_rehearsal_db() {
  setup_genesis_db "$1"
}

drop_deletion_rehearsal_db() {
  _assert_ephemeral_db_target || return 1
  psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $1;" >/dev/null
}
