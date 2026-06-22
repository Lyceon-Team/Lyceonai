#!/usr/bin/env bash
# ============================================================================
# Atomicity gate for the §40.4 in-app cancel RPC (cancel_account_deletion)
# ============================================================================
# Proves, against a THROWAWAY Postgres with genesis + the staged deletion-lifecycle
# migration applied, that in-app cancel is a single atomic transaction: an email-reclaim
# collision while clearing deleted_at rolls BOTH writes back, so a user can never be left
# cancelled-but-still-locked (the strand the §40.3 lock exists to prevent). A mocked unit
# suite cannot prove a DB rollback. Shared throwaway-DB setup via lib/deletion-rehearsal-db.sh.
# Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"
SQL="$SCRIPT_DIR/deletion-cancel-atomicity.sql"
DB=deletion_cancel_atomicity_ci
trap 'drop_deletion_rehearsal_db "$DB" 2>/dev/null || true' EXIT

[ -f "$SQL" ] || { echo "FAIL: cancel-atomicity sql not found ($SQL)"; exit 1; }

echo "==> provision throwaway DB (genesis + staged deletion-lifecycle migration)"
setup_deletion_rehearsal_db "$DB"

echo "==> run in-app cancel atomicity rehearsal"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$SQL"

echo "    OK"
