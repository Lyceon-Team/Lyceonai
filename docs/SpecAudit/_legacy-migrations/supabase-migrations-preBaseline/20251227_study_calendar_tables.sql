-- Study Calendar / Study Plan Tables (MVP)
-- Goal: persist daily plan + student plan config for calendar view

-- ============================================================================
-- Table: student_study_profile
-- One row per student with planning preferences + exam targets
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

CREATE INDEX IF NOT EXISTS idx_study_profile_exam_date
  ON public.student_study_profile(exam_date);

-- ============================================================================
-- Table: student_study_plan_days
-- One row per user per day. JSON tasks keeps it flexible for MVP.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_study_plan_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_date DATE NOT NULL,

  planned_minutes INTEGER NOT NULL DEFAULT 0,

  -- Example focus:
  -- [{"section":"Math","competencies":["algebra.linear_equations"],"weight":0.7}]
  focus JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Example tasks:
  -- [{"type":"practice","section":"Math","mode":"mixed","minutes":20,"competencies":["algebra.linear_equations"]}]
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- For regeneration/versioning
  plan_version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, day_date)
);

CREATE INDEX IF NOT EXISTS idx_study_plan_days_user_date
  ON public.student_study_plan_days(user_id, day_date);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.student_study_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_study_plan_days ENABLE ROW LEVEL SECURITY;

-- Students: only access their own profile
CREATE POLICY "Users can view own study profile"
  ON public.student_study_profile
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own study profile"
  ON public.student_study_profile
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Students: only access their own plan days
CREATE POLICY "Users can view own study plan days"
  ON public.student_study_plan_days
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own study plan days"
  ON public.student_study_plan_days
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass (server-side ops)
CREATE POLICY "Service role full access to study profile"
  ON public.student_study_profile
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to study plan days"
  ON public.student_study_plan_days
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

