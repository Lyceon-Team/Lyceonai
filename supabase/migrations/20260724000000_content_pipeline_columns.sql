-- ============================================================================
-- Content pipeline: servable_questions view, new snapshot columns, RPC extension
-- ============================================================================
-- @spec [Doc-02B_V4 §14; Doc-02A_V6 §16 questions DDL; Coding Standards §9]
-- @implemented [2026-07-24]
--
-- (a) CREATE VIEW servable_questions — single shared definition of "what
--     questions are eligible for serving" (published + no issue_flags).
--     Used by select_practice_pool_random and future review/full-length surfaces.
--
-- (b) ADD to practice_session_items: question_assets (jsonb), question_estimated_time_seconds (integer).
--     question_option_metadata already exists.
--
-- (c) EXTEND select_practice_pool_random to return 3 new columns:
--     assets (jsonb), option_metadata (jsonb), estimated_time_seconds (integer).
--     Now selects FROM servable_questions instead of questions directly.
--     Total: 16 columns (was 13). Additive only — all 13 existing columns unchanged.
--
-- Preserves: PLAIN-INVOKER posture (prosecdef=false, NO SET search_path),
--   ACL {=X/postgres,postgres=X/postgres,service_role=X/postgres}.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION below.
-- ============================================================================

-- ============================================================================
-- UP MIGRATION
-- ============================================================================

BEGIN;

-- (a) Servable-questions view: shared definition for all serving surfaces.
-- A question is servable iff: published AND no issue_flags set.
CREATE OR REPLACE VIEW public.servable_questions AS
  SELECT *
  FROM public.questions
  WHERE status = 'published'
    AND (issue_flags IS NULL OR array_length(issue_flags, 1) IS NULL);

-- (b) New snapshot columns on practice_session_items.
ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS question_assets jsonb,
  ADD COLUMN IF NOT EXISTS question_estimated_time_seconds integer;

-- (c) Extend select_practice_pool_random: 13 → 16 columns, source from view.
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
  passage               text,
  assets                jsonb,
  option_metadata       jsonb,
  estimated_time_seconds integer
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
    q.passage,
    q.assets,
    q.option_metadata,
    q.estimated_time_seconds
  FROM public.servable_questions q
  WHERE (p_sections IS NULL    OR q.section = ANY(p_sections))
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
--
-- -- Restore 13-column RPC selecting from questions directly
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
--   correct_variants text[], passage text
-- )
-- LANGUAGE sql VOLATILE
-- AS $$ SELECT q.id, q.section, q.stem, q.options, q.difficulty,
--        q.correct_answer, q.explanation, q.domain, q.skill_codes,
--        q.source_type, q.item_type, q.correct_variants, q.passage
--   FROM public.questions q WHERE q.status = 'published'
--     AND (p_sections IS NULL OR q.section = ANY(p_sections))
--     AND (p_domains IS NULL OR q.domain = ANY(p_domains))
--     AND (p_skills IS NULL OR q.skill_codes && p_skills)
--     AND (p_difficulties IS NULL OR q.difficulty = ANY(p_difficulties))
--     AND (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
--   ORDER BY random() LIMIT p_limit; $$;
-- GRANT EXECUTE ON FUNCTION public.select_practice_pool_random(text[], text[], text[], int[], text[], int)
--   TO service_role;
--
-- -- Drop new columns
-- ALTER TABLE public.practice_session_items
--   DROP COLUMN IF EXISTS question_assets,
--   DROP COLUMN IF EXISTS question_estimated_time_seconds;
--
-- -- Drop servable_questions view
-- DROP VIEW IF EXISTS public.servable_questions;
--
-- COMMIT;
