-- ============================================================================
-- Diagnostic Gate — Vertical B, Slice 1
-- ============================================================================
-- @spec [Doc-05A_V1.0 §11 (diagnostic seeding contract); Doc-05C_V1.0 §6.2
--        (evidence gate); Doc-05P_V1.0 §10.1 (DIAGNOSTIC_TOTAL_QUESTIONS=40)]
-- @implemented [2026-08-06]
--
-- Closes gap SP-12: the 40-question initial diagnostic that seeds mastery
-- state and unlocks the Q4 score projection.
--
-- Key changes:
--   M1. Extend practice_sessions.mode CHECK for 'diagnostic'
--   M2. Seed diagnostic config keys in practice_runtime_config
--   M3. Fix MA-10: DIAGNOSTIC_TOTAL_QUESTIONS = 40 in mastery_constants
--   M4. Update canonical_mastery_events() to emit 'diagnostic_attempt' for
--       items from diagnostic sessions (JOIN to practice_sessions.mode)
--   M5. Update canonical_mastery_events_for_student() — same fix
--   M6. Create select_diagnostic_pool() RPC (per-domain balanced selection)
--
-- Karl applies at step 7 — this migration stays UNAPPLIED until then.
--
-- LYCEON-MIGRATION-REVIEWED
-- Rollback:
--   ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;
--   ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_mode_check
--     CHECK (mode IN ('flow', 'structured', 'balanced', 'timed'));
--   DELETE FROM public.practice_runtime_config WHERE key IN ('diagnostic_total_questions','diagnostic_per_domain');
--   -- Re-run original canonical_mastery_events from 20260613000000_lane_c_mastery_seam.sql
--   -- Re-run original canonical_mastery_events_for_student from 20260625000000_05d_backfill_recompute.sql
--   DROP FUNCTION IF EXISTS public.select_diagnostic_pool(integer, text[]);

BEGIN;

-- ============================================================================
-- M1. Extend practice_sessions.mode CHECK for 'diagnostic'
-- ============================================================================
-- Same pattern as 20260629000000_vertical_a_schema_reconcile.sql line 25-27.
ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_mode_check
  CHECK (mode IN ('flow', 'structured', 'balanced', 'timed', 'diagnostic'));

-- ============================================================================
-- M2. Seed diagnostic config keys in practice_runtime_config
-- ============================================================================
-- Config doctrine (Doc-02B §41; INV-02B-15): no hardcoded literals.
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description, environment)
VALUES
  ('diagnostic_total_questions', '40', 'integer', 'product',
   'Total questions in the initial diagnostic (8 domains × 5 = 40, per Doc 05P §10.1 / RB-05P-V1-13)',
   'all'),
  ('diagnostic_per_domain', '5', 'integer', 'product',
   'Questions per domain in the initial diagnostic (MIN_EVENTS_FOR_MASTERY, per Doc 05A §11.2)',
   'all')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = now();

-- ============================================================================
-- M3. Fix MA-10: DIAGNOSTIC_TOTAL_QUESTIONS = 40 in mastery_constants
-- ============================================================================
-- GAP MA-10: was seeded as 20, locked spec value is 40 (8 × 5).
INSERT INTO public.mastery_constants (key, value, description)
VALUES ('DIAGNOSTIC_TOTAL_QUESTIONS', '40',
  'Doc 05P §10.1: N_canonical_domains × MIN_EVENTS_FOR_MASTERY = 8 × 5 = 40 (RB-05P-V1-13)')
ON CONFLICT (key) DO UPDATE SET
  value = '40',
  description = EXCLUDED.description;

-- ============================================================================
-- M4. Update canonical_mastery_events() — emit 'diagnostic_attempt' for
--     items from diagnostic sessions (JOIN to practice_sessions.mode)
-- ============================================================================
-- Original: 20260613000000_lane_c_mastery_seam.sql lines 33-75
-- The practice branch hardcoded 'practice_attempt'::text for ALL practice_session_items.
-- Diagnostic items live in the same table (Doc 05A §11.4: "diagnostics are regular
-- practice events") but must emit event_source_kind='diagnostic_attempt' so the
-- mastery seam guard (LC-D1-001) finds them via the correct kind.
--
-- Fix: JOIN practice_session_items → practice_sessions on session_id.
-- CASE on ps.mode = 'diagnostic' → 'diagnostic_attempt', else → 'practice_attempt'.
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

  -- Review events: review_error_attempts (unchanged).
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
-- M5. Update canonical_mastery_events_for_student() — same diagnostic fix
-- ============================================================================
-- Original: 20260625000000_05d_backfill_recompute.sql lines 52-83
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

-- ============================================================================
-- M6. select_diagnostic_pool() — per-domain balanced selection
-- ============================================================================
-- @spec [Doc-05A §11.2: per-domain coverage ≥ 5; Doc-02B §14: selection from
--        servable_questions] | @implemented [2026-08-06]
--
-- Selects p_per_domain questions from each of the 8 canonical SAT domains,
-- interleaving across difficulty levels (easy → medium → hard → easy → ...)
-- so the diagnostic spans the difficulty spectrum per domain.
--
-- Domain strings use the DB-canonical form ("and", not "&").
-- Returns the same 16-column shape as select_practice_pool_random.
CREATE OR REPLACE FUNCTION public.select_diagnostic_pool(
  p_per_domain     integer  DEFAULT 5,
  p_exclude_ids    text[]   DEFAULT NULL
)
RETURNS TABLE (
  id                      text,
  section                 text,
  stem                    text,
  options                 jsonb,
  difficulty              int,
  correct_answer          text,
  explanation             text,
  domain                  text,
  skill_codes             text[],
  source_type             int,
  item_type               text,
  correct_variants        text[],
  passage                 text,
  assets                  jsonb,
  option_metadata         jsonb,
  estimated_time_seconds  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Step 1: define the 8 canonical domains (byte-identical to Doc 05 Parent §10.2 /
  -- projection evidence gate / mastery_constants domain strings).
  WITH canonical_domains(cd_section, cd_domain) AS (
    VALUES
      ('M',  'Algebra'),
      ('M',  'Advanced Math'),
      ('M',  'Problem Solving and Data Analysis'),
      ('M',  'Geometry and Trigonometry'),
      ('RW', 'Information and Ideas'),
      ('RW', 'Craft and Structure'),
      ('RW', 'Expression of Ideas'),
      ('RW', 'Standard English Conventions')
  ),
  -- Step 2: rank questions within each (domain, difficulty) group randomly.
  per_difficulty AS (
    SELECT
      q.id, q.section, q.stem, q.options, q.difficulty, q.correct_answer,
      q.explanation, q.domain, q.skill_codes, q.source_type, q.item_type,
      q.correct_variants, q.passage, q.assets, q.option_metadata,
      q.estimated_time_seconds,
      ROW_NUMBER() OVER (
        PARTITION BY q.domain, q.difficulty
        ORDER BY random()
      ) AS diff_rank
    FROM public.servable_questions q
    JOIN canonical_domains cd ON q.domain = cd.cd_domain AND q.section = cd.cd_section
    WHERE (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ),
  -- Step 3: interleave across difficulties within each domain.
  -- ORDER BY diff_rank (round), then difficulty (1→2→3 within each round).
  -- For 5 picks: round 1 gets easy/medium/hard, round 2 gets easy/medium = 5 total.
  interleaved AS (
    SELECT
      pd.*,
      ROW_NUMBER() OVER (
        PARTITION BY pd.domain
        ORDER BY pd.diff_rank, pd.difficulty
      ) AS domain_rank
    FROM per_difficulty pd
  )
  -- Step 4: take top p_per_domain per domain, ordered by section then domain.
  SELECT
    il.id, il.section, il.stem, il.options, il.difficulty, il.correct_answer,
    il.explanation, il.domain, il.skill_codes, il.source_type, il.item_type,
    il.correct_variants, il.passage, il.assets, il.option_metadata,
    il.estimated_time_seconds
  FROM interleaved il
  WHERE il.domain_rank <= p_per_domain
  ORDER BY il.section, il.domain, il.domain_rank;
$$;

REVOKE ALL ON FUNCTION public.select_diagnostic_pool(integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_diagnostic_pool(integer, text[]) TO service_role;

COMMIT;
