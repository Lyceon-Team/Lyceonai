#!/usr/bin/env bash
# ============================================================================
# Flag-on end-to-end gate for the §40 account-deletion lifecycle
# ============================================================================
# Drives all three chains the UI triggers — through the REAL RPCs the route handlers call, with
# genesis + the staged deletion-lifecycle migration applied to a throwaway Postgres:
#   request -> T+7 cron -> anonymize; request -> token recovery -> restored;
#   request -> in-app cancel -> restored.
# The route handlers themselves use the Supabase JS client (PostgREST) and can't run against a bare
# Postgres; this proves the DB half the routes delegate to composes end-to-end (the unit suite proves
# each route function maps to the right RPC). Shared throwaway-DB setup via lib/deletion-rehearsal-db.sh.
# Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"
SQL="$SCRIPT_DIR/deletion-lifecycle-e2e.sql"
DB=deletion_lifecycle_e2e_ci
trap 'drop_deletion_rehearsal_db "$DB" 2>/dev/null || true' EXIT

[ -f "$SQL" ] || { echo "FAIL: e2e sql not found ($SQL)"; exit 1; }

echo "==> provision throwaway DB (genesis + staged deletion-lifecycle migration)"
setup_deletion_rehearsal_db "$DB"

echo "==> run flag-on deletion-lifecycle e2e chains"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$SQL"

echo "    OK"
