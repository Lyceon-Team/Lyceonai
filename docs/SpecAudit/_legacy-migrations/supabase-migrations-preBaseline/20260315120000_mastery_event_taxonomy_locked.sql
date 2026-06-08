-- Sprint M1: Canonical mastery event taxonomy lock
-- Ensures DB defaults and configured event weights align to the runtime taxonomy.

BEGIN;

UPDATE public.student_question_attempts
SET event_type = CASE
  WHEN event_type = 'PRACTICE_SUBMIT' THEN CASE WHEN COALESCE(is_correct, FALSE) THEN 'practice_pass' ELSE 'practice_fail' END
  WHEN event_type = 'DIAGNOSTIC_SUBMIT' THEN CASE WHEN COALESCE(is_correct, FALSE) THEN 'practice_pass' ELSE 'practice_fail' END
  WHEN event_type = 'FULL_LENGTH_SUBMIT' THEN CASE WHEN COALESCE(is_correct, FALSE) THEN 'test_pass' ELSE 'test_fail' END
  WHEN event_type = 'REVIEW_PASS' THEN 'review_pass'
  WHEN event_type = 'REVIEW_FAIL' THEN 'review_fail'
  WHEN event_type = 'TUTOR_HELPED' THEN 'tutor_helped'
  WHEN event_type = 'TUTOR_FAIL' THEN 'tutor_fail'
  ELSE event_type
END;

ALTER TABLE public.student_question_attempts
  ALTER COLUMN event_type SET DEFAULT 'practice_pass';

UPDATE public.mastery_constants
SET value_json = jsonb_build_object(
  'practice_pass', 1.0,
  'practice_fail', 1.0,
  'review_pass', 1.2,
  'review_fail', 1.2,
  'tutor_helped', 0.25,
  'tutor_fail', 0.25,
  'test_pass', 1.5,
  'test_fail', 1.5
)
WHERE key = 'EVENT_WEIGHTS';

COMMIT;
