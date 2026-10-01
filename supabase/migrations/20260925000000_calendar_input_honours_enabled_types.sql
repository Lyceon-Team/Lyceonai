-- ============================================================================
-- Doc 05F §9.3 / §10.2 — the plan input tells the truth about enabled engines
--
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §9.3 plan input, §10.2 PlanOutput,
--        §21 as amended by formula sheet §8 item 12 (enabled_block_types)]
-- @implemented [2026-09-22]
--
-- plain English: a day was losing time to blocks the student could never see.
-- The generator reserves budget for a review block and a full-length sitting from
-- the plan INPUT, but calendar_plan_to_output then drops every member whose type
-- is not in enabled_block_types. Nothing told the generator which engines were on,
-- so it spent the day's seconds on blocks that were thrown away on the way out.
--
-- MEASURED IN PRODUCTION, 2026-09-22, student amingwa08. The profile is correct
-- (Mon-Sat, 60 min, Saturday tests) and the plan is not: Tue-Thu carry 20 questions
-- where 40 fit, Monday carries 10, and Saturday is EMPTY. 76 active queue entries
-- and one test day, all invisible, all paid for.
--
-- Two fields, both in the builder:
--
--   full_length not enabled -> snapshot profile.full_length_weekday = NULL, exam
--   facts NULL. calendar_compute_plan derives its exam dates from that one weekday
--   (20260917130000 line 966). NULL means no exam date, so the "an exam day holds
--   nothing else" CONTINUE never fires -- which is why Saturday was empty -- and the
--   exam_review_placeholder that branch reserves is never charged either.
--
--   review not enabled -> snapshot review_due_by_date = []. v_due stays 0, no
--   review block is sized, and the seconds go to practice.
--
-- THE FORMULA IS UNTOUCHED. calendar_compute_plan and calendar_compute_plan_fallback
-- are not redeclared by this migration, not by one byte. Only what they are TOLD
-- changes. That is deliberate: the formula is parity-locked against
-- calendar_formula_reference.py by 6018 byte-exact comparisons, and a change there
-- would have to be mirrored in the Python oracle. A change to the INPUT is checked
-- by the writer gates instead, where it belongs.
--
-- SOURCE BODY. Taken from calendar_build_plan_input as declared in
-- 20260924000000_calendar_review_due_servable_join.sql (lines 45-221), which is the
-- LIVE declaration -- it carries the servable_questions join (H5) and nothing has
-- replaced it since. Extracted programmatically rather than retyped. The diff
-- against that body is five lines rewritten and forty-eight added; every removed
-- line is one of the five anchors rewritten in place, and no other line moved.
--
-- expected outcome: with enabled_block_types = ["practice"], every study day's
-- planned seconds equal the full daily budget and a test weekday is an ordinary
-- study day. Flip to ["practice","review"] and review blocks appear, practice
-- shrinking by exactly their seconds -- the budget is conserved, not created.
--
-- trade-offs: the snapshot now differs from the profile for a student whose test
-- day is set while full_length is off. That is the point -- the snapshot records
-- what the generator was told, not what the student asked for -- but it does mean
-- input_snapshot is no longer a verbatim copy of the profile row. The stored
-- profile is untouched, so enabling full_length restores the student's chosen day
-- with no write.
--
-- edge cases: a student with a test day set and full_length disabled keeps that
-- day as an ordinary study day if it is in their mask, and as a rest day if it is
-- not -- the mask decides, which is the §7.1 rule. The review queue is not
-- touched: entries stay active and are planned the moment review is enabled.
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
  -- Which engines the product has actually turned on. Read once, used twice below.
  v_review_on      boolean;
  v_full_length_on boolean;
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

  -- The snapshot must describe the world the OUTPUT will be filtered against.
  -- calendar_plan_to_output drops every member whose block_type is not in
  -- enabled_block_types (20260917130000 line 1586), but the generator allocates
  -- budget from these inputs without consulting that list. So a disabled engine
  -- spends the day's seconds on a block that is then thrown away, and the day
  -- comes up short with nothing to explain it. Reading the list HERE is what
  -- makes the two agree.
  SELECT
    COALESCE(bool_or(t = 'review'), false),
    COALESCE(bool_or(t = 'full_length'), false)
    INTO v_review_on, v_full_length_on
  FROM jsonb_array_elements_text(COALESCE(v_constants -> 'enabled_block_types', '[]'::jsonb)) t;

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
      -- The single field that places an exam. calendar_compute_plan derives its
      -- full-length dates from this weekday (20260917130000 line 966); with it NULL
      -- there are no exam dates, so the "an exam day holds nothing else" CONTINUE
      -- never fires and the day keeps its budget for practice. The same branch is
      -- what reserves the exam_review_placeholder, so nulling this withholds the
      -- reservation too -- both symptoms, one field.
      --
      -- The PROFILE still stores the student's chosen test day. This is the
      -- SNAPSHOT: what the generator is told, not what the student asked for. When
      -- full_length is enabled the stored value flows through untouched.
      'full_length_weekday', CASE WHEN v_full_length_on
                                  THEN v_profile.full_length_weekday ELSE NULL END,
      'planner_mode', v_profile.planner_mode,
      'setup_date', COALESCE(
        (v_profile.setup_completed_at AT TIME ZONE v_profile.timezone)::date,
        (v_profile.created_at AT TIME ZONE v_profile.timezone)::date)::text),

    'mastery', COALESCE(v_mastery, '[]'::jsonb),

    -- Anything already overdue folds onto today rather than being lost: the
    -- generator walks the horizon forward and never looks behind its first date.
    -- Same rule as full_length_weekday above: with review disabled the generator
    -- must not see work it is about to have filtered away. An empty list is the
    -- honest snapshot of "no review is planned", which is true when the engine
    -- cannot be reached. The queue itself is untouched -- the entries stay active
    -- and are planned the moment review is enabled.
    'review_due_by_date', CASE WHEN NOT v_review_on THEN '[]'::jsonb ELSE COALESCE((
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
      ) q), '[]'::jsonb) END,

    -- Every field here is unconditionally NULL today: the exams seam has no table
    -- and the adapter is a fail-open stub, which is why "exams" is in degraded[]
    -- above. The gate is written anyway so that enabling full_length stays the ONE
    -- switch that makes exam facts visible to the generator. Until the exam vertical
    -- ships this CASE cannot change the result -- stated plainly rather than left for
    -- a reader to work out, and asserted as a no-op by the parity suite.
    'exams', CASE WHEN NOT v_full_length_on THEN jsonb_build_object(
      'last_completed_local_date', NULL,
      'days_since_exam', NULL,
      'missed_count', NULL,
      'reviewed', NULL,
      'weak_domains', '[]'::jsonb) ELSE jsonb_build_object(
      'last_completed_local_date', NULL,
      'days_since_exam', NULL,
      'missed_count', NULL,
      'reviewed', NULL,
      'weak_domains', '[]'::jsonb) END,

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

COMMENT ON FUNCTION public.calendar_build_plan_input(uuid, date[]) IS
  'Doc 05F §9.3. Builds the plan input snapshot. Engines absent from enabled_block_types are reported as absent: full_length off -> profile.full_length_weekday and exam facts NULL; review off -> review_due_by_date []. The generator therefore does not reserve budget for blocks calendar_plan_to_output would filter out (§10.2 / sheet §8 item 12).';

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- Re-apply the calendar_build_plan_input body from
-- 20260924000000_calendar_review_due_servable_join.sql (lines 45-221) verbatim --
-- that is this file minus the two gates. The function is CREATE OR REPLACE, so
-- the rollback is a replace and touches no data.
--
-- Nothing else in this migration changes: no table, column, constraint, policy
-- or grant. A rollback therefore cannot lose a row.
--
-- WHAT THE ROLLBACK RESTORES, stated so it is a decision and not a surprise:
-- plans generated after it would again reserve budget for review and full-length
-- blocks that enabled_block_types filters out, so days would once more come up
-- short of their daily budget and a test weekday would once more be planned empty.
-- Versions already written are unaffected -- they are append-only history
-- (INV-08-05) and are not recomputed. A student wanting the corrected plan
-- regenerates; nothing backfills.
-- ============================================================================
