-- ============================================================================
-- Mastery Constants Table + True Half-Life Migration
-- 
-- Implements Sprint 3 PR-3: True Half-Life mastery as exponentially-decayed
-- evidence (E,C) in the PERSISTED mastery update path.
--
-- Changes:
-- 1. Create mastery_constants table with seeded values
-- 2. Alter attempts/correct columns from INTEGER to NUMERIC for decayed counts
-- 3. Update RPC functions to implement exponential decay formula
-- ============================================================================

-- ============================================================================
-- Step 1: Create mastery_constants table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mastery_constants (
  key TEXT PRIMARY KEY,
  value_num NUMERIC,
  value_text TEXT,
  value_json JSONB,
  units TEXT,
  description TEXT NOT NULL,
  formula_ref TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mastery_constants IS 'Configuration constants for mastery calculation (True Half-Life formula)';

-- ============================================================================
-- Step 2: Seed mastery constants
-- ============================================================================

INSERT INTO public.mastery_constants (key, value_num, units, description, formula_ref) VALUES
  ('HALF_LIFE_DAYS', 21, 'days', 'Half-life for exponential decay of evidence', 'decay = 0.5^(dt_days / HALF_LIFE_DAYS)'),
  ('ALPHA0', 2, 'dimensionless', 'Beta distribution prior: pseudo-count of correct attempts', 'p = (C + ALPHA0) / (E + ALPHA0 + BETA0)'),
  ('BETA0', 2, 'dimensionless', 'Beta distribution prior: pseudo-count of incorrect attempts', 'p = (C + ALPHA0) / (E + ALPHA0 + BETA0)'),
  ('DIAGNOSTIC_TOTAL_QUESTIONS', 20, 'questions', 'Total number of questions in diagnostic assessment', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.mastery_constants (key, value_json, description) VALUES
  ('EVENT_WEIGHTS', '{
    "PRACTICE_SUBMIT": 1.0,
    "DIAGNOSTIC_SUBMIT": 1.25,
    "FULL_LENGTH_SUBMIT": 1.5,
    "TUTOR_RETRY_SUBMIT": 1.0
  }'::jsonb, 'Event type weights for mastery updates'),
  ('MASTERY_THRESHOLDS', '{
    "weak": 40,
    "improving": 70,
    "proficient": 100
  }'::jsonb, 'Mastery score thresholds (0-100 scale) for status labels')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Step 3: RLS for mastery_constants
-- ============================================================================

ALTER TABLE public.mastery_constants ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users (needed for client-side display)
CREATE POLICY "Authenticated users can view mastery constants" 
  ON public.mastery_constants
  FOR SELECT USING (auth.role() IS NOT NULL);

-- Service role can mutate
CREATE POLICY "Service role can manage mastery constants" 
  ON public.mastery_constants
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- Step 4: Alter mastery tables to support decayed counts (NUMERIC)
-- ============================================================================

-- student_skill_mastery: Change attempts/correct from INTEGER to NUMERIC
ALTER TABLE public.student_skill_mastery 
  ALTER COLUMN attempts TYPE NUMERIC USING attempts::NUMERIC,
  ALTER COLUMN correct TYPE NUMERIC USING correct::NUMERIC;

-- student_cluster_mastery: Change attempts/correct from INTEGER to NUMERIC
ALTER TABLE public.student_cluster_mastery 
  ALTER COLUMN attempts TYPE NUMERIC USING attempts::NUMERIC,
  ALTER COLUMN correct TYPE NUMERIC USING correct::NUMERIC;

-- ============================================================================
-- Step 5: Update upsert_skill_mastery with True Half-Life formula
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
  p_user_id UUID,
  p_section VARCHAR(32),
  p_domain VARCHAR(64),
  p_skill VARCHAR(128),
  p_is_correct BOOLEAN,
  p_event_weight NUMERIC DEFAULT 1.0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_half_life_days NUMERIC;
  v_alpha0 NUMERIC;
  v_beta0 NUMERIC;
  
  v_existing_attempts NUMERIC;
  v_existing_correct NUMERIC;
  v_last_updated_at TIMESTAMPTZ;
  
  v_dt_seconds NUMERIC;
  v_dt_days NUMERIC;
  v_decay NUMERIC;
  
  v_E NUMERIC; -- Effective attempts (decayed)
  v_C NUMERIC; -- Effective correct (decayed)
  v_p NUMERIC; -- Probability of success
  v_mastery_score NUMERIC;
  
  v_question_weight NUMERIC := 1.0; -- All questions weighted equally for now
BEGIN
  -- Fetch constants from mastery_constants table
  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
  
  -- Get existing mastery state, or NULL if cold start
  SELECT attempts, correct, updated_at
  INTO v_existing_attempts, v_existing_correct, v_last_updated_at
  FROM public.student_skill_mastery
  WHERE user_id = p_user_id
    AND section = p_section
    AND domain = COALESCE(p_domain, 'unknown')
    AND skill = p_skill;
  
  -- Cold start: no existing row
  IF v_existing_attempts IS NULL THEN
    v_existing_attempts := 0;
    v_existing_correct := 0;
    v_last_updated_at := NOW(); -- No decay on first event
  END IF;
  
  -- Compute time delta and decay factor
  v_dt_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_updated_at));
  v_dt_days := v_dt_seconds / 86400.0;
  v_decay := POWER(0.5, v_dt_days / v_half_life_days);
  
  -- Apply exponential decay and add new evidence
  v_E := (v_existing_attempts * v_decay) + (p_event_weight * v_question_weight);
  v_C := (v_existing_correct * v_decay) + (p_event_weight * v_question_weight * CASE WHEN p_is_correct THEN 1 ELSE 0 END);
  
  -- Compute probability using Beta distribution with priors
  v_p := (v_C + v_alpha0) / (v_E + v_alpha0 + v_beta0);
  
  -- Convert to mastery_score on [0, 100] scale
  v_mastery_score := ROUND(100.0 * v_p, 2);
  
  -- Upsert the row with new mastery score and decayed evidence
  INSERT INTO public.student_skill_mastery (
    user_id, section, domain, skill, 
    attempts, correct, accuracy, mastery_score, 
    last_attempt_at, updated_at
  )
  VALUES (
    p_user_id, 
    p_section, 
    COALESCE(p_domain, 'unknown'), 
    p_skill,
    v_E,
    v_C,
    v_p,
    v_mastery_score,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, section, domain, skill) DO UPDATE SET
    attempts = v_E,
    correct = v_C,
    accuracy = v_p,
    mastery_score = v_mastery_score,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- Step 6: Update upsert_cluster_mastery with True Half-Life formula
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
  p_user_id UUID,
  p_structure_cluster_id UUID,
  p_is_correct BOOLEAN,
  p_event_weight NUMERIC DEFAULT 1.0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_half_life_days NUMERIC;
  v_alpha0 NUMERIC;
  v_beta0 NUMERIC;
  
  v_existing_attempts NUMERIC;
  v_existing_correct NUMERIC;
  v_last_updated_at TIMESTAMPTZ;
  
  v_dt_seconds NUMERIC;
  v_dt_days NUMERIC;
  v_decay NUMERIC;
  
  v_E NUMERIC; -- Effective attempts (decayed)
  v_C NUMERIC; -- Effective correct (decayed)
  v_p NUMERIC; -- Probability of success
  v_mastery_score NUMERIC;
  
  v_question_weight NUMERIC := 1.0; -- All questions weighted equally for now
BEGIN
  -- Fetch constants from mastery_constants table
  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
  
  -- Get existing mastery state, or NULL if cold start
  SELECT attempts, correct, updated_at
  INTO v_existing_attempts, v_existing_correct, v_last_updated_at
  FROM public.student_cluster_mastery
  WHERE user_id = p_user_id
    AND structure_cluster_id = p_structure_cluster_id;
  
  -- Cold start: no existing row
  IF v_existing_attempts IS NULL THEN
    v_existing_attempts := 0;
    v_existing_correct := 0;
    v_last_updated_at := NOW(); -- No decay on first event
  END IF;
  
  -- Compute time delta and decay factor
  v_dt_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_updated_at));
  v_dt_days := v_dt_seconds / 86400.0;
  v_decay := POWER(0.5, v_dt_days / v_half_life_days);
  
  -- Apply exponential decay and add new evidence
  v_E := (v_existing_attempts * v_decay) + (p_event_weight * v_question_weight);
  v_C := (v_existing_correct * v_decay) + (p_event_weight * v_question_weight * CASE WHEN p_is_correct THEN 1 ELSE 0 END);
  
  -- Compute probability using Beta distribution with priors
  v_p := (v_C + v_alpha0) / (v_E + v_alpha0 + v_beta0);
  
  -- Convert to mastery_score on [0, 100] scale
  v_mastery_score := ROUND(100.0 * v_p, 2);
  
  -- Upsert the row with new mastery score and decayed evidence
  INSERT INTO public.student_cluster_mastery (
    user_id, structure_cluster_id,
    attempts, correct, accuracy, mastery_score,
    last_attempt_at, updated_at
  )
  VALUES (
    p_user_id,
    p_structure_cluster_id,
    v_E,
    v_C,
    v_p,
    v_mastery_score,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, structure_cluster_id) DO UPDATE SET
    attempts = v_E,
    correct = v_C,
    accuracy = v_p,
    mastery_score = v_mastery_score,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION public.upsert_skill_mastery IS 'Updates skill mastery using True Half-Life formula: exponential decay of evidence (E,C) with Beta priors';
COMMENT ON FUNCTION public.upsert_cluster_mastery IS 'Updates cluster mastery using True Half-Life formula: exponential decay of evidence (E,C) with Beta priors';
