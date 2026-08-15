-- ============================================================================
-- Backfill occurred_at + defensive COALESCE in canonical_mastery_events
-- ============================================================================
-- @spec [Doc-05A §4.1 seam R1; Doc-02B §8 seam §2 occurred_at contract]
-- @implemented [2026-08-15]
--
-- ROOT CAUSE (LIVE BUG #3): practice_session_items answered before the
-- handler began stamping occurred_at (2026-07-22 → 2026-08-06) have
-- occurred_at = NULL.  compute_mastery_for_entity validates ALL historical
-- events for a (student, section, domain, skill) entity; any NULL occurred_at
-- raises MASTERY_HISTORICAL_DATA_INVALID, which propagates through
-- apply_mastery_event → fail-closed 500 on diagnostic answer submission.
-- 42 of 45 answered prod items carry the NULL.
--
-- FIX (two layers):
--   1. DATA BACKFILL: SET occurred_at = answered_at WHERE NULL.
--      answered_at is the writer's authoritative timestamp and was always
--      set on answered items.  The seam comment (20260610020000 line 135)
--      says "set to answered_at at write" — so this backfill applies the
--      same value the writer would have stamped.
--
--   2. DEFENSIVE COALESCE: canonical_mastery_events and
--      canonical_mastery_events_for_student now emit
--      COALESCE(pi.occurred_at, pi.answered_at) instead of bare
--      pi.occurred_at.  This is defense-in-depth: if a future writer bug
--      leaves occurred_at NULL while answered_at is set, mastery
--      computation does not poison.  answered_at is structurally present
--      on every answered item (the UPDATE that sets status='answered'
--      always stamps answered_at in the same row).
--
-- ROLLBACK (safe):
--   The COALESCE is a no-op on rows where occurred_at IS NOT NULL (no
--   behavior change for healthy data).  The backfill is a pure data
--   repair — rolling back the migration does NOT null-out the backfilled
--   values (DML is committed, not schema-reversible).  To re-create the
--   functions without COALESCE, re-run the originals from:
--     - 20260806000000_diagnostic_gate.sql (M4b canonical_mastery_events,
--       M5 canonical_mastery_events_for_student)
--     - 20260613010000_05b_domain_mastery_kpi.sql (compute_streak_days,
--       compute_longest_streak_days, refresh_section_kpi,
--       refresh_domain_kpi, refresh_skill_kpi, refresh_overall_kpi)
--
-- LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DATA BACKFILL: set occurred_at = answered_at where missing
-- ============================================================================
UPDATE public.practice_session_items
   SET occurred_at = answered_at
 WHERE status = 'answered'
   AND occurred_at IS NULL
   AND answered_at IS NOT NULL;

-- ============================================================================
-- 2. DEFENSIVE COALESCE: canonical_mastery_events
-- ============================================================================
-- Original: 20260806000000_diagnostic_gate.sql M4b (lines 116-162)
-- Only change: line 135 pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at)
CREATE OR REPLACE FUNCTION public.canonical_mastery_events(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Practice + diagnostic events: canonical table practice_session_items (Doc 02B §8 / seam §2).
  -- Diagnostic items are stored identically to practice items (Doc 05A §11.4); the session's
  -- mode column discriminates the event_source_kind for the mastery seam guard.
  SELECT
    pi.id                       AS event_id,
    public.practice_session_mode_to_event_kind(ps.mode)
                                AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    -- DEFENSIVE COALESCE (2026-08-15): items answered before the handler stamped
    -- occurred_at carry NULL.  answered_at is the authoritative fallback per seam
    -- contract (20260610020000 line 135: "set to answered_at at write").
    COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at,
    pi.question_id              AS question_id
  FROM public.practice_session_items pi
  JOIN public.practice_sessions ps ON ps.id = pi.session_id
  WHERE pi.user_id = p_student_id
    AND pi.status  = 'answered'
    AND pi.question_section = p_section
    AND pi.question_domain  = p_domain
    AND (p_entity_type = 'domain' OR pi.question_skill = p_skill)
  -- NOTE (RB-05A-V1-17): no difficulty filter — invalid rows must reach compute_mastery_for_entity's
  -- validation block so it raises MASTERY_HISTORICAL_DATA_INVALID rather than silently excluding them.

  UNION ALL

  -- Review events: review_error_attempts (unchanged — occurred_at is NOT NULL on this table).
  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section    = p_section
    AND ra.domain     = p_domain
    AND (p_entity_type = 'domain' OR ra.skill = p_skill);
$$;

REVOKE ALL ON FUNCTION public.canonical_mastery_events(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_mastery_events(uuid, text, text, text, text) TO service_role;

-- ============================================================================
-- 3. DEFENSIVE COALESCE: canonical_mastery_events_for_student
-- ============================================================================
-- Original: 20260806000000_diagnostic_gate.sql M5 (lines 168-204)
-- Only change: line 184 pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at)
CREATE OR REPLACE FUNCTION public.canonical_mastery_events_for_student(
  p_student_id uuid
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    pi.id                       AS event_id,
    public.practice_session_mode_to_event_kind(ps.mode)
                                AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at,
    pi.question_id              AS question_id
  FROM public.practice_session_items pi
  JOIN public.practice_sessions ps ON ps.id = pi.session_id
  WHERE pi.user_id = p_student_id
    AND pi.status  = 'answered'
    AND pi.question_section IN ('M','RW')

  UNION ALL

  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section IN ('M','RW');
$$;

REVOKE ALL ON FUNCTION public.canonical_mastery_events_for_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_mastery_events_for_student(uuid) TO service_role;

-- ============================================================================
-- 4. DEFENSIVE COALESCE: compute_streak_days
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 376-424)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at) in event subquery
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.compute_streak_days(
  p_student_id  uuid,
  p_section     text DEFAULT NULL,
  p_domain      text DEFAULT NULL,
  p_skill       text DEFAULT NULL,
  p_t_now       timestamptz DEFAULT now()
) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_streak integer := 0;
  v_today  date := (p_t_now AT TIME ZONE 'UTC')::date;
  v_check_date date;
  v_has_event boolean;
BEGIN
  v_check_date := v_today;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT (e.occurred_at AT TIME ZONE 'UTC')::date AS event_date, e.section, e.domain, e.skill
        FROM (
          SELECT COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at, pi.question_section AS section, pi.question_domain AS domain, pi.question_skill AS skill
          FROM public.practice_session_items pi
          WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          UNION ALL
          SELECT ra.occurred_at, ra.section, ra.domain, ra.skill
          FROM public.review_error_attempts ra
          WHERE ra.student_id = p_student_id
        ) e
      ) ev
      WHERE ev.event_date = v_check_date
        AND (p_section IS NULL OR ev.section = p_section)
        AND (p_domain  IS NULL OR ev.domain  = p_domain)
        AND (p_skill   IS NULL OR ev.skill   = p_skill)
    ) INTO v_has_event;

    IF v_has_event THEN
      v_streak := v_streak + 1;
      v_check_date := v_check_date - 1;
    ELSE
      EXIT;
    END IF;

    IF v_streak >= 730 THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_streak_days(uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_streak_days(uuid, text, text, text, timestamptz) TO service_role;

-- ============================================================================
-- 5. DEFENSIVE COALESCE: compute_longest_streak_days
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 432-462)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at)
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.compute_longest_streak_days(
  p_student_id  uuid,
  p_t_now       timestamptz DEFAULT now()
) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_longest integer := 0;
BEGIN
  WITH active_days AS (
    SELECT DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date AS d
    FROM (
      SELECT COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at
      FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.occurred_at
      FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
    ) e
    WHERE e.occurred_at IS NOT NULL
  ),
  islands AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp
    FROM active_days
  )
  SELECT COALESCE(MAX(run_len), 0) INTO v_longest
  FROM (SELECT COUNT(*) AS run_len FROM islands GROUP BY grp) r;

  RETURN v_longest;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_longest_streak_days(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_longest_streak_days(uuid, timestamptz) TO service_role;

-- ============================================================================
-- 6. DEFENSIVE COALESCE: refresh_section_kpi
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 472-557)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at) in validation + computation
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.refresh_section_kpi(
  p_student_id  uuid,
  p_section     text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_section_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

  -- RB-05B-V1-02: explicit data-integrity validation, no silent NULL filter.
  -- DEFENSIVE COALESCE (2026-08-15): use COALESCE so answered_at covers NULL occurred_at.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section % (refresh_section_kpi)', v_bad_count, p_student_id, p_section;
  END IF;

  WITH section_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section
    ) e
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
    current_streak_days, last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    s.current_streak, a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id, section) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    current_streak_days=EXCLUDED.current_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_section_kpi(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_section_kpi(uuid, text, timestamptz) TO service_role;

-- ============================================================================
-- 7. DEFENSIVE COALESCE: refresh_domain_kpi
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 565-648)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at) in validation + computation
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.refresh_domain_kpi(
  p_student_id  uuid,
  p_section     text,
  p_domain      text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_domain_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_domain_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_domain|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: domain KPI lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- DEFENSIVE COALESCE (2026-08-15): use COALESCE so answered_at covers NULL occurred_at.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section %, domain % (refresh_domain_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH domain_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
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
    FROM domain_events
  )
  INSERT INTO public.student_domain_kpi (
    student_id, section, domain, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, p_domain, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a
  ON CONFLICT (student_id, section, domain) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_domain_kpi(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_domain_kpi(uuid, text, text, timestamptz) TO service_role;

-- ============================================================================
-- 8. DEFENSIVE COALESCE: refresh_skill_kpi
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 657-732)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at) in validation + computation
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.refresh_skill_kpi(
  p_student_id  uuid,
  p_section     text,
  p_domain      text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_skill_batch|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: skill KPI batch lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- DEFENSIVE COALESCE (2026-08-15): use COALESCE so answered_at covers NULL occurred_at.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.question_skill AS skill, pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL OR e.skill IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at/skill for student %, section %, domain % (refresh_skill_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH skill_events AS (
    SELECT skill, correct, occurred_at FROM (
      SELECT pi.question_skill AS skill, pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
  )
  INSERT INTO public.student_skill_kpi (
    student_id, section, domain, skill, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT
    p_student_id, p_section, p_domain, se.skill,
    COUNT(*),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff),
    ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4),
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END,
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END,
    MAX(occurred_at),
    'v1.0', now(), p_t_now
  FROM skill_events se
  GROUP BY se.skill
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_skill_kpi(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_skill_kpi(uuid, text, text, timestamptz) TO service_role;

-- ============================================================================
-- 9. DEFENSIVE COALESCE: refresh_overall_kpi
-- ============================================================================
-- Original: 20260613010000_05b_domain_mastery_kpi.sql (lines 741-830)
-- Change: pi.occurred_at → COALESCE(pi.occurred_at, pi.answered_at) in validation + computation
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.refresh_overall_kpi(
  p_student_id  uuid,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_overall_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

  -- DEFENSIVE COALESCE (2026-08-15): use COALESCE so answered_at covers NULL occurred_at.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student % (refresh_overall_kpi)', v_bad_count, p_student_id;
  END IF;

  WITH all_events AS (
    SELECT section, correct, occurred_at FROM (
      SELECT pi.question_section AS section, pi.is_correct AS correct, COALESCE(pi.occurred_at, pi.answered_at) AS occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.section, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id
    ) e
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
    kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, a.evt_total, a.evt_7d, a.evt_30d,
    a.acc_overall, a.acc_7d, a.acc_30d,
    a.sec_active, s.current_streak, s.longest_streak, a.last_active,
    'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    sections_active=EXCLUDED.sections_active, current_streak_days=EXCLUDED.current_streak_days,
    longest_streak_days=EXCLUDED.longest_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_overall_kpi(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_overall_kpi(uuid, timestamptz) TO service_role;

COMMIT;
