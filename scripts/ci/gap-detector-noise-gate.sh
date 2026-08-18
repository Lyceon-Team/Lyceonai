#!/usr/bin/env bash
# ============================================================================
# Gap-detector noise gate — 20260818000000
# ============================================================================
# The detector reported 84 gaps out of 91 answered items on its first day in
# production. Every one was an item the Step 8 backfill had correctly rebuilt:
# backfill_recompute_student writes no per-event audit row, so "rebuilt" and
# "never derived" are indistinguishable to an anti-join over the audit log.
#
# An alert that is 100% noise on arrival gets muted. This gate is what stops that
# shipping again.
#
#   (N1) SILENT ON THE BACKFILL   91 answered / 7 live / 84 backfilled -> 0 gaps
#        MUTATION: remove the backfill exclusion from the view -> 84, gate reds.
#   (N2) LOUD ON A REAL GAP       one un-emitted answer AFTER the backfill -> 1
#        This is the case a bare student-scope exclusion would silently hide, and
#        the reason the predicate carries a time bound.
#   (N3) SUMMARY AGREES           mastery_derivation_gap_summary is defined over
#        the view, so it must inherit the fix rather than needing its own.
#   (N4) PRE-MIGRATION CONTROL    against the migration held back, the same
#        fixture reports 84 — proving N1 measures the fix and not the fixture.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

FIXTURE="$SCRIPT_DIR/gap-detector-noise-gate.sql"
MIGRATION=20260818000000_gap_detector_excludes_backfilled.sql
[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found ($FIXTURE)"; exit 1; }

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in gap_noise_ci gap_noise_pre; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

gaps() { psql -tAq -d "$1" -c "SELECT count(*) FROM public.mastery_derivation_gaps;" 2>/dev/null; }

# ---------------------------------------------------------------------------
echo "==> (N4) control: the fixture reports 84 BEFORE the fix"
setup_genesis_db gap_noise_pre "$MIGRATION" || { echo "FAIL: could not provision"; exit 1; }
psql -v ON_ERROR_STOP=1 -d gap_noise_pre -q -v seed=1 -f "$FIXTURE" >/dev/null || { echo "FAIL: seed failed"; exit 1; }
PRE="$(gaps gap_noise_pre)"
if [ "$PRE" != "84" ]; then
  fail N4 "pre-migration gap count is '$PRE', expected 84 — the fixture does not reproduce the reported shape, so N1 would prove nothing"
else
  pass N4 "84 false positives before the fix — the defect is reproduced"
fi

# ---------------------------------------------------------------------------
echo "==> (N1) silent on the backfill"
setup_genesis_db gap_noise_ci || { echo "FAIL: could not provision"; exit 1; }
psql -v ON_ERROR_STOP=1 -d gap_noise_ci -q -v seed=1 -f "$FIXTURE" >/dev/null || { echo "FAIL: seed failed"; exit 1; }

ANSWERED="$(psql -tAq -d gap_noise_ci -c "SELECT count(*) FROM public.practice_session_items WHERE status='answered';")"
AUDITED="$(psql -tAq -d gap_noise_ci -c "SELECT count(*) FROM public.mastery_event_audit_log;")"
POST="$(gaps gap_noise_ci)"
if [ "$ANSWERED" != "91" ] || [ "$AUDITED" != "7" ]; then
  fail N1 "fixture shape is $ANSWERED answered / $AUDITED audited, expected 91 / 7"
elif [ "$POST" != "0" ]; then
  fail N1 "the detector reports $POST gap(s) against a fully-backfilled history, expected 0"
else
  pass N1 "91 answered, 7 live, 84 backfilled -> 0 gaps"
fi

# ---------------------------------------------------------------------------
echo "==> (N2) loud on a real gap"
psql -v ON_ERROR_STOP=1 -d gap_noise_ci -q -v seed_genuine=1 -f "$FIXTURE" >/dev/null || { echo "FAIL: genuine seed failed"; exit 1; }
GENUINE="$(gaps gap_noise_ci)"
if [ "$GENUINE" != "1" ]; then
  fail N2 "one genuinely un-emitted answer produced $GENUINE gap(s), expected exactly 1 — a time-unbounded exclusion hides it"
else
  pass N2 "an un-emitted answer after the backfill still reports as exactly 1"
fi

# ---------------------------------------------------------------------------
echo "==> (N3) the summary inherits the fix"
SUM="$(psql -tAq -d gap_noise_ci -c "SELECT COALESCE(sum(gap_count),0) FROM public.mastery_derivation_gap_summary;")"
if [ "$SUM" != "1" ]; then
  fail N3 "gap_summary totals $SUM, expected 1 — it is not reading the corrected view"
else
  pass N3 "mastery_derivation_gap_summary agrees with the view"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "GAP-DETECTOR NOISE GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "GAP-DETECTOR NOISE GATE: PASS"
