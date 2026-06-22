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
# (Its companion, deletion-deidentify-negative-control.sh, proves this gate can
# actually FAIL by running it against a deliberately broken WHERE.)
#
# DB setup (genesis pipeline + the staged owner-run migration) is shared with the
# negative control via lib/deletion-rehearsal-db.sh. It does NOT touch
# supabase/migrations/ or the committed genesis snapshot — the pending migration
# stays staged.
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD). Defaults to a
# local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"
REHEARSAL="$SCRIPT_DIR/deletion-deidentify-rehearsal.sql"
DB=deletion_rehearsal_ci

[ -f "$REHEARSAL" ] || { echo "FAIL: rehearsal sql not found ($REHEARSAL)"; exit 1; }

echo "==> provision throwaway DB (genesis + staged deletion-lifecycle migration)"
setup_deletion_rehearsal_db "$DB"

echo "==> run destructive-path rehearsal"
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$REHEARSAL"

echo "==> drop throwaway DB"
drop_deletion_rehearsal_db "$DB"
echo "    OK"
