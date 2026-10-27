-- ===========================================================================
-- The QOTD day: 04:00 UTC to 04:00 UTC, fixed (no DST logic).
--
-- @spec [owner ruling "QOTD: day boundary at 04:00 UTC, social run at 04:05 UTC" (Karl,
--       2026-10-27) items 1 and 3: "The QOTD day runs 04:00 UTC -> 04:00 UTC (fixed UTC, no DST
--       logic) everywhere the QOTD day is computed: today's question, archive and reveal
--       eligibility, the streak, the Home card, /qotd, and smart-landing 'QOTD already
--       answered'. Other Chicago-day logic (free quota, landing windows) stays as is." and
--       "Cutover: no student loses a streak because of the switch."; SCL recorded with this
--       change, amending SCL-226 (the streak's days) and plan R18 (the QOTD day)]
--       | @implemented [2026-10-27]
--
-- plain English:
--  1. `qotd_day(at)` is THE QOTD day of an instant: America/Chicago's date before the cutover,
--     `(at in UTC - 4 hours)::date` from the cutover on. A day D therefore runs from 04:00 UTC on
--     D to 04:00 UTC on D+1 (midnight in UTC-4: 11 pm the evening before in Chicago in summer,
--     10 pm in winter). `chicago_day` is unchanged and still serves the quota, the landing
--     windows and the notification rules.
--  2. The cutover is stored once, in `qotd_day_boundary`, as the Chicago midnight that follows
--     the moment this migration is applied (`qotd_day_cutover()` reads it). So the day that is
--     live when this runs keeps its full Chicago length, and the next day begins at that
--     midnight (the label is the same under both rules there, so no day is skipped or repeated)
--     and ends at 04:00 UTC. Every instant before the cutover keeps the Chicago day it always
--     had: no past answer moves to another day, so no streak changes because of the switch.
--  3. The five functions that computed the QOTD day from `chicago_day` now use `qotd_day`, with
--     their bodies otherwise copied unchanged from their last definitions:
--     `qotd_today` (today's question, the archive's past days, `qotd_record_attempt`,
--     `qotd_schedule_release`), `qotd_student_answer` (the Home answer's day), `student_answer_days`
--     and `student_streak` (the streak and "This week"), `qotd_horizon` (the ops alerts' today).
--     `student_answer_days` reads from the earliest instant day `p_since` can start under either
--     rule (04:00 UTC); a row before that day's real start is labelled the day before and never
--     counted as `p_since`.
--  4. The switch's bridge, in `student_streak` only: an answer at the same UTC time every night
--     between 04:00 UTC and the Chicago midnight moves from "the day before" to "its own date" at
--     the switch, so that habit skips exactly one label, the first 04:00 UTC day. Once that day is
--     past, it counts for the streak's run of any student who answered the day before it (a
--     one-time grace). It is never "today done" and never a ticked day in "This week".
--  Not changed: `qotd_daily_notify` (the 17:00 Chicago reminder: at 17:00 Chicago both rules give
--  the same date, so its one-event-per-student-per-day id is unchanged) and its expiry (the end of
--  the Chicago day, after the 21:00 quiet-hours start either way).
--
-- Deploy order: the server code first, then this migration. The code reads the cutover through
-- `qotd_day_cutover()`; until this migration exists it falls back to Chicago, which is exactly
-- what the database does then.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order; before the cutover instant it changes nothing anyone saw, after it
-- the days since the cutover go back to Chicago labels):
--   re-run the five function definitions from their previous homes
--     (20261020000000_qotd_schema.sql qotd_today; 20261029010000_home_qotd_streak_email.sql
--      qotd_student_answer, student_answer_days, student_streak;
--      20261030000000_qotd_resilience_alerts.sql qotd_horizon);
--   DROP FUNCTION IF EXISTS public.qotd_day(timestamptz);
--   DROP FUNCTION IF EXISTS public.qotd_day_cutover();
--   DROP TABLE IF EXISTS public.qotd_day_boundary;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The cutover, set once at apply time
-- ---------------------------------------------------------------------------
CREATE TABLE public.qotd_day_boundary (
  id         boolean     PRIMARY KEY DEFAULT true CHECK (id),
  cutover_at timestamptz NOT NULL,
  set_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qotd_day_boundary IS
  'The QOTD day switch (Karl, 2026-10-27): one row. Before cutover_at the QOTD day is the America/Chicago date; from cutover_at on it is the 04:00 UTC to 04:00 UTC day. Set once, at apply time, to the next Chicago midnight. Server-only.';

INSERT INTO public.qotd_day_boundary (id, cutover_at)
VALUES (true, ((now() AT TIME ZONE 'America/Chicago')::date + 1)::timestamp AT TIME ZONE 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.qotd_day_boundary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qotd_day_boundary FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.qotd_day_boundary TO service_role;

CREATE OR REPLACE FUNCTION public.qotd_day_cutover()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT cutover_at FROM public.qotd_day_boundary WHERE id;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. The QOTD day of an instant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_day(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN c.cutover_at IS NULL OR p_at < c.cutover_at
             THEN (p_at AT TIME ZONE 'America/Chicago')::date
           ELSE ((p_at AT TIME ZONE 'UTC') - interval '4 hours')::date
         END
    FROM (SELECT public.qotd_day_cutover() AS cutover_at) c;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Today, through the QOTD day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.qotd_day(now())
$$;

-- ---------------------------------------------------------------------------
-- 4. The Home answer's day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_student_answer(
  p_student_id      uuid,
  p_actor_id        uuid,
  p_qotd_date       date,
  p_question_id     text,
  p_item            jsonb,
  p_selected_answer text,
  p_is_correct      boolean,
  p_idempotency_key text,
  p_now             timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing public.student_qotd_attempts%ROWTYPE;
  v_session  uuid;
  v_item     uuid;
BEGIN
  IF p_qotd_date IS DISTINCT FROM public.qotd_day(p_now) THEN
    RETURN jsonb_build_object('status', 'not_today');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.qotd_schedule s
     WHERE s.qotd_date = p_qotd_date AND s.question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('status', 'not_today');
  END IF;

  -- One writer per student per day.
  PERFORM pg_advisory_xact_lock(hashtextextended('qotd_student_answer:' || p_student_id::text || ':' || p_qotd_date::text, 0));

  SELECT * INTO v_existing FROM public.student_qotd_attempts
   WHERE student_id = p_student_id AND qotd_date = p_qotd_date;
  IF FOUND THEN
    IF v_existing.idempotency_key = p_idempotency_key THEN
      RETURN jsonb_build_object(
        'status', 'replay',
        'practice_session_item_id', v_existing.practice_session_item_id,
        'selected_answer', v_existing.selected_answer,
        'is_correct', v_existing.is_correct,
        'answered_at', v_existing.answered_at
      );
    END IF;
    RETURN jsonb_build_object('status', 'conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_qotd_attempts WHERE idempotency_key = p_idempotency_key) THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  INSERT INTO public.practice_sessions
    (user_id, actor_id, mode, filters, target_count, platform, status,
     created_at, updated_at, last_activity_at, completed_at)
  VALUES
    (p_student_id, p_actor_id, 'qotd',
     jsonb_build_object('source', 'qotd', 'qotd_date', p_qotd_date,
                        'session_start_idempotency_key', p_idempotency_key),
     1, 'web', 'active', p_now, p_now, p_now, NULL)
  RETURNING id INTO v_session;

  INSERT INTO public.practice_session_items (
    session_id, user_id, actor_id, ordinal, question_id,
    question_stem, question_passage, question_options, question_correct_answer,
    question_explanation, question_option_metadata, question_domain, question_skill,
    question_difficulty, question_section, question_item_type, question_correct_variants,
    question_assets, question_estimated_time_seconds, option_order, option_token_map,
    status, served_at
  ) VALUES (
    v_session, p_student_id, p_actor_id, 1, p_question_id,
    p_item->>'question_stem', p_item->>'question_passage', p_item->'question_options',
    p_item->>'question_correct_answer', p_item->>'question_explanation',
    p_item->'question_option_metadata', p_item->>'question_domain', p_item->>'question_skill',
    (p_item->>'question_difficulty')::smallint, p_item->>'question_section',
    p_item->>'question_item_type',
    CASE WHEN jsonb_typeof(p_item->'question_correct_variants') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_item->'question_correct_variants')) END,
    p_item->'question_assets', (p_item->>'question_estimated_time_seconds')::integer,
    CASE WHEN jsonb_typeof(p_item->'option_order') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_item->'option_order')) END,
    p_item->'option_token_map',
    'served', p_now
  ) RETURNING id INTO v_item;

  -- The practice answer path's own write (practice-canonical.ts submitPracticeAnswer): the
  -- AFTER UPDATE review trigger queues a miss exactly as it does for any practice item.
  UPDATE public.practice_session_items
     SET status = 'answered',
         selected_answer = p_selected_answer,
         is_correct = p_is_correct,
         outcome = CASE WHEN p_is_correct THEN 'correct' ELSE 'incorrect' END,
         answered_at = p_now,
         occurred_at = p_now,
         client_attempt_id = p_idempotency_key
   WHERE id = v_item AND status = 'served';

  UPDATE public.practice_sessions
     SET status = 'completed', completed_at = p_now, updated_at = p_now, last_activity_at = p_now
   WHERE id = v_session;

  INSERT INTO public.student_qotd_attempts
    (student_id, qotd_date, question_id, practice_session_item_id, selected_answer,
     is_correct, answered_at, idempotency_key)
  VALUES
    (p_student_id, p_qotd_date, p_question_id, v_item, p_selected_answer,
     p_is_correct, p_now, p_idempotency_key);

  RETURN jsonb_build_object(
    'status', 'created',
    'practice_session_id', v_session,
    'practice_session_item_id', v_item,
    'selected_answer', p_selected_answer,
    'is_correct', p_is_correct,
    'answered_at', p_now
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The streak and "This week": QOTD days with at least one answered question
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_answer_days(p_student_id uuid, p_since date)
RETURNS TABLE (day date)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  -- From the earliest instant day p_since can start under either rule (04:00 UTC); a row before
  -- that day's real start carries the day before, which the outer filter drops.
  SELECT u.day FROM (
    SELECT DISTINCT public.qotd_day(i.occurred_at)
      FROM public.practice_session_items i
     WHERE i.user_id = p_student_id AND i.status = 'answered' AND i.occurred_at IS NOT NULL
       AND i.occurred_at >= ((p_since::timestamp + interval '4 hours') AT TIME ZONE 'UTC')
    UNION
    SELECT DISTINCT public.qotd_day(COALESCE(r.occurred_at, r.answered_at))
      FROM public.review_session_items r
     WHERE r.student_id = p_student_id AND r.status = 'answered'
       AND COALESCE(r.occurred_at, r.answered_at) >= ((p_since::timestamp + interval '4 hours') AT TIME ZONE 'UTC')
    UNION
    SELECT DISTINCT public.qotd_day(a.created_at)
      FROM public.test_answer_submissions a
      JOIN public.test_sessions t ON t.id = a.test_session_id
     WHERE t.student_id = p_student_id AND a.answer IS NOT NULL
       AND a.created_at >= ((p_since::timestamp + interval '4 hours') AT TIME ZONE 'UTC')
  ) AS u(day)
   WHERE u.day >= p_since;
$fn$;

CREATE OR REPLACE FUNCTION public.student_streak(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS TABLE (current_streak integer, today_done boolean, broken boolean)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH today AS (SELECT public.qotd_day(p_now) AS d),
  days AS (
    SELECT day FROM public.student_answer_days(p_student_id, (SELECT d FROM today) - 400)
     WHERE day <= (SELECT d FROM today)
  ),
  -- The switch's bridge (Karl, 2026-10-27: "no student loses a streak because of the switch").
  -- An answer at the same UTC time every night between 04:00 and the Chicago midnight carried the
  -- day before under the Chicago day and carries its own date under the 04:00 UTC day, so the
  -- first 04:00 UTC day is the one label that habit skips. Once that day is past, it counts for
  -- the RUN of a student who answered the day before it. It is never "today done" and never a
  -- ticked day in "This week" (student_answer_days is unchanged).
  run_days AS (
    SELECT day FROM days
    UNION
    SELECT b.day
      FROM (SELECT public.qotd_day(public.qotd_day_cutover()) AS day) AS b
     WHERE b.day IS NOT NULL
       AND b.day < (SELECT d FROM today)
       AND EXISTS (SELECT 1 FROM days WHERE day = b.day - 1)
  ),
  anchor AS (
    -- The run ends today if today has an answer, else yesterday if yesterday has one.
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM run_days WHERE day = (SELECT d FROM today)) THEN (SELECT d FROM today)
             WHEN EXISTS (SELECT 1 FROM run_days WHERE day = (SELECT d FROM today) - 1) THEN (SELECT d FROM today) - 1
           END AS d
  ),
  run AS (
    -- Consecutive days back from the anchor: the anchor minus k is in the set for k = 0..n-1.
    SELECT count(*)::integer AS n
      FROM generate_series(0, 400) AS k
     WHERE (SELECT d FROM anchor) IS NOT NULL
       AND k < COALESCE((
             SELECT min(g) FROM generate_series(0, 401) AS g
              WHERE NOT EXISTS (SELECT 1 FROM run_days WHERE day = (SELECT d FROM anchor) - g)
           ), 401)
  )
  SELECT (SELECT n FROM run),
         EXISTS (SELECT 1 FROM days WHERE day = (SELECT d FROM today)),
         (SELECT n FROM run) = 0 AND EXISTS (SELECT 1 FROM days);
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The ops alerts' today
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_horizon(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH t AS (SELECT public.qotd_day(p_now) AS today),
  gap AS (
    SELECT COALESCE(
             (SELECT min((SELECT today FROM t) + k)
                FROM generate_series(0, 61) AS k
               WHERE NOT public.qotd_servable((SELECT today FROM t) + k)),
             (SELECT today FROM t) + 62
           ) AS first_gap
  )
  SELECT jsonb_build_object(
    'today', (SELECT today FROM t),
    'today_covered', (SELECT first_gap FROM gap) > (SELECT today FROM t),
    'runs_out_on', (SELECT first_gap FROM gap),
    'horizon', GREATEST((SELECT first_gap FROM gap) - (SELECT today FROM t) - 1, 0)
  );
$fn$;

COMMENT ON TABLE public.qotd_schedule IS
  'QOTD (plan R18; Karl 2026-10-27): one question per QOTD day (04:00 UTC to 04:00 UTC from the cutover in qotd_day_boundary, America/Chicago before it). qotd_date PK = one a day; question_id UNIQUE = never repeated. Server-only (no grants beyond service_role).';
COMMENT ON TABLE public.student_qotd_attempts IS
  'Home QOTD: one signed-in student answer per QOTD day (public.qotd_day). selected_answer is the canonical option key. The answer itself is the linked practice_session_items row (mode qotd). ON DELETE CASCADE from profiles.';

-- ---------------------------------------------------------------------------
-- 7. Privileges: service role only (the replaced functions keep theirs)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.qotd_day_cutover(),
  public.qotd_day(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.qotd_day_cutover(),
  public.qotd_day(timestamptz)
  TO service_role;

DO $chk$
BEGIN
  IF (SELECT count(*) FROM public.qotd_day_boundary) <> 1 THEN
    RAISE EXCEPTION 'qotd day migration: qotd_day_boundary must hold exactly one row';
  END IF;
  -- The switch is seamless: just before the cutover is the day before the cutover's label, and
  -- the cutover instant is that label + 1 under both rules.
  IF public.qotd_day(public.qotd_day_cutover())
       IS DISTINCT FROM (public.qotd_day_cutover() AT TIME ZONE 'America/Chicago')::date
     OR public.qotd_day(public.qotd_day_cutover() - interval '1 microsecond')
       IS DISTINCT FROM public.qotd_day(public.qotd_day_cutover()) - 1 THEN
    RAISE EXCEPTION 'qotd day migration: the cutover is not seamless';
  END IF;
END
$chk$;

COMMIT;
