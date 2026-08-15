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
--   functions without COALESCE, re-run the originals from
--   20260806000000_diagnostic_gate.sql (M4b, M5).
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

COMMIT;
