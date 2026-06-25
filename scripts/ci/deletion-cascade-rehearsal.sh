#!/usr/bin/env bash
# ============================================================================
# Destructive-cascade rehearsal gate — execute_account_deletion_cascade
# ============================================================================
# Proves, against a THROWAWAY Postgres (no prod creds), that the 05D §10
# cascade function correctly hard-deletes all derived + event data for the
# TARGET profile while leaving the CONTROL profile byte-identical, and that
# a second run is a clean idempotent no-op.
#
# Modeled on deletion-deidentify-rehearsal.sh. DB setup reuses the shared
# lib/deletion-rehearsal-db.sh (genesis pipeline + all applied migrations).
#
# Asserts:
#   (A) Both TARGET and CONTROL seeded with rows in all in-scope tables
#   (B) Cascade returns 'completed' with rows_affected > 0
#   (C) TARGET has 0 rows in ALL tables (L1+L2+pre-clear+profile+auth)
#   (D) CONTROL row counts unchanged
#   (E) Idempotent re-run returns no_op
#   (F) Status guard blocks cascade without completed deletion request
#   (G) Anonymize mode raises BLOCKING_PRIVACY_GAP
#   (I) Operator-FK preflight guard: config references block cascade fail-closed
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD). Defaults
# to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"
REHEARSAL="$SCRIPT_DIR/deletion-cascade-rehearsal.sql"
DB=deletion_cascade_rehearsal_ci

[ -f "$REHEARSAL" ] || { echo "FAIL: rehearsal sql not found ($REHEARSAL)"; exit 1; }

echo "==> provision throwaway DB (genesis + all migrations)"
setup_deletion_rehearsal_db "$DB"

echo "==> run cascade rehearsal"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$REHEARSAL"

echo "==> drop throwaway DB"
drop_deletion_rehearsal_db "$DB"
echo "    OK"
