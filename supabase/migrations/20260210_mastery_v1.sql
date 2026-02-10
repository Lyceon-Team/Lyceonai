-- ============================================================================
-- Mastery V1.0 Migration
-- 
-- Updates mastery tables and RPC functions to implement the exact Mastery v1.0
-- specification with:
-- - Mastery score range [0, 100] instead of [0, 1]
-- - Event-type-weighted delta formula
-- - EMA-style updates (M_new = M_old + ALPHA * delta)
-- - Cold start initialization to M_init = 50.0
-- ============================================================================

-- ============================================================================
-- Step 1: Update mastery_score columns to support [0, 100] range
-- ============================================================================

-- student_skill_mastery: Change mastery_score from NUMERIC(5,4) [0,1] to NUMERIC(5,2) [0,100]
-- Migrate existing data by multiplying by 100
ALTER TABLE public.student_skill_mastery 
  ALTER COLUMN mastery_score TYPE NUMERIC(5,2);

UPDATE public.student_skill_mastery 
  SET mastery_score = mastery_score * 100 
  WHERE mastery_score <= 1.0;

-- student_cluster_mastery: Same transformation
ALTER TABLE public.student_cluster_mastery 
  ALTER COLUMN mastery_score TYPE NUMERIC(5,2);

UPDATE public.student_cluster_mastery 
  SET mastery_score = mastery_score * 100 
  WHERE mastery_score <= 1.0;

-- ============================================================================
-- Step 2: Create diagnostic_sessions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.diagnostic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blueprint_version VARCHAR(32) NOT NULL DEFAULT 'diag_v1',
  question_ids TEXT[] NOT NULL, -- Ordered array of canonical IDs
  current_index INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_student_id 
  ON public.diagnostic_sessions(student_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_completed 
  ON public.diagnostic_sessions(student_id, completed_at);

-- ============================================================================
-- Step 3: Create diagnostic_responses table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.diagnostic_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  question_canonical_id VARCHAR(16) NOT NULL,
  question_index INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  selected_choice VARCHAR(1),
  time_spent_ms INTEGER,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(session_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_responses_session_id 
  ON public.diagnostic_responses(session_id);

-- ============================================================================
-- Step 4: Add RLS policies for diagnostic tables
-- ============================================================================

ALTER TABLE public.diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_responses ENABLE ROW LEVEL SECURITY;

-- Students can only access their own diagnostic sessions
CREATE POLICY "Users can view own diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Users can manage own diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR ALL USING (auth.uid() = student_id);

-- Students can only access responses for their own sessions
CREATE POLICY "Users can view own diagnostic responses" 
  ON public.diagnostic_responses
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM public.diagnostic_sessions WHERE student_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own diagnostic responses" 
  ON public.diagnostic_responses
  FOR ALL USING (
    session_id IN (
      SELECT id FROM public.diagnostic_sessions WHERE student_id = auth.uid()
    )
  );

-- Service role bypass
CREATE POLICY "Service role full access to diagnostic sessions" 
  ON public.diagnostic_sessions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to diagnostic responses" 
  ON public.diagnostic_responses
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- Step 5: Update upsert_skill_mastery with Mastery v1.0 formula
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
  v_alpha CONSTANT NUMERIC := 0.20;
  v_base_delta CONSTANT NUMERIC := 10.0;
  v_m_init CONSTANT NUMERIC := 50.0;
  v_m_min CONSTANT NUMERIC := 0;
  v_m_max CONSTANT NUMERIC := 100;
  
  v_current_mastery NUMERIC;
  v_sign NUMERIC;
  v_delta NUMERIC;
  v_new_mastery NUMERIC;
BEGIN
  -- Get current mastery score, or use M_init if no row exists
  SELECT mastery_score INTO v_current_mastery
  FROM public.student_skill_mastery
  WHERE user_id = p_user_id
    AND section = p_section
    AND domain = COALESCE(p_domain, 'unknown')
    AND skill = p_skill;
  
  -- Cold start: initialize to M_init if no existing row
  IF v_current_mastery IS NULL THEN
    v_current_mastery := v_m_init;
  END IF;
  
  -- Compute mastery delta using Mastery v1.0 formula
  -- sign = +1 if correct, -1 if incorrect
  v_sign := CASE WHEN p_is_correct THEN 1 ELSE -1 END;
  
  -- delta = sign * base_delta * event_weight * question_weight (question_weight=1.0 for v1.0)
  v_delta := v_sign * v_base_delta * p_event_weight * 1.0;
  
  -- M_new_raw = M_old + ALPHA * delta
  v_new_mastery := v_current_mastery + (v_alpha * v_delta);
  
  -- Clamp to [M_min, M_max]
  v_new_mastery := GREATEST(v_m_min, LEAST(v_m_max, v_new_mastery));
  
  -- Upsert the row with new mastery score
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
    1,
    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END,
    v_new_mastery,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, section, domain, skill) DO UPDATE SET
    attempts = student_skill_mastery.attempts + 1,
    correct = student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    accuracy = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC 
               / (student_skill_mastery.attempts + 1)::NUMERIC,
    mastery_score = v_new_mastery,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- Step 6: Update upsert_cluster_mastery with Mastery v1.0 formula
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
  v_alpha CONSTANT NUMERIC := 0.20;
  v_base_delta CONSTANT NUMERIC := 10.0;
  v_m_init CONSTANT NUMERIC := 50.0;
  v_m_min CONSTANT NUMERIC := 0;
  v_m_max CONSTANT NUMERIC := 100;
  
  v_current_mastery NUMERIC;
  v_sign NUMERIC;
  v_delta NUMERIC;
  v_new_mastery NUMERIC;
BEGIN
  -- Get current mastery score, or use M_init if no row exists
  SELECT mastery_score INTO v_current_mastery
  FROM public.student_cluster_mastery
  WHERE user_id = p_user_id
    AND structure_cluster_id = p_structure_cluster_id;
  
  -- Cold start: initialize to M_init if no existing row
  IF v_current_mastery IS NULL THEN
    v_current_mastery := v_m_init;
  END IF;
  
  -- Compute mastery delta using Mastery v1.0 formula
  v_sign := CASE WHEN p_is_correct THEN 1 ELSE -1 END;
  v_delta := v_sign * v_base_delta * p_event_weight * 1.0;
  v_new_mastery := v_current_mastery + (v_alpha * v_delta);
  
  -- Clamp to [M_min, M_max]
  v_new_mastery := GREATEST(v_m_min, LEAST(v_m_max, v_new_mastery));
  
  -- Upsert the row with new mastery score
  INSERT INTO public.student_cluster_mastery (
    user_id, structure_cluster_id,
    attempts, correct, accuracy, mastery_score,
    last_attempt_at, updated_at
  )
  VALUES (
    p_user_id,
    p_structure_cluster_id,
    1,
    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END,
    v_new_mastery,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, structure_cluster_id) DO UPDATE SET
    attempts = student_cluster_mastery.attempts + 1,
    correct = student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    accuracy = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC 
               / (student_cluster_mastery.attempts + 1)::NUMERIC,
    mastery_score = v_new_mastery,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.diagnostic_sessions IS 'Diagnostic assessment sessions with deterministic blueprint (Mastery v1.0)';
COMMENT ON TABLE public.diagnostic_responses IS 'Per-question responses within a diagnostic session';
COMMENT ON FUNCTION public.upsert_skill_mastery IS 'Updates skill mastery using Mastery v1.0 EMA formula: M_new = clamp(M_old + ALPHA * delta, 0, 100)';
COMMENT ON FUNCTION public.upsert_cluster_mastery IS 'Updates cluster mastery using Mastery v1.0 EMA formula: M_new = clamp(M_old + ALPHA * delta, 0, 100)';
