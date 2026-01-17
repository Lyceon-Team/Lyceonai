-- Student Mastery Tables Migration
-- Enables weakness tracking: attempts logging + skill/cluster mastery rollups

-- ============================================================================
-- Table: student_question_attempts
-- Logs each answer attempt with question metadata snapshot for analytics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_canonical_id VARCHAR(16) NOT NULL,
  session_id UUID,
  
  -- Answer data
  is_correct BOOLEAN NOT NULL,
  selected_choice VARCHAR(1),
  time_spent_ms INTEGER,
  
  -- Question metadata snapshot (denormalized for analytics)
  exam VARCHAR(16),
  section VARCHAR(32),
  domain VARCHAR(64),
  skill VARCHAR(128),
  subskill VARCHAR(128),
  difficulty_bucket VARCHAR(16),
  structure_cluster_id UUID,
  
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for querying attempts
CREATE INDEX IF NOT EXISTS idx_student_attempts_user_id ON public.student_question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_student_attempts_user_section ON public.student_question_attempts(user_id, section);
CREATE INDEX IF NOT EXISTS idx_student_attempts_user_domain ON public.student_question_attempts(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_student_attempts_user_skill ON public.student_question_attempts(user_id, skill);
CREATE INDEX IF NOT EXISTS idx_student_attempts_canonical_id ON public.student_question_attempts(question_canonical_id);
CREATE INDEX IF NOT EXISTS idx_student_attempts_attempted_at ON public.student_question_attempts(attempted_at DESC);

-- ============================================================================
-- Table: student_skill_mastery
-- Rollup table for skill-level mastery tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_skill_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section VARCHAR(32) NOT NULL,
  domain VARCHAR(64),
  skill VARCHAR(128) NOT NULL,
  
  -- Rollup stats
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy NUMERIC(5,4) NOT NULL DEFAULT 0,
  mastery_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, section, domain, skill)
);

CREATE INDEX IF NOT EXISTS idx_skill_mastery_user_id ON public.student_skill_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_mastery_user_section ON public.student_skill_mastery(user_id, section);
CREATE INDEX IF NOT EXISTS idx_skill_mastery_accuracy ON public.student_skill_mastery(user_id, accuracy ASC);

-- ============================================================================
-- Table: student_cluster_mastery
-- Rollup table for structure-cluster-level mastery tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_cluster_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  structure_cluster_id UUID NOT NULL,
  
  -- Rollup stats
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  accuracy NUMERIC(5,4) NOT NULL DEFAULT 0,
  mastery_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, structure_cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_mastery_user_id ON public.student_cluster_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_cluster_mastery_accuracy ON public.student_cluster_mastery(user_id, accuracy ASC);

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE public.student_question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_skill_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_cluster_mastery ENABLE ROW LEVEL SECURITY;

-- Students can only see their own attempts
CREATE POLICY "Users can view own attempts" ON public.student_question_attempts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attempts" ON public.student_question_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Skill mastery policies
CREATE POLICY "Users can view own skill mastery" ON public.student_skill_mastery
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own skill mastery" ON public.student_skill_mastery
  FOR ALL USING (auth.uid() = user_id);

-- Cluster mastery policies
CREATE POLICY "Users can view own cluster mastery" ON public.student_cluster_mastery
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own cluster mastery" ON public.student_cluster_mastery
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- Service role bypass for server-side operations
-- ============================================================================
CREATE POLICY "Service role full access to attempts" ON public.student_question_attempts
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to skill mastery" ON public.student_skill_mastery
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to cluster mastery" ON public.student_cluster_mastery
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- RPC: Upsert skill mastery (atomic increment)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
  p_user_id UUID,
  p_section VARCHAR(32),
  p_domain VARCHAR(64),
  p_skill VARCHAR(128),
  p_is_correct BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempts INTEGER;
  v_correct INTEGER;
  v_accuracy NUMERIC(5,4);
BEGIN
  INSERT INTO public.student_skill_mastery (user_id, section, domain, skill, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
  VALUES (p_user_id, p_section, COALESCE(p_domain, 'unknown'), p_skill, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, NOW(), NOW())
  ON CONFLICT (user_id, section, domain, skill) DO UPDATE SET
    attempts = student_skill_mastery.attempts + 1,
    correct = student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    accuracy = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
    mastery_score = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- RPC: Upsert cluster mastery (atomic increment)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
  p_user_id UUID,
  p_structure_cluster_id UUID,
  p_is_correct BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.student_cluster_mastery (user_id, structure_cluster_id, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
  VALUES (p_user_id, p_structure_cluster_id, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, NOW(), NOW())
  ON CONFLICT (user_id, structure_cluster_id) DO UPDATE SET
    attempts = student_cluster_mastery.attempts + 1,
    correct = student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    accuracy = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
    mastery_score = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
    last_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

COMMENT ON TABLE public.student_question_attempts IS 'Logs each student answer attempt with question metadata snapshot';
COMMENT ON TABLE public.student_skill_mastery IS 'Rollup of student accuracy by skill for weakness tracking';
COMMENT ON TABLE public.student_cluster_mastery IS 'Rollup of student accuracy by structure cluster for weakness tracking';
