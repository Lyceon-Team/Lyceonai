-- ============================================================================
-- E9b — the calendar's full-length seam (Doc 05F §9.4, G-08-02)
--
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar §7.4 scope shape, §9.1 adapter contract, §9.4
--        full-length adapter, §10.1 PlanInput exams{}, §17.2 day editor;
--        Doc_05F_formula_sheet §2 step 4 (exam review), §6 (weak = L0-L1);
--        SCL-167, SCL-168, SCL-169, SCL-170]
-- @implemented [2026-09-25]
--
-- plain English: the calendar can now plan, launch and count a full-length
-- practice test, and the review block that follows an exam reviews THAT exam.
--
--   1. calendar_scope_is_valid: a full_length scope is {form_id, exam_mode}.
--      exam_mode is the exam engine's own test_sessions.mode vocabulary
--      ('strict' = test-day timing, 'lenient' = practice timing); form_id null
--      means "the next test" (SCL-167).
--   2. calendar_runtime_config.weak_level_max = 1: the ONE definition of a weak
--      domain for planning, read by the plan-input builder AND the generator's
--      explanation step (formula sheet §6, SCL-169).
--   3. exam_next_form_for_student: the deterministic "next test" rule that
--      replaces the "Doc 04 rotation" §9.4 cites and no Doc 04 defines
--      (SCL-168).
--   4. calendar_exam_review_scope: the exam-review block's scope, one helper for
--      both generators (SCL-170).
--   5. calendar_build_plan_input: the exams{} facts are real (SCL-169).
--   6. calendar_compute_plan / calendar_compute_plan_fallback: read
--      weak_level_max, emit the session-scoped exam review and the widened
--      full_length scope. generator_version moves to this file (C-09c).
--
-- NOT HERE: enabling full_length. That is 20261004010000, applied LAST, the
-- same split review used (20260928000000).
--
-- PARITY. calendar_formula_reference.py (docs/Spec, read-only) is untouched and
-- does not need to move: calendar-parity.ts compares [block_type, practice mix,
-- target_count, explanation_key] plus the per-domain explanation keys, and none
-- of this file's changes are in that projection except the weak threshold,
-- whose value 1 is the oracle's own `L <= 1` (reference line 41). The emitter
-- states it as the constant weak_level_max = 1 and the parity gate then pins the
-- database row to it.
--
-- SOURCE BODIES. Extracted programmatically, then patched at asserted anchors:
--   calendar_scope_is_valid, calendar_compute_plan,
--   calendar_compute_plan_fallback   <- 20260917130000_calendar_v1.sql
--   calendar_build_plan_input        <- 20260925000000_calendar_input_honours_enabled_types.sql
-- Every other line of each body is byte-identical to its source.
--
-- Authored only. The owner applies it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Scope shape (05F §7.4, widened by SCL-167)
--    Production held no full_length block when this was written (read-only
--    query, 2026-09-25: 0 rows), so no stored row predates the two-key shape.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_scope_is_valid(
  p_block_type text,
  p_section    text,
  p_scope      jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_block_type

    WHEN 'practice' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NOT NULL AND p_section IN ('M', 'RW')
      AND CASE p_scope ->> 'level'

        WHEN 'section' THEN
              p_scope ?& ARRAY['level', 'count', 'explanation_key']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'count') = 'number'
          AND (p_scope ->> 'count') ~ '^[1-9][0-9]*$'
          AND jsonb_typeof(p_scope -> 'explanation_key') = 'string'

        WHEN 'domain' THEN
              p_scope ?& ARRAY['level', 'mix']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 2
          AND jsonb_typeof(p_scope -> 'mix') = 'array'
          AND jsonb_array_length(p_scope -> 'mix') >= 1
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry)
            WHERE NOT (
                  jsonb_typeof(entry) = 'object'
              AND entry ?& ARRAY['domain', 'count', 'explanation_key']
              AND (SELECT count(*) FROM jsonb_object_keys(entry)) = 3
              AND jsonb_typeof(entry -> 'domain') = 'string'
              AND jsonb_typeof(entry -> 'count') = 'number'
              AND (entry ->> 'count') ~ '^[1-9][0-9]*$'
              AND jsonb_typeof(entry -> 'explanation_key') = 'string'
              AND (
                (p_section = 'M'  AND entry ->> 'domain' IN (
                   'Algebra', 'Advanced Math',
                   'Problem Solving and Data Analysis',
                   'Geometry and Trigonometry'))
                OR
                (p_section = 'RW' AND entry ->> 'domain' IN (
                   'Information and Ideas', 'Craft and Structure',
                   'Expression of Ideas', 'Standard English Conventions'))
              )
            )
          )
          -- a domain appears at most once in a mix
          AND (SELECT count(DISTINCT e.entry ->> 'domain')
               FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry))
              = jsonb_array_length(p_scope -> 'mix')

        ELSE false
      END

    WHEN 'review' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      AND CASE p_scope ->> 'mode'
        WHEN 'queue' THEN
              p_scope ?& ARRAY['mode']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 1
        WHEN 'session' THEN
              p_scope ?& ARRAY['mode', 'source_engine', 'source_session_id']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'source_engine') = 'string'
          AND p_scope ->> 'source_engine' IN ('practice', 'full_length')
          AND jsonb_typeof(p_scope -> 'source_session_id') = 'string'
        ELSE false
      END

    WHEN 'full_length' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      -- E9b / SCL (05F §7.4 widened): two keys, both always present. form_id null
      -- means "the next test" by exam_next_form_for_student; exam_mode is the
      -- exam engine's own vocabulary (test_sessions.mode), never a calendar copy.
      AND p_scope ?& ARRAY['form_id', 'exam_mode']
      AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 2
      AND jsonb_typeof(p_scope -> 'form_id') IN ('string', 'null')
      AND jsonb_typeof(p_scope -> 'exam_mode') = 'string'
      AND p_scope ->> 'exam_mode' IN ('strict', 'lenient')

    ELSE false
  END;
$$;

-- ----------------------------------------------------------------------------
-- 2. weak_level_max (formula sheet §6, SCL-169)
-- ----------------------------------------------------------------------------
INSERT INTO public.calendar_runtime_config
  (key, value, value_type, min_value, max_value, owner, description) VALUES
  ('weak_level_max', '1', 'integer', '0', '4', 'product',
   'Doc 05F formula sheet §6: a domain whose Doc 05B mastery_level is <= this is weak for planning (L0 Foundations, L1 Building). Read by calendar_build_plan_input for exams.weak_domains and by calendar_compute_plan for the per-domain weak explanation key, so the two cannot disagree. NULL (unmeasured) is never weak. Interacts with post_exam_multiplier: the x2 lands on domains weight_by_level already weights heaviest.');

-- ----------------------------------------------------------------------------
-- 3. The next test (SCL-168)
--
-- plain English: which published form a calendar full-length block with
-- form_id null starts. Deterministic, no randomness anywhere (Coding Standards
-- §4.1):
--   a. the student's LIVE session's form, if one is live -- so a launch resumes
--      that exam (exam_create_session answers 200 for the same form) instead of
--      being refused for a different one;
--   b. else the first selectable published form the student has never
--      completed, in the order /api/tests/forms lists them (published_at, name,
--      id -- exam_list_forms);
--   c. else the form the student completed LEAST recently.
-- NULL when there is no selectable published form; the adapter reports that as
-- an engine refusal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_next_form_for_student(p_student_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT s.test_form_id
       FROM test_sessions s
      WHERE s.student_id = p_student_id
        AND s.state IN ('created', 'active', 'section_break')
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1),
    (SELECT f.id
       FROM test_forms f
       LEFT JOIN LATERAL (
         SELECT max(s.completed_at) AS last_completed
           FROM test_sessions s
          WHERE s.student_id = p_student_id
            AND s.test_form_id = f.id
            AND s.state = 'completed') c ON true
      WHERE f.status = 'published'
        AND f.is_selectable
      ORDER BY c.last_completed IS NOT NULL,
               c.last_completed,
               f.published_at, f.name, f.id
      LIMIT 1));
$$;

COMMENT ON FUNCTION public.exam_next_form_for_student(uuid) IS
  'SCL-168 (replaces the "Doc 04 rotation" Doc 05F §9.4 cites): the live session''s form; else the first selectable published form never completed (published_at, name, id); else the least recently completed. Deterministic.';

REVOKE ALL ON FUNCTION public.exam_next_form_for_student(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_next_form_for_student(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. The exam-review block's scope (05F §9.4, SCL-170)
--
-- plain English: an exam review with a known exam is a SESSION review of that
-- exam; completing it is what sets exams.reviewed, so the block clears. A
-- placeholder (an exam placed but not yet sat) has no session to name and stays
-- a queue review. A real exam review WITHOUT a session id is a malformed
-- snapshot -- calendar_build_plan_input always emits the id with the date -- and
-- raising is the honest answer: a queue-mode exam review can never clear, which
-- is the defect this file exists to remove.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_exam_review_scope(p_key text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_key = 'exam_review' THEN
    IF p_session_id IS NULL THEN
      RAISE EXCEPTION 'calendar_exam_review_scope: an exam_review block needs exams.source_session_id'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('mode', 'session', 'source_engine', 'full_length',
                              'source_session_id', p_session_id);
  END IF;
  RETURN jsonb_build_object('mode', 'queue');
END;
$$;

COMMENT ON FUNCTION public.calendar_exam_review_scope(text, text) IS
  'Doc 05F §9.4 / SCL-170: exam_review -> {"mode":"session","source_engine":"full_length","source_session_id"}; exam_review_placeholder -> {"mode":"queue"}. One helper for deterministic_v1 and fallback_v1.';

REVOKE ALL ON FUNCTION public.calendar_exam_review_scope(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_exam_review_scope(text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. The plan input (05F §10.1 exams{}, SCL-169)
-- ----------------------------------------------------------------------------
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
  -- E9b: the exam facts (05F §10.1 exams{}), all NULL unless full_length is on
  -- AND the student has a completed exam.
  v_weak_max       integer;
  v_exam_id        uuid;
  v_exam_date      date;
  v_seams_applied  boolean := false;
  v_missed         integer;
  v_reviewed       boolean;
  v_weak           jsonb := '[]'::jsonb;
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

  -- E9b (G-08-02): the exams seam is real now. Every fact below is read from its
  -- owner, never computed here, and all of them stay NULL while full_length is not
  -- in enabled_block_types (the same "tell the generator the truth" rule as the
  -- weekday above). "exams" is no longer pushed into degraded[]: the read either
  -- finds an exam or finds none, and "none" is a fact, not a degradation.
  --
  --   last exam          the student's newest test_sessions row in state
  --                      'completed' (Doc 04A terminal state), dated by
  --                      completed_at in the profile's timezone (§8.2).
  --   missed_count       its review-queue rows (source_engine 'full_length',
  --                      source_session_id = the exam) that are still ACTIVE and
  --                      SERVABLE -- the H5 rule: never plan against rows the review
  --                      engine will refuse to serve. NULL until E9's seams event
  --                      has applied, because before that the queue rows do not
  --                      exist yet and "unknown" is not "zero".
  --   reviewed           a COMPLETED session-mode review sourced from that exam
  --                      (review_sessions.mode = 'session', filters naming it), OR
  --                      the seams have applied and nothing from it is left
  --                      outstanding. The second arm is load-bearing: the generator
  --                      holds an exam-review debt open while missed_count = 0 and
  --                      reviewed is not true, and while it is open it places no
  --                      ordinary review at all -- so a perfect exam, or one whose
  --                      misses were cleared in queue review, would otherwise
  --                      suppress review for the whole horizon, forever.
  --   weak_domains       Doc 05B's own student_domain_mastery levels (already in
  --                      v_mastery above), filtered at weak_level_max -- the one
  --                      definition calendar_compute_plan's explanation step reads
  --                      too. A NULL level (below MIN_EVENTS_FOR_MASTERY) is
  --                      unmeasured, never weak.
  --   source_session_id  the exam's id, so the generator can name it in the
  --                      exam-review block's session scope (05F §9.4).
  --
  -- ANONYMISED STUDENT: a de-identified exam carries student_id NULL, so it never
  -- matches p_student_id here; the path terminates at this WHERE.
  IF v_full_length_on THEN
    v_weak_max := public.calendar_require_int(v_constants, 'weak_level_max');

    SELECT s.id, (s.completed_at AT TIME ZONE v_profile.timezone)::date
      INTO v_exam_id, v_exam_date
    FROM public.test_sessions s
    WHERE s.student_id = p_student_id
      AND s.state = 'completed'
    ORDER BY s.completed_at DESC, s.id DESC
    LIMIT 1;

    IF v_exam_id IS NOT NULL THEN
      v_seams_applied := EXISTS (
        SELECT 1 FROM public.exam_runtime_outbox o
        WHERE o.aggregate_id = v_exam_id
          AND o.event_type = 'test_session_scored'
          AND o.result ->> 'outcome' = 'applied');

      IF v_seams_applied THEN
        SELECT count(*)::integer INTO v_missed
        FROM public.review_schedule r
        JOIN public.servable_questions sq ON sq.id = r.question_id
        WHERE r.student_id = p_student_id
          AND r.source_engine = 'full_length'
          AND r.source_session_id = v_exam_id
          AND r.status = 'active';
      END IF;

      v_reviewed := EXISTS (
          SELECT 1 FROM public.review_sessions rs
          WHERE rs.student_id = p_student_id
            AND rs.mode = 'session'
            AND rs.status = 'completed'
            AND rs.filters ->> 'source_engine' = 'full_length'
            AND rs.filters ->> 'source_session_id' = v_exam_id::text)
        OR (v_seams_applied AND v_missed = 0);

      SELECT COALESCE(jsonb_agg(t.m ->> 'domain' ORDER BY t.o), '[]'::jsonb) INTO v_weak
      FROM jsonb_array_elements(COALESCE(v_mastery, '[]'::jsonb)) WITH ORDINALITY AS t(m, o)
      WHERE jsonb_typeof(t.m -> 'mastery_level') = 'number'
        AND (t.m ->> 'mastery_level')::integer <= v_weak_max;
    END IF;
  END IF;

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

    -- E9b: the facts gathered above. With full_length off, or no completed exam,
    -- every field is NULL and weak_domains is [] -- exactly the shape the oracle
    -- gives a student who has never sat one.
    'exams', jsonb_build_object(
      'last_completed_local_date', v_exam_date::text,
      'days_since_exam', CASE WHEN v_exam_date IS NULL THEN NULL ELSE v_today - v_exam_date END,
      'missed_count', v_missed,
      'reviewed', CASE WHEN v_exam_id IS NULL THEN NULL ELSE v_reviewed END,
      'weak_domains', v_weak,
      'source_session_id', v_exam_id::text),

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
  'Doc 05F §10.1. Builds the plan input snapshot. Engines absent from enabled_block_types are reported as absent: full_length off -> profile.full_length_weekday NULL and exams{} NULL; review off -> review_due_by_date []. With full_length on, exams{} carries the newest completed exam: date, days since, missed_count (active servable queue rows from it, NULL until its seams applied), reviewed, weak_domains (05B levels <= weak_level_max) and source_session_id (SCL-169).';

-- ----------------------------------------------------------------------------
-- 6. The generators (session-scoped exam review, widened full_length scope,
--    weak_level_max). Formula otherwise unchanged; parity-checked.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_compute_plan(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  -- constants (sheet §4)
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_null_weight       integer;
  k_post_days         integer;
  k_post_mult         integer;
  k_weak_max          integer;
  k_min_domain_q      integer;
  k_max_domains       integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  v_constants         jsonb;
  v_weight_by_level   jsonb;
  v_order             jsonb;

  -- engine planning (snapshotted from the owning configs)
  e_practice_secs     integer;
  e_review_secs       integer;

  -- profile
  p_today             date;
  p_setup             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  p_fl_weekday        integer;

  -- exams
  x_last_date         date;
  x_days_since        integer;
  x_missed            integer;
  x_reviewed          boolean;
  x_weak              text[];
  x_session           text;

  -- domain arrays, all aligned on canonical order
  d_dom               text[] := '{}';
  d_sec               text[] := '{}';
  d_lvl               integer[] := '{}';
  d_w                 integer[] := '{}';
  d_why               text[] := '{}';
  d_alloc             integer[] := '{}';
  v_cold_start        boolean;

  -- exam placement (shared derivation)
  v_fl                jsonb;

  -- running state
  v_allocated_total   integer := 0;
  v_planned_total     integer := 0;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;

  -- per-day
  v_d                 date;
  v_i                 integer;
  v_j                 integer;
  v_k                 integer;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_sec_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_tot               integer;
  v_sec_tot           integer;
  v_units             integer;
  v_cum               integer;
  v_best              integer;
  v_best_def          integer;
  v_def               integer;
  v_sec_w             integer[];
  v_sec_units         integer[];
  v_planned_sec       integer[];
  v_s                 integer;
  v_secname           text;
  v_mix_dom           integer[];
  v_mix_cnt           integer[];
  v_mix_json          jsonb;
  v_pool_ok           boolean;
  v_key               text;
BEGIN
  ----------------------------------------------------------------------------
  -- Snapshot unpacking. Every essential field is required, never defaulted.
  ----------------------------------------------------------------------------
  v_constants := p_input -> 'constants';
  IF v_constants IS NULL OR jsonb_typeof(v_constants) <> 'object' THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no constants object' USING ERRCODE = '22023';
  END IF;

  k_horizon_days     := public.calendar_require_int(v_constants, 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(v_constants, 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(v_constants, 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(v_constants, 'exam_review_default_count');
  k_null_weight      := public.calendar_require_int(v_constants, 'null_level_weight');
  k_post_days        := public.calendar_require_int(v_constants, 'post_exam_emphasis_days');
  k_post_mult        := public.calendar_require_int(v_constants, 'post_exam_multiplier');
  -- E9b: the one definition of "weak" for planning (sheet §6 L0-L1), read from
  -- config so the builder's weak_domains and this explanation step cannot disagree.
  k_weak_max         := public.calendar_require_int(v_constants, 'weak_level_max');
  k_min_domain_q     := public.calendar_require_int(v_constants, 'min_domain_questions');
  k_max_domains      := public.calendar_require_int(v_constants, 'max_domains_per_block');
  k_granularity      := public.calendar_require_int(v_constants, 'granularity');
  k_taper_days       := public.calendar_require_int(v_constants, 'taper_days');
  k_taper_bp         := public.calendar_require_int(v_constants, 'taper_ratio_bp');

  v_weight_by_level := v_constants -> 'weight_by_level';
  v_order           := v_constants -> 'canonical_domain_order';
  IF v_weight_by_level IS NULL OR jsonb_typeof(v_weight_by_level) <> 'object'
     OR v_order IS NULL OR jsonb_typeof(v_order) <> 'array'
     OR jsonb_array_length(v_order) <> 8 THEN
    RAISE EXCEPTION 'calendar_compute_plan: constants must carry weight_by_level and an eight-entry canonical_domain_order'
      USING ERRCODE = '22023';
  END IF;

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan: engine_planning seconds-per-unit must be positive' USING ERRCODE = '22023';
  END IF;

  IF (p_input -> 'profile') IS NULL OR (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no profile or no today' USING ERRCODE = '22023';
  END IF;
  p_today      := (p_input ->> 'today')::date;
  p_setup      := (p_input #>> '{profile,setup_date}')::date;
  p_mask       := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes    := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target     := (p_input #>> '{profile,target_exam_date}')::date;
  p_fl_weekday := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: profile.setup_date is essential and was not supplied' USING ERRCODE = '22023';
  END IF;

  x_last_date  := (p_input #>> '{exams,last_completed_local_date}')::date;
  x_days_since := CASE WHEN (p_input #>> '{exams,days_since_exam}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'days_since_exam') END;
  x_missed     := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;
  -- jsonb null cannot be cast to boolean, it RAISES — and a snapshot whose
  -- exam facts are unreadable carries exactly that. An absent flag means "not
  -- known to be reviewed", which the ladder below already treats correctly.
  x_reviewed   := CASE WHEN jsonb_typeof(p_input #> '{exams,reviewed}') = 'boolean'
                      THEN (p_input #> '{exams,reviewed}')::boolean ELSE NULL END;
  SELECT COALESCE(array_agg(t), '{}') INTO x_weak
  FROM jsonb_array_elements_text(COALESCE(p_input #> '{exams,weak_domains}', '[]'::jsonb)) t;
  x_session    := p_input #>> '{exams,source_session_id}';

  ----------------------------------------------------------------------------
  -- Domain arrays, in canonical order. `mastery` carries the section for each
  -- domain, so the M/RW split is read from the snapshot rather than restated
  -- here, and canonical_domain_order supplies only the order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. 7 LOOP
    d_dom := d_dom || (v_order ->> v_i);
    SELECT m ->> 'section',
           CASE WHEN m ->> 'mastery_level' IS NULL THEN NULL ELSE (m ->> 'mastery_level')::integer END
      INTO v_secname, v_s
    FROM jsonb_array_elements(COALESCE(p_input -> 'mastery', '[]'::jsonb)) m
    WHERE m ->> 'domain' = (v_order ->> v_i);
    IF v_secname IS NULL THEN
      RAISE EXCEPTION 'calendar_compute_plan: snapshot mastery has no row for domain ''%''', v_order ->> v_i
        USING ERRCODE = '22023';
    END IF;
    d_sec := d_sec || v_secname;
    d_lvl := d_lvl || v_s;
    d_alloc := d_alloc || 0;
  END LOOP;

  -- recent_planned_by_domain seeds the deficit state (sheet §2 step 5: the
  -- deficit is measured against the last recent_planned_window_days plus today).
  FOR v_i IN 1 .. 8 LOOP
    SELECT COALESCE((SELECT public.calendar_require_int(r, 'count')
                     FROM jsonb_array_elements(COALESCE(p_input -> 'recent_planned_by_domain', '[]'::jsonb)) r
                     WHERE r ->> 'domain' = d_dom[v_i]), 0)
      INTO v_s;
    d_alloc[v_i] := v_s;
    v_allocated_total := v_allocated_total + v_s;
  END LOOP;
  v_planned_total := v_allocated_total;

  ----------------------------------------------------------------------------
  -- Step 3 — need weights. All eight unmeasured is cold start: Step 5 splits
  -- Math and R&W evenly and no weight is consulted.
  ----------------------------------------------------------------------------
  v_cold_start := true;
  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NOT NULL THEN v_cold_start := false; END IF;
  END LOOP;

  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NULL THEN
      d_w := d_w || k_null_weight;
      d_why := d_why || 'exploring'::text;
    ELSE
      d_w := d_w || public.calendar_require_int(v_weight_by_level, d_lvl[v_i]::text);
      d_why := d_why || (CASE WHEN d_lvl[v_i] <= k_weak_max THEN 'weak'
                              WHEN d_lvl[v_i] >= 3 THEN 'strength'
                              ELSE 'balanced' END)::text;
    END IF;
    IF x_days_since IS NOT NULL AND x_days_since <= k_post_days AND d_dom[v_i] = ANY (x_weak) THEN
      d_w[v_i] := d_w[v_i] * k_post_mult;
      d_why[v_i] := 'post_exam';
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- Step 2 — full-length placement, shared with fallback_v1 so the precedence
  -- rules have exactly one implementation (sheet §5A).
  ----------------------------------------------------------------------------
  v_fl := public.calendar_place_full_lengths(p_input);

  ----------------------------------------------------------------------------
  -- An exam completed and not yet reviewed owes an exam-review block on the
  -- next study day. A missed count of zero leaves the debt standing rather than
  -- discharging it silently -- the reference does the same, and inventing a
  -- size here would be exactly the kind of guess §6 forbids.
  ----------------------------------------------------------------------------
  IF x_last_date IS NOT NULL AND x_missed IS NOT NULL AND x_reviewed IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := x_missed;
    v_pending_key    := 'exam_review';
  END IF;

  ----------------------------------------------------------------------------
  -- The six steps, per date in horizon order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT v_due + COALESCE((SELECT public.calendar_require_int(r, 'due_count')
                             FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r
                             WHERE (r ->> 'date')::date = v_d), 0)
      INTO v_due;

    -- An exam day holds nothing else, and sets up the review that follows it.
    SELECT f ->> 'explanation_key' INTO v_key
    FROM jsonb_array_elements(v_fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL, 'exam_mode', 'strict'),
                           'target_count', 1, 'explanation_key', v_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    -- Step 1 — budget. Nothing is planned on or after the test until the
    -- student sets a new date.
    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    -- Step 4 — review. Exam review takes the whole budget if it needs it,
    -- otherwise ordinary review is capped by its share of the day.
    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        -- E9b: a real exam review is a SESSION review of that exam (05F §9.4), so
        -- completing it is what sets exams.reviewed. The placeholder stays queue:
        -- no session exists yet. One helper serves both generators.
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', public.calendar_exam_review_scope(v_pending_key, x_session),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Step 5 — practice.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      IF v_cold_start THEN
        -- Math and R&W halves, the leading section alternating by study-day index.
        v_half := (v_day_q / k_granularity / 2) * k_granularity;
        IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
        ELSE v_lead := 'RW'; v_other := 'M'; END IF;
        v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'cold_start' END;
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                      'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_day_q - v_half, 'explanation_key', v_key);
        IF v_half <> 0 THEN
          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                        'scope', jsonb_build_object('level','section','count', v_half,
                                                    'explanation_key', v_key),
                        'target_count', v_half, 'explanation_key', v_key);
        END IF;
      ELSE
        v_tot := 0;
        FOR v_j IN 1 .. 8 LOOP v_tot := v_tot + d_w[v_j]; END LOOP;

        v_sec_w := ARRAY[0, 0];         -- [1] = M, [2] = RW
        v_planned_sec := ARRAY[0, 0];
        FOR v_j IN 1 .. 8 LOOP
          v_s := CASE WHEN d_sec[v_j] = 'M' THEN 1 ELSE 2 END;
          v_sec_w[v_s] := v_sec_w[v_s] + d_w[v_j];
          v_planned_sec[v_s] := v_planned_sec[v_s] + d_alloc[v_j];
        END LOOP;
        v_sec_tot := v_sec_w[1] + v_sec_w[2];
        v_units := v_day_q / k_granularity;

        -- Level 1 — each granule goes to the section furthest behind its share.
        -- Ties go to Math.
        v_sec_units := ARRAY[0, 0];
        FOR v_j IN 1 .. v_units LOOP
          v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2] + 1) * k_granularity;
          v_best := 1;
          v_best_def := v_cum * v_sec_w[1] - (v_planned_sec[1] + v_sec_units[1] * k_granularity) * v_sec_tot;
          v_def := v_cum * v_sec_w[2] - (v_planned_sec[2] + v_sec_units[2] * k_granularity) * v_sec_tot;
          IF v_def > v_best_def THEN v_best := 2; v_best_def := v_def; END IF;
          v_sec_units[v_best] := v_sec_units[v_best] + 1;
        END LOOP;

        -- Product rule: when the day has two or more granules, both sections appear.
        IF v_units >= 2 THEN
          IF v_sec_units[1] = 0 THEN v_sec_units[1] := 1; v_sec_units[2] := v_sec_units[2] - 1; END IF;
          IF v_sec_units[2] = 0 THEN v_sec_units[2] := 1; v_sec_units[1] := v_sec_units[1] - 1; END IF;
        END IF;

        -- Level 2 — within each section, each granule goes to the domain
        -- furthest behind its share. Once the block holds max_domains_per_block
        -- distinct domains, later granules stay inside them. Math first, so the
        -- R&W deficits already see Math’s allocations for the day.
        FOR v_s IN 1 .. 2 LOOP
          v_secname := CASE WHEN v_s = 1 THEN 'M' ELSE 'RW' END;
          v_sec_q := v_sec_units[v_s] * k_granularity;
          CONTINUE WHEN v_sec_q < k_min_domain_q;

          v_mix_dom := '{}';
          v_mix_cnt := '{}';
          FOR v_j IN 1 .. v_sec_q / k_granularity LOOP
            v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
            v_best := NULL;
            v_pool_ok := COALESCE(array_length(v_mix_dom, 1), 0) >= k_max_domains;
            FOR v_k IN 1 .. 8 LOOP       -- canonical order; ties keep the earlier index
              CONTINUE WHEN d_sec[v_k] <> v_secname;
              CONTINUE WHEN v_pool_ok AND NOT (v_k = ANY (v_mix_dom));
              v_def := v_cum * d_w[v_k]
                     - (d_alloc[v_k] + COALESCE(
                         (SELECT v_mix_cnt[ix] FROM generate_subscripts(v_mix_dom, 1) ix
                          WHERE v_mix_dom[ix] = v_k), 0)) * v_tot;
              IF v_best IS NULL OR v_def > v_best_def THEN
                v_best := v_k; v_best_def := v_def;
              END IF;
            END LOOP;
            IF v_best = ANY (v_mix_dom) THEN
              v_mix_cnt := (SELECT array_agg(CASE WHEN v_mix_dom[ix] = v_best
                                                  THEN v_mix_cnt[ix] + k_granularity
                                                  ELSE v_mix_cnt[ix] END ORDER BY ix)
                            FROM generate_subscripts(v_mix_dom, 1) ix);
            ELSE
              v_mix_dom := v_mix_dom || v_best;       -- first touch fixes display order
              v_mix_cnt := v_mix_cnt || k_granularity;
            END IF;
          END LOOP;

          v_mix_json := '[]'::jsonb;
          FOR v_j IN 1 .. array_length(v_mix_dom, 1) LOOP
            v_mix_json := v_mix_json || jsonb_build_object(
              'domain', d_dom[v_mix_dom[v_j]],
              'count',  v_mix_cnt[v_j],
              'explanation_key', d_why[v_mix_dom[v_j]]);
            d_alloc[v_mix_dom[v_j]] := d_alloc[v_mix_dom[v_j]] + v_mix_cnt[v_j];
          END LOOP;

          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_secname,
                        'scope', jsonb_build_object('level','domain','mix', v_mix_json),
                        'target_count', v_sec_q,
                        'explanation_key', CASE WHEN v_tapered THEN 'taper' ELSE 'weighted' END);
        END LOOP;

        v_planned_total := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  RETURN jsonb_build_object('generator', 'deterministic_v1', 'days', v_days);
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_min_domain_q      integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  e_practice_secs     integer;
  e_review_secs       integer;
  p_today             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  x_last              date;
  x_reviewed          boolean;
  x_missed            integer;
  x_session           text;
  fl                  jsonb;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;
  v_i                 integer;
  v_d                 date;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_key               text;
  v_fl_key            text;
BEGIN
  k_horizon_days     := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(p_input -> 'constants', 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(p_input -> 'constants', 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(p_input -> 'constants', 'exam_review_default_count');
  k_min_domain_q     := public.calendar_require_int(p_input -> 'constants', 'min_domain_questions');
  k_granularity      := public.calendar_require_int(p_input -> 'constants', 'granularity');
  k_taper_days       := public.calendar_require_int(p_input -> 'constants', 'taper_days');
  k_taper_bp         := public.calendar_require_int(p_input -> 'constants', 'taper_ratio_bp');

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: engine_planning seconds-per-unit must be positive'
      USING ERRCODE = '22023';
  END IF;

  IF (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: snapshot has no today' USING ERRCODE = '22023';
  END IF;
  p_today   := (p_input ->> 'today')::date;
  p_mask    := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target  := (p_input #>> '{profile,target_exam_date}')::date;

  x_last     := (p_input #>> '{exams,last_completed_local_date}')::date;
  -- jsonb null cannot be cast to boolean, it RAISES — and a snapshot whose
  -- exam facts are unreadable carries exactly that. An absent flag means "not
  -- known to be reviewed", which the ladder below already treats correctly.
  x_reviewed := CASE WHEN jsonb_typeof(p_input #> '{exams,reviewed}') = 'boolean'
                      THEN (p_input #> '{exams,reviewed}')::boolean ELSE NULL END;
  x_missed   := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                     ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;

  x_session  := p_input #>> '{exams,source_session_id}';

  fl := public.calendar_place_full_lengths(p_input);

  -- A single total is enough here: the fallback runs precisely when the
  -- per-date review queue may be unreadable.
  SELECT COALESCE(sum(public.calendar_require_int(r, 'due_count')), 0) INTO v_due
  FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r;

  -- Unlike deterministic_v1, a missing OR ZERO missed count falls back to the
  -- placeholder size rather than leaving the debt standing. The fallback’s whole
  -- job is to produce a usable day from partial inputs, and deterministic_v1 has the
  -- real number or it waits. Both behaviours are the reference’s.
  IF x_last IS NOT NULL AND COALESCE(x_reviewed, true) IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := CASE WHEN COALESCE(x_missed, 0) = 0 THEN k_exam_review_dflt ELSE x_missed END;
    v_pending_key    := 'exam_review';
  END IF;

  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT f ->> 'explanation_key' INTO v_fl_key
    FROM jsonb_array_elements(fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_fl_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL, 'exam_mode', 'strict'),
                           'target_count', 1, 'explanation_key', v_fl_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        -- E9b: a real exam review is a SESSION review of that exam (05F §9.4), so
        -- completing it is what sets exams.reviewed. The placeholder stays queue:
        -- no session exists yet. One helper serves both generators.
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', public.calendar_exam_review_scope(v_pending_key, x_session),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Two practice blocks, Math and R&W halves, the leading section alternating
    -- by study-day index so no state has to be stored to keep them balanced.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      v_half := (v_day_q / k_granularity / 2) * k_granularity;
      IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
      ELSE v_lead := 'RW'; v_other := 'M'; END IF;
      v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'fallback' END;
      v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                    'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                'explanation_key', v_key),
                    'target_count', v_day_q - v_half, 'explanation_key', v_key);
      IF v_half <> 0 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                      'scope', jsonb_build_object('level','section','count', v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_half, 'explanation_key', v_key);
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  RETURN jsonb_build_object('generator', 'fallback_v1', 'days', v_days);
END;
$$;

UPDATE public.calendar_runtime_config
   SET value = '"20261004000000"'::jsonb
 WHERE key = 'generator_version';

DO $verify$
BEGIN
  IF (SELECT value #>> '{}' FROM public.calendar_runtime_config WHERE key = 'generator_version')
     <> '20261004000000' THEN
    RAISE EXCEPTION 'generator_version was not moved to 20261004000000';
  END IF;
  IF (SELECT value FROM public.calendar_runtime_config WHERE key = 'weak_level_max') <> '1'::jsonb THEN
    RAISE EXCEPTION 'weak_level_max was not seeded to 1';
  END IF;
END
$verify$;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- Run 20261004010000's rollback first (disable full_length). Then:
--   re-apply calendar_scope_is_valid, calendar_compute_plan and
--     calendar_compute_plan_fallback from 20260917130000_calendar_v1.sql, and
--     calendar_build_plan_input from 20260925000000 -- all CREATE OR REPLACE;
--   DROP FUNCTION public.calendar_exam_review_scope(text, text);
--   DROP FUNCTION public.exam_next_form_for_student(uuid);
--   DELETE FROM public.calendar_runtime_config WHERE key = 'weak_level_max';
--   UPDATE public.calendar_runtime_config SET value = '"20260917140000"'::jsonb
--    WHERE key = 'generator_version';  -- its value before this file
-- A full_length block written under the two-key shape would then fail the
-- narrower CHECK function on re-validation; calendar_blocks is append-only and
-- the CHECK is not re-run on stored rows, so nothing is lost, but no new
-- two-key block could be written. Roll back only before any such block exists.
