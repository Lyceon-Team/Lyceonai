-- ============================================================================
-- Practice pool selection — DB-side ORDER BY random()
-- ============================================================================
-- @spec [Doc-02B_V4 §14/§15; CEO model; SCL-P-ADAPTIVE] | @implemented [2026-06-27]
-- plain English: selects N random questions from the pool matching the given
--   faceted filters (sections, domains, skills, difficulties). Replaces TS-side
--   Fisher-Yates shuffle with Postgres-native ORDER BY random(). Only serving-safe
--   columns are returned; correct_answer/explanation are included for server-side
--   grading at prepopulation but are never projected to the student pre-submit.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
-- ROLLBACK (INV-06): DROP FUNCTION public.select_practice_pool_random;
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — DROP FUNCTION only.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.select_practice_pool_random(
  p_sections       text[]   DEFAULT NULL,
  p_domains        text[]   DEFAULT NULL,
  p_skills         text[]   DEFAULT NULL,
  p_difficulties   int[]    DEFAULT NULL,
  p_exclude_ids    uuid[]   DEFAULT NULL,
  p_limit          int      DEFAULT 10
)
RETURNS TABLE (
  id                    uuid,
  section               text,
  item_type             text,
  stem                  text,
  options               jsonb,
  difficulty            text,
  correct_answer        text,
  explanation           text,
  domain                text,
  skill_codes           text[],
  source_type           text,
  correct_variants      text[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    q.id,
    q.section,
    q.item_type,
    q.stem,
    q.options,
    q.difficulty::text,
    q.correct_answer,
    q.explanation,
    q.domain,
    q.skill_codes,
    q.source_type::text,
    q.correct_variants
  FROM public.questions q
  WHERE q.item_type IN ('mcq', 'grid_in')
    AND (p_sections IS NULL    OR q.section = ANY(p_sections))
    AND (p_domains IS NULL     OR q.domain = ANY(p_domains))
    AND (p_skills IS NULL      OR q.skill_codes && p_skills)
    AND (p_difficulties IS NULL OR (
      CASE
        WHEN q.difficulty ~ '^\d+$' THEN q.difficulty::int
        WHEN lower(trim(q.difficulty)) = 'easy'   THEN 1
        WHEN lower(trim(q.difficulty)) = 'medium'  THEN 2
        WHEN lower(trim(q.difficulty)) = 'hard'    THEN 3
        ELSE 2
      END
    ) = ANY(p_difficulties))
    AND (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.select_practice_pool_random(text[], text[], text[], int[], uuid[], int)
  TO service_role;

COMMIT;
