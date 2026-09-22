#!/usr/bin/env bash
# ============================================================================
# Doc 05F calendar — concurrency gate (INV-08-17)
# ============================================================================
# calendar_persist_version allocates version_no as MAX+1. That is only safe
# because the RPC takes FOR UPDATE on the student's study-profile row first, so
# two regenerations for one student serialise instead of racing to the same
# number. A single-session SQL script cannot prove that: the lock is invisible
# unless somebody else is holding it.
#
# So this runs REAL concurrent sessions and asserts the outcome twice:
#
#   C-1  N concurrent calls with N DISTINCT idempotency keys produce exactly N
#        versions numbered 1..N — no duplicate, no gap, no error. Without the
#        FOR UPDATE this is where a duplicate-key violation or a lost version
#        shows up.
#   C-2  N concurrent calls with ONE SHARED key produce exactly ONE version
#        (INV-08-09). The ledger is checked under the same lock, so the losers
#        return the stored response rather than writing.
#   C-4  A MOVE and the WEEKLY job fired together serialise on the same profile
#        lock -- two contiguous versions, no error, whichever wins the race.
#
# Connection via standard PG* env. Usage:
#   bash scripts/ci/calendar-concurrency-gate.sh
#
# @spec [Doc-05F_V1.0 §12.3 version allocation (INV-08-17), §7.8 idempotency
#        (INV-08-09)]
# ============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${PGDATABASE:-calendar_parity}"
N="${CALENDAR_CONCURRENCY_N:-8}"
S='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

q() { psql -v ON_ERROR_STOP=1 -d "$DB" -tAX "$@"; }

# profiles.id -> auth.users is ON DELETE RESTRICT, so auth.users must go LAST.
# Everything calendar-side cascades from profiles. This gate COMMITS (it has to:
# the sessions are real and concurrent), so leaving rows behind would make any
# later gate that counts rows depend on the order the gates ran in.
# This gate COMMITS -- it has to, because the sessions are real and concurrent --
# so it must put the database back exactly as it found it. Anything left behind
# is a booby trap for whichever gate runs next.
#
# Order matters twice over: profiles.id -> auth.users is ON DELETE RESTRICT, so
# auth.users goes last; and student_domain_mastery does NOT cascade from
# profiles, so it has to be named explicitly rather than assumed away.
cleanup() {
  q -c "DELETE FROM public.calendar_mutation_ledger  WHERE student_id = '$S';
        DELETE FROM public.student_domain_mastery    WHERE student_id = '$S';
        DELETE FROM public.student_study_profile     WHERE student_id = '$S';
        DELETE FROM public.profiles                  WHERE id         = '$S';
        DELETE FROM auth.users                       WHERE id         = '$S';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> fixture"
cleanup
q >/dev/null <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('$S', 'concurrency@example.test', '{}'::jsonb);
INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('$S', 'America/Chicago', 62, 60, 6, 1400, now());
INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
VALUES ('$S', 'M', 'Algebra', 0, 0, 0, 10, 'h'),
       ('$S', 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');
SQL

# ---------------------------------------------------------------------------
# C-1 — N concurrent regenerations, N distinct keys.
# ---------------------------------------------------------------------------
echo "==> C-1: $N concurrent calls, distinct idempotency keys"
fail=0
pids=()
for i in $(seq 1 "$N"); do
  key=$(printf '00000000-0000-0000-0000-%012d' "$i")
  q -c "SELECT public.calendar_persist_version('$S','weekly','system','v1','$key');" \
    >"/tmp/_cal_c1_$i.out" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || fail=1; done

if [ "$fail" -ne 0 ]; then
  echo "FAIL C-1: at least one concurrent call errored"
  grep -h -iE 'error' /tmp/_cal_c1_*.out | head -5
  exit 1
fi

read -r versions distinct minv maxv <<<"$(q -c "
  SELECT count(*), count(DISTINCT version_no), min(version_no), max(version_no)
  FROM public.calendar_plan_versions WHERE student_id = '$S';" | tr '|' ' ')"

if [ "$versions" != "$N" ] || [ "$distinct" != "$N" ] || [ "$minv" != "1" ] || [ "$maxv" != "$N" ]; then
  echo "FAIL C-1: expected $N versions numbered 1..$N; got count=$versions distinct=$distinct min=$minv max=$maxv"
  exit 1
fi
echo "    OK C-1 $N concurrent calls produced $N versions numbered 1..$N — no duplicate, no gap"

# ---------------------------------------------------------------------------
# C-2 — N concurrent regenerations, ONE shared key.
# ---------------------------------------------------------------------------
echo "==> C-2: $N concurrent calls, one shared idempotency key"
before="$versions"
pids=()
for i in $(seq 1 "$N"); do
  q -c "SELECT public.calendar_persist_version('$S','weekly','system','v1','dddddddd-dddd-dddd-dddd-dddddddddddd');" \
    >"/tmp/_cal_c2_$i.out" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || fail=1; done

if [ "$fail" -ne 0 ]; then
  echo "FAIL C-2: at least one concurrent call errored"
  grep -h -iE 'error' /tmp/_cal_c2_*.out | head -5
  exit 1
fi

after="$(q -c "SELECT count(*) FROM public.calendar_plan_versions WHERE student_id = '$S';")"
ledger="$(q -c "SELECT count(*) FROM public.calendar_mutation_ledger WHERE student_id = '$S' AND idempotency_key = 'dddddddd-dddd-dddd-dddd-dddddddddddd';")"
distinct_responses="$(sort -u /tmp/_cal_c2_*.out | grep -c . || true)"

if [ "$after" != "$((before + 1))" ]; then
  echo "FAIL C-2: a shared idempotency key produced $((after - before)) versions, expected exactly 1"
  exit 1
fi
if [ "$ledger" != "1" ]; then
  echo "FAIL C-2: the ledger holds $ledger rows for the shared key, expected 1"
  exit 1
fi
if [ "$distinct_responses" != "1" ]; then
  echo "FAIL C-2: the $N callers did not all get the same response ($distinct_responses distinct)"
  sort -u /tmp/_cal_c2_*.out | head -3
  exit 1
fi
echo "    OK C-2 $N concurrent calls on one key produced 1 version, 1 ledger row, and 1 identical response"

# ---------------------------------------------------------------------------
# C-3 — N concurrent launches of ONE block, N distinct engine_session_ids.
#
# This is the case the (engine, engine_session_id) replay does NOT cover, so
# sequence allocation is the only thing keeping the callers apart.
# launch_sequence is COALESCE(max, 0) + 1 over calendar_block_launches, and the
# applied 20260917130000 body held nothing while computing it: every caller read
# the same max and the losers died on calendar_block_launches_pkey with a raw
# 23505 -- a 500 on a student pressing Start twice. 20260917140000 replaces the
# function with FOR UPDATE on the block row.
#
# Measured on the unlocked body, three runs of N=8: 1, 3 and 2 collisions. A race
# does not lose every time, which is exactly why this is a gate and not a comment.
# ---------------------------------------------------------------------------
echo "==> C-3: $N concurrent launches of one block, distinct engine sessions"
q -c "SELECT public.calendar_persist_version('$S','setup','student','v1');" >/tmp/_cal_c3_seed.out 2>&1 || { echo "  C-3 seed failed:"; cat /tmp/_cal_c3_seed.out; exit 1; }
BLOCK="$(q -c "SELECT block_id FROM public.calendar_blocks
               WHERE student_id = '$S' AND block_type = 'practice'
               ORDER BY scheduled_date, block_id LIMIT 1;")"
if [ -z "$BLOCK" ]; then
  echo "FAIL C-3: the fixture produced no practice block to launch"
  exit 1
fi

pids=()
for i in $(seq 1 "$N"); do
  sid="$(printf 'dddddddd-0000-4000-8000-%012d' "$i")"
  q -c "SELECT public.calendar_link_launch('$S','$BLOCK','practice','$sid');" \
    >"/tmp/_cal_c3_$i.out" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done

# Count errors, not successes: the 23505 DETAIL line contains the words
# launch_sequence, so grepping for success matches the failure too.
# `grep -l` exits 1 when it matches nothing, and under `set -e` with pipefail
# that kills the gate on the PASSING case. `|| true` keeps zero errors meaning
# zero errors rather than a silent exit.
errs="$({ grep -lE '^ERROR:' /tmp/_cal_c3_*.out 2>/dev/null || true; } | wc -l | tr -d ' ')"
read -r rows distinct <<<"$(q -c "
  SELECT count(*), count(DISTINCT launch_sequence)
  FROM public.calendar_block_launches WHERE block_id = '$BLOCK';" | tr '|' ' ')"

if [ "$errs" != "0" ] || [ "$rows" != "$N" ] || [ "$distinct" != "$N" ]; then
  echo "FAIL C-3: $errs errored, $rows row(s), $distinct distinct sequence(s) — expected 0/$N/$N"
  grep -hoE 'ERROR:.*' /tmp/_cal_c3_*.out 2>/dev/null | sort -u | head -3
  rm -f /tmp/_cal_c3_*.out
  exit 1
fi
echo "    OK C-3 $N concurrent launches produced $N rows with $N distinct sequences — no collision"

rm -f /tmp/_cal_c3_*.out

# ---------------------------------------------------------------- C-4
# A MOVE and the WEEKLY job, fired at the same instant for one student.
#
# Both writers take FOR UPDATE on the same study-profile row before they read
# the ledger or allocate a version, so they must serialise. If either one
# skipped the lock the two would allocate the same version_no and one would
# lose to calendar_plan_versions' unique constraint -- or worse, both would
# succeed and the student would have two versions claiming the same number.
#
# The ORDER is deliberately not asserted. Which one wins the lock is a race and
# either outcome is correct; what must hold is that exactly two versions exist,
# numbered contiguously, with no error from either session.
echo "==> C-4: a move and a weekly run, fired concurrently"
q -c "SELECT public.calendar_persist_version('$S','setup','student','v1');" >/dev/null

MOVE_BLOCK="$(q -c "
  SELECT cp.block_id FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = '$S'
    AND cp.scheduled_date > (now() AT TIME ZONE 'America/Chicago')::date
    AND b.block_type = 'practice'
  ORDER BY cp.scheduled_date, cp.display_ordinal LIMIT 1;")"
if [ -z "$MOVE_BLOCK" ]; then
  echo "FAIL C-4: no future practice block to move, so the test would prove nothing"
  exit 1
fi
MOVE_TO="$(q -c "SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 5)::text;")"
BEFORE="$(q -c "SELECT count(*) FROM public.calendar_plan_versions WHERE student_id = '$S';")"

q -c "SELECT public.calendar_move_block('$S','$MOVE_BLOCK','$MOVE_TO','v1','cccccccc-0000-4000-8000-000000000001');" \
  >/tmp/_cal_c4_move.out 2>&1 &
mpid=$!
q -c "SELECT public.calendar_persist_version('$S','weekly','system','v1');" \
  >/tmp/_cal_c4_weekly.out 2>&1 &
wpid=$!
wait "$mpid" || true
wait "$wpid" || true

c4errs="$({ grep -lE '^ERROR:' /tmp/_cal_c4_*.out 2>/dev/null || true; } | wc -l | tr -d ' ')"
read -r total contiguous <<<"$(q -c "
  SELECT count(*), (count(*) = max(version_no) - min(version_no) + 1)::int
  FROM public.calendar_plan_versions WHERE student_id = '$S';" | tr '|' ' ')"
expected=$((BEFORE + 2))

if [ "$c4errs" != "0" ] || [ "$total" != "$expected" ] || [ "$contiguous" != "1" ]; then
  echo "FAIL C-4: $c4errs errored, $total version(s) (expected $expected), contiguous=$contiguous"
  grep -hoE 'ERROR:.*' /tmp/_cal_c4_*.out 2>/dev/null | sort -u | head -3
  rm -f /tmp/_cal_c4_*.out
  exit 1
fi
echo "    OK C-4 a concurrent move and weekly run serialised into $total contiguous versions"

rm -f /tmp/_cal_c4_*.out
rm -f /tmp/_cal_c1_*.out /tmp/_cal_c2_*.out
# Prove the cleanup worked rather than trusting it: a leftover row here is a
# booby trap for the next gate.
cleanup
left="$(q -c "SELECT (SELECT count(*) FROM public.calendar_plan_versions WHERE student_id = '$S')
                            + (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = '$S')
                            + (SELECT count(*) FROM public.student_study_profile  WHERE student_id = '$S')
                            + (SELECT count(*) FROM public.profiles               WHERE id         = '$S');")"
if [ "$left" != "0" ]; then
  echo "FAIL: cleanup left $left row(s) behind for $S"
  exit 1
fi
echo "    OK cleanup left nothing behind"
echo "OK: calendar concurrency gate"
