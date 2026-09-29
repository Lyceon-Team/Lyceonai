-- ---------------------------------------------------------------------------
-- Brief 14 Step 5 — the two practice-test notifications.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05F_V1.0 §8.1 (full-length placement), §12.5 (the daily job pattern),
--        §7.8 `calendar_job_runs`, §18 (job outcomes), §13 (progress is the allocator over
--        engine events, never the launch table);
--        contracts/notifications.contract.md §1.1 (adding a type is a CHECK change plus a
--        §2.3 row), §2.2 (emit inside the mutating SQL function), §5.1/§5.2 (deterministic
--        id, replay no-op), §8.1 (payload = identifiers and rendering parameters only);
--        owner ruling 2026-09-26 ("two event types, not one with a kind in the payload")]
-- @implemented 2026-09-27
--
-- plain English: a student with a practice test in their plan is told twice — once on the
-- Monday of the week it falls in, once the day before. Expected outcome: exactly two
-- notifications per exam block, in the student's own dates, and none at all once the sitting
-- is done. Trade-offs and edge cases are set out under each object below.
--
-- TWO EVENT TYPES, NOT ONE WITH A KIND IN THE PAYLOAD (owner ruling 2026-09-26). The two
-- messages say different things, are read at different moments, and — decisively — the event
-- id is `notification_event_id(event_type, source_id)`, so the type being part of the hash is
-- what makes ONE block yield TWO independent, independently-replayable notifications. A single
-- type with `{"kind": ...}` in the payload would derive one id per block, and the second
-- notification would be swallowed by the ON CONFLICT that makes the first idempotent. That is
-- the plant recorded in the PR.
--
-- WHY A DAILY CRON AND A PREDICATE, NOT A WEEKLY ONE. Same reason as §12.5's weekly job: a
-- cron fires in one timezone and the students are in all of them. The schedule wakes the job;
-- `calendar_exam_notification_candidates` decides who is actually due, in each student's own
-- zone. A student in Auckland and one in Los Angeles each get their Monday notice on their
-- own Monday.
--
-- NOTHING HERE IS A SECOND NOTIFICATION SYSTEM (Brief 14 Step 5, first sentence). The bell,
-- the feed, the unread count, the dispatcher, the retention sweep and the Resend transport all
-- exist and are unchanged. This migration adds two event types and the job that emits them.
--
-- IDEMPOTENT: every CHECK is dropped-if-exists and re-added; every function is CREATE OR
-- REPLACE with its body restated in full. Safe on live data — widening a CHECK cannot fail on
-- rows that already satisfy the narrower one, and no row is written by this migration.
--
-- NOT APPLIED BY THIS SESSION — Karl applies all SQL.
--
-- rollback:
--   DROP FUNCTION IF EXISTS public.calendar_emit_exam_notification(uuid, uuid, text, date, text);
--   DROP FUNCTION IF EXISTS public.calendar_exam_notification_candidates(integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.calendar_full_length_complete(uuid, date, text);
--   ALTER TABLE public.calendar_job_runs DROP CONSTRAINT IF EXISTS calendar_job_runs_job_check;
--   ALTER TABLE public.calendar_job_runs ADD CONSTRAINT calendar_job_runs_job_check
--     CHECK (job IN ('weekly_regen'));
--   ALTER TABLE public.calendar_job_runs DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
--   ALTER TABLE public.calendar_job_runs ADD CONSTRAINT calendar_job_runs_outcome_check
--     CHECK (outcome IN ('ok','skipped_fresh','skipped_custom','skipped_no_entitlement','failed'));
--   ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
--   ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_type_check
--     CHECK (event_type IN ('guardian_linked', 'guardian_unlinked'));
--   -- (the last two fail while rows of the dropped values exist; delete those rows first —
--   --  notification_events rows cascade to their messages.)
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two event types (contract §1.1: a CHECK change plus a §2.3 row)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (event_type IN ('guardian_linked',
                        'guardian_unlinked',
                        'full_length_week',
                        'full_length_tomorrow'));

-- ---------------------------------------------------------------------------
-- 2. The job, and its two new outcomes (§7.8, §18)
--
-- `exam_notify` joins `weekly_regen`. The two new outcomes are the two reasons this job
-- passes a due block over, and they are RECORDED rather than filtered: §12.5's own doctrine
-- is that a student the job skipped silently is a student nobody can explain afterwards.
--
--   skipped_complete   the sitting is already done — the rule "nothing if the block is
--                      already complete", observed rather than assumed
--   skipped_duplicate  this (block, kind) was already notified; the emit was a no-op
--
-- `period_key` is a date, so the week notice keys on its Monday and the day-before notice on
-- the exam's own date. No uniqueness on (student, period): reruns are safe and recorded, as
-- for the weekly job.
-- ---------------------------------------------------------------------------
ALTER TABLE public.calendar_job_runs
  DROP CONSTRAINT IF EXISTS calendar_job_runs_job_check;
ALTER TABLE public.calendar_job_runs
  ADD CONSTRAINT calendar_job_runs_job_check
  CHECK (job IN ('weekly_regen', 'exam_notify'));

ALTER TABLE public.calendar_job_runs
  DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
ALTER TABLE public.calendar_job_runs
  ADD CONSTRAINT calendar_job_runs_outcome_check
  CHECK (outcome IN ('ok',
                     'skipped_fresh',
                     'skipped_custom',
                     'skipped_no_entitlement',
                     'skipped_complete',
                     'skipped_duplicate',
                     'failed'));

-- ---------------------------------------------------------------------------
-- 3. calendar_full_length_complete — THE one derivation of "the sitting is done"
--
-- Doc 05F §13: progress is the allocator over ENGINE EVENTS, never over
-- `calendar_block_launches` (that table's own comment says so). So completion is not "a
-- launch exists" — a student can open an exam and walk away — it is what Doc 04A calls a
-- terminal, ran-to-the-end sitting: `test_sessions.state = 'completed'`, dated by
-- `completed_at`, inside the block's OWN local day.
--
-- This is a line-for-line agreement with the full-length adapter's `activityUnits`
-- (`server/services/calendar/adapters/full-length.ts`): same table, same state, same
-- half-open local-day window. The adapter serves the read model and cannot be called from a
-- SQL job, which is why the rule is stated once here in SQL and once there in TypeScript and
-- both are pinned — see `scripts/ci/calendar-schema-gates.sql`. An abandoned or
-- partially-scored sitting is NOT complete, for the same reason a skipped item is not a unit
-- in the other two engines: the unit is the work, not the attempt at it.
--
-- ONE CALL SITE, and deliberately so: `calendar_emit_exam_notification` below. The candidate
-- function does NOT check completeness, so there is exactly one place that can answer this
-- question and it sits at the chokepoint every write passes through.
--
-- The window is half-open `[start, end)`, so no instant belongs to two local days. The
-- timezone is the PLAN DATE's own (`calendar_plan_dates.timezone`), not the profile's current
-- one: that is the zone the day was planned in, and it is the zone
-- `calendar_build_plan_input` buckets activity by. A student who moves zone does not
-- retroactively change when their Saturday was.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_full_length_complete(
  p_student_id uuid,
  p_local_date date,
  p_timezone   text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.test_sessions s
    WHERE s.student_id = p_student_id
      AND s.state = 'completed'
      AND s.completed_at >= (p_local_date::timestamp AT TIME ZONE p_timezone)
      AND s.completed_at <  ((p_local_date + 1)::timestamp AT TIME ZONE p_timezone)
  );
$$;

COMMENT ON FUNCTION public.calendar_full_length_complete(uuid, date, text) IS
  'Doc 05F §13: the ONE derivation of "this full-length block''s sitting is done" — a test_sessions row in state=completed whose completed_at falls in the block''s own local day. Never derived from calendar_block_launches (§7.7: launches are for Resume, never for progress).';

-- ---------------------------------------------------------------------------
-- 4. calendar_exam_notification_candidates — the predicate, in one place
--
-- "For each student with an accepted current plan and active entitlement: one row per
-- full_length block that is due a notice today, in that student's own zone."
--
--   full_length_week      today IS a Monday for the student, and the block falls in the
--                         local ISO week that starts today. period_key = that Monday.
--   full_length_tomorrow  the block's local date is tomorrow for the student.
--                         period_key = the block's own date.
--
-- date_trunc('week') is Monday-anchored in Postgres, which is R-08-30 exactly. A student
-- whose exam IS on the Monday gets both notices, one on the day and one the day before — that
-- is not a duplicate, it is two different facts ("this week" and "tomorrow"), and the two
-- event types keep them independent.
--
-- IT RETURNS THE OUTCOME, NOT JUST THE CANDIDATES, exactly as `calendar_weekly_candidates`
-- does: `skipped_no_entitlement` is a value `calendar_job_runs.outcome` enumerates, so the
-- job records the skip instead of filtering it away. outcome IS NULL means "notify".
-- Entitlement is a POPULATION question and lives here; completeness is a WRITE-TIME question
-- and lives in the emitter, so it has one derivation and one call site.
--
-- WHO IS NOT IN THE POPULATION AT ALL. A student with no accepted plan, or no full_length
-- block in it, has nothing to be notified about and no outcome value that would describe
-- them; they are absent rather than recorded. `calendar_current_plan` is the accepted-version
-- view, so a rejected or superseded plan can never produce a notice.
--
-- `calendar_current_plan` is `security_invoker = true`, so it is read through the CALLER's
-- RLS. This function is SECURITY DEFINER and reads it as the definer, which is what lets the
-- job see every student; `authenticated` is granted nothing on it (§7.12), below.
--
-- p_limit bounds one invocation, and the ordering is stable so a rerun covers the same rows
-- in the same order.
--
-- WHY `p_now` IS A PARAMETER. Unlike §12.5's week truncation, the week notice turns on an
-- EQUALITY — "today IS a Monday for this student" — and the day-before notice on another one.
-- A predicate of that shape is untestable against a wall clock: it would be green on one day
-- in seven and unexercised on the other six, which is the "fails green" pattern this vertical
-- has already produced four times. The job never passes it, so production has exactly one
-- clock; the gate passes a fixed instant and asserts that the defaulted call and an explicit
-- `now()` call agree, so the default cannot drift away from the thing it defaults to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_exam_notification_candidates(
  p_limit integer     DEFAULT 500,
  p_now   timestamptz DEFAULT now()
) RETURNS TABLE (
  student_id uuid,
  block_id   uuid,
  local_date date,
  timezone   text,
  kind       text,
  period_key date,
  outcome    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH exams AS (
    SELECT cp.student_id,
           cp.block_id,
           cp.scheduled_date AS local_date,
           cp.timezone,
           -- "Today" and "tomorrow" for THIS student: the plan date's own zone, the same zone
           -- the day was planned in and the same one the completeness window uses.
           (p_now AT TIME ZONE cp.timezone)::date AS today_local
    FROM public.calendar_current_plan cp
    JOIN public.calendar_blocks b
      ON b.block_id = cp.block_id AND b.student_id = cp.student_id
    WHERE b.block_type = 'full_length'
  ),
  due AS (
    SELECT e.student_id, e.block_id, e.local_date, e.timezone,
           'full_length_week'::text AS kind,
           date_trunc('week', e.today_local)::date AS period_key
    FROM exams e
    WHERE EXTRACT(DOW FROM e.today_local)::integer = 1
      AND e.local_date >= e.today_local
      AND e.local_date <  e.today_local + 7
    UNION ALL
    SELECT e.student_id, e.block_id, e.local_date, e.timezone,
           'full_length_tomorrow'::text AS kind,
           e.local_date AS period_key
    FROM exams e
    WHERE e.local_date = e.today_local + 1
  )
  SELECT d.student_id, d.block_id, d.local_date, d.timezone, d.kind, d.period_key,
         CASE WHEN NOT public.entitlement_active(d.student_id)
              THEN 'skipped_no_entitlement'
              ELSE NULL
         END AS outcome
  FROM due d
  ORDER BY d.student_id, d.local_date, d.kind
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.calendar_exam_notification_candidates(integer, timestamptz) IS
  'Brief 14 Step 5: one row per (full_length block, notice kind) due today in the student''s own zone — full_length_week on their local Monday for that week''s exams, full_length_tomorrow the day before. outcome NULL means notify; skipped_no_entitlement is the calendar_job_runs CHECK verbatim so every considered row gets a job row. Completeness is NOT decided here (see calendar_emit_exam_notification). p_now exists so the two date EQUALITIES are testable on any day of the week; the job never passes it.';

-- ---------------------------------------------------------------------------
-- 5. calendar_emit_exam_notification — the writer, and the chokepoint
--
-- Contract §2.2: the emit lives inside the SQL function that performs the mutation, in one
-- transaction. There is no domain row to mutate here — the notification IS the mutation —
-- so this function is that function.
--
-- It returns what happened, because the job records it: 'emitted' | 'skipped_complete' |
-- 'duplicate'. Returning void would make both skips indistinguishable from a write in
-- `calendar_job_runs`, which is the one thing §18's outcomes exist to prevent.
--
-- FAIL CLOSED ON COMPLETENESS, HERE AND NOWHERE ELSE. Any caller — the job, a backfill, a
-- console session — passes through this check, so "nothing if the block is already complete"
-- is a property of the write path rather than of one job's loop.
--
-- IDEMPOTENT PER (block, kind), and that is `notification_event_id`'s doing: the event type
-- is part of the hash input (contract §5.1), so the two kinds for one block are two ids, and
-- a replay of either is an ON CONFLICT DO NOTHING inside `emit_notification_event`
-- (contract §5.2). The EXISTS below is not what provides idempotency — the conflict clause
-- is — it is what lets this function tell the job that nothing was written. The two cannot
-- disagree: both read the same event row.
--
-- RECIPIENT AND CHANNELS (contract §2.3 row). The student only. A practice test is the work,
-- and Doc 01 §38.1 gives a guardian aggregates, not the student's nudges. The day-before
-- notice goes in_app AND email because it is time-critical and a bell nobody opens is not a
-- notification; the week-ahead notice is in_app only, because §12.2 says minimise contact on
-- a minor's surface and the student will see the week when they open the calendar. This is
-- the one judgement in Step 5 the brief did not rule on, and it is one jsonb array here plus
-- one contract row if the owner wants it the other way.
--
-- PAYLOAD (contract §8.1): the block id and the local date, which is the rendering parameter
-- the template needs to say "on Saturday the 17th". No form id — that names a specific exam
-- paper and would be content about the assessment in a persisted, recipient-readable row.
-- Nothing else: `.strict()` on the TypeScript payload schema refuses any addition at render
-- time as well.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_emit_exam_notification(
  p_student_id uuid,
  p_block_id   uuid,
  p_kind       text,
  p_local_date date,
  p_timezone   text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event_id uuid;
  v_channels jsonb;
BEGIN
  IF p_kind NOT IN ('full_length_week', 'full_length_tomorrow') THEN
    RAISE EXCEPTION 'calendar_emit_exam_notification: unknown kind %', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- The rule, at the chokepoint. One call site for one derivation.
  IF public.calendar_full_length_complete(p_student_id, p_local_date, p_timezone) THEN
    RETURN 'skipped_complete';
  END IF;

  v_event_id := public.notification_event_id(p_kind, p_block_id::text);

  IF EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id = v_event_id) THEN
    RETURN 'duplicate';
  END IF;

  v_channels := CASE WHEN p_kind = 'full_length_tomorrow'
                     THEN jsonb_build_array('in_app', 'email')
                     ELSE jsonb_build_array('in_app')
                END;

  PERFORM public.emit_notification_event(
    v_event_id,
    p_kind,
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id, 'channels', v_channels)
    ),
    jsonb_build_object('block_id', p_block_id, 'local_date', p_local_date)
  );

  RETURN 'emitted';
END;
$fn$;

COMMENT ON FUNCTION public.calendar_emit_exam_notification(uuid, uuid, text, date, text) IS
  'Brief 14 Step 5 / notifications contract §2.2, §5.1, §8.1: the one write path for the two practice-test notices. Returns emitted | skipped_complete | duplicate. Idempotent per (block_id, kind) because the event type is part of notification_event_id''s hash input. Recipient is the student alone.';

-- ---------------------------------------------------------------------------
-- 6. Grants (Doc 05F §7.12 — no write RPC is reachable from a session token)
--
-- `authenticated` and `anon` get nothing on any of the three. The job runs as the service
-- role, which is the only caller.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.calendar_full_length_complete(uuid, date, text)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.calendar_exam_notification_candidates(integer, timestamptz)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.calendar_emit_exam_notification(uuid, uuid, text, date, text)
  FROM PUBLIC, authenticated, anon;

COMMIT;
