-- ============================================================================
-- 20260314_practice_session_items_runtime.sql
-- Canonical practice session items + served-item linkage
--
-- Goals
-- - practice_sessions = session header truth
-- - practice_session_items = served-item truth
-- - answer_attempts.session_item_id = one-attempt-per-served-item anchor
-- - question_canonical_id is the canonical question identifier used by runtime
-- - option_order stores the served UI order for deterministic resume/replay
--
-- Notes
-- - This does NOT shuffle the canonical question row in public.questions.
-- - Shuffle should happen server-side when serving the item, then the chosen
--   order can be persisted into practice_session_items.option_order.
-- - This script is defensive and tries not to fail on partially-existing schema.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Create practice_session_items if missing
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.practice_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,

  -- Canonical question key used by runtime.
  -- This is intentionally TEXT so it can store your in-house canonical ID.
  question_canonical_id text NOT NULL,

  ordinal integer NOT NULL CHECK (ordinal > 0),

  -- served = currently unresolved item shown to the user
  -- answered = resolved by submit
  -- skipped = optional future-safe state
  status text NOT NULL DEFAULT 'served'
    CHECK (status IN ('served', 'answered', 'skipped')),

  attempt_id uuid NULL,
  client_instance_id text NULL,

  -- Persist the displayed option order for resume/replay.
  -- Example: ARRAY['C','A','D','B']
  -- UI does not need to show labels, but server needs stable mapping.
  option_order text[] NULL,

  answered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2) Normalize existing table shape if the table already existed
-- ----------------------------------------------------------------------------

-- Add question_canonical_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'practice_session_items'
      AND column_name = 'question_canonical_id'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD COLUMN question_canonical_id text NULL;
  END IF;
END $$;

-- Add option_order if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'practice_session_items'
      AND column_name = 'option_order'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD COLUMN option_order text[] NULL;
  END IF;
END $$;

-- If an old UUID-based question_id column exists, do not keep using it as truth.
-- We leave it alone for safety, but question_canonical_id becomes the canonical runtime column.
-- Backfill question_canonical_id from any existing text column if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'practice_session_items'
      AND column_name = 'question_id'
      AND data_type IN ('text', 'character varying')
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items
      SET question_canonical_id = question_id
      WHERE question_canonical_id IS NULL
        AND question_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- If you previously had a UUID question_id column, there is no safe generic way
-- to backfill canonical IDs here without a known mapping table. Leave as-is.
-- The app/runtime should write question_canonical_id going forward.

-- Make question_canonical_id required once it is present for all rows
DO $$
DECLARE
  missing_count bigint;
BEGIN
  SELECT count(*)
  INTO missing_count
  FROM public.practice_session_items
  WHERE question_canonical_id IS NULL;

  IF missing_count = 0 THEN
    ALTER TABLE public.practice_session_items
      ALTER COLUMN question_canonical_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'practice_session_items.question_canonical_id still has % NULL row(s); leaving nullable until backfilled.', missing_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Foreign keys for session + user
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'practice_session_items_session_id_fkey'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.practice_sessions(id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add practice_session_items_session_id_fkey: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'practice_session_items_user_id_fkey'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add practice_session_items_user_id_fkey: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Optional FK from question_canonical_id to public.questions
--
-- This block tries, in order:
--   a) questions.canonical_id
--   b) questions.id
--
-- It only adds the FK if the target column exists and is text-like.
-- If your referenced column is not unique, Postgres will reject the FK and
-- we surface a NOTICE rather than failing the whole migration.
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
        WHERE conname = 'practice_session_items_question_canonical_id_fkey'
      ) THEN
        ALTER TABLE public.practice_session_items
          ADD CONSTRAINT practice_session_items_question_canonical_id_fkey
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
        WHERE conname = 'practice_session_items_question_canonical_id_fkey'
      ) THEN
        ALTER TABLE public.practice_session_items
          ADD CONSTRAINT practice_session_items_question_canonical_id_fkey
          FOREIGN KEY (question_canonical_id)
          REFERENCES public.questions(id)
          ON DELETE RESTRICT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add FK to public.questions(id): %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'No compatible public.questions text key found for question_canonical_id FK.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5) Indexes / uniqueness for deterministic progression
-- ----------------------------------------------------------------------------

-- Stable ordinal per session
CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_session_items_session_ordinal
  ON public.practice_session_items(session_id, ordinal);

-- At most one unresolved served item at a time per session
CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_session_items_single_unanswered
  ON public.practice_session_items(session_id)
  WHERE status = 'served';

-- Helpful lookup for "current unresolved item" / state queries
CREATE INDEX IF NOT EXISTS idx_practice_session_items_session_status_ordinal
  ON public.practice_session_items(session_id, status, ordinal DESC);

CREATE INDEX IF NOT EXISTS idx_practice_session_items_user_created_at
  ON public.practice_session_items(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_session_items_question_canonical_id
  ON public.practice_session_items(question_canonical_id);

-- ----------------------------------------------------------------------------
-- 6) RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.practice_session_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_session_items'
      AND policyname = 'practice_session_items_select_own'
  ) THEN
    CREATE POLICY practice_session_items_select_own
      ON public.practice_session_items
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_session_items'
      AND policyname = 'practice_session_items_insert_own'
  ) THEN
    CREATE POLICY practice_session_items_insert_own
      ON public.practice_session_items
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_session_items'
      AND policyname = 'practice_session_items_update_own'
  ) THEN
    CREATE POLICY practice_session_items_update_own
      ON public.practice_session_items
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_session_items'
      AND policyname = 'practice_session_items_service'
  ) THEN
    CREATE POLICY practice_session_items_service
      ON public.practice_session_items
      FOR ALL
      TO authenticated
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7) answer_attempts linkage and idempotency support
-- ----------------------------------------------------------------------------

-- Add session_item_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'answer_attempts'
      AND column_name = 'session_item_id'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD COLUMN session_item_id uuid NULL;
  END IF;
END $$;

-- Add client_attempt_id if missing so the partial unique index does not fail
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'answer_attempts'
      AND column_name = 'client_attempt_id'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD COLUMN client_attempt_id text NULL;
  END IF;
END $$;

-- FK from answer_attempts.session_item_id -> practice_session_items.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'answer_attempts_session_item_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_session_item_id_fkey
      FOREIGN KEY (session_item_id)
      REFERENCES public.practice_session_items(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add answer_attempts_session_item_id_fkey: %', SQLERRM;
END $$;

-- One resolved attempt record per served item
CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempts_session_item_id
  ON public.answer_attempts(session_item_id)
  WHERE session_item_id IS NOT NULL;

-- Replay-safe client attempt idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempts_user_client_attempt
  ON public.answer_attempts(user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_item_id
  ON public.answer_attempts(session_item_id)
  WHERE session_item_id IS NOT NULL;

COMMIT;
