-- Migration: Questions Table Ultra Cleanup
-- Standardizes on a concise schema and removes redundant/unused legacy columns.

BEGIN;

-- 1. Add new standardized columns (if they don't already exist)
ALTER TABLE public.questions 
ADD COLUMN IF NOT EXISTS section_code TEXT,
ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'multiple_choice',
ADD COLUMN IF NOT EXISTS correct_answer TEXT,
ADD COLUMN IF NOT EXISTS difficulty INTEGER,
ADD COLUMN IF NOT EXISTS test_code TEXT DEFAULT 'SAT',
ADD COLUMN IF NOT EXISTS source_type INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

-- Ensure difficulty is INTEGER
ALTER TABLE public.questions ALTER COLUMN difficulty TYPE INTEGER USING (
  CASE 
    WHEN difficulty::text ~ '^[0-9]+$' THEN difficulty::text::integer
    WHEN difficulty::text ILIKE 'easy' THEN 1
    WHEN difficulty::text ILIKE 'medium' THEN 2
    WHEN difficulty::text ILIKE 'hard' THEN 3
    ELSE NULL
  END
);

-- 2. Backfill core columns from legacy counterparts
UPDATE public.questions
SET section_code = CASE 
    WHEN section IN ('MATH', 'M', 'Math') THEN 'MATH'
    WHEN section IN ('RW', 'Reading & Writing', 'Reading', 'Writing') THEN 'RW'
    WHEN classification::text ILIKE '%RW%' THEN 'RW'
    WHEN classification::text ILIKE '%MATH%' THEN 'MATH'
    ELSE section_code
END;

UPDATE public.questions
SET question_type = CASE
    WHEN type = 'mc' THEN 'multiple_choice'
    WHEN type = 'fr' THEN 'free_response'
    ELSE COALESCE(question_type, 'multiple_choice')
END;

UPDATE public.questions
SET correct_answer = COALESCE(correct_answer, answer_choice, answer);

UPDATE public.questions
SET difficulty = COALESCE(difficulty, difficulty_level);

UPDATE public.questions
SET test_code = COALESCE(test_code, exam, 'SAT');

-- 3. Drop policies that depend on legacy columns
DROP POLICY IF EXISTS questions_select_accessible ON public.questions;

-- 4. Drop redundant taxonomy and mapping columns
ALTER TABLE public.questions 
DROP COLUMN IF EXISTS section,
DROP COLUMN IF EXISTS classification,
DROP COLUMN IF EXISTS type,
DROP COLUMN IF EXISTS answer,
DROP COLUMN IF EXISTS answer_choice,
DROP COLUMN IF EXISTS difficulty_level,
DROP COLUMN IF EXISTS difficulty_bucket,
DROP COLUMN IF EXISTS unit_tag,
DROP COLUMN IF EXISTS competencies,
DROP COLUMN IF EXISTS cluster_name,
DROP COLUMN IF EXISTS tag_confidence;

-- 5. Drop unused/legacy system columns
ALTER TABLE public.questions
DROP COLUMN IF EXISTS course_id,
DROP COLUMN IF EXISTS document_id,
DROP COLUMN IF EXISTS question_number,
DROP COLUMN IF EXISTS source_mapping,
DROP COLUMN IF EXISTS page_number,
DROP COLUMN IF EXISTS position,
DROP COLUMN IF EXISTS parsing_metadata,
DROP COLUMN IF EXISTS structure_cluster_id,
DROP COLUMN IF EXISTS reviewed_at,
DROP COLUMN IF EXISTS reviewed_by,
DROP COLUMN IF EXISTS needs_review,
DROP COLUMN IF EXISTS version,
DROP COLUMN IF EXISTS confidence,
DROP COLUMN IF EXISTS exam,
DROP COLUMN IF EXISTS ai_generated;

-- 6. Final Constraints and Policies
ALTER TABLE public.questions ALTER COLUMN section_code SET NOT NULL;
ALTER TABLE public.questions ALTER COLUMN question_type SET NOT NULL;
ALTER TABLE public.questions ALTER COLUMN correct_answer SET NOT NULL;

-- Re-create a clean selection policy
CREATE POLICY "questions_select_accessible" ON public.questions
FOR SELECT TO authenticated, anon
USING (true);

COMMIT;
