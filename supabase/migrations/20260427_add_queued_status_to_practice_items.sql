-- 20260427_add_queued_status_to_practice_items.sql
-- Adds 'queued' status to practice_session_items to support pre-loaded sessions.

BEGIN;

-- 1) Explicitly drop the constraint by name if it exists
ALTER TABLE public.practice_session_items 
  DROP CONSTRAINT IF EXISTS practice_session_items_status_check;

-- 2) Fallback: Drop any other constraint that looks like a status check
DO $$
DECLARE
    const_name TEXT;
BEGIN
    SELECT conname INTO const_name
    FROM pg_constraint
    WHERE conrelid = 'public.practice_session_items'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF const_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.practice_session_items DROP CONSTRAINT ' || const_name;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 3) Add the new check constraint including 'queued'
ALTER TABLE public.practice_session_items
  ADD CONSTRAINT practice_session_items_status_check
  CHECK (status IN ('queued', 'served', 'answered', 'skipped'));

COMMIT;
