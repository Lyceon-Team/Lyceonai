#!/usr/bin/env bash
# ============================================================================
# Negative control for the deletion-deidentify rehearsal — proves the gate FAILS
# ============================================================================
# A positive-only rehearsal can rot into a vacuous gate: if a future change makes
# the rehearsal unable to detect a widened destructive UPDATE, "green" would mean
# nothing. This gate mutates deidentify_user on a throwaway copy so its WHERE
# clause touches EVERY row (the exact failure the rehearsal must catch), runs the
# SAME rehearsal SQL, and asserts it FAILS — specifically at the exact-target
# assertion (B). If the rehearsal passes against the broken function, OR fails for
# any other reason, THIS gate fails. "The green means something" is now CI-enforced.
#
# DB setup is shared with the positive rehearsal via lib/deletion-rehearsal-db.sh.
# Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"
REHEARSAL="$SCRIPT_DIR/deletion-deidentify-rehearsal.sql"
DB=deletion_negctl_ci
OUT="$(mktemp)"
trap 'rm -f "$OUT"; drop_deletion_rehearsal_db "$DB" 2>/dev/null || true' EXIT

[ -f "$REHEARSAL" ] || { echo "FAIL: rehearsal sql not found ($REHEARSAL)"; exit 1; }

echo "==> provision throwaway DB (genesis + staged deletion-lifecycle migration)"
setup_deletion_rehearsal_db "$DB"

echo "==> MUTATE deidentify_user: drop the WHERE clause so it anonymizes EVERY row"
psql -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION public.deidentify_user(target_user_id uuid, deleted_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- BROKEN ON PURPOSE (negative control): no `WHERE id = target_user_id`, so this
  -- anonymizes every profile, not just the eligible one. The rehearsal MUST catch this.
  UPDATE public.profiles
     SET email = deleted_email, full_name = NULL, display_name = 'Deleted User',
         stripe_customer_id = NULL, guardian_email = NULL, date_of_birth = NULL, updated_at = now();
END $$;
SQL

echo "==> run the rehearsal against the broken function (it MUST fail)"
if psql -v ON_ERROR_STOP=1 -d "$DB" -f "$REHEARSAL" >"$OUT" 2>&1; then
  echo "!!! NEGATIVE CONTROL FAILED: the rehearsal PASSED against a broken WHERE — the gate cannot fail."
  sed 's/^/    | /' "$OUT"
  exit 1
fi

if ! grep -qE 'ERROR:.*\(B\) deidentify_user mutated' "$OUT"; then
  echo "!!! NEGATIVE CONTROL FAILED: the rehearsal failed, but NOT at the exact-target assertion (B)."
  echo "    A broken WHERE must trip (B); failing for another reason means (B) is not actually load-bearing."
  sed 's/^/    | /' "$OUT"
  exit 1
fi

echo "    OK negative control: the broken WHERE correctly tripped exact-target assertion (B):"
grep -E 'ERROR:.*\(B\) deidentify_user mutated' "$OUT" | sed 's/^/    | /'
echo "    => the rehearsal's ability-to-fail is CI-enforced and repeatable."
