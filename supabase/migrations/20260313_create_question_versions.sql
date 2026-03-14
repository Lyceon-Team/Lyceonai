-- ============================================================================
-- 20260313_create_question_versions.sql
-- Canonical question version ledger
--
-- Goals
-- - public.questions remains the source of truth for current question content
-- - public.question_versions stores immutable version snapshots
-- - one canonical question key column only: question_canonical_id
-- - no dual truth between question_id and canonical_id
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical in-house question ID used to associate this version with public.questions
  question_canonical_id text NOT NULL,

  version_number integer NOT NULL CHECK (version_number > 0),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('qa', 'published')),
  snapshot jsonb NOT NULL,

  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL
);

-- ----------------------------------------------------------------------------
-- Normalize existing table shape if question_versions already existed
-- ----------------------------------------------------------------------------

-- Add question_canonical_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_versions'
      AND column_name = 'question_canonical_id'
  ) THEN
    ALTER TABLE public.question_versions
      ADD COLUMN question_canonical_id text NULL;
  END IF;
END $$;

-- Backfill from legacy canonical_id first
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_versions'
      AND column_name = 'canonical_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.question_versions
      SET question_canonical_id = canonical_id
      WHERE question_canonical_id IS NULL
        AND canonical_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Backfill from legacy question_id if it is text-like
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_versions'
      AND column_name = 'question_id'
      AND data_type IN ('text', 'character varying')
  ) THEN
    EXECUTE $sql$
      UPDATE public.question_versions
      SET question_canonical_id = question_id
      WHERE question_canonical_id IS NULL
        AND question_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Require question_canonical_id if fully backfilled
DO $$
DECLARE
  missing_count bigint;
BEGIN
  SELECT count(*)
  INTO missing_count
  FROM public.question_versions
  WHERE question_canonical_id IS NULL;

  IF missing_count = 0 THEN
    ALTER TABLE public.question_versions
      ALTER COLUMN question_canonical_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'question_versions.question_canonical_id still has % NULL row(s); leaving nullable until backfilled.', missing_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Optional FK to public.questions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  has_canonical_id boolean;
  has_id boolean;
  id_is_text boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'canonical_id'
  )
  INTO has_canonical_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'id'
  )
  INTO has_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'id'
      AND data_type IN ('text', 'character varying')
  )
  INTO id_is_text;

  IF has_canonical_id THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'question_versions_question_canonical_id_fkey'
      ) THEN
        ALTER TABLE public.question_versions
          ADD CONSTRAINT question_versions_question_canonical_id_fkey
          FOREIGN KEY (question_canonical_id)
          REFERENCES public.questions(canonical_id)
          ON DELETE RESTRICT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add FK to public.questions(canonical_id): %', SQLERRM;
    END;
  ELSIF has_id AND id_is_text THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'question_versions_question_canonical_id_fkey'
      ) THEN
        ALTER TABLE public.question_versions
          ADD CONSTRAINT question_versions_question_canonical_id_fkey
          FOREIGN KEY (question_canonical_id)
          REFERENCES public.questions(id)
          ON DELETE RESTRICT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add FK to public.questions(id): %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'No compatible public.questions text key found for question_versions.question_canonical_id FK.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Uniqueness + indexes
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_versions_question_version
  ON public.question_versions(question_canonical_id, version_number);

CREATE INDEX IF NOT EXISTS idx_question_versions_question_canonical_id
  ON public.question_versions(question_canonical_id);

CREATE INDEX IF NOT EXISTS idx_question_versions_lifecycle_status
  ON public.question_versions(lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_question_versions_published_at
  ON public.question_versions(published_at);

COMMIT;
