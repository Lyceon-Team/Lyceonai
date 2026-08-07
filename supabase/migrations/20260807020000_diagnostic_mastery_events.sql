-- @spec [Doc-05A_V1 §6.2 (canonical_mastery_events) / Doc-05A §11 (diagnostic seeding)]
-- @implemented [2026-08-07]
-- plain English: extends canonical_mastery_events and its per-student variant to emit
--   'diagnostic_attempt' for items from mode='diagnostic' sessions instead of the generic
--   'practice_attempt'. Without this, the mastery seam guard rejects diagnostic events
--   with MASTERY_EVENT_NOT_DERIVED because apply_mastery_event passes 'diagnostic_attempt'
--   but the canonical function only returns 'practice_attempt'.
-- trade-offs: adds a JOIN to practice_sessions for the mode column; the join is on the
--   indexed session_id FK and adds negligible cost for the per-entity / per-student queries.
-- ROLLBACK: re-run the prior CREATE OR REPLACE from 20260613000000_lane_c_mastery_seam.sql (lines 33-75)
--   and 20260625000000_05d_backfill_recompute.sql (lines 52-83) to restore the hardcoded
--   'practice_attempt' versions. No schema changes to reverse — only function body.
-- LYCEON-MIGRATION-REVIEWED

-- 1. canonical_mastery_events — entity-level derivation (practice + review)
CREATE OR REPLACE FUNCTION public.canonical_mastery_events(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Practice events: canonical table practice_session_items (Doc 02B §8 / seam §2; NOT the
  -- fossil practice_attempts_v0 — A3/SP-22). Mastery-bearing = answered items only; pending/
  -- served/skipped are not mastery events (their seam columns are unpopulated by design).
  -- Diagnostic sessions (mode='diagnostic') emit 'diagnostic_attempt' instead of 'practice_attempt'.
  SELECT
    pi.id                       AS event_id,
    CASE WHEN ps.mode = 'diagnostic'
         THEN 'diagnostic_attempt'::text
         ELSE 'practice_attempt'::text
    END                         AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    pi.occurred_at              AS occurred_at,
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

  -- Review events: review_error_attempts. Every row is an attempt (fires on correct AND incorrect,
  -- H7). Seam columns are first-class; used_tutor is telemetry-only (never read here).
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


-- 2. canonical_mastery_events_for_student — per-student accessor (R3)
CREATE OR REPLACE FUNCTION public.canonical_mastery_events_for_student(
  p_student_id uuid
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    pi.id                       AS event_id,
    CASE WHEN ps.mode = 'diagnostic'
         THEN 'diagnostic_attempt'::text
         ELSE 'practice_attempt'::text
    END                         AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    pi.occurred_at              AS occurred_at,
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
