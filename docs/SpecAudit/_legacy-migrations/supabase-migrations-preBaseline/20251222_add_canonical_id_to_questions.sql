-- Add canonical_id column to public.questions
-- This is the new authoritative identifier per the CQID specification

-- Step 1: Add canonical_id column (nullable initially for backfill)
ALTER TABLE public.questions
ADD COLUMN IF NOT EXISTS canonical_id TEXT;

-- Step 2: Drop the unique constraint on internal_id (demote to non-authoritative)
-- Try both possible names: index name and constraint name
DROP INDEX IF EXISTS questions_internal_id_unique;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_key;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_internal_id_unique;

-- Step 3: Create a helper function for generating unique CQID tokens
-- Uses 36^6 = 2.18 billion combinations per TEST/SECTION/SOURCE prefix
CREATE OR REPLACE FUNCTION generate_cqid_token() RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || SUBSTR(chars, FLOOR(RANDOM() * 36)::INT + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Backfill canonical_id for existing rows using a collision-aware approach
-- Generate unique CQIDs by checking for collisions within the current batch
DO $$
DECLARE
  rec RECORD;
  test_code TEXT;
  section_code TEXT;
  source_code TEXT;
  unique_token TEXT;
  new_cqid TEXT;
  retry_count INT;
  max_retries INT := 10;
  used_cqids TEXT[];
BEGIN
  -- Collect all CQIDs we'll use in this batch to avoid in-batch collisions
  used_cqids := ARRAY[]::TEXT[];
  
  FOR rec IN 
    SELECT id, section, ai_generated 
    FROM public.questions 
    WHERE canonical_id IS NULL
    ORDER BY id
  LOOP
    test_code := 'SAT';
    
    -- Map section to section code
    IF LOWER(rec.section) = 'math' THEN
      section_code := 'M';
    ELSIF LOWER(rec.section) = 'reading' THEN
      section_code := 'R';
    ELSIF LOWER(rec.section) = 'writing' THEN
      section_code := 'W';
    ELSE
      section_code := 'R'; -- Default to Reading for R&W combined
    END IF;
    
    -- Map ai_generated to source code
    IF rec.ai_generated THEN
      source_code := '2';
    ELSE
      source_code := '1';
    END IF;
    
    retry_count := 0;
    LOOP
      -- Generate random 6-character alphanumeric token
      unique_token := generate_cqid_token();
      new_cqid := test_code || section_code || source_code || unique_token;
      
      -- Check for collision within this batch
      IF NOT (new_cqid = ANY(used_cqids)) THEN
        -- Update the row
        UPDATE public.questions SET canonical_id = new_cqid WHERE id = rec.id;
        -- Track this CQID to prevent in-batch collisions
        used_cqids := array_append(used_cqids, new_cqid);
        EXIT; -- Success, exit retry loop
      END IF;
      
      retry_count := retry_count + 1;
      IF retry_count >= max_retries THEN
        RAISE EXCEPTION 'Failed to generate unique canonical_id after % retries for question %', max_retries, rec.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Step 5: Clean up the helper function
DROP FUNCTION IF EXISTS generate_cqid_token();

-- Step 6: Make canonical_id NOT NULL
ALTER TABLE public.questions
ALTER COLUMN canonical_id SET NOT NULL;

-- Step 7: Add UNIQUE constraint on canonical_id
CREATE UNIQUE INDEX IF NOT EXISTS questions_canonical_id_unique 
ON public.questions (canonical_id);

-- Step 8: Add optional index on internal_id (non-unique, for lookup only)
CREATE INDEX IF NOT EXISTS questions_internal_id_idx 
ON public.questions (internal_id) 
WHERE internal_id IS NOT NULL;

-- Step 9: Add CHECK constraint for canonical_id format (basic validation)
-- Format: {TEST}{SECTION}{SOURCE}{UNIQUE} where UNIQUE is 6 alphanumeric chars
-- This is lenient - just ensures uppercase alphanumeric and minimum length
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canonical_id_format_check'
  ) THEN
    ALTER TABLE public.questions
    ADD CONSTRAINT canonical_id_format_check 
    CHECK (canonical_id ~ '^[A-Z0-9]{8,}$');
  END IF;
END $$;
