-- Practice Sessions and Answer Attempts Tables
-- Required for the Practice UI to function properly
-- IDEMPOTENT: Safe to run on fresh DB or existing DB
-- NOTE: RLS policies require Supabase's auth schema (run on Supabase, not local dev DB)

-- ============================================================================
-- Table: practice_sessions
-- Stores user practice session metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  mode TEXT NOT NULL,
  section TEXT,
  difficulty TEXT,
  
  target_duration_ms INTEGER,
  actual_duration_ms INTEGER,
  
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'paused', 'completed', 'abandoned')),
  question_ids UUID[],
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  
  metadata JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_id 
  ON public.practice_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_status 
  ON public.practice_sessions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_started_at 
  ON public.practice_sessions(started_at DESC);

-- ============================================================================
-- Table: answer_attempts
-- Stores individual question attempts within a practice session
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.answer_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  
  selected_answer TEXT,
  free_response_answer TEXT,
  
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  outcome TEXT CHECK (outcome IN ('correct', 'incorrect', 'skipped')),
  
  time_spent_ms INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_id 
  ON public.answer_attempts(session_id);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_question_id 
  ON public.answer_attempts(question_id);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_question 
  ON public.answer_attempts(session_id, question_id);

-- ============================================================================
-- RLS Policies for practice_sessions
-- ============================================================================
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own practice sessions" ON public.practice_sessions;
CREATE POLICY "Users can view own practice sessions"
  ON public.practice_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own practice sessions" ON public.practice_sessions;
CREATE POLICY "Users can create own practice sessions"
  ON public.practice_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own practice sessions" ON public.practice_sessions;
CREATE POLICY "Users can update own practice sessions"
  ON public.practice_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to practice sessions" ON public.practice_sessions;
CREATE POLICY "Service role full access to practice sessions"
  ON public.practice_sessions
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- RLS Policies for answer_attempts
-- ============================================================================
ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own answer attempts" ON public.answer_attempts;
CREATE POLICY "Users can view own answer attempts"
  ON public.answer_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.practice_sessions ps
      WHERE ps.id = answer_attempts.session_id
      AND ps.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create own answer attempts" ON public.answer_attempts;
CREATE POLICY "Users can create own answer attempts"
  ON public.answer_attempts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.practice_sessions ps
      WHERE ps.id = answer_attempts.session_id
      AND ps.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role full access to answer attempts" ON public.answer_attempts;
CREATE POLICY "Service role full access to answer attempts"
  ON public.answer_attempts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- Ensure study tables exist (if not already created)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_study_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  baseline_score INTEGER,
  target_score INTEGER,
  exam_date DATE,
  daily_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.student_study_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study profile" ON public.student_study_profile;
CREATE POLICY "Users can view own study profile"
  ON public.student_study_profile
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own study profile" ON public.student_study_profile;
CREATE POLICY "Users can manage own study profile"
  ON public.student_study_profile
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to study profile" ON public.student_study_profile;
CREATE POLICY "Service role full access to study profile"
  ON public.student_study_profile
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE TABLE IF NOT EXISTS public.student_study_plan_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_date DATE NOT NULL,
  planned_minutes INTEGER NOT NULL DEFAULT 0,
  focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  plan_version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, day_date)
);

ALTER TABLE public.student_study_plan_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study plan days" ON public.student_study_plan_days;
CREATE POLICY "Users can view own study plan days"
  ON public.student_study_plan_days
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own study plan days" ON public.student_study_plan_days;
CREATE POLICY "Users can manage own study plan days"
  ON public.student_study_plan_days
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to study plan days" ON public.student_study_plan_days;
CREATE POLICY "Service role full access to study plan days"
  ON public.student_study_plan_days
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Add completed_minutes column to study plan days if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'student_study_plan_days' 
    AND column_name = 'completed_minutes'
  ) THEN
    ALTER TABLE public.student_study_plan_days ADD COLUMN completed_minutes INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
