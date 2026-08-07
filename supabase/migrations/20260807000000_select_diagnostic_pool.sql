-- ============================================================================
-- Diagnostic pool selection — 5 per domain × 8 domains, difficulty spread
-- ============================================================================
-- @spec [Doc-02B_V4 §14/§20; Coding Standards §5/§9] | @implemented [2026-08-07]
-- plain English: selects up to p_per_domain questions from EACH of the 8 SAT
--   domains (4 Math + 4 R&W), randomized (ORDER BY random()), with difficulty
--   spread (round-robin across difficulty tiers before repeating). This IS
--   the practice engine's pool selector with a per-domain-count filter —
--   diagnostics are practice, not a separate subsystem.
--
-- SECURITY INVOKER: the function runs with the INVOKER's privileges, not
-- the owner's. Only roles granted EXECUTE can call it, and the underlying
-- servable_questions view's security_invoker flag enforces that only roles
-- with SELECT on questions can read through it.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
-- ROLLBACK (INV-06): DROP FUNCTION public.select_diagnostic_pool;
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — DROP FUNCTION only.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.select_diagnostic_pool(
  p_per_domain     int      DEFAULT 5,
  p_exclude_ids    text[]   DEFAULT NULL
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
  estimated_time_seconds int
)
LANGUAGE sql
SECURITY INVOKER
VOLATILE
AS $$
  -- Step 1: rank within each (domain, difficulty) bucket, randomized.
  -- Step 2: interleave difficulties — pick one from each tier before repeating
  --         (diff_rank ASC, difficulty ASC) so the first 3 picks are easy/med/hard.
  -- Step 3: take p_per_domain per domain → natural difficulty spread.
  WITH diff_ranked AS (
    SELECT
      q.id, q.section, q.stem, q.options, q.difficulty,
      q.correct_answer, q.explanation, q.domain, q.skill_codes,
      q.source_type, q.item_type, q.correct_variants, q.passage,
      q.assets, q.option_metadata, q.estimated_time_seconds,
      ROW_NUMBER() OVER (
        PARTITION BY q.domain, q.difficulty ORDER BY random()
      ) AS diff_rank
    FROM public.servable_questions q
    WHERE (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ),
  interleaved AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY domain ORDER BY diff_rank, difficulty
      ) AS domain_rank
    FROM diff_ranked
  )
  SELECT
    i.id, i.section, i.stem, i.options, i.difficulty,
    i.correct_answer, i.explanation, i.domain, i.skill_codes,
    i.source_type, i.item_type, i.correct_variants, i.passage,
    i.assets, i.option_metadata, i.estimated_time_seconds
  FROM interleaved i
  WHERE i.domain_rank <= p_per_domain
  ORDER BY random();
$$;

-- service_role only — same grant model as select_practice_pool_random.
GRANT EXECUTE ON FUNCTION public.select_diagnostic_pool(int, text[])
  TO service_role;

COMMIT;
