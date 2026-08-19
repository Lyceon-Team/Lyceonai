#!/usr/bin/env bash
# ============================================================================
# Session-lifecycle database gate — steps 2, 1, 8 and 9
# ============================================================================
# Guards the four migrations added by the session-lifecycle workstream:
#   20260817000000  practice_sessions_one_completed_diagnostic_uq   (step 2)
#   20260817010000  student_diagnostic_states / student_diagnostic_state()  (step 1)
#   20260817020000  abandoned_at + practice_sessions_abandoned_not_completed (step 9)
#   20260817030000  student_baseline_pending                        (step 8)
#
# Cases, and the mutation each one exists to catch:
#
#  S2-A  a second COMPLETED diagnostic raises 23505
#        MUTATION: drop `AND status = 'completed'` from the index predicate.
#        Student B's abandoned diagnostic then collides with a completed one and
#        the seed itself fails — the fixture is built so a widened predicate
#        cannot pass quietly.
#  S2-B  abandoned and in-flight diagnostics do NOT collide with a completed one
#  S2-C  the migration REFUSES to apply over pre-existing duplicates, naming them
#
#  S1-A  all seven students resolve to the expected state
#        MUTATION: replace count(DISTINCT section) FILTER (mid IS NOT NULL) with
#        count(*) — student E (two ALL-NULL baseline rows) flips to baseline_ready.
#  S1-B  completed outranks in-flight for a student holding both
#        MUTATION: swap the two CASE arms — student G flips to in_progress, which
#        is the answer resolveDiagnosticStartDecision does NOT give.
#  S1-C  the function answers for a student the view has no row for
#
#  S8-A  student_baseline_pending lists exactly the pending students, with an age
#
#  S9-A  the backfill moves the misplaced timestamp instead of inventing one
#        MUTATION: delete the UPDATE — the ALTER TABLE ... ADD CONSTRAINT in the
#        same file then fails, so repair and seal cannot ship apart.
#  S9-B  the constraint rejects both halves of BUG-4 (completed_at on an abandoned
#        row; an abandoned row with no abandoned_at)
#  S9-C  the constraint did NOT exist before its migration — proves S9-B is
#        testing the migration and not something genesis already provided
#
#  S10-A the sweep predicate leaves diagnostics and fresh sessions alone
#        (SQL-level proof of the same predicate the TypeScript sweep issues; the
#        TypeScript path itself is proven in tests/ci/stale-session-sweep.test.ts)
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

FIXTURE="$SCRIPT_DIR/session-lifecycle-db-gate.sql"
[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found ($FIXTURE)"; exit 1; }

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in slc_state_ci slc_legacy_ci slc_dup_ci; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

q() { psql -tAq -d "$1" -c "$2" 2>/dev/null; }
# Returns the SQLSTATE of a failing statement, or 'OK' when it succeeds.
# VERBOSITY=verbose is what makes psql print the five-character code at all; the
# default terse output carries only the message text, so asserting on a code
# without it silently degrades into asserting on English.
sqlstate() {
  local out
  out="$(psql -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$1" -c "$2" 2>&1)" && { echo OK; return; }
  # sed with a capture, not two greps: 'ERROR' is itself five uppercase
  # characters, so a bare [0-9A-Z]{5} match returns the word ERROR every time and
  # every SQLSTATE assertion in this file silently compares against that instead.
  sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' <<<"$out" | head -1 \
    | grep -qE '.' && sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' <<<"$out" | head -1 \
    || { echo "$out" | head -2 | tr '\n' ' '; }
}

A=aaaa1111-0000-4000-8000-000000000001
B=aaaa1111-0000-4000-8000-000000000002
C=aaaa1111-0000-4000-8000-000000000003
D=aaaa1111-0000-4000-8000-000000000004
E=aaaa1111-0000-4000-8000-000000000005
F=aaaa1111-0000-4000-8000-000000000006
G=aaaa1111-0000-4000-8000-000000000007

# ---------------------------------------------------------------------------
echo "==> provisioning (all migrations)"
setup_genesis_db slc_state_ci || { echo "FAIL: could not provision"; exit 1; }
psql -v ON_ERROR_STOP=1 -d slc_state_ci -q -v seed=1 -f "$FIXTURE" >/dev/null \
  || { echo "FAIL: seed failed (a widened index predicate makes the fixture itself unwritable — that is S2-A firing early)"; exit 1; }

# ---------------------------------------------------------------------------
echo "==> (S1) state derivation"
declare -A EXPECTED=(
  ["$A"]=not_taken
  ["$B"]=not_taken
  ["$C"]=in_progress
  ["$D"]=baseline_pending
  ["$E"]=baseline_pending
  ["$F"]=baseline_ready
  ["$G"]=baseline_pending
)
S1A_OK=1
for sid in "${!EXPECTED[@]}"; do
  got="$(q slc_state_ci "SELECT public.student_diagnostic_state('$sid'::uuid);")"
  if [ "$got" != "${EXPECTED[$sid]}" ]; then
    fail S1-A "student ${sid:0:13}… resolved to '$got', expected '${EXPECTED[$sid]}'"
    S1A_OK=0
  fi
done
[ "$S1A_OK" = 1 ] && pass S1-A "all seven students resolve correctly (incl. E: two ALL-NULL baseline rows are NOT a baseline)"

if [ "$(q slc_state_ci "SELECT state FROM public.student_diagnostic_states WHERE student_id='$G'::uuid;")" != "baseline_pending" ]; then
  fail S1-B "a student holding BOTH a completed and an active diagnostic did not resolve completed-first"
else
  pass S1-B "completed outranks in-flight — matches resolveDiagnosticStartDecision"
fi

if [ "$(q slc_state_ci "SELECT count(*) FROM public.student_diagnostic_states WHERE student_id='$A'::uuid;")" != "0" ]; then
  fail S1-C "the view has a row for a student with no diagnostic session; the fixture premise is wrong"
elif [ "$(q slc_state_ci "SELECT public.student_diagnostic_state('$A'::uuid);")" != "not_taken" ]; then
  fail S1-C "the function did not answer not_taken for a student the view has no row for"
else
  pass S1-C "function answers for a student with no row — callers never interpret an absent row"
fi

# ---------------------------------------------------------------------------
echo "==> (S8) baseline_pending staleness surface"
PENDING="$(q slc_state_ci "SELECT string_agg(student_id::text, ',' ORDER BY student_id) FROM public.student_baseline_pending;")"
EXPECT_PENDING="$D,$E,$G"
AGE_OK="$(q slc_state_ci "SELECT count(*) FROM public.student_baseline_pending WHERE pending_seconds IS NULL OR pending_seconds <= 0;")"
if [ "$PENDING" != "$EXPECT_PENDING" ]; then
  fail S8-A "pending set is '$PENDING', expected '$EXPECT_PENDING'"
elif [ "$AGE_OK" != "0" ]; then
  fail S8-A "$AGE_OK pending row(s) have a null or non-positive age"
else
  pass S8-A "lists exactly the pending students, each with a positive age"
fi

# ---------------------------------------------------------------------------
echo "==> (S2) one completed diagnostic per student"
# Runs AFTER S8: the two inserts below legitimately create new completed
# diagnostics, which changes who is baseline_pending. Ordering, not coincidence.
ACTOR_F="$(q slc_state_ci "SELECT actor_id FROM public.profiles WHERE id='$F'::uuid;")"
STATE="$(sqlstate slc_state_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id, completed_at) VALUES ('$F'::uuid,'diagnostic',40,'web','completed','$ACTOR_F'::uuid, now());")"
if [ "$STATE" != "23505" ]; then
  fail S2-A "a second completed diagnostic was accepted (SQLSTATE '$STATE', expected 23505)"
else
  pass S2-A "second completed diagnostic rejected with 23505"
fi

ACTOR_B="$(q slc_state_ci "SELECT actor_id FROM public.profiles WHERE id='$B'::uuid;")"
S2B="$(sqlstate slc_state_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id, completed_at) VALUES ('$B'::uuid,'diagnostic',40,'web','completed','$ACTOR_B'::uuid, now());")"
S2B2="$(sqlstate slc_state_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id) VALUES ('$G'::uuid,'diagnostic',40,'web','active',(SELECT actor_id FROM public.profiles WHERE id='$G'::uuid));")"
if [ "$S2B" != "OK" ]; then
  fail S2-B "a student whose only other diagnostic is ABANDONED could not complete one ('$S2B') — ruling Q1 says abandonment does not spend the diagnostic"
elif [ "$S2B2" != "OK" ]; then
  fail S2-B "an in-flight diagnostic collided with a completed one ('$S2B2') — the index is too wide"
else
  pass S2-B "abandoned and in-flight diagnostics do not collide with a completed one"
fi

# ---------------------------------------------------------------------------
echo "==> (S2-C) the index migration refuses to apply over existing duplicates"
setup_genesis_db slc_dup_ci 20260817000000_diagnostic_once_only_index.sql \
  || { echo "FAIL: could not provision the pre-index DB"; exit 1; }
psql -v ON_ERROR_STOP=1 -d slc_dup_ci -q -v seed_two_completed=1 -f "$FIXTURE" >/dev/null \
  || { echo "FAIL: duplicate seed failed"; exit 1; }
DUP_OUT="$(apply_migration slc_dup_ci 20260817000000_diagnostic_once_only_index.sql 2>&1)"
if grep -q 'DIAGNOSTIC_ONCE_ONLY' <<<"$DUP_OUT"; then
  if grep -q 'resolve-duplicate-diagnostic.sql' <<<"$DUP_OUT"; then
    pass S2-C "refuses, names the offending student, and points at the resolution file"
  else
    fail S2-C "refused, but the message does not say what to do about it"
  fi
elif grep -qE '23505|duplicate key' <<<"$DUP_OUT"; then
  fail S2-C "the index build failed with a raw duplicate-key error — the preamble did not run first, so the operator gets a key instead of a student id"
else
  fail S2-C "the migration applied over a database holding two completed diagnostics for one student"
fi

# ---------------------------------------------------------------------------
echo "==> (S9) abandoned_at — repair, then seal"
setup_genesis_db slc_legacy_ci 20260817020000_practice_session_abandoned_at.sql \
  || { echo "FAIL: could not provision the pre-migration DB"; exit 1; }
psql -v ON_ERROR_STOP=1 -d slc_legacy_ci -q -v seed_legacy_abandoned=1 -f "$FIXTURE" >/dev/null \
  || { echo "FAIL: legacy seed failed"; exit 1; }

PRE_CONSTRAINT="$(q slc_legacy_ci "SELECT count(*) FROM pg_constraint WHERE conname='practice_sessions_abandoned_not_completed';")"
if [ "$PRE_CONSTRAINT" != "0" ]; then
  fail S9-C "the constraint already existed before its migration — S9-B would prove nothing"
else
  pass S9-C "the defect row is writable before the migration; the constraint is what closes it"
fi

if ! apply_migration slc_legacy_ci 20260817020000_practice_session_abandoned_at.sql >/dev/null 2>&1; then
  fail S9-A "the migration failed to apply over a database holding the defect it repairs"
else
  # row 1: completed_at was 12:00; abandoned_at must BE that instant, not now()
  R1="$(q slc_legacy_ci "SELECT (completed_at IS NULL) || '/' || to_char(abandoned_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') FROM public.practice_sessions WHERE client_instance_id IS NULL AND status='abandoned' AND last_activity_at='2026-08-01 11:30:00Z';")"
  # row 2: no completed_at ever; abandoned_at must come from last_activity_at
  R2="$(q slc_legacy_ci "SELECT (completed_at IS NULL) || '/' || to_char(abandoned_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') FROM public.practice_sessions WHERE status='abandoned' AND last_activity_at='2026-08-02 09:15:00Z';")"
  if [ "$R1" != "true/2026-08-01 12:00" ]; then
    fail S9-A "row with a misplaced completed_at repaired to '$R1', expected 'true/2026-08-01 12:00'"
  elif [ "$R2" != "true/2026-08-02 09:15" ]; then
    fail S9-A "row with no completed_at repaired to '$R2', expected 'true/2026-08-02 09:15' (from last_activity_at)"
  else
    pass S9-A "the misplaced timestamp is moved, not invented; a row with none falls back to last_activity_at"
  fi
fi

ACTOR_H="$(q slc_legacy_ci "SELECT actor_id FROM public.profiles WHERE id='bbbb2222-0000-4000-8000-000000000008'::uuid;")"
BAD1="$(sqlstate slc_legacy_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id, completed_at, abandoned_at) VALUES ('bbbb2222-0000-4000-8000-000000000008'::uuid,'balanced',10,'web','abandoned','$ACTOR_H'::uuid, now(), now());")"
BAD2="$(sqlstate slc_legacy_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id) VALUES ('bbbb2222-0000-4000-8000-000000000008'::uuid,'balanced',10,'web','abandoned','$ACTOR_H'::uuid);")"
GOOD="$(sqlstate slc_legacy_ci "INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, status, actor_id, abandoned_at) VALUES ('bbbb2222-0000-4000-8000-000000000008'::uuid,'balanced',10,'web','abandoned','$ACTOR_H'::uuid, now());")"
if [ "$BAD1" != "23514" ]; then
  fail S9-B "an abandoned row carrying completed_at was accepted ('$BAD1') — BUG-4 is not sealed"
elif [ "$BAD2" != "23514" ]; then
  fail S9-B "an abandoned row with no abandoned_at was accepted ('$BAD2')"
elif [ "$GOOD" != "OK" ]; then
  fail S9-B "the correct shape (abandoned + abandoned_at, no completed_at) was rejected ('$GOOD')"
else
  pass S9-B "both halves of BUG-4 rejected; the correct shape accepted"
fi

# ---------------------------------------------------------------------------
echo "==> (S10) sweep predicate leaves diagnostics and fresh sessions alone"
psql -v ON_ERROR_STOP=1 -d slc_state_ci -q -v seed_stale=1 -f "$FIXTURE" >/dev/null 2>&1 \
  || { fail S10-A "stale fixture failed to seed"; }
psql -q -d slc_state_ci -c "
  UPDATE public.practice_sessions
     SET status='abandoned', abandoned_at=now(), completed_at=NULL, updated_at=now()
   WHERE status IN ('created','active')
     AND mode <> 'diagnostic'
     AND last_activity_at < now() - interval '7 days';" >/dev/null 2>&1
SWEPT="$(q slc_state_ci "SELECT string_agg(client_instance_id || ':' || status, ' ' ORDER BY client_instance_id) FROM public.practice_sessions WHERE client_instance_id LIKE 'stale-%' OR client_instance_id LIKE 'fresh-%';")"
EXPECT_SWEPT="fresh-practice:active stale-created:abandoned stale-diagnostic:active stale-practice:abandoned"
if [ "$SWEPT" != "$EXPECT_SWEPT" ]; then
  fail S10-A "post-sweep states are '$SWEPT', expected '$EXPECT_SWEPT'"
else
  pass S10-A "idle practice swept; idle DIAGNOSTIC untouched; fresh practice untouched"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "SESSION-LIFECYCLE DB GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "SESSION-LIFECYCLE DB GATE: PASS"
