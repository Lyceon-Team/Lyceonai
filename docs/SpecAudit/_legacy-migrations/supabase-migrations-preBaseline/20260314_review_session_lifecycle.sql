-- ============================================================================
-- 20260314_review_session_lifecycle.sql
-- Canonical review session header + item ledger + event chronology
--
-- Runtime contract:
-- - review_sessions = server-owned review lifecycle header
-- - review_session_items = served-item truth
-- - review_session_events = auditable ordered timeline
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'completed', 'abandoned')),
  source_context text NOT NULL DEFAULT 'review_errors',
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  client_instance_id text NULL,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_sessions_student_status_created
  ON public.review_sessions(student_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_sessions_single_active
  ON public.review_sessions(student_id)
  WHERE status IN ('created', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_sessions_student_idempotency
  ON public.review_sessions(student_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.review_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_session_id uuid NOT NULL REFERENCES public.review_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  question_canonical_id text NOT NULL,
  source_question_id text NULL,
  source_question_canonical_id text NULL,
  source_origin text NOT NULL CHECK (source_origin IN ('practice', 'full_test')),
  retry_mode text NOT NULL DEFAULT 'same_question' CHECK (retry_mode IN ('same_question', 'similar_question')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'served', 'answered', 'skipped')),
  attempt_id uuid NULL REFERENCES public.review_error_attempts(id) ON DELETE SET NULL,
  tutor_opened_at timestamptz NULL,
  answered_at timestamptz NULL,
  source_attempted_at timestamptz NULL,
  client_instance_id text NULL,
  option_order text[] NULL,
  option_token_map jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_session_items_session_ordinal
  ON public.review_session_items(review_session_id, ordinal);

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_session_items_single_served
  ON public.review_session_items(review_session_id)
  WHERE status = 'served';

CREATE INDEX IF NOT EXISTS idx_review_session_items_session_status_ordinal
  ON public.review_session_items(review_session_id, status, ordinal);

CREATE INDEX IF NOT EXISTS idx_review_session_items_student_created
  ON public.review_session_items(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_session_items_question_canonical
  ON public.review_session_items(question_canonical_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'canonical_id'
  ) THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'review_session_items_question_canonical_id_fkey'
      ) THEN
        ALTER TABLE public.review_session_items
          ADD CONSTRAINT review_session_items_question_canonical_id_fkey
          FOREIGN KEY (question_canonical_id)
          REFERENCES public.questions(canonical_id)
          ON DELETE RESTRICT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add review_session_items_question_canonical_id_fkey: %', SQLERRM;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.review_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_session_id uuid NOT NULL REFERENCES public.review_sessions(id) ON DELETE CASCADE,
  review_session_item_id uuid NULL REFERENCES public.review_session_items(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_session_events_session_created
  ON public.review_session_events(review_session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_review_session_events_student_created
  ON public.review_session_events(student_id, created_at DESC);

ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_session_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_sessions' AND policyname='review_sessions_select_own'
  ) THEN
    CREATE POLICY review_sessions_select_own
      ON public.review_sessions
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_sessions' AND policyname='review_sessions_insert_own'
  ) THEN
    CREATE POLICY review_sessions_insert_own
      ON public.review_sessions
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_sessions' AND policyname='review_sessions_update_own'
  ) THEN
    CREATE POLICY review_sessions_update_own
      ON public.review_sessions
      FOR UPDATE TO authenticated
      USING (student_id = auth.uid())
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_sessions' AND policyname='review_sessions_service'
  ) THEN
    CREATE POLICY review_sessions_service
      ON public.review_sessions
      FOR ALL TO authenticated
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_items' AND policyname='review_session_items_select_own'
  ) THEN
    CREATE POLICY review_session_items_select_own
      ON public.review_session_items
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_items' AND policyname='review_session_items_insert_own'
  ) THEN
    CREATE POLICY review_session_items_insert_own
      ON public.review_session_items
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_items' AND policyname='review_session_items_update_own'
  ) THEN
    CREATE POLICY review_session_items_update_own
      ON public.review_session_items
      FOR UPDATE TO authenticated
      USING (student_id = auth.uid())
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_items' AND policyname='review_session_items_service'
  ) THEN
    CREATE POLICY review_session_items_service
      ON public.review_session_items
      FOR ALL TO authenticated
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_events' AND policyname='review_session_events_select_own'
  ) THEN
    CREATE POLICY review_session_events_select_own
      ON public.review_session_events
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_events' AND policyname='review_session_events_insert_own'
  ) THEN
    CREATE POLICY review_session_events_insert_own
      ON public.review_session_events
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_session_events' AND policyname='review_session_events_service'
  ) THEN
    CREATE POLICY review_session_events_service
      ON public.review_session_events
      FOR ALL TO authenticated
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

COMMIT;
