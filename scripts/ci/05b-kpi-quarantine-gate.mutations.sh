#!/usr/bin/env bash
# ============================================================================
# Mutation harness for scripts/ci/05b-kpi-quarantine-gate.sh
# ============================================================================
# Each mutation patches the MIGRATION, re-runs the gate, and requires the gate to go RED
# on a NAMED assertion — not merely to fail. A mutation that reds an earlier assertion than
# the one it targets proves less than it claims, so the expected FAIL substring is declared
# per mutation and checked.
#
# RULE 1 — APPLIED. A mutation whose target text is not found is STALE: a hard failure, never
# a pass. Prettier, a rename or a refactor silently detaching a mutation is the failure mode
# this rule exists for.
# RULE 2 — NAMED RED. The gate must fail AND its output must contain the declared substring.
# RULE 3 — GREEN BASELINE + RESTORE. The gate must be green before any mutation and green
# again after every restore, so a pre-existing failure cannot be read as a mutation's effect.
#
# NOTE ON OUTPUT CAPTURE: gate output is captured into a variable and matched with a shell
# case, never piped to `grep -q`. `grep -q` exits at the first match and closes the pipe;
# the producer then dies on SIGPIPE before flushing, which has previously produced a
# "did not fire" report against a mechanism that fires correctly.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260901010000_kpi_quarantine_excluded_count.sql"
GATE="$ROOT/scripts/ci/05b-kpi-quarantine-gate.sh"
BACKUP="$(mktemp /tmp/kpi-mut.XXXX.sql)"
PASS=0; FAIL=0

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "KPI QUARANTINE MUTATIONS: SKIPPED — no Postgres at $PGHOST:$PGPORT. A skip, not a pass."
  exit 0
fi

cp "$MIG" "$BACKUP"
restore() { cp "$BACKUP" "$MIG"; }
trap 'restore; rm -f "$BACKUP"' EXIT

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

run_gate() { bash "$GATE" 2>&1; }

# apply_mutation <name> <python-old> <python-new>
apply_mutation() {
  python3 - "$MIG" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times (expected exactly 1)\n" % n)
    sys.exit(9)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(run_gate)"; RC=$?
case "$OUT" in
  *"05B KPI QUARANTINE GATE: PASS"*) [ "$RC" = 0 ] && ok "baseline green" || bad "baseline printed PASS but exited $RC" ;;
  *) bad "baseline is not green — every mutation below would be unreadable"; echo "$OUT" | tail -6 | sed 's/^/        /' ;;
esac

# ---------------------------------------------------------------------------
# M1 — restore the RAISE in refresh_overall_kpi.
#      The event must fail to commit. Reds on the mastery write, not on a KPI number.
# ---------------------------------------------------------------------------
echo "=== M1: restore the RAISE in refresh_overall_kpi ==="
restore
apply_mutation M1 \
'  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;

  WITH all_events AS (' \
'  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION '"'"'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student % (refresh_overall_kpi)'"'"', v_bad_count, p_student_id;
  END IF;

  WITH all_events AS ('
MRC=$?
if [ "$MRC" = 9 ]; then bad "M1 STALE — target text not found exactly once"; else
  OUT="$(run_gate)"; RC=$?
  case "$OUT" in
    *"FAIL: apply_mastery_event did not commit"*) ok "M1 reds on the mastery write (the outage returns)" ;;
    *"05B KPI QUARANTINE GATE: PASS"*)            bad "M1 left the gate GREEN — the commit assertion cannot fail" ;;
    *) bad "M1 red, but on the wrong assertion:"; echo "$OUT" | grep -E "FAIL" | head -2 | sed 's/^/        /' ;;
  esac
fi

# ---------------------------------------------------------------------------
# M2 — compute the count but do not persist it.
#      Reds on the column, with the event still committing.
# ---------------------------------------------------------------------------
echo "=== M2: refresh_overall_kpi computes v_bad_count but persists 0 ==="
restore
apply_mutation M2 \
'    '"'"'v1.0'"'"', now(), p_t_now,
    v_bad_count
  FROM aggregates a CROSS JOIN streak s' \
'    '"'"'v1.0'"'"', now(), p_t_now,
    0
  FROM aggregates a CROSS JOIN streak s'
MRC=$?
if [ "$MRC" = 9 ]; then bad "M2 STALE — target text not found exactly once"; else
  OUT="$(run_gate)"; RC=$?
  case "$OUT" in
    *"FAIL: excluded_event_count (overall|section M) = 0|0"*)
        case "$OUT" in
          *"OK apply_mastery_event committed"*) ok "M2 reds on the column, event still commits (count computed, not written)" ;;
          *)                                    bad "M2 reds on the column but the event did not commit — wrong cause" ;;
        esac ;;
    *"05B KPI QUARANTINE GATE: PASS"*) bad "M2 left the gate GREEN — the count is never asserted as PERSISTED" ;;
    *) bad "M2 red, but on the wrong assertion:"; echo "$OUT" | grep -E "FAIL" | head -2 | sed 's/^/        /' ;;
  esac
fi

# ---------------------------------------------------------------------------
# M3 — THE ONE THAT MATTERS. Remove the CTE filter, keep the count.
#      Without this, "counted" and "excluded" are indistinguishable.
# ---------------------------------------------------------------------------
echo "=== M3: refresh_overall_kpi counts the bad rows but stops excluding them ==="
restore
apply_mutation M3 \
'    -- The quarantine itself. Excluded rows enter NO aggregate below.
    WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL
  ),
  aggregates AS (
    SELECT
      COUNT(*) AS evt_total,' \
'  ),
  aggregates AS (
    SELECT
      COUNT(*) AS evt_total,'
MRC=$?
if [ "$MRC" = 9 ]; then bad "M3 STALE — target text not found exactly once"; else
  OUT="$(run_gate)"; RC=$?
  case "$OUT" in
    *"FAIL: overall (events_total|sections_active) = 2|2"*)
        case "$OUT" in
          *"OK overall counts the RW exclusion (1)"*)
              ok "M3 reds on the AGGREGATE while the COUNT still passes — counted != excluded, proven" ;;
          *)  bad "M3 reds on the aggregate but the count assertion also moved — the two are entangled" ;;
        esac ;;
    *"05B KPI QUARANTINE GATE: PASS"*) bad "M3 left the gate GREEN — excluded rows are never proven excluded" ;;
    *) bad "M3 red, but on the wrong assertion:"; echo "$OUT" | grep -E "FAIL" | head -2 | sed 's/^/        /' ;;
  esac
fi

echo "=== (4) GREEN RESTORED ==="
restore
OUT="$(run_gate)"; RC=$?
case "$OUT" in
  *"05B KPI QUARANTINE GATE: PASS"*) ok "green restored after all mutations" ;;
  *) bad "gate is NOT green after restore — the harness left the tree dirty"; echo "$OUT" | tail -6 | sed 's/^/        /' ;;
esac

echo
echo "KPI QUARANTINE MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
