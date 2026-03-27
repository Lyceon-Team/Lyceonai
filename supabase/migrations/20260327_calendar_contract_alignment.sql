-- Calendar contract alignment
-- Additive profile fields + task taxonomy backfill

BEGIN;

ALTER TABLE public.student_study_profile
  ADD COLUMN IF NOT EXISTS study_days_of_week INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  ADD COLUMN IF NOT EXISTS blocked_weekdays INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS blocked_dates DATE[] NOT NULL DEFAULT ARRAY[]::DATE[],
  ADD COLUMN IF NOT EXISTS blocked_windows JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.student_study_profile
SET
  study_days_of_week = COALESCE(
    NULLIF(study_days_of_week, ARRAY[]::INTEGER[]),
    NULLIF(preferred_study_days, ARRAY[]::INTEGER[]),
    ARRAY[1,2,3,4,5,6,7]
  ),
  preferred_study_days = COALESCE(
    NULLIF(study_days_of_week, ARRAY[]::INTEGER[]),
    NULLIF(preferred_study_days, ARRAY[]::INTEGER[]),
    ARRAY[1,2,3,4,5,6,7]
  ),
  blocked_weekdays = COALESCE(blocked_weekdays, ARRAY[]::INTEGER[]),
  blocked_dates = COALESCE(blocked_dates, ARRAY[]::DATE[]),
  blocked_windows = COALESCE(blocked_windows, '[]'::jsonb);

UPDATE public.student_study_plan_tasks
SET task_type = CASE lower(task_type)
  WHEN 'practice' THEN 'practice'
  WHEN 'math_practice' THEN 'practice'
  WHEN 'rw_practice' THEN 'practice'
  WHEN 'focused_drill' THEN 'focused_drill'
  WHEN 'review_practice' THEN 'review_practice'
  WHEN 'review_errors' THEN 'review_practice'
  WHEN 'review_full_length' THEN 'review_full_length'
  WHEN 'review' THEN 'review_practice'
  WHEN 'full_length' THEN 'full_length'
  WHEN 'full_length_exam' THEN 'full_length'
  WHEN 'full_test' THEN 'full_length'
  WHEN 'tutor_support' THEN 'tutor_support'
  ELSE 'practice'
END;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_study_plan_tasks_task_type_check'
      AND conrelid = 'public.student_study_plan_tasks'::regclass
  ) THEN
    ALTER TABLE public.student_study_plan_tasks
      DROP CONSTRAINT student_study_plan_tasks_task_type_check;
  END IF;
END $$;

ALTER TABLE public.student_study_plan_tasks
  ADD CONSTRAINT student_study_plan_tasks_task_type_check
  CHECK (task_type IN ('practice', 'focused_drill', 'review_practice', 'review_full_length', 'full_length', 'tutor_support'));

COMMIT;
