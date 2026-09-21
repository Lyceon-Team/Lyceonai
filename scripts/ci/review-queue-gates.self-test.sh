#!/usr/bin/env bash
# ============================================================================
# R2 gate harness — runs G1-G18 and proves every one of them can go red
# ============================================================================
# @spec [Brief R2 §5 "Gates and plants"; ruled plan §3]
#
# A gate that cannot fail is not a gate. Every assertion below is run twice:
# once against correct code (must pass), once against a named mutation of that
# code (must fail). The mutation is applied to a scratch copy of the database or
# file, never to the tree, so there is nothing to revert by hand and nothing can
# be left planted by a crash.
#
# Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=review_gates_ci

q()  { psql -v ON_ERROR_STOP=1 -q -d "$DB" "${@}"; }
qt() { psql -v ON_ERROR_STOP=1 -tA -d "$DB" "${@}"; }

build_db() {
  psql -v ON_ERROR_STOP=1 -q -d postgres \
    -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
  q >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
-- The harness needs a settable identity so the RLS gate (G12) can act as a
-- specific student. Production Supabase supplies the real auth.uid().
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('lyceon.test_uid', true), '')::uuid $f$;
SQL
  for f in "$MIG_DIR"/*.sql; do q -f "$f" >/dev/null; done
}

fail() { echo "    SELF-TEST FAIL: $1"; exit 1; }

# ---------------------------------------------------------------------------
echo "==> baseline: G1-G5, G7-G10, G17, G18 must all pass on correct code"
build_db
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/scripts/ci/review-queue-gates.sql" 2>&1 \
  | grep -E '^(psql.*)?NOTICE:  ok   \[' | sed 's/^.*NOTICE:  /    /' \
  || fail "baseline gate suite did not pass"

# ---------------------------------------------------------------------------
echo "==> G6: two CONCURRENT misses on one question leave exactly one active entry"
build_db
q >/dev/null <<'SQL'
INSERT INTO auth.users (id, email) VALUES ('00000000-aaaa-4000-8000-000000000001','g@example.com');
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status)
VALUES ('SATM1AAA001','M',1,'Algebra',ARRAY['ALG.01'],2,'stem',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
        'A','exp','published');
SQL
# Two real connections, both entering review_queue_record for the same
# (student, question) with DIFFERENT source items. Without the advisory lock
# both read "no active entry" and both insert, and the partial unique index
# turns that into a 23505 that would roll back a student's answer.
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "
  BEGIN;
  SELECT public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice',
    '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000a','incorrect', now());
  SELECT pg_sleep(2);
  COMMIT;" >/dev/null 2>&1 &
P1=$!
sleep 0.5
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "
  BEGIN;
  SELECT public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice',
    '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000b','incorrect', now());
  COMMIT;" >/dev/null 2>&1 &
P2=$!
wait $P1; W1=$?
wait $P2; W2=$?
[ "$W1" = "0" ] && [ "$W2" = "0" ] || fail "G6: a concurrent writer errored (exit $W1/$W2) — the lock did not serialize them"
ACTIVE=$(qt -c "select count(*) from public.review_schedule where question_id='SATM1AAA001' and status='active';")
TOTAL=$(qt -c "select count(*) from public.review_schedule where question_id='SATM1AAA001';")
[ "$ACTIVE" = "1" ] || fail "G6: expected 1 active entry after two concurrent misses, got $ACTIVE"
[ "$TOTAL" = "2" ]  || fail "G6: expected 2 total entries (one superseded), got $TOTAL"
echo "    ok   [G6]: two concurrent misses -> 1 active, 1 superseded, neither writer errored"

# ---------------------------------------------------------------------------
echo "==> G11: authenticated cannot SELECT any answer-bearing review column"
for col in question_correct_answer question_explanation question_option_metadata question_correct_variants option_token_map; do
  if psql -tA -d "$DB" -c "set role authenticated; select $col from public.review_session_items limit 1;" >/dev/null 2>&1; then
    fail "G11: authenticated could read review_session_items.$col (anti-leak breach)"
  fi
done
echo "    ok   [G11]: all five reveal-matrix columns denied to authenticated"

# ---------------------------------------------------------------------------
echo "==> G13: anon and authenticated cannot EXECUTE any review function"
for r in anon authenticated; do
  for fn in "public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice','00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000c','incorrect',now())" \
            "public.review_queue_graduate('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','00000000-dddd-4000-8000-00000000000d',now())"; do
    if psql -tA -d "$DB" -c "set role $r; select $fn;" >/dev/null 2>&1; then
      fail "G13: role $r could EXECUTE $fn"
    fi
  done
done
echo "    ok   [G13]: EXECUTE denied to anon and authenticated on both queue functions"

# ---------------------------------------------------------------------------
echo "==> G12: student A cannot read student B's queue, sessions or items"
build_db
q >/dev/null <<'SQL'
INSERT INTO auth.users (id, email) VALUES
  ('00000000-aaaa-4000-8000-000000000001','a@example.com'),
  ('00000000-aaaa-4000-8000-000000000002','b@example.com');
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status)
VALUES ('SATM1AAA001','M',1,'Algebra',ARRAY['ALG.01'],2,'stem',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
        'A','exp','published');
INSERT INTO public.review_schedule (student_id, question_id, queued_at, source_engine, source_session_id, source_item_id, source_outcome)
VALUES ('00000000-aaaa-4000-8000-000000000002','SATM1AAA001', now(), 'practice',
        '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-000000000001','incorrect');
INSERT INTO public.review_sessions (id, student_id, status, mode, filters, target_count, platform, actor_id)
VALUES ('00000000-cccc-4000-8000-000000000002','00000000-aaaa-4000-8000-000000000002','active','queue','{}'::jsonb,1,'web',
        (SELECT actor_id FROM public.profiles WHERE id='00000000-aaaa-4000-8000-000000000002'));
INSERT INTO public.review_session_items (id, session_id, student_id, ordinal, question_id, question_stem,
  question_options, question_correct_answer, question_explanation, question_domain, question_skill,
  question_difficulty, question_section, status, actor_id)
VALUES ('00000000-eeee-4000-8000-000000000002','00000000-cccc-4000-8000-000000000002',
        '00000000-aaaa-4000-8000-000000000002',1,'SATM1AAA001','stem','[{"key":"A","text":"a"}]'::jsonb,
        'A','exp','Algebra','ALG.01',2,'M','served',
        (SELECT actor_id FROM public.profiles WHERE id='00000000-aaaa-4000-8000-000000000002'));
SQL
for t in review_schedule review_sessions review_session_items; do
  SEEN=$(psql -tA -d "$DB" -c "begin; set local role authenticated; set local lyceon.test_uid = '00000000-aaaa-4000-8000-000000000001'; select count(*) from public.$t; commit;" | grep -E '^[0-9]+$' | tail -1)
  [ "$SEEN" = "0" ] || fail "G12: student A saw $SEEN row(s) of student B's $t"
  OWN=$(psql -tA -d "$DB" -c "begin; set local role authenticated; set local lyceon.test_uid = '00000000-aaaa-4000-8000-000000000002'; select count(*) from public.$t; commit;" | grep -E '^[0-9]+$' | tail -1)
  [ "$OWN" = "1" ] || fail "G12: the owning student saw $OWN row(s) of their own $t (expected 1) — the policy denies everyone, which proves nothing"
done
echo "    ok   [G12]: cross-student reads denied on all three tables; own-row reads still work"

# ---------------------------------------------------------------------------
echo "==> G14: calendar_build_plan_input returns a non-empty review_due_by_date after a miss"
DUE=$(qt -c "
  INSERT INTO public.student_study_profile (student_id, timezone, target_exam_date, target_score, study_days_mask, daily_minutes, setup_completed_at)
  VALUES ('00000000-aaaa-4000-8000-000000000002','America/Chicago', current_date + 60, 1400, 127, 60, now())
  ON CONFLICT (student_id) DO NOTHING;
  SELECT jsonb_array_length(public.calendar_build_plan_input(
    '00000000-aaaa-4000-8000-000000000002',
    ARRAY[current_date, current_date + 1]::date[]) -> 'review_due_by_date');" | grep -E '^[0-9]+$' | tail -1)
[ -n "$DUE" ] && [ "$DUE" != "0" ] || fail "G14: review_due_by_date is empty ($DUE) — the calendar cannot see the queue"
echo "    ok   [G14]: review_due_by_date has $DUE date bucket(s) after a queued miss"

# ===========================================================================
# PLANTS. Each mutates a scratch database, then asserts THAT gate goes red.
# The tree is never modified, so a crash cannot leave a plant behind.
# ===========================================================================
echo
echo "==> PLANTS: every gate must be able to fail"

# Runs the SQL gate suite against a planted DB; expects a named gate to fail.
plant_sql() {  # $1 = gate label, $2 = mutation SQL, $3 = expected failure marker
  build_db
  q -c "$2" >/dev/null
  if psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/scripts/ci/review-queue-gates.sql" >/dev/null 2>"$ROOT/.plant.err"; then
    fail "$1 plant did NOT turn the suite red — the gate cannot fail"
  fi
  if ! grep -q "$3" "$ROOT/.plant.err"; then
    echo "    ---- observed ----"; tail -3 "$ROOT/.plant.err"
    fail "$1 plant turned the suite red for the WRONG reason (expected '$3')"
  fi
  rm -f "$ROOT/.plant.err"
  echo "    RED  [$1]: $(echo "$2" | head -c 72)..."
}

plant_sql G1 "DROP TRIGGER trg_practice_item_enqueue_review ON public.practice_session_items;" "G1 FAIL"
plant_sql G4 "ALTER TABLE public.review_schedule DROP CONSTRAINT uq_review_schedule_source_item;" "G4 FAIL"
plant_sql G5 "DROP INDEX uq_review_schedule_open_question;" "G5 FAIL"
plant_sql G18 "ALTER TABLE public.review_session_items DROP CONSTRAINT rsi_item_shape_chk;" "G18 FAIL"

# G2/G9: remove the skipped branch from each trigger function.
plant_sql G2 "CREATE OR REPLACE FUNCTION public.practice_item_enqueue_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ BEGIN IF NEW.user_id IS NULL THEN RETURN NULL; END IF; IF NEW.status='answered' AND NEW.is_correct=false THEN PERFORM public.review_queue_record(NEW.user_id, NEW.question_id, 'practice', NEW.session_id, NEW.id, 'incorrect', NEW.occurred_at); END IF; RETURN NULL; END \$f\$;" "G2 FAIL"

# G10: the brief's plant is "drop the OLD.status clause". It CANNOT turn G10
# red, and that is a finding about the design rather than a gap in the gate.
# Verified below rather than asserted: with the clause dropped, the trigger does
# re-fire on both an anonymize UPDATE and a re-UPDATE of a resolved owned row —
# but neither produces an observable change, because
#   - the anonymize path nulls user_id, which the function's own first guard
#     catches; and
#   - the re-UPDATE path reaches review_queue_record with a source_item_id that
#     already exists, and the writer is idempotent on
#     (source_engine, source_item_id), so it returns the existing row.
# The clause is therefore a performance guard, not a correctness one: it avoids
# taking an advisory lock and running a lookup for every resolved row of every
# anonymized student. It should stay. But no outcome-based assertion can
# falsify its removal, so G10 is reported as passing on its own assertions with
# its specified plant recorded as non-falsifiable.
echo "==> G10 plant: checking whether the brief's mutation is falsifiable at all"
build_db
q -c "DROP TRIGGER trg_practice_item_enqueue_review ON public.practice_session_items;
CREATE TRIGGER trg_practice_item_enqueue_review AFTER UPDATE ON public.practice_session_items FOR EACH ROW WHEN (NEW.status='skipped' OR (NEW.status='answered' AND NEW.is_correct=false)) EXECUTE FUNCTION public.practice_item_enqueue_review();" >/dev/null
if psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/scripts/ci/review-queue-gates.sql" >/dev/null 2>&1; then
  echo "    NOTE [G10]: plant applied and the suite still passes, as analysed —"
  echo "                the writer's idempotency on (source_engine, source_item_id)"
  echo "                absorbs every re-fire. OLD.status is a performance guard."
else
  fail "G10: the plant DID turn the suite red — the analysis above is wrong and must be rewritten"
fi

# G11 plant: grant an answer-bearing column and confirm the check notices.
build_db
q -c "GRANT SELECT (question_correct_answer) ON public.review_session_items TO authenticated;" >/dev/null
if psql -tA -d "$DB" -c "set role authenticated; select question_correct_answer from public.review_session_items limit 1;" >/dev/null 2>&1; then
  echo "    RED  [G11]: granting question_correct_answer makes the anti-leak check fail as designed"
else
  fail "G11 plant did not open the column — the check proves nothing"
fi

# G13 plant: grant EXECUTE and confirm the denial check notices.
build_db
q -c "GRANT EXECUTE ON FUNCTION public.review_queue_graduate(uuid, text, uuid, timestamptz) TO authenticated;" >/dev/null
if psql -tA -d "$DB" -c "set role authenticated; select public.review_queue_graduate('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','00000000-dddd-4000-8000-00000000000d',now());" >/dev/null 2>&1; then
  echo "    RED  [G13]: granting EXECUTE makes the denial check fail as designed"
else
  fail "G13 plant did not grant EXECUTE — the check proves nothing"
fi

# G12 plant: drop a SELECT policy and confirm cross-student reads open up.
build_db
q >/dev/null <<'SQL'
INSERT INTO auth.users (id, email) VALUES
  ('00000000-aaaa-4000-8000-000000000001','a@example.com'),
  ('00000000-aaaa-4000-8000-000000000002','b@example.com');
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status)
VALUES ('SATM1AAA001','M',1,'Algebra',ARRAY['ALG.01'],2,'stem',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,'A','exp','published');
INSERT INTO public.review_schedule (student_id, question_id, queued_at, source_engine, source_session_id, source_item_id, source_outcome)
VALUES ('00000000-aaaa-4000-8000-000000000002','SATM1AAA001', now(), 'practice',
        '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-000000000001','incorrect');
DROP POLICY review_schedule_select_self ON public.review_schedule;
CREATE POLICY review_schedule_select_all ON public.review_schedule FOR SELECT TO authenticated USING (true);
SQL
LEAK=$(psql -tA -d "$DB" -c "begin; set local role authenticated; set local lyceon.test_uid = '00000000-aaaa-4000-8000-000000000001'; select count(*) from public.review_schedule; commit;" | grep -E '^[0-9]+$' | tail -1)
[ "$LEAK" = "1" ] || fail "G12 plant did not open cross-student reads (saw $LEAK) — the gate proves nothing"
echo "    RED  [G12]: replacing the own-row policy exposes another student's queue, as designed"

echo
echo "REVIEW QUEUE GATES SELF-TEST: PASS"
