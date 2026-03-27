BEGIN;

-- =============================================================================
-- Canonical runtime rebuild additive migration
-- Full rewrite:
-- - fixes text/uuid COALESCE issue
-- - keeps additive/idempotent posture
-- - creates review canonical runtime tables if absent
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Practice session item snapshot parity for canonical runtime-only reads
-- -----------------------------------------------------------------------------
ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS question_domain text,
  ADD COLUMN IF NOT EXISTS question_skill text,
  ADD COLUMN IF NOT EXISTS question_subskill text,
  ADD COLUMN IF NOT EXISTS question_exam text,
  ADD COLUMN IF NOT EXISTS question_structure_cluster_id text,
  ADD COLUMN IF NOT EXISTS question_correct_answer text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'domain'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_domain = COALESCE(NULLIF(psi.question_domain, ''), q.domain)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_domain IS NULL OR psi.question_domain = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'skill'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_skill = COALESCE(NULLIF(psi.question_skill, ''), q.skill)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_skill IS NULL OR psi.question_skill = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'subskill'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_subskill = COALESCE(NULLIF(psi.question_subskill, ''), q.subskill)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_subskill IS NULL OR psi.question_subskill = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'exam'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_exam = COALESCE(NULLIF(psi.question_exam, ''), q.exam)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_exam IS NULL OR psi.question_exam = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'structure_cluster_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_structure_cluster_id = COALESCE(
            NULLIF(psi.question_structure_cluster_id, ''),
            q.structure_cluster_id::text
          )
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_structure_cluster_id IS NULL OR psi.question_structure_cluster_id = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'answer_choice'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_correct_answer = COALESCE(NULLIF(psi.question_correct_answer, ''), q.answer_choice)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_correct_answer IS NULL OR psi.question_correct_answer = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'answer'
  ) THEN
    EXECUTE $sql$
      UPDATE public.practice_session_items psi
      SET question_correct_answer = COALESCE(NULLIF(psi.question_correct_answer, ''), q.answer)
      FROM public.questions q
      WHERE q.id = psi.question_id
        AND (psi.question_correct_answer IS NULL OR psi.question_correct_answer = '')
    $sql$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Full-length snapshot parity: persisted answer key
-- -----------------------------------------------------------------------------
ALTER TABLE public.full_length_exam_questions
  ADD COLUMN IF NOT EXISTS question_correct_answer text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'answer_choice'
  ) THEN
    EXECUTE $sql$
      UPDATE public.full_length_exam_questions fleq
      SET question_correct_answer = COALESCE(NULLIF(fleq.question_correct_answer, ''), q.answer_choice)
      FROM public.questions q
      WHERE q.id = fleq.question_id
        AND (fleq.question_correct_answer IS NULL OR fleq.question_correct_answer = '')
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'answer'
  ) THEN
    EXECUTE $sql$
      UPDATE public.full_length_exam_questions fleq
      SET question_correct_answer = COALESCE(NULLIF(fleq.question_correct_answer, ''), q.answer)
      FROM public.questions q
      WHERE q.id = fleq.question_id
        AND (fleq.question_correct_answer IS NULL OR fleq.question_correct_answer = '')
    $sql$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Review canonical runtime tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_error_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  context text NOT NULL DEFAULT 'review_errors' CHECK (context = 'review_errors'),
  selected_answer text,
  is_correct boolean NOT NULL,
  seconds_spent integer,
  client_attempt_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_error_attempts_student_created
  ON public.review_error_attempts(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_error_attempts_student_question
  ON public.review_error_attempts(student_id, question_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_error_attempts_client_id
  ON public.review_error_attempts(student_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'active', 'completed', 'abandoned')),
  source_context text NOT NULL DEFAULT 'review_errors',
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  client_instance_id text NULL,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
  retry_mode text NOT NULL DEFAULT 'same_question'
    CHECK (retry_mode IN ('same_question', 'similar_question')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'served', 'answered', 'skipped')),
  attempt_id uuid NULL REFERENCES public.review_error_attempts(id) ON DELETE SET NULL,
  tutor_opened_at timestamptz NULL,
  answered_at timestamptz NULL,
  source_attempted_at timestamptz NULL,
  client_instance_id text NULL,
  option_order text[] NULL,
  option_token_map jsonb NULL,
  question_section text NULL,
  question_stem text NULL,
  question_options jsonb NULL,
  question_difficulty jsonb NULL,
  question_domain text NULL,
  question_skill text NULL,
  question_subskill text NULL,
  question_exam text NULL,
  question_structure_cluster_id text NULL,
  question_correct_answer text NULL,
  question_explanation text NULL,
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

ALTER TABLE public.review_error_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_session_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_error_attempts'
      AND policyname = 'review_error_attempts_select_own'
  ) THEN
    CREATE POLICY review_error_attempts_select_own
      ON public.review_error_attempts
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_error_attempts'
      AND policyname = 'review_error_attempts_insert_own'
  ) THEN
    CREATE POLICY review_error_attempts_insert_own
      ON public.review_error_attempts
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_sessions'
      AND policyname = 'review_sessions_select_own'
  ) THEN
    CREATE POLICY review_sessions_select_own
      ON public.review_sessions
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_sessions'
      AND policyname = 'review_sessions_insert_own'
  ) THEN
    CREATE POLICY review_sessions_insert_own
      ON public.review_sessions
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_sessions'
      AND policyname = 'review_sessions_update_own'
  ) THEN
    CREATE POLICY review_sessions_update_own
      ON public.review_sessions
      FOR UPDATE TO authenticated
      USING (student_id = auth.uid())
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_session_items'
      AND policyname = 'review_session_items_select_own'
  ) THEN
    CREATE POLICY review_session_items_select_own
      ON public.review_session_items
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_session_items'
      AND policyname = 'review_session_items_insert_own'
  ) THEN
    CREATE POLICY review_session_items_insert_own
      ON public.review_session_items
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_session_items'
      AND policyname = 'review_session_items_update_own'
  ) THEN
    CREATE POLICY review_session_items_update_own
      ON public.review_session_items
      FOR UPDATE TO authenticated
      USING (student_id = auth.uid())
      WITH CHECK (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_session_events'
      AND policyname = 'review_session_events_select_own'
  ) THEN
    CREATE POLICY review_session_events_select_own
      ON public.review_session_events
      FOR SELECT TO authenticated
      USING (student_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_session_events'
      AND policyname = 'review_session_events_insert_own'
  ) THEN
    CREATE POLICY review_session_events_insert_own
      ON public.review_session_events
      FOR INSERT TO authenticated
      WITH CHECK (student_id = auth.uid());
  END IF;
END $$;

COMMIT;
