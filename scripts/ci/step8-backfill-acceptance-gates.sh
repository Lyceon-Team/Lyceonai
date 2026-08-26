#!/usr/bin/env bash
# ============================================================================
# Step 8 backfill-acceptance gate
# ============================================================================
# Proves scripts/prod-verify/step8-verify.sql asserts the RIGHT signal.
#
# The file it guards previously reported STOP on a completely successful
# production backfill, because it asserted student_projection_refresh_state > 0.
# That table is the event-time throttle counter: backfill_recompute_student calls
# recompute_skill_mastery with p_chain_downstream := false, so
# bump_projection_refresh_counter never fires and the table is correctly EMPTY
# after a backfill. Same for mastery_event_audit_log, whose only writer is
# apply_mastery_event.
#
# A comment saying so is not enough — the next person to see two empty tables
# will "fix" it back. So this gate runs a REAL backfill against a real database
# and asserts the structural claim directly.
#
# Cases:
#   (G1) ABOVE THE GATE   a student with >= mastery_min_events() events in all
#                         EIGHT canonical (section, domain) pairs. Runs the real
#                         backfill, then the REAL step8-verify.sql in console
#                         mode, and requires its OK verdict.
#   (G2) STRUCTURAL       after that same backfill, the two event-time tables are
#                         empty and the backfill_recompute provenance stamp is
#                         present. This is the claim the verdict rests on.
#   (G3) BELOW THE GATE   the same student with only the 4 M-section domains. The
#                         Q4 gate spans both sections, so projected_score_mid must
#                         be NULL and step8-verify.sql must STOP — even though
#                         skill/domain/projection row counts are all non-zero.
#                         This is what proves the acceptance test is the mid and
#                         not the row counts.
#   (G4) EVENT-TIME NOISE a single event-time row makes the verdict STOP, so the
#                         "must be empty" assertions are real and not decorative.
#
# (G3) is the load-bearing negative. compute_section_projection emits an explicit
# ALL-NULL projection row when the gate fails, so every count-based assertion
# still passes there — a verdict built on counts alone would report OK on a
# student with no usable projection.
#
# Connection via standard PG* env. The shared lib refuses non-ephemeral hosts.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

FIXTURE="$SCRIPT_DIR/step8-backfill-acceptance-gates.sql"
VERIFY="$ROOT/scripts/prod-verify/step8-verify.sql"
OK_VERDICT='OK — backfill rebuilt mastery end to end; 3f18cbe2 projects in both sections'

[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found ($FIXTURE)"; exit 1; }
[ -f "$VERIFY" ]  || { echo "FAIL: verifier not found ($VERIFY)"; exit 1; }

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in step8_above step8_below; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Run the REAL prod-verify file the way the operator does: psql -c, which does
# not process meta-commands. Using the shipped file rather than a re-typed
# predicate means this cannot pass while the shipped file is wrong.
run_verify() { psql -tAq -F'|' -d "$1" -c "$(cat "$VERIFY")" 2>&1; }

# ---------------------------------------------------------------------------
# (G1) + (G2) above the gate
# ---------------------------------------------------------------------------
echo "==> (G1) above the Q4 gate — backfill must produce non-NULL projections"
if ! setup_genesis_db step8_above; then
  fail G1 "could not provision DB"
else
  psql -v ON_ERROR_STOP=1 -d step8_above -q -v seed_above_gate=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail G1 "seed failed"

  # Before the backfill there is no mastery at all — so a green (G1) cannot be a
  # pre-existing state. The verifier must STOP here.
  BEFORE="$(run_verify step8_above)"
  if grep -qF "$OK_VERDICT" <<<"$BEFORE"; then
    fail G1 "step8-verify reported OK BEFORE the backfill ran — it is not measuring the backfill"
  fi

  if ! psql -v ON_ERROR_STOP=1 -d step8_above -q -v run_backfill=1 -f "$FIXTURE" >/dev/null 2>&1; then
    fail G1 "backfill_recompute_student failed"
  else
    AFTER="$(run_verify step8_above)"
    if ! grep -qF "$OK_VERDICT" <<<"$AFTER"; then
      fail G1 "step8-verify did not report OK after a successful backfill
       got: $(head -2 <<<"$AFTER")"
    else
      pass G1 "STOP before the backfill, OK after — projections non-NULL in both sections"
    fi
  fi

  echo "==> (G2) structural — a backfill writes no event-time rows"
  if ! psql -v ON_ERROR_STOP=1 -d step8_above -q -v assert_event_time_empty=1 -f "$FIXTURE" >/dev/null; then
    fail G2 "the event-time-empty claim step8-verify rests on does NOT hold"
  else
    pass G2 "refresh_state and event audit both empty; backfill_recompute stamp present"
  fi

  # -------------------------------------------------------------------------
  # (G4) the "must be empty" assertions are load-bearing, not decorative
  # -------------------------------------------------------------------------
  echo "==> (G4) a single event-time row must flip the verdict to STOP"
  psql -q -d step8_above -c "
    INSERT INTO public.student_projection_refresh_state (student_id, events_since_refresh)
    VALUES ('3f18cbe2-0000-4000-8000-000000000001'::uuid, 1)
    ON CONFLICT DO NOTHING;" >/dev/null 2>&1
  NOISY="$(run_verify step8_above)"
  if grep -qF "$OK_VERDICT" <<<"$NOISY"; then
    fail G4 "verdict still OK with a student_projection_refresh_state row present — the emptiness assertion is decorative"
  elif ! grep -qF 'student_projection_refresh_state is non-empty' <<<"$NOISY"; then
    fail G4 "verdict STOPped but not on the event-time branch
       got: $(head -2 <<<"$NOISY")"
  else
    pass G4 "one event-time row flips OK -> STOP on the correct branch"
  fi
fi

# ---------------------------------------------------------------------------
# (G3) below the gate — the load-bearing negative
# ---------------------------------------------------------------------------
echo "==> (G3) below the Q4 gate — counts non-zero but projected_score_mid NULL"
if ! setup_genesis_db step8_below; then
  fail G3 "could not provision DB"
else
  psql -v ON_ERROR_STOP=1 -d step8_below -q -v seed_below_gate=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail G3 "seed failed"
  psql -v ON_ERROR_STOP=1 -d step8_below -q -v run_backfill=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail G3 "backfill failed"

  OUT="$(run_verify step8_below)"

  # The point of this case: every count-based signal is healthy here.
  SKILL="$(psql -tAq -d step8_below -c 'SELECT count(*) FROM public.student_skill_mastery;' 2>/dev/null)"
  PROJ="$(psql -tAq -d step8_below -c 'SELECT count(*) FROM public.student_section_projections;' 2>/dev/null)"
  MID="$(psql -tAq -d step8_below -c "SELECT count(*) FROM public.student_section_projections WHERE projected_score_mid IS NOT NULL;" 2>/dev/null)"

  if [ "${SKILL:-0}" = "0" ] || [ "${PROJ:-0}" = "0" ]; then
    fail G3 "fixture is wrong: expected non-zero skill ($SKILL) and projection ($PROJ) rows below the gate, so the negative isolates the mid"
  elif [ "${MID:-x}" != "0" ]; then
    fail G3 "expected every projected_score_mid to be NULL below the Q4 gate, found $MID non-NULL"
  elif grep -qF "$OK_VERDICT" <<<"$OUT"; then
    fail G3 "step8-verify reported OK with NULL projections — the acceptance test is measuring row counts, not the projection"
  elif ! grep -qF 'NULL projected_score_mid' <<<"$OUT"; then
    fail G3 "STOPped but not on the projection branch
       got: $(head -2 <<<"$OUT")"
  else
    pass G3 "counts healthy (skill=$SKILL, projections=$PROJ) yet mid is NULL and the verdict STOPs on it"
  fi
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "STEP8 BACKFILL ACCEPTANCE GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "STEP8 BACKFILL ACCEPTANCE GATE: PASS"
