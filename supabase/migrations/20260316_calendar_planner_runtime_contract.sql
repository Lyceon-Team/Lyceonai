-- Sprint CAL1 runtime contract completion
-- Canonicalizes planner state into explicit day/task ledgers and settings.

BEGIN;

ALTER TABLE public.student_study_profile
  ADD COLUMN IF NOT EXISTS full_test_cadence TEXT NOT NULL DEFAULT 'biweekly',
  ADD COLUMN IF NOT EXISTS preferred_study_days INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_profile_full_test_cadence_check'
      AND conrelid = 'public.student_study_profile'::regclass
  ) THEN
    ALTER TABLE public.student_study_profile
      ADD CONSTRAINT student_study_profile_full_test_cadence_check
      CHECK (full_test_cadence IN ('weekly', 'biweekly', 'none'));
  END IF;
END $$;

ALTER TABLE public.student_study_plan_days
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS generation_source TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS is_exam_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_taper_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_full_test_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS required_task_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_task_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_minutes_target INTEGER NOT NULL DEFAULT 0;

UPDATE public.student_study_plan_days
SET status = CASE status
  WHEN 'complete' THEN 'completed'
  WHEN 'in_progress' THEN 'partially_completed'
  WHEN 'planned' THEN 'planned'
  WHEN 'completed' THEN 'completed'
  WHEN 'partially_completed' THEN 'partially_completed'
  WHEN 'missed' THEN 'missed'
  ELSE 'planned'
END;

UPDATE public.student_study_plan_days
SET generation_source = CASE
  WHEN generation_source IN ('auto', 'user', 'refresh', 'regenerate', 'generate') THEN generation_source
  ELSE 'auto'
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_plan_days_status_check'
      AND conrelid = 'public.student_study_plan_days'::regclass
  ) THEN
    ALTER TABLE public.student_study_plan_days
      ADD CONSTRAINT student_study_plan_days_status_check
      CHECK (status IN ('planned', 'partially_completed', 'completed', 'missed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_plan_days_generation_source_check'
      AND conrelid = 'public.student_study_plan_days'::regclass
  ) THEN
    ALTER TABLE public.student_study_plan_days
      ADD CONSTRAINT student_study_plan_days_generation_source_check
      CHECK (generation_source IN ('auto', 'user', 'refresh', 'regenerate', 'generate'));
  END IF;
END $$;

UPDATE public.student_study_plan_days
SET study_minutes_target = COALESCE(study_minutes_target, planned_minutes, 0)
WHERE study_minutes_target IS NULL OR study_minutes_target = 0;

CREATE TABLE IF NOT EXISTS public.student_study_plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.student_study_plan_days(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_date DATE NOT NULL,
  ordinal INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  section TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  source_skill_code TEXT,
  source_domain TEXT,
  source_subskill TEXT,
  source_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned',
  is_user_override BOOLEAN NOT NULL DEFAULT FALSE,
  planner_owned BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(day_id, ordinal)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_plan_tasks_task_type_check'
      AND conrelid = 'public.student_study_plan_tasks'::regclass
  ) THEN
    ALTER TABLE public.student_study_plan_tasks
      ADD CONSTRAINT student_study_plan_tasks_task_type_check
      CHECK (task_type IN ('math_practice', 'rw_practice', 'review_errors', 'full_length_exam'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_plan_tasks_status_check'
      AND conrelid = 'public.student_study_plan_tasks'::regclass
  ) THEN
    ALTER TABLE public.student_study_plan_tasks
      ADD CONSTRAINT student_study_plan_tasks_status_check
      CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped', 'missed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_user_date
  ON public.student_study_plan_tasks(user_id, day_date, ordinal);

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_day
  ON public.student_study_plan_tasks(day_id, ordinal);

ALTER TABLE public.student_study_plan_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study plan tasks" ON public.student_study_plan_tasks;
CREATE POLICY "Users can view own study plan tasks"
  ON public.student_study_plan_tasks
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own study plan tasks" ON public.student_study_plan_tasks;
CREATE POLICY "Users can manage own study plan tasks"
  ON public.student_study_plan_tasks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to study plan tasks" ON public.student_study_plan_tasks;
CREATE POLICY "Service role full access to study plan tasks"
  ON public.student_study_plan_tasks
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

COMMIT;
