-- ============================================================================
-- CANONICAL PRACTICE SYSTEM MIGRATION (Jan 2026)
-- Ensures: practice_sessions, answer_attempts, practice_events
-- IDEMPOTENT: Safe to re-run
-- ============================================================================

-- 1) practice_sessions
CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL,
  section text NULL,
  difficulty text NULL,
  target_duration_ms integer NULL,
  actual_duration_ms integer NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active',
  question_ids jsonb NULL,
  completed boolean NOT NULL DEFAULT false,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'practice_sessions_user_id_fkey'
  ) THEN
    ALTER TABLE public.practice_sessions
      ADD CONSTRAINT practice_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_active
  ON public.practice_sessions(user_id, status, completed);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_mode_section
  ON public.practice_sessions(user_id, mode, section);

-- 2) answer_attempts
CREATE TABLE IF NOT EXISTS public.answer_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  question_id uuid NOT NULL,
  selected_answer text NULL,
  free_response_answer text NULL,
  chosen text NULL,
  is_correct boolean NOT NULL DEFAULT false,
  outcome text NULL,
  elapsed_ms integer NULL,
  time_spent_ms integer NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'answer_attempts' AND column_name = 'user_id') THEN
    ALTER TABLE public.answer_attempts ADD COLUMN user_id uuid;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'answer_attempts_session_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'answer_attempts_user_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempts_session_question
  ON public.answer_attempts(session_id, question_id);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_id
  ON public.answer_attempts(session_id);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_user_id
  ON public.answer_attempts(user_id);

-- 3) practice_events (JEPA spine for event sourcing)
CREATE TABLE IF NOT EXISTS public.practice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid NULL,
  event_type text NOT NULL,
  question_id uuid NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'practice_events_user_id_fkey'
  ) THEN
    ALTER TABLE public.practice_events
      ADD CONSTRAINT practice_events_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'practice_events_session_id_fkey'
  ) THEN
    ALTER TABLE public.practice_events
      ADD CONSTRAINT practice_events_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_practice_events_user_created
  ON public.practice_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_events_session_created
  ON public.practice_events(session_id, created_at DESC);

-- 4) RLS
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_select_own'
  ) THEN
    CREATE POLICY practice_sessions_select_own
      ON public.practice_sessions
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_insert_own'
  ) THEN
    CREATE POLICY practice_sessions_insert_own
      ON public.practice_sessions
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_update_own'
  ) THEN
    CREATE POLICY practice_sessions_update_own
      ON public.practice_sessions
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answer_attempts' AND policyname='answer_attempts_select_own'
  ) THEN
    CREATE POLICY answer_attempts_select_own
      ON public.answer_attempts
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answer_attempts' AND policyname='answer_attempts_insert_own'
  ) THEN
    CREATE POLICY answer_attempts_insert_own
      ON public.answer_attempts
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_events' AND policyname='practice_events_select_own'
  ) THEN
    CREATE POLICY practice_events_select_own
      ON public.practice_events
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_events' AND policyname='practice_events_insert_own'
  ) THEN
    CREATE POLICY practice_events_insert_own
      ON public.practice_events
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Service role policies for server-side operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_service'
  ) THEN
    CREATE POLICY practice_sessions_service
      ON public.practice_sessions
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answer_attempts' AND policyname='answer_attempts_service'
  ) THEN
    CREATE POLICY answer_attempts_service
      ON public.answer_attempts
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_events' AND policyname='practice_events_service'
  ) THEN
    CREATE POLICY practice_events_service
      ON public.practice_events
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
