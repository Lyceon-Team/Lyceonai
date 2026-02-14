-- ============================================================================
-- Mastery True Half-Life with Difficulty Weights and Deterministic Rounding
-- 
-- Sprint 3 PR-4: Implements per-question difficulty weights and deterministic
-- rounding for persisted mastery updates.
--
-- Changes:
-- 1. Add QUESTION_DIFFICULTY_WEIGHTS to mastery_constants
-- 2. Add rounding precision constants (ROUND_EVIDENCE_DECIMALS, etc.)
-- 3. Add TUTOR_VIEW to EVENT_WEIGHTS
-- 4. Update RPC signatures to accept p_event_type and p_difficulty_bucket
-- 5. Apply difficulty weights in decay formula
-- 6. Apply deterministic rounding at specified precision
-- ============================================================================

-- ============================================================================
-- Step 1: Seed additional mastery constants (only if absent)
-- ============================================================================

-- Add QUESTION_DIFFICULTY_WEIGHTS JSON constant
INSERT INTO public.mastery_constants (key, value_json, description) VALUES
  ('QUESTION_DIFFICULTY_WEIGHTS', '{
    "easy": 1.0,
    "medium": 1.1,
    "hard": 1.2
  }'::jsonb, 'Difficulty-based weights for question evidence (w_q)')
ON CONFLICT (key) DO NOTHING;

-- Add rounding precision constants
INSERT INTO public.mastery_constants (key, value_num, units, description) VALUES
  ('ROUND_EVIDENCE_DECIMALS', 2, 'decimals', 'Decimal precision for E and C (evidence counts)'),
  ('ROUND_ACCURACY_DECIMALS', 4, 'decimals', 'Decimal precision for accuracy (p)'),
  ('ROUND_MASTERY_SCORE_DECIMALS', 2, 'decimals', 'Decimal precision for mastery_score (0-100 scale)')
ON CONFLICT (key) DO NOTHING;

-- Add ROUNDING_MODE documentation constant
INSERT INTO public.mastery_constants (key, value_text, description, formula_ref) VALUES
  ('ROUNDING_MODE', 'HALF_UP', 'Postgres ROUND() uses half-up (banker''s rounding in ties)', 'ROUND(x, n) rounds to n decimal places')
ON CONFLICT (key) DO NOTHING;

-- Update EVENT_WEIGHTS to include TUTOR_VIEW (if not already present)
-- Note: We cannot do partial JSON updates with ON CONFLICT DO NOTHING,
-- so we only insert if the key doesn't exist. For updates, use manual migration.
INSERT INTO public.mastery_constants (key, value_json, description) VALUES
  ('EVENT_WEIGHTS', '{
    "PRACTICE_SUBMIT": 1.0,
    "DIAGNOSTIC_SUBMIT": 1.25,
    "FULL_LENGTH_SUBMIT": 1.5,
    "TUTOR_RETRY_SUBMIT": 1.0,
    "TUTOR_VIEW": 0.0
  }'::jsonb, 'Event type weights for mastery updates')
ON CONFLICT (key) DO UPDATE SET
  value_json = EXCLUDED.value_json || public.mastery_constants.value_json;

-- ============================================================================
-- Step 2: Update upsert_skill_mastery with difficulty weights + rounding
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
  p_user_id UUID,
  p_section VARCHAR(32),
  p_domain VARCHAR(64),
  p_skill VARCHAR(128),
  p_is_correct BOOLEAN,
  p_event_weight NUMERIC DEFAULT 1.0,
  p_event_type TEXT DEFAULT 'PRACTICE_SUBMIT',
  p_difficulty_bucket TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_half_life_days NUMERIC;
  v_alpha0 NUMERIC;
  v_beta0 NUMERIC;
  v_round_evidence_decimals INTEGER;
  v_round_accuracy_decimals INTEGER;
  v_round_mastery_score_decimals INTEGER;
  
  v_existing_attempts NUMERIC;
  v_existing_correct NUMERIC;
  v_last_updated_at TIMESTAMPTZ;
  
  v_dt_seconds NUMERIC;
  v_dt_days NUMERIC;
  v_decay NUMERIC;
  
  v_event_weight NUMERIC;
  v_difficulty_weight NUMERIC;
  
  v_E NUMERIC; -- Effective attempts (decayed)
  v_C NUMERIC; -- Effective correct (decayed)
  v_p NUMERIC; -- Probability of success
  v_mastery_score NUMERIC;
BEGIN
  -- Fetch constants from mastery_constants table
  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
  SELECT value_num INTO v_round_evidence_decimals FROM public.mastery_constants WHERE key = 'ROUND_EVIDENCE_DECIMALS';
  SELECT value_num INTO v_round_accuracy_decimals FROM public.mastery_constants WHERE key = 'ROUND_ACCURACY_DECIMALS';
  SELECT value_num INTO v_round_mastery_score_decimals FROM public.mastery_constants WHERE key = 'ROUND_MASTERY_SCORE_DECIMALS';
  
  -- Get event weight from EVENT_WEIGHTS JSON
  SELECT COALESCE(
    (value_json ->> p_event_type)::numeric,
    1.0
  ) INTO v_event_weight
  FROM public.mastery_constants
  WHERE key = 'EVENT_WEIGHTS';
  
  -- Get difficulty weight from QUESTION_DIFFICULTY_WEIGHTS JSON
  -- Default to 1.0 if difficulty_bucket is null/empty or missing from JSON
  SELECT COALESCE(
    (value_json ->> p_difficulty_bucket)::numeric,
    1.0
  ) INTO v_difficulty_weight
  FROM public.mastery_constants
  WHERE key = 'QUESTION_DIFFICULTY_WEIGHTS';
  
  -- If difficulty_bucket is null, default to 1.0
  IF p_difficulty_bucket IS NULL OR p_difficulty_bucket = '' THEN
    v_difficulty_weight := 1.0;
  END IF;
  
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
  
  -- Apply exponential decay and add new evidence with weights
  -- E := round(E_old*decay + (w_event*w_q), ROUND_EVIDENCE_DECIMALS)
  -- C := round(C_old*decay + (w_event*w_q*is_correct), ROUND_EVIDENCE_DECIMALS)
  v_E := ROUND(
    (v_existing_attempts * v_decay) + (v_event_weight * v_difficulty_weight),
    v_round_evidence_decimals
  );
  v_C := ROUND(
    (v_existing_correct * v_decay) + (v_event_weight * v_difficulty_weight * CASE WHEN p_is_correct THEN 1 ELSE 0 END),
    v_round_evidence_decimals
  );
  
  -- Compute probability using Beta distribution with priors
  -- p := (C + ALPHA0) / (E + ALPHA0 + BETA0)
  v_p := (v_C + v_alpha0) / (v_E + v_alpha0 + v_beta0);
  
  -- Apply deterministic rounding
  -- accuracy := round(p, ROUND_ACCURACY_DECIMALS)
  -- mastery_score := round(100*p, ROUND_MASTERY_SCORE_DECIMALS)
  v_p := ROUND(v_p, v_round_accuracy_decimals);
  v_mastery_score := ROUND(100.0 * v_p, v_round_mastery_score_decimals);
  
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
-- Step 3: Update upsert_cluster_mastery with difficulty weights + rounding
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
  p_user_id UUID,
  p_structure_cluster_id UUID,
  p_is_correct BOOLEAN,
  p_event_weight NUMERIC DEFAULT 1.0,
  p_event_type TEXT DEFAULT 'PRACTICE_SUBMIT',
  p_difficulty_bucket TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_half_life_days NUMERIC;
  v_alpha0 NUMERIC;
  v_beta0 NUMERIC;
  v_round_evidence_decimals INTEGER;
  v_round_accuracy_decimals INTEGER;
  v_round_mastery_score_decimals INTEGER;
  
  v_existing_attempts NUMERIC;
  v_existing_correct NUMERIC;
  v_last_updated_at TIMESTAMPTZ;
  
  v_dt_seconds NUMERIC;
  v_dt_days NUMERIC;
  v_decay NUMERIC;
  
  v_event_weight NUMERIC;
  v_difficulty_weight NUMERIC;
  
  v_E NUMERIC; -- Effective attempts (decayed)
  v_C NUMERIC; -- Effective correct (decayed)
  v_p NUMERIC; -- Probability of success
  v_mastery_score NUMERIC;
BEGIN
  -- Fetch constants from mastery_constants table
  SELECT value_num INTO v_half_life_days FROM public.mastery_constants WHERE key = 'HALF_LIFE_DAYS';
  SELECT value_num INTO v_alpha0 FROM public.mastery_constants WHERE key = 'ALPHA0';
  SELECT value_num INTO v_beta0 FROM public.mastery_constants WHERE key = 'BETA0';
  SELECT value_num INTO v_round_evidence_decimals FROM public.mastery_constants WHERE key = 'ROUND_EVIDENCE_DECIMALS';
  SELECT value_num INTO v_round_accuracy_decimals FROM public.mastery_constants WHERE key = 'ROUND_ACCURACY_DECIMALS';
  SELECT value_num INTO v_round_mastery_score_decimals FROM public.mastery_constants WHERE key = 'ROUND_MASTERY_SCORE_DECIMALS';
  
  -- Get event weight from EVENT_WEIGHTS JSON
  SELECT COALESCE(
    (value_json ->> p_event_type)::numeric,
    1.0
  ) INTO v_event_weight
  FROM public.mastery_constants
  WHERE key = 'EVENT_WEIGHTS';
  
  -- Get difficulty weight from QUESTION_DIFFICULTY_WEIGHTS JSON
  -- Default to 1.0 if difficulty_bucket is null/empty or missing from JSON
  SELECT COALESCE(
    (value_json ->> p_difficulty_bucket)::numeric,
    1.0
  ) INTO v_difficulty_weight
  FROM public.mastery_constants
  WHERE key = 'QUESTION_DIFFICULTY_WEIGHTS';
  
  -- If difficulty_bucket is null, default to 1.0
  IF p_difficulty_bucket IS NULL OR p_difficulty_bucket = '' THEN
    v_difficulty_weight := 1.0;
  END IF;
  
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
  
  -- Apply exponential decay and add new evidence with weights
  -- E := round(E_old*decay + (w_event*w_q), ROUND_EVIDENCE_DECIMALS)
  -- C := round(C_old*decay + (w_event*w_q*is_correct), ROUND_EVIDENCE_DECIMALS)
  v_E := ROUND(
    (v_existing_attempts * v_decay) + (v_event_weight * v_difficulty_weight),
    v_round_evidence_decimals
  );
  v_C := ROUND(
    (v_existing_correct * v_decay) + (v_event_weight * v_difficulty_weight * CASE WHEN p_is_correct THEN 1 ELSE 0 END),
    v_round_evidence_decimals
  );
  
  -- Compute probability using Beta distribution with priors
  -- p := (C + ALPHA0) / (E + ALPHA0 + BETA0)
  v_p := (v_C + v_alpha0) / (v_E + v_alpha0 + v_beta0);
  
  -- Apply deterministic rounding
  -- accuracy := round(p, ROUND_ACCURACY_DECIMALS)
  -- mastery_score := round(100*p, ROUND_MASTERY_SCORE_DECIMALS)
  v_p := ROUND(v_p, v_round_accuracy_decimals);
  v_mastery_score := ROUND(100.0 * v_p, v_round_mastery_score_decimals);
  
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
-- Comments (with full signatures for migration-safety)
-- ============================================================================

COMMENT ON FUNCTION public.upsert_skill_mastery(UUID, VARCHAR(32), VARCHAR(64), VARCHAR(128), BOOLEAN, NUMERIC, TEXT, TEXT) IS 
  'Updates skill mastery using True Half-Life formula with difficulty weights: decay = 0.5^(dt/HALF_LIFE_DAYS), E = round(E_old*decay + w_event*w_q, decimals), p = (C+ALPHA0)/(E+ALPHA0+BETA0)';

COMMENT ON FUNCTION public.upsert_cluster_mastery(UUID, UUID, BOOLEAN, NUMERIC, TEXT, TEXT) IS 
  'Updates cluster mastery using True Half-Life formula with difficulty weights: decay = 0.5^(dt/HALF_LIFE_DAYS), E = round(E_old*decay + w_event*w_q, decimals), p = (C+ALPHA0)/(E+ALPHA0+BETA0)';
