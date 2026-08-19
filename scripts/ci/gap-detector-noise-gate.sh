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
#   (N5) FIXTURE INTEGRITY        the genuine gap really is inside a backfilled
#        (student, section, domain) and postdates its applied_at — without that,
#        N2 passes on scope alone and proves nothing about the time bound.
#   (N6) SCOPE-ONLY COUNTERFACTUAL a scope-only exclusion (no time bound) HIDES
#        the genuine gap. That is what makes the bound load-bearing rather than
#        decoration: repair must not blind the alarm.
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

# ---------------------------------------------------------------------------
# (N5) FIXTURE INTEGRITY — N2 only proves the time bound if the genuine item sits
# INSIDE a backfilled (student, section, domain). If a later edit moved it to a
# domain no backfill covered, N2 would still report 1 and would still pass, while
# proving nothing at all: scope alone would hide it just as well. So assert the
# fixture's shape rather than trusting it.
echo "==> (N5) the genuine gap really is inside a backfilled scope, after the watermark"
SHAPE="$(psql -tAq -d gap_noise_ci <<'SQL'
SELECT count(*)
  FROM public.practice_session_items pi
  JOIN public.mastery_domain_refresh_audit_log ral
    ON  ral.triggered_by = 'backfill_recompute'
    AND ral.student_id   = pi.user_id
    AND ral.section      = pi.question_section
    AND ral.domain       = pi.question_domain
 WHERE pi.status = 'answered'
   AND pi.occurred_at > ral.applied_at
   AND NOT EXISTS (SELECT 1 FROM public.mastery_event_audit_log mal
                    WHERE mal.student_id = pi.user_id
                      AND mal.section    = pi.question_section
                      AND mal.domain     = pi.question_domain);
SQL
)"
if [ "$SHAPE" != "1" ]; then
  fail N5 "the fixture holds $SHAPE un-emitted answer(s) inside a backfilled (student, section, domain) and after its applied_at, expected exactly 1.
       Without one, N2's pass is satisfied by scope alone and says nothing about the time bound."
else
  pass N5 "exactly one un-emitted answer inside a backfilled scope, postdating the backfill"
fi

# ---------------------------------------------------------------------------
# (N6) THE SCOPE-ONLY COUNTERFACTUAL — is the time bound load-bearing, or decoration?
# Redefine the view with the exclusion but WITHOUT `occurred_at <= applied_at`,
# inside a transaction that is rolled back. That is the cheaper fix someone will
# propose. If the genuine gap survives it, the time bound buys nothing and this
# case should be deleted; if the gap DISAPPEARS, the bound is what makes the
# detector still able to see a new failure in a domain that was once repaired.
# Repair must not blind the alarm.
echo "==> (N6) a scope-only exclusion HIDES the genuine gap (so the time bound is load-bearing)"
# The counterfactual view is DERIVED from the shipped migration rather than
# hand-copied: take its CREATE OR REPLACE VIEW block verbatim and delete only the
# two `occurred_at <= ral.applied_at` lines. A hand-written copy would drift from
# the migration and start proving something else; this cannot.
MIG_PATH="$(cd "$SCRIPT_DIR/../.." && pwd)/supabase/migrations/$MIGRATION"
SCOPE_ONLY_VIEW="$(awk '/^CREATE OR REPLACE VIEW public.mastery_derivation_gaps AS$/,/^\);$/' "$MIG_PATH" \
                   | grep -v 'occurred_at  <= ral.applied_at')"
BOUND_LINES="$(awk '/^CREATE OR REPLACE VIEW public.mastery_derivation_gaps AS$/,/^\);$/' "$MIG_PATH" \
               | grep -c 'occurred_at  <= ral.applied_at')"
if [ "$BOUND_LINES" != "2" ]; then
  fail N6 "found $BOUND_LINES time-bound line(s) in the migration's view block, expected 2 (one per branch).
       Either a branch lost its bound or the text changed and this case is no longer stripping what it thinks."
  SCOPE_ONLY=""
else
  SCOPE_ONLY="$(psql -tAq -d gap_noise_ci <<SQL 2>&1
BEGIN;
$SCOPE_ONLY_VIEW
SELECT count(*) FROM public.mastery_derivation_gaps;
ROLLBACK;
SQL
)"
  SCOPE_ONLY="$(printf '%s' "$SCOPE_ONLY" | grep -E '^[0-9]+$' | tail -1)"
fi
if [ "$BOUND_LINES" = "2" ]; then
  if [ -z "$SCOPE_ONLY" ]; then
    fail N6 "the scope-only counterfactual did not return a count — it errored rather than reporting"
  elif [ "$SCOPE_ONLY" != "0" ]; then
    fail N6 "a scope-only exclusion still reports $SCOPE_ONLY gap(s). The time bound is then doing nothing,
       and either this case or the migration's occurred_at <= applied_at clause is wrong."
  else
    pass N6 "scope-only hides the genuine gap (0); the shipped view keeps it (1). The bound is load-bearing"
  fi
fi

# The rollback must have restored the shipped definition — prove it rather than
# assume, or every case after this one would be measuring the counterfactual.
RESTORED="$(gaps gap_noise_ci)"
if [ "$RESTORED" != "1" ]; then
  fail N6 "after ROLLBACK the view reports $RESTORED gap(s), expected 1 — the counterfactual leaked"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "GAP-DETECTOR NOISE GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "GAP-DETECTOR NOISE GATE: PASS"
