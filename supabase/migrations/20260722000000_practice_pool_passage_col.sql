-- ============================================================================
-- Practice pool RPC: add passage column (13th)
-- ============================================================================
-- @spec [Doc-02B_V4 §14; Doc-02A_V6 §16 questions DDL] | @implemented [2026-07-22]
-- plain English: R&W questions carry a reading passage (questions.passage) that
--   is required to understand the question. select_practice_pool_random did not
--   return this column, so prepopulation wrote NULL to
--   practice_session_items.question_passage and R&W passages never rendered.
--   This migration extends the RETURNS TABLE + SELECT to include passage as the
--   13th column. Additive only — all 12 existing columns are unchanged.
--
-- Preserves: published gate, section/domain/skill/difficulty/exclude filters,
--   ORDER BY random() LIMIT p_limit, PLAIN-INVOKER posture (prosecdef=false,
--   NO SET search_path), ACL {=X/postgres,postgres=X/postgres,
--   service_role=X/postgres}.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — function DROP+recreate restores 12-col signature.
-- ============================================================================

-- ============================================================================
-- UP MIGRATION
-- ============================================================================

BEGIN;

-- DROP required: PG cannot change RETURNS TABLE columns via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.select_practice_pool_random(text[], text[], text[], int[], text[], int);

CREATE FUNCTION public.select_practice_pool_random(
  p_sections       text[]   DEFAULT NULL,
  p_domains        text[]   DEFAULT NULL,
  p_skills         text[]   DEFAULT NULL,
  p_difficulties   int[]    DEFAULT NULL,
  p_exclude_ids    text[]   DEFAULT NULL,
  p_limit          int      DEFAULT 10
)
RETURNS TABLE (
  id                    text,
  section               text,
  stem                  text,
  options               jsonb,
  difficulty            int,
  correct_answer        text,
  explanation           text,
  domain                text,
  skill_codes           text[],
  source_type           int,
  item_type             text,
  correct_variants      text[],
  passage               text
)
LANGUAGE sql
VOLATILE
AS $$
  SELECT
    q.id,
    q.section,
    q.stem,
    q.options,
    q.difficulty,
    q.correct_answer,
    q.explanation,
    q.domain,
    q.skill_codes,
    q.source_type,
    q.item_type,
    q.correct_variants,
    q.passage
  FROM public.questions q
  WHERE q.status = 'published'
    AND (p_sections IS NULL    OR q.section = ANY(p_sections))
    AND (p_domains IS NULL     OR q.domain = ANY(p_domains))
    AND (p_skills IS NULL      OR q.skill_codes && p_skills)
    AND (p_difficulties IS NULL OR q.difficulty = ANY(p_difficulties))
    AND (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.select_practice_pool_random(text[], text[], text[], int[], text[], int)
  TO service_role;

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (rollback — run these statements to reverse)
-- ============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.select_practice_pool_random(text[], text[], text[], int[], text[], int);
-- CREATE FUNCTION public.select_practice_pool_random(
--   p_sections text[] DEFAULT NULL, p_domains text[] DEFAULT NULL,
--   p_skills text[] DEFAULT NULL, p_difficulties int[] DEFAULT NULL,
--   p_exclude_ids text[] DEFAULT NULL, p_limit int DEFAULT 10
-- )
-- RETURNS TABLE (
--   id text, section text, stem text, options jsonb, difficulty int,
--   correct_answer text, explanation text, domain text,
--   skill_codes text[], source_type int, item_type text,
--   correct_variants text[]
-- )
-- LANGUAGE sql VOLATILE
-- AS $$ SELECT q.id, q.section, q.stem, q.options, q.difficulty,
--        q.correct_answer, q.explanation, q.domain, q.skill_codes,
--        q.source_type, q.item_type, q.correct_variants
--   FROM public.questions q WHERE q.status = 'published'
--     AND (p_sections IS NULL OR q.section = ANY(p_sections))
--     AND (p_domains IS NULL OR q.domain = ANY(p_domains))
--     AND (p_skills IS NULL OR q.skill_codes && p_skills)
--     AND (p_difficulties IS NULL OR q.difficulty = ANY(p_difficulties))
--     AND (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
--   ORDER BY random() LIMIT p_limit; $$;
-- GRANT EXECUTE ON FUNCTION public.select_practice_pool_random(text[], text[], text[], int[], text[], int)
--   TO service_role;
-- COMMIT;
