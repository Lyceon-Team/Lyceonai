-- Migration: Drop internal_id column from public.questions
-- Date: 2024-12-22
-- Purpose: internal_id is no longer used at runtime; canonical_id is the authoritative identifier
-- 
-- IMPORTANT: Run this AFTER verifying no runtime code uses internal_id
-- 
-- This migration:
-- 1. Drops any remaining indexes on internal_id
-- 2. Drops the internal_id column entirely

-- Step 1: Drop any remaining indexes on internal_id
DROP INDEX IF EXISTS public.questions_internal_id_key;
DROP INDEX IF EXISTS public.questions_internal_id_unique;
DROP INDEX IF EXISTS public.questions_internal_id_idx;
DROP INDEX IF EXISTS public.questions_internal_id_lookup_idx;

-- Step 2: Drop any remaining constraints on internal_id
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_key;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_unique;

-- Step 3: Drop the internal_id column
-- Using IF EXISTS to make idempotent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'internal_id'
  ) THEN
    ALTER TABLE public.questions DROP COLUMN internal_id;
    RAISE NOTICE 'Dropped internal_id column from public.questions';
  ELSE
    RAISE NOTICE 'Column internal_id does not exist, skipping';
  END IF;
END$$;

-- Verification query (informational only):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'questions'
-- ORDER BY ordinal_position;
