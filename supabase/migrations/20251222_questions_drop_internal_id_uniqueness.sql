-- Remove internal_id uniqueness from public.questions
-- CQID (canonical_id) is now the only authoritative identifier

-- Drop any unique constraints/indexes on internal_id
-- Try all possible names that might exist
DROP INDEX IF EXISTS public.questions_internal_id_key;
DROP INDEX IF EXISTS public.questions_internal_id_unique;
DROP INDEX IF EXISTS public.questions_internal_id_idx;

-- Also try constraint names
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_key;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_unique;

-- Make internal_id nullable (it's now legacy metadata only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' 
      AND column_name = 'internal_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.questions ALTER COLUMN internal_id DROP NOT NULL;
  END IF;
END $$;

-- Add a non-unique index on internal_id for lookup performance (if needed)
CREATE INDEX IF NOT EXISTS questions_internal_id_lookup_idx
ON public.questions (internal_id)
WHERE internal_id IS NOT NULL;

-- Ensure canonical_id remains the only unique identifier
-- Deduplicate any redundant canonical_id indexes first
DROP INDEX IF EXISTS public.questions_canonical_id_key;
DROP INDEX IF EXISTS public.questions_canonical_id_idx;

-- Keep only one unique index
CREATE UNIQUE INDEX IF NOT EXISTS questions_canonical_id_unique
ON public.questions (canonical_id);

-- Verification queries (run after migration):
/*
-- Check no unique constraints on internal_id:
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'public.questions'::regclass 
  AND conname LIKE '%internal_id%';
-- Expected: empty result

-- Check unique indexes on internal_id:
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'questions' 
  AND indexname LIKE '%internal_id%' 
  AND indexdef LIKE '%UNIQUE%';
-- Expected: empty result

-- Confirm canonical_id unique index exists:
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'questions' 
  AND indexname LIKE '%canonical%';
-- Expected: exactly one row for questions_canonical_id_unique
*/
