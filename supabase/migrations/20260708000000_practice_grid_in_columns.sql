-- ============================================================================
-- Practice session items: grid-in column extension
-- ============================================================================
-- @spec [Doc-02B_V4 §14; Doc-02-Preamble_V3 §12 INV-02-08; SCL-018;
--        contracts/mcfr-coexistence.contract.md §(a)(c)]
-- @implemented [2026-07-08]
-- plain English: adds item_type discriminator and correct_variants accepted-
--   forms array to practice_session_items so grid-in (SPR) questions can be
--   persisted and graded through the practice engine. Extends the pool-
--   selection RPC to return the two new columns. MCQ rows are unchanged
--   (DEFAULT 'mcq', variants NULL, options unchanged).
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- ROLLBACK (INV-06): see DOWN MIGRATION section below.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — columns + constraint + function.
-- ============================================================================

-- ============================================================================
-- UP MIGRATION
-- ============================================================================

BEGIN;

-- 1. Add grid-in columns to practice_session_items --------------------------

ALTER TABLE public.practice_session_items
  ADD COLUMN question_item_type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (question_item_type IN ('mcq', 'grid_in'));

ALTER TABLE public.practice_session_items
  ADD COLUMN question_correct_variants TEXT[];

ALTER TABLE public.practice_session_items
  ADD CONSTRAINT psi_item_shape_chk CHECK (
    (question_item_type = 'mcq'
       AND question_correct_variants IS NULL)
    OR
    (question_item_type = 'grid_in'
       AND question_correct_variants IS NOT NULL
       AND array_length(question_correct_variants, 1) >= 1
       AND question_options = '[]'::jsonb)
  );

-- 2. Extend select_practice_pool_random to return item_type + correct_variants
--    Preserves: ACL, WHERE clause, ORDER BY, PLAIN INVOKER security model.
--    DROP required: PG cannot change RETURNS TABLE columns via CREATE OR REPLACE.

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
  correct_variants      text[]
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
    q.correct_variants
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
-- ALTER TABLE public.practice_session_items DROP CONSTRAINT IF EXISTS psi_item_shape_chk;
-- ALTER TABLE public.practice_session_items DROP COLUMN IF EXISTS question_correct_variants;
-- ALTER TABLE public.practice_session_items DROP COLUMN IF EXISTS question_item_type;
--
-- -- Restore the original RPC without item_type/correct_variants:
-- DROP FUNCTION IF EXISTS public.select_practice_pool_random(text[], text[], text[], int[], text[], int);
-- CREATE FUNCTION public.select_practice_pool_random(
--   p_sections text[] DEFAULT NULL, p_domains text[] DEFAULT NULL,
--   p_skills text[] DEFAULT NULL, p_difficulties int[] DEFAULT NULL,
--   p_exclude_ids text[] DEFAULT NULL, p_limit int DEFAULT 10
-- )
-- RETURNS TABLE (
--   id text, section text, stem text, options jsonb, difficulty int,
--   correct_answer text, explanation text, domain text,
--   skill_codes text[], source_type int
-- )
-- LANGUAGE sql VOLATILE
-- AS $$ SELECT q.id, q.section, q.stem, q.options, q.difficulty,
--        q.correct_answer, q.explanation, q.domain, q.skill_codes, q.source_type
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
