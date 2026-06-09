-- Full-Length Exam Calculator State Persistence (bounded)
-- Adds module-scoped JSONB state for math-only Desmos persistence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'full_length_exam_modules'
      AND column_name = 'calculator_state'
  ) THEN
    ALTER TABLE public.full_length_exam_modules
      ADD COLUMN calculator_state JSONB NULL;
  END IF;
END $$;

SELECT 'full_length_exam_modules.calculator_state ready' AS status;
