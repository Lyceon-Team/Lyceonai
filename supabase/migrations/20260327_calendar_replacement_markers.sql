-- Calendar regenerate replacement provenance markers
-- Additive migration

BEGIN;

ALTER TABLE public.student_study_plan_days
  ADD COLUMN IF NOT EXISTS replaces_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replaced_override_day_id TEXT,
  ADD COLUMN IF NOT EXISTS replacement_source TEXT,
  ADD COLUMN IF NOT EXISTS replacement_at TIMESTAMPTZ;

ALTER TABLE public.student_study_plan_tasks
  ADD COLUMN IF NOT EXISTS replaces_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replaced_override_task_id TEXT,
  ADD COLUMN IF NOT EXISTS replacement_source TEXT,
  ADD COLUMN IF NOT EXISTS replacement_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS override_target_type TEXT,
  ADD COLUMN IF NOT EXISTS override_target_domain TEXT,
  ADD COLUMN IF NOT EXISTS override_target_skill TEXT,
  ADD COLUMN IF NOT EXISTS override_target_session_id TEXT,
  ADD COLUMN IF NOT EXISTS override_target_exam_id TEXT;

CREATE INDEX IF NOT EXISTS idx_study_plan_days_replacement
  ON public.student_study_plan_days(user_id, day_date)
  WHERE replaces_override = TRUE;

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_replacement
  ON public.student_study_plan_tasks(user_id, day_date, ordinal)
  WHERE replaces_override = TRUE;

COMMIT;
