-- Patch: align score_rollups with UUID-based exam tables + fix RLS uuid/text mismatch
-- Safe to run multiple times.

DO $$
BEGIN
  -- 1) Ensure table exists
  IF to_regclass('public.full_length_exam_score_rollups') IS NULL THEN
    CREATE TABLE public.full_length_exam_score_rollups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      user_id uuid NOT NULL,
      rw_module1_correct integer NOT NULL DEFAULT 0,
      rw_module1_total integer NOT NULL DEFAULT 0,
      rw_module2_correct integer NOT NULL DEFAULT 0,
      rw_module2_total integer NOT NULL DEFAULT 0,
      math_module1_correct integer NOT NULL DEFAULT 0,
      math_module1_total integer NOT NULL DEFAULT 0,
      math_module2_correct integer NOT NULL DEFAULT 0,
      math_module2_total integer NOT NULL DEFAULT 0,
      overall_score integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;

  -- 2) Force UUID types (covers cases where earlier migration created VARCHAR)
  -- session_id
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='full_length_exam_score_rollups'
      AND column_name='session_id'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.full_length_exam_score_rollups
      ALTER COLUMN session_id TYPE uuid USING session_id::uuid;
  END IF;

  -- user_id
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='full_length_exam_score_rollups'
      AND column_name='user_id'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.full_length_exam_score_rollups
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
  END IF;

  -- 3) Ensure constraints / indexes
  -- one rollup per session
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'full_length_exam_score_rollups_unique_session_id'
  ) THEN
    ALTER TABLE public.full_length_exam_score_rollups
      ADD CONSTRAINT full_length_exam_score_rollups_unique_session_id UNIQUE (session_id);
  END IF;

  -- FK to sessions (uuid -> uuid)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'full_length_exam_score_rollups_session_id_fkey'
  ) THEN
    ALTER TABLE public.full_length_exam_score_rollups
      ADD CONSTRAINT full_length_exam_score_rollups_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.full_length_exam_sessions(id)
      ON DELETE CASCADE;
  END IF;

  -- helpful history index
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='full_length_exam_score_rollups_user_created_at_idx'
  ) THEN
    CREATE INDEX full_length_exam_score_rollups_user_created_at_idx
      ON public.full_length_exam_score_rollups (user_id, created_at DESC);
  END IF;

  -- 4) RLS policies (uuid comparisons, no ::text)
  EXECUTE 'ALTER TABLE public.full_length_exam_score_rollups ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS score_rollups_select_own ON public.full_length_exam_score_rollups';
  EXECUTE 'CREATE POLICY score_rollups_select_own ON public.full_length_exam_score_rollups
           FOR SELECT USING (user_id = auth.uid())';

  EXECUTE 'DROP POLICY IF EXISTS score_rollups_insert_own ON public.full_length_exam_score_rollups';
  EXECUTE 'CREATE POLICY score_rollups_insert_own ON public.full_length_exam_score_rollups
           FOR INSERT WITH CHECK (user_id = auth.uid())';
END $$;
