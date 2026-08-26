#!/usr/bin/env bash
# ============================================================================
# Baseline-repair gate
# ============================================================================
# Guards scripts/prod-verify/baseline-repair.sql, which exists because
# captureDiagnosticBaseline is once-only with no retry: it requires BOTH sections
# to have a non-NULL projected_score_mid and silently returns when they do not
# (practice-canonical.ts:2984-2997). During the mastery outage every projection was
# all-NULL, so capture was skipped while the session was still marked 'completed' —
# leaving a student permanently reading as no_baseline.
#
# THE PROPERTY THIS GATE IS REALLY ABOUT: the repair must be a REPAIR, not a
# fabrication. compute_section_projection emits an explicit ALL-NULL row when the
# evidence gate fails, so row COUNT can never be the predicate — and a fixture with
# only a repairable student could not tell a correct repair from
# `INSERT ... SELECT * FROM student_section_projections`. Hence three students.
#
# Cases:
#   (B1) REPAIR      repairable student gets exactly 2 rows copied from the live
#                    projection; no-evidence student gets NONE; an existing
#                    baseline is not overwritten; periodic snapshots survive
#   (B2) IDEMPOTENT  a second run inserts 0 and still reports OK
#   (B3) SKIP REPORT the no-evidence student is reported as skipped, not hidden
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

FIXTURE="$SCRIPT_DIR/baseline-repair-gate.sql"
REPAIR="$ROOT/scripts/prod-verify/baseline-repair.sql"
PREVIEW="$ROOT/scripts/prod-verify/baseline-repair-preview.sql"
DB=baseline_repair_ci
REPAIRABLE=aaaaaaaa-0000-4000-8000-000000000001

for f in "$FIXTURE" "$REPAIR" "$PREVIEW"; do
  [ -f "$f" ] || { echo "FAIL: not found ($f)"; exit 1; }
done

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() { drop_deletion_rehearsal_db "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Console mode — psql -c, exactly how the operator runs these files.
run_file() { PGOPTIONS='-c client_min_messages=notice' psql -d "$DB" -c "$(cat "$1")" 2>&1; }
q() { psql -tAq -d "$DB" -c "$1" 2>/dev/null; }
baseline_rows() {
  q "SELECT count(*) FROM public.student_section_projection_snapshots
      WHERE snapshot_kind = 'diagnostic_baseline';"
}
skipped_count() {
  q "SELECT count(*) FROM public.profiles p
      WHERE EXISTS (SELECT 1 FROM public.practice_sessions ps
                     WHERE ps.user_id = p.id AND ps.mode='diagnostic'
                       AND ps.status='completed')
        AND NOT EXISTS (SELECT 1 FROM public.student_section_projection_snapshots sn
                         WHERE sn.student_id = p.id
                           AND sn.snapshot_kind='diagnostic_baseline');"
}

echo "==> provisioning"
if ! setup_genesis_db "$DB"; then
  echo "FAIL: could not provision $DB"
  exit 1
fi
psql -v ON_ERROR_STOP=1 -d "$DB" -q -v seed=1 -f "$FIXTURE" >/dev/null 2>&1 \
  || { echo "FAIL: seed failed"; exit 1; }

# Preflight: the preview must see the repairable student, and only the
# has_baseline student may already hold rows. Without this a green (B1) could be a
# pre-existing state rather than the repair's work.
PREV="$(run_file "$PREVIEW")"
grep -q "$REPAIRABLE" <<<"$PREV" || fail B1 "the preview does not list the repairable student"

BEFORE="$(baseline_rows)"
[ "${BEFORE:-x}" = "2" ] || fail B1 "expected 2 pre-existing baseline rows, got '${BEFORE}'"
SKIP_BEFORE="$(skipped_count)"
[ "${SKIP_BEFORE:-x}" = "2" ] || fail B1 "expected 2 students owed a baseline before repair, got '${SKIP_BEFORE}'"

# ---------------------------------------------------------------------------
echo "==> (B1) repair writes only what it should"
OUT="$(run_file "$REPAIR")"
if ! grep -q 'OK — baseline repair complete' <<<"$OUT"; then
  fail B1 "repair did not report its OK verdict
       got: $(grep -oE '(OK|STOP) —.*' <<<"$OUT" | head -1)"
elif ! psql -v ON_ERROR_STOP=1 -d "$DB" -q -v assert_post=1 -f "$FIXTURE" >/dev/null; then
  fail B1 "post-repair assertions failed"
else
  AFTER="$(baseline_rows)"
  if [ "${AFTER:-x}" != "4" ]; then
    fail B1 "expected 4 baseline rows after repair (2 existing + 2 new), got '${AFTER}'"
  else
    pass B1 "repaired from live values; no-evidence skipped; existing baseline immutable; periodic untouched"
  fi
fi

# ---------------------------------------------------------------------------
echo "==> (B2) re-running writes nothing"
OUT2="$(run_file "$REPAIR")"
AGAIN="$(baseline_rows)"
if [ "${AGAIN:-x}" != "4" ]; then
  fail B2 "second run changed the baseline row count to '${AGAIN}' — not idempotent"
elif ! grep -q 'OK — baseline repair complete' <<<"$OUT2"; then
  fail B2 "second run did not report OK"
elif ! grep -q 'inserted 0 row' <<<"$OUT2"; then
  fail B2 "second run did not report inserting 0 rows — it may have re-written existing baselines"
else
  pass B2 "second run inserts 0 and still reports OK"
fi

# ---------------------------------------------------------------------------
echo "==> (B3) the no-evidence student is reported as skipped, not hidden"
SKIP_AFTER="$(skipped_count)"
if [ "${SKIP_AFTER:-x}" != "1" ]; then
  fail B3 "expected exactly 1 student still owed a baseline (projection NULL), got '${SKIP_AFTER}'"
elif ! grep -qE 'skipped_no_evidence' <<<"$(cat "$REPAIR")"; then
  fail B3 "the repair file does not report skipped_no_evidence — a student we owe something to would be invisible"
else
  pass B3 "1 student correctly left in the skipped set and reported"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "BASELINE REPAIR GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "BASELINE REPAIR GATE: PASS"
