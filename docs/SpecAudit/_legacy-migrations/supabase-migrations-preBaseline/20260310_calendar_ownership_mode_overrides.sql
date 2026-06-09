-- CAL1 calendar ownership completion
-- Adds canonical planner mode + per-day override ownership flags.

ALTER TABLE public.student_study_profile
  ADD COLUMN IF NOT EXISTS planner_mode TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_profile_planner_mode_check'
      AND conrelid = 'public.student_study_profile'::regclass
  ) THEN
    ALTER TABLE public.student_study_profile
      ADD CONSTRAINT student_study_profile_planner_mode_check
      CHECK (planner_mode IN ('auto', 'custom'));
  END IF;
END $$;

ALTER TABLE public.student_study_plan_days
  ADD COLUMN IF NOT EXISTS is_user_override BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.student_study_plan_days
SET is_user_override = FALSE
WHERE is_user_override IS NULL;

CREATE INDEX IF NOT EXISTS idx_study_plan_days_user_override
  ON public.student_study_plan_days(user_id, day_date)
  WHERE is_user_override = TRUE;
