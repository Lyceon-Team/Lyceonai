-- ============================================================================
-- Doc 05F §9.3 / review handoff H5 — review_due_by_date joins servable_questions
--
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §9.3 review planning input]
--       [review handoff "Calendar <- Review: Seam Changes" H5]
-- @implemented [2026-09-23]
--
-- plain English: a review queue entry whose question has since been retired or
-- issue-flagged is no longer servable. This stops the generator counting it, so
-- a review block is sized against work the engine can actually hand back.
--
-- SOURCE BODY. Taken from calendar_build_plan_input as declared in
-- 20260921000000_review_queue_runtime.sql (lines 667-834), which is the LIVE
-- declaration -- that migration re-declared the function verbatim from
-- 20260917130000_calendar_v1.sql to rename a column, and nothing has replaced it
-- since. Extracted programmatically rather than retyped, with exactly one edit:
-- the JOIN below. Everything else is byte-identical to that body.
--
-- WHY THE JOIN AND NOT A STATUS COLUMN ON THE QUEUE. The queue deliberately
-- stores no question metadata (review ruling 19): a snapshot goes stale and then
-- re-serves a question the bank has withdrawn. servable_questions is the single
-- definition of "servable", and review prefill already joins it. Joining here
-- means the planner and the server agree by construction rather than by two
-- copies of a rule.
--
-- expected outcome: B-01 stays green -- the gate that proves this function
-- returns the shape calendar_compute_plan reads. A student with active queue
-- entries whose questions are all unservable gets NO review block rather than an
-- empty one.
--
-- trade-offs: an INNER join silently drops a queue row whose question_id has no
-- row in the view at all. That is the correct reading: "not in servable_questions"
-- and "retired" are the same answer to the only question being asked.
--
-- edge cases: servable_questions is security_invoker. calendar_build_plan_input
-- is SECURITY DEFINER, so the view resolves as the function owner, which is the
-- same role that already reads public.questions elsewhere in this function.
--
-- Authored only. The owner applies it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile   record;
  v_constants jsonb;
  v_today     date;
  v_window    integer;
  v_practice  integer;
  v_review    integer;
  v_horizon_lo date;
  v_horizon_hi date;
  v_degraded  jsonb := '[]'::jsonb;
  v_mastery   jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.student_study_profile WHERE student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_build_plan_input: student % has no study profile', p_student_id
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_object_agg(key, value) INTO v_constants FROM public.calendar_runtime_config;
  IF v_constants IS NULL THEN
    RAISE EXCEPTION 'calendar_runtime_config: no rows; the calendar cannot generate without constants'
      USING ERRCODE = '22023';
  END IF;

  -- §8.2 local dates: every date in a plan is the student’s local date, and the
  -- profile’s timezone is what makes "today" mean anything.
  v_today  := (now() AT TIME ZONE v_profile.timezone)::date;
  v_window := public.calendar_require_int(v_constants, 'recent_planned_window_days');
  v_review := public.calendar_require_int(v_constants, 'review_estimated_seconds_per_item');

  -- Doc 02B §41 owns practice timing. It is referenced, never restated (§20 audit rule).
  SELECT public.calendar_require_int(jsonb_build_object('target_seconds_per_question', value),
                                     'target_seconds_per_question')
    INTO v_practice
  FROM public.practice_runtime_config WHERE key = 'target_seconds_per_question';
  IF v_practice IS NULL THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key ''target_seconds_per_question'''
      USING ERRCODE = '22023';
  END IF;

  v_horizon_lo := COALESCE((SELECT min(d) FROM unnest(p_dates) d), v_today);
  v_horizon_hi := COALESCE((SELECT max(d) FROM unnest(p_dates) d), v_today);

  -- Mastery, in canonical order, one row per domain. A student with no rows is
  -- COLD START, not degraded: all eight unknown is a state the formula has a
  -- branch for (sheet §2 step 3), and calling it degraded would push every new
  -- student onto fallback_v1 for being new.
  SELECT jsonb_agg(jsonb_build_object(
           'section', CASE WHEN d.domain IN ('Algebra','Advanced Math',
                                             'Problem Solving and Data Analysis',
                                             'Geometry and Trigonometry') THEN 'M' ELSE 'RW' END,
           'domain', d.domain,
           'mastery_level', m.mastery_level) ORDER BY d.ord)
    INTO v_mastery
  FROM jsonb_array_elements_text(v_constants -> 'canonical_domain_order')
       WITH ORDINALITY AS d(domain, ord)
  LEFT JOIN public.student_domain_mastery m
    ON m.student_id = p_student_id AND m.domain = d.domain;

  -- The exams seam has no table yet: full-length is a rebuild vertical and its
  -- adapter ships as a fail-open stub (G-08-02, sheet §8 item 12). Recording it
  -- in degraded[] is the honest form — the alternative is a snapshot that claims
  -- the student has never sat an exam, which is a different statement.
  v_degraded := v_degraded || '"exams"'::jsonb;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'today', v_today::text,
    'generated_for', jsonb_build_object(
      'dates', COALESCE((SELECT jsonb_agg(d::text ORDER BY d) FROM unnest(p_dates) d), '[]'::jsonb)),

    'profile', jsonb_build_object(
      'timezone', v_profile.timezone,
      'target_exam_date', v_profile.target_exam_date::text,
      'target_score', v_profile.target_score,
      'study_days_mask', v_profile.study_days_mask,
      'daily_minutes', v_profile.daily_minutes,
      'full_length_weekday', v_profile.full_length_weekday,
      'planner_mode', v_profile.planner_mode,
      'setup_date', COALESCE(
        (v_profile.setup_completed_at AT TIME ZONE v_profile.timezone)::date,
        (v_profile.created_at AT TIME ZONE v_profile.timezone)::date)::text),

    'mastery', COALESCE(v_mastery, '[]'::jsonb),

    -- Anything already overdue folds onto today rather than being lost: the
    -- generator walks the horizon forward and never looks behind its first date.
    'review_due_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', q.d::text, 'due_count', q.n) ORDER BY q.d)
      FROM (
        SELECT greatest((r.queued_at AT TIME ZONE v_profile.timezone)::date, v_today) AS d,
               count(*)::integer AS n
        FROM public.review_schedule r
        -- H5: the ONLY change from the 20260921000000 body. A queue entry whose question
        -- has been retired or issue-flagged since it was queued is not servable, so it must
        -- not be PLANNED either -- the queue stores no question metadata (ruling 19), and
        -- review's own prefill joins this same view at serve time. Without the join the
        -- generator sizes a review block against rows the engine will then refuse to serve,
        -- and the student gets a block that runs short with nothing to explain it.
        -- INNER join, deliberately: a missing row means not servable, which is the same
        -- answer as a retired one.
        JOIN public.servable_questions sq ON sq.id = r.question_id
        WHERE r.student_id = p_student_id
          AND r.status = 'active'
          AND (r.queued_at AT TIME ZONE v_profile.timezone)::date <= v_horizon_hi
        GROUP BY 1
      ) q), '[]'::jsonb),

    'exams', jsonb_build_object(
      'last_completed_local_date', NULL,
      'days_since_exam', NULL,
      'missed_count', NULL,
      'reviewed', NULL,
      'weak_domains', '[]'::jsonb),

    -- The deficit rule measures a domain against what it has had over the
    -- window plus today (sheet §2 step 5). Only domain-level practice blocks
    -- can be attributed. A cold-start section block names no domain, and
    -- guessing how to split it would be inventing history.
    'recent_planned_by_domain', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('domain', q.domain, 'count', q.n) ORDER BY q.domain)
      FROM (
        SELECT e ->> 'domain' AS domain, sum((e ->> 'count')::integer)::integer AS n
        FROM public.calendar_current_plan cp
        JOIN public.calendar_blocks b ON b.block_id = cp.block_id
        CROSS JOIN LATERAL jsonb_array_elements(b.scope -> 'mix') e
        WHERE cp.student_id = p_student_id
          AND b.block_type = 'practice'
          AND b.scope ->> 'level' = 'domain'
          AND cp.scheduled_date >= v_today - v_window
          AND cp.scheduled_date < v_today
        GROUP BY 1
      ) q), '[]'::jsonb),

    -- §12.2 protected state, and the inputs V-12/V-13/V-14 are checked against.
    'started_blocks_by_date', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
        AND EXISTS (SELECT 1 FROM public.calendar_block_launches l WHERE l.block_id = b.block_id)
      ), '[]'::jsonb),

    'existing_blocks_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'current_overrides', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', cp.scheduled_date::text, 'is_user_override', cp.is_user_override))
      FROM public.calendar_current_plan cp
      WHERE cp.student_id = p_student_id
        AND cp.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'enabled_block_types', v_constants -> 'enabled_block_types',

    'engine_planning', jsonb_build_object(
      'practice_seconds_per_unit', v_practice,
      'review_seconds_per_unit', v_review),

    'constants', v_constants,
    'degraded', v_degraded);
END;
$$;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- Re-apply the calendar_build_plan_input body from
-- 20260921000000_review_queue_runtime.sql (lines 667-834) verbatim -- that is
-- this file minus the JOIN. The function is CREATE OR REPLACE, so the rollback
-- is a replace and touches no data.
--
-- Nothing else in this migration changes: no table, column, constraint, policy
-- or grant. A rollback therefore cannot lose a row.
--
-- WHAT THE ROLLBACK RESTORES, stated so it is a decision and not a surprise:
-- plans generated after it would once again count unservable queue entries
-- toward review block sizes. Versions already written are unaffected -- they are
-- append-only history (INV-08-05) and are not recomputed.
-- ============================================================================
