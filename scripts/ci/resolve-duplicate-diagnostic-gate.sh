#!/usr/bin/env bash
# ============================================================================
# resolve-duplicate-diagnostic gate
# ============================================================================
# Guards scripts/prod-verify/resolve-duplicate-diagnostic.sql — a one-off,
# exact-target write against a single pinned production row (owner ruling Q8).
#
# The fixture seeds THREE diagnostic sessions, and the third is the point: a
# SECOND student's in-progress diagnostic. The named mutation for this step is
# "widen the predicate to WHERE mode='diagnostic' AND status='active'", and with
# only the target student's two rows that widened predicate abandons exactly the
# same single row — the fixture could not distinguish the pinned target from its
# superset. Student B's session is in the superset and is not the target.
#
# Cases:
#   (D1) EXACT TARGET  the pinned row is abandoned, WITHOUT completed_at; the kept
#                      completed diagnostic is untouched; the other student's
#                      active diagnostic survives; all 47 answered events preserved
#   (D2) IDEMPOTENT    a second run REFUSES (the target is no longer 'active')
#                      rather than silently doing nothing or widening its reach
#   (D3) PREMISE GUARD with no completed diagnostic for the owner, the file refuses
#                      — abandoning the target would take away their only diagnostic
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

FIXTURE="$SCRIPT_DIR/resolve-duplicate-diagnostic-gate.sql"
RESOLVE="$ROOT/scripts/prod-verify/resolve-duplicate-diagnostic.sql"
PREVIEW="$ROOT/scripts/prod-verify/resolve-duplicate-diagnostic-preview.sql"
TARGET=18187611-6dd2-4947-a35e-935874f83096
OTHER=eeeeeeee-0000-4000-8000-00000000000c

for f in "$FIXTURE" "$RESOLVE" "$PREVIEW"; do
  [ -f "$f" ] || { echo "FAIL: not found ($f)"; exit 1; }
done

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in dup_diag_ci dup_diag_premise; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

run_file() { PGOPTIONS='-c client_min_messages=notice' psql -d "$1" -c "$(cat "$2")" 2>&1; }
st() { psql -tAq -d "$1" -c "SELECT status FROM public.practice_sessions WHERE id='$2';" 2>/dev/null; }

# ---------------------------------------------------------------------------
echo "==> (D1) exact-target write"
if ! setup_genesis_db dup_diag_ci; then
  echo "FAIL: could not provision"; exit 1
fi
psql -v ON_ERROR_STOP=1 -d dup_diag_ci -q -v seed=1 -f "$FIXTURE" >/dev/null 2>&1 \
  || { echo "FAIL: seed failed"; exit 1; }

PREV="$(run_file dup_diag_ci "$PREVIEW")"
grep -q 'ABANDON — the surplus' <<<"$PREV" || fail D1 "the preview does not mark the target for abandonment"
grep -q 'KEEP — the baseline' <<<"$PREV"   || fail D1 "the preview does not mark the kept session"

[ "$(st dup_diag_ci "$TARGET")" = "active" ] || fail D1 "fixture wrong: target is not active before the run"
[ "$(st dup_diag_ci "$OTHER")" = "active" ]  || fail D1 "fixture wrong: the other student's diagnostic is not active"

OUT="$(run_file dup_diag_ci "$RESOLVE")"
if ! grep -q 'OK — duplicate diagnostic resolved' <<<"$OUT"; then
  fail D1 "resolve did not report its OK verdict
       got: $(grep -oE '(OK|STOP) —.*' <<<"$OUT" | head -1)
       $(head -3 <<<"$OUT")"
elif ! psql -v ON_ERROR_STOP=1 -d dup_diag_ci -q -v assert_post=1 -f "$FIXTURE" >/dev/null; then
  fail D1 "post-resolve assertions failed"
else
  pass D1 "target abandoned with no completed_at; kept intact; other student untouched; 47 events preserved"
fi

# ---------------------------------------------------------------------------
echo "==> (D2) a second run refuses rather than widening its reach"
OUT2="$(run_file dup_diag_ci "$RESOLVE")"
if ! grep -qE "expected ''active''|has status" <<<"$OUT2"; then
  fail D2 "second run did not refuse on the status premise
       got: $(head -3 <<<"$OUT2")"
elif [ "$(st dup_diag_ci "$OTHER")" != "active" ]; then
  fail D2 "the second run modified another student's diagnostic"
else
  pass D2 "second run refuses: the target is no longer 'active'"
fi

# ---------------------------------------------------------------------------
echo "==> (D3) premise guard — no completed diagnostic for the owner"
if ! setup_genesis_db dup_diag_premise; then
  fail D3 "could not provision"
else
  psql -v ON_ERROR_STOP=1 -d dup_diag_premise -q -v seed=1 -f "$FIXTURE" >/dev/null 2>&1
  # Remove the owner's completed diagnostic, leaving only the surplus one. Now
  # abandoning the target would take away their ONLY diagnostic.
  psql -q -d dup_diag_premise -c "
    DELETE FROM public.practice_session_items
     WHERE session_id = '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff';
    DELETE FROM public.practice_sessions
     WHERE id = '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff';" >/dev/null 2>&1
  OUT3="$(run_file dup_diag_premise "$RESOLVE")"
  if ! grep -q 'holds no COMPLETED diagnostic' <<<"$OUT3"; then
    fail D3 "the file did not refuse when the owner has no completed diagnostic
       got: $(head -3 <<<"$OUT3")"
  elif [ "$(st dup_diag_premise "$TARGET")" != "active" ]; then
    fail D3 "the target was abandoned despite the premise failing — the student lost their only diagnostic"
  else
    pass D3 "refuses, and leaves the target active"
  fi
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "RESOLVE-DUPLICATE-DIAGNOSTIC GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "RESOLVE-DUPLICATE-DIAGNOSTIC GATE: PASS"
