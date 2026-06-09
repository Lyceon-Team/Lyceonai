-- Full-Length Exam Submitted Late Flag Migration
-- Adds submitted_late column to track deterministic late submissions
--
-- Changes:
-- 1. Add submitted_late BOOLEAN NOT NULL DEFAULT false to full_length_exam_modules

-- ============================================================================
-- PART A: Add Column (Idempotent)
-- ============================================================================

-- Add submitted_late column to track if module was submitted after ends_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'full_length_exam_modules'
        AND column_name = 'submitted_late'
    ) THEN
        ALTER TABLE public.full_length_exam_modules
        ADD COLUMN submitted_late BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- ============================================================================
-- Verification
-- ============================================================================

SELECT 'Full-length exam submitted_late column added successfully' AS status;
