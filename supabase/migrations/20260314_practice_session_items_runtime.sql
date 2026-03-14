-- Canonical practice session items + served-item idempotency linkage
-- Locked contract alignment: practice_sessions (header) + practice_session_items (served items)
-- + answer_attempts.session_item_id for one-attempt-per-served-item behavior.

CREATE TABLE IF NOT EXISTS public.practice_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  question_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL DEFAULT 'served' CHECK (status IN ('served', 'answered', 'skipped')),
  attempt_id uuid NULL,
  client_instance_id text NULL,
  answered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_session_items_session_id_fkey'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_session_items_user_id_fkey'
  ) THEN
    ALTER TABLE public.practice_session_items
      ADD CONSTRAINT practice_session_items_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_session_items_session_ordinal
  ON public.practice_session_items(session_id, ordinal);

CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_session_items_single_unanswered
  ON public.practice_session_items(session_id)
  WHERE status = 'served';

CREATE INDEX IF NOT EXISTS idx_practice_session_items_session_status
  ON public.practice_session_items(session_id, status, ordinal DESC);

ALTER TABLE public.practice_session_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='practice_session_items' AND policyname='practice_session_items_select_own'
  ) THEN
    CREATE POLICY practice_session_items_select_own
      ON public.practice_session_items
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='practice_session_items' AND policyname='practice_session_items_insert_own'
  ) THEN
    CREATE POLICY practice_session_items_insert_own
      ON public.practice_session_items
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='practice_session_items' AND policyname='practice_session_items_update_own'
  ) THEN
    CREATE POLICY practice_session_items_update_own
      ON public.practice_session_items
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='practice_session_items' AND policyname='practice_session_items_service'
  ) THEN
    CREATE POLICY practice_session_items_service
      ON public.practice_session_items
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='answer_attempts' AND column_name='session_item_id'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD COLUMN session_item_id uuid NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'answer_attempts_session_item_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_session_item_id_fkey
      FOREIGN KEY (session_item_id) REFERENCES public.practice_session_items(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempts_session_item_id
  ON public.answer_attempts(session_item_id)
  WHERE session_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempts_user_client_attempt
  ON public.answer_attempts(user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;
