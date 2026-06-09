-- ============================================================================
-- Review Event Taxonomy Canonicalization
--
-- Sprint R1:
-- 1. Persist canonical event_type on student_question_attempts
-- 2. Seed/update mastery EVENT_WEIGHTS for review+tutor split semantics
-- ============================================================================

ALTER TABLE public.student_question_attempts
  ADD COLUMN IF NOT EXISTS event_type TEXT;

UPDATE public.student_question_attempts
SET event_type = 'PRACTICE_SUBMIT'
WHERE event_type IS NULL;

ALTER TABLE public.student_question_attempts
  ALTER COLUMN event_type SET DEFAULT 'PRACTICE_SUBMIT';

ALTER TABLE public.student_question_attempts
  ALTER COLUMN event_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_attempts_user_event_type
  ON public.student_question_attempts(user_id, event_type, attempted_at DESC);

INSERT INTO public.mastery_constants (key, value_json, description)
VALUES (
  'EVENT_WEIGHTS',
  '{
    "PRACTICE_SUBMIT": 1.0,
    "DIAGNOSTIC_SUBMIT": 1.25,
    "FULL_LENGTH_SUBMIT": 1.5,
    "TUTOR_VIEW": 0.0,
    "REVIEW_PASS": 1.0,
    "REVIEW_FAIL": 1.0,
    "TUTOR_HELPED": 0.25,
    "TUTOR_FAIL": 0.25
  }'::jsonb,
  'Canonical mastery event weights (review/tutor split semantics)'
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.mastery_constants
SET value_json = COALESCE(value_json, '{}'::jsonb) || jsonb_build_object(
  'PRACTICE_SUBMIT', COALESCE((value_json ->> 'PRACTICE_SUBMIT')::numeric, 1.0),
  'DIAGNOSTIC_SUBMIT', COALESCE((value_json ->> 'DIAGNOSTIC_SUBMIT')::numeric, 1.25),
  'FULL_LENGTH_SUBMIT', COALESCE((value_json ->> 'FULL_LENGTH_SUBMIT')::numeric, 1.5),
  'TUTOR_VIEW', COALESCE((value_json ->> 'TUTOR_VIEW')::numeric, 0.0),
  'REVIEW_PASS', COALESCE((value_json ->> 'REVIEW_PASS')::numeric, 1.0),
  'REVIEW_FAIL', COALESCE((value_json ->> 'REVIEW_FAIL')::numeric, 1.0),
  'TUTOR_HELPED', COALESCE((value_json ->> 'TUTOR_HELPED')::numeric, 0.25),
  'TUTOR_FAIL', COALESCE((value_json ->> 'TUTOR_FAIL')::numeric, 0.25)
)
WHERE key = 'EVENT_WEIGHTS';
