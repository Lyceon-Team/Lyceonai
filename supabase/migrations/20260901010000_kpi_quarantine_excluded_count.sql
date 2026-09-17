-- ============================================================================
-- KPI quarantine — refresh_section_kpi / refresh_overall_kpi exclude and count
-- instead of aborting the mastery transaction.
--
-- @spec [Doc 05B V1.0 §4.9 KPI fan-out; RB-05B-V1-02 partially superseded for these
--        two functions only; SCL-054 (the KPI fan-out entry — renumbered from SCL-042
--        by owner ruling 2026-08-26; SCL-042 is now the Stripe governing-doctrine entry)]
-- | @implemented [2026-09-01]
--
-- plain English: both functions currently count rows with NULL correct/occurred_at and
-- RAISE if the count is non-zero. Both are called by refresh_domain_mastery §4.9 inside
-- apply_mastery_event's transaction, downstream of the audit insert. So one malformed row
-- anywhere in a student's history rolls back every mastery write for that student — skill
-- mastery, audit row, domain mastery and the projection refresh counter — for every domain,
-- permanently. That is the 2026-06-26 → 2026-08-17 outage: 84 answered items, zero mastery
-- output, zero rows in student_projection_refresh_state.
--
-- THE DEFECT IS THE COUPLING, NOT THE SCOPE. Each validator validates exactly what it
-- aggregates: refresh_section_kpi validates (student, section) and aggregates
-- (student, section); refresh_overall_kpi validates (student) and aggregates (student).
-- Neither over-scans. The defect is that a student-wide DISPLAY aggregate is a hard
-- availability dependency of a per-event write to the TRUTH ANCHOR. This migration
-- reverses that dependency direction and changes nothing else.
--
-- WHY THIS IS NOT THE SILENT NULL FILTER RB-05B-V1-02 REJECTED. RB-05B-V1-02 was right:
-- a silent filter makes corrupt data indistinguishable from absent data, and yields a KPI
-- nobody can audit. The count is not discarded here — it is persisted on the KPI row as
-- excluded_event_count, per student and per refresher, recomputed on every refresh. An
-- operator can see exactly how many rows were excluded for exactly which student. Counted
-- is not silent. If that distinction is judged not to hold, this change should be rejected;
-- it is the whole justification.
--
-- INV-05B-14 (materialized derivatives only) HOLDS. excluded_event_count is recomputed on
-- every refresh from the same event set as every other column on the row and stores no
-- independent state.
--
-- SCOPE. Only these two function bodies and two columns. compute_mastery_for_entity,
-- refresh_domain_kpi, refresh_skill_kpi, apply_mastery_event and 05C's
-- PROJECTION_MASTERY_TERM_NULL are unchanged and stay fail-closed: mastery is the truth
-- anchor, KPI is a display surface, and only the display surface changes posture.
--
-- CURRENT PROD EFFECT: none. Verified read-only 2026-08-31 — practice_session_items has 0
-- rows with NULL is_correct/occurred_at (sealed by CHECK psi_resolved_requires_occurred_at)
-- and review_error_attempts has 0, with NOT NULL on both is_correct and occurred_at. Both
-- ingresses are sealed. This is insurance against the class, not a repair of live data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The persisted count. Added before the functions because their INSERT column
--    lists reference it and CREATE FUNCTION parse-checks the body.
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_section_kpi
  ADD COLUMN IF NOT EXISTS excluded_event_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.student_overall_kpi
  ADD COLUMN IF NOT EXISTS excluded_event_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.student_section_kpi.excluded_event_count IS
  'Canonical events excluded from this row''s aggregates for NULL correct/occurred_at. '
  'Recomputed every refresh from the same event set as every other column (INV-05B-14). '
  'Operator-only: Doc 05 Parent AC#20 locks student and guardian read surfaces to mastery_level.';
COMMENT ON COLUMN public.student_overall_kpi.excluded_event_count IS
  'Canonical events excluded from this row''s aggregates for NULL correct/occurred_at. '
  'Recomputed every refresh from the same event set as every other column (INV-05B-14). '
  'Operator-only: Doc 05 Parent AC#20 locks student and guardian read surfaces to mastery_level.';

-- ---------------------------------------------------------------------------
-- 2. refresh_section_kpi — quarantine, scoped (student, section)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamp with time zone DEFAULT now())
 RETURNS student_section_kpi
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_section_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_section|' || p_student_id::text || '|' || p_section));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: section KPI lock (%, %)', p_student_id, p_section;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- RB-05B-V1-02 partially superseded (SCL-054): the identical predicate now CLASSIFIES
  -- rather than aborts. The count is kept and persisted below; it is not discarded, which
  -- is what separates this from the silent NULL filter RB-05B-V1-02 correctly rejected.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;

  WITH section_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section
    ) e
    -- The quarantine itself. Excluded rows enter NO aggregate below.
    WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL
  ),
  aggregates AS (
    SELECT
      COUNT(*)                                                AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0
           THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) ELSE NULL END AS acc_30d,
      MAX(occurred_at) AS last_active
    FROM section_events
  ),
  streak AS (
    SELECT public.compute_streak_days(p_student_id, p_section, NULL::text, NULL::text, p_t_now) AS current_streak
  )
  INSERT INTO public.student_section_kpi (
    student_id, section, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    current_streak_days, last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now,
    excluded_event_count
  )
  SELECT p_student_id, p_section, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    s.current_streak, a.last_active, 'v1.0', now(), p_t_now,
    v_bad_count
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id, section) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    current_streak_days=EXCLUDED.current_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now,
    excluded_event_count=EXCLUDED.excluded_event_count
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. refresh_overall_kpi — quarantine, scoped (student)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_overall_kpi(p_student_id uuid, p_t_now timestamp with time zone DEFAULT now())
 RETURNS student_overall_kpi
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_overall_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_overall|' || p_student_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: overall KPI lock (%)', p_student_id;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- RB-05B-V1-02 partially superseded (SCL-054). This is the student-wide validator whose
  -- RAISE produced the outage's blast radius: it aborted the whole mastery transaction for
  -- a student because of a row in a section the event under test never touched.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;

  WITH all_events AS (
    SELECT section, correct, occurred_at FROM (
      SELECT pi.question_section AS section, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.section, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id
    ) e
    -- The quarantine itself. Excluded rows enter NO aggregate below.
    WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL
  ),
  aggregates AS (
    SELECT
      COUNT(*) AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END AS acc_30d,
      COUNT(DISTINCT section)::smallint AS sec_active,
      MAX(occurred_at) AS last_active
    FROM all_events
  ),
  streak AS (
    SELECT
      public.compute_streak_days(p_student_id, NULL::text, NULL::text, NULL::text, p_t_now) AS current_streak,
      public.compute_longest_streak_days(p_student_id, p_t_now) AS longest_streak
  )
  INSERT INTO public.student_overall_kpi (
    student_id, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    sections_active, current_streak_days, longest_streak_days, last_active_at,
    kpi_refresh_version, refreshed_at, refreshed_at_t_now,
    excluded_event_count
  )
  SELECT p_student_id, a.evt_total, a.evt_7d, a.evt_30d,
    a.acc_overall, a.acc_7d, a.acc_30d,
    a.sec_active, s.current_streak, s.longest_streak, a.last_active,
    'v1.0', now(), p_t_now,
    v_bad_count
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    sections_active=EXCLUDED.sections_active, current_streak_days=EXCLUDED.current_streak_days,
    longest_streak_days=EXCLUDED.longest_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now,
    excluded_event_count=EXCLUDED.excluded_event_count
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$function$;
