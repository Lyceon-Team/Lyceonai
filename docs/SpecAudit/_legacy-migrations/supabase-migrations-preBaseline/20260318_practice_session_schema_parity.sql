-- ============================================================================
-- 20260318_practice_session_schema_parity.sql
-- Align practice_session_items schema with mounted deterministic prebuild runtime.
--
-- Runtime truth requires:
-- - practice_session_items.status supports queued|served|answered|skipped
-- - practice_session_items.question_id exists (UUID question owner key)
-- ============================================================================

BEGIN;

-- 1) Ensure question_id exists for mounted runtime reads/writes.
ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS question_id uuid;

-- 2) Best-effort backfill from canonical question id when possible.
DO $$
BEGIN
  UPDATE public.practice_session_items psi
  SET question_id = q.id
  FROM public.questions q
  WHERE psi.question_id IS NULL
    AND psi.question_canonical_id IS NOT NULL
    AND q.canonical_id = psi.question_canonical_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'question_id backfill skipped: %', SQLERRM;
END $$;

-- 3) Add FK/index for question_id when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'practice_session_items_question_id_fkey'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_question_id_fkey
      FOREIGN KEY (question_id)
      REFERENCES public.questions(id)
      ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add practice_session_items_question_id_fkey: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_practice_session_items_question_id
  ON public.practice_session_items(question_id);

-- 4) Ensure status check includes queued (prebuilt future items).
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT conname, pg_get_constraintdef(oid) AS defn
    FROM pg_constraint
    WHERE conrelid = 'public.practice_session_items'::regclass
      AND contype = 'c'
  LOOP
    IF rec.defn ILIKE '%status%'
       AND rec.defn ILIKE '%served%'
       AND rec.defn ILIKE '%answered%'
       AND rec.defn ILIKE '%skipped%'
       AND rec.defn NOT ILIKE '%queued%'
    THEN
      EXECUTE format('ALTER TABLE public.practice_session_items DROP CONSTRAINT %I', rec.conname);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.practice_session_items'::regclass
      AND conname = 'practice_session_items_status_check'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_status_check
      CHECK (status IN ('queued', 'served', 'answered', 'skipped'));
  END IF;
END $$;

-- 5) Ensure answer_attempts outcome check stays aligned with mounted answer/skip runtime.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT conname, pg_get_constraintdef(oid) AS defn
    FROM pg_constraint
    WHERE conrelid = 'public.answer_attempts'::regclass
      AND contype = 'c'
  LOOP
    IF rec.defn ILIKE '%outcome%'
       AND (rec.defn NOT ILIKE '%correct%' OR rec.defn NOT ILIKE '%incorrect%' OR rec.defn NOT ILIKE '%skipped%')
    THEN
      EXECUTE format('ALTER TABLE public.answer_attempts DROP CONSTRAINT %I', rec.conname);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.answer_attempts'::regclass
      AND conname = 'answer_attempts_outcome_check'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('correct', 'incorrect', 'skipped'));
  END IF;
END $$;

COMMIT;
