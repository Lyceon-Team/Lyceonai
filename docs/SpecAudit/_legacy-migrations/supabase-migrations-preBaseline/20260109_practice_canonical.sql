-- Practice System Canonical Migration
-- Safe to re-run (idempotent)

-- 1) Helpful indexes for practice queries
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_id ON public.practice_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_status ON public.practice_sessions (status);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_id ON public.answer_attempts (session_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_user_id ON public.answer_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_question_id ON public.answer_attempts (question_id);

-- 2) Prevent duplicate submissions of same question in same session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uniq_answer_attempts_session_question'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX uniq_answer_attempts_session_question ON public.answer_attempts (session_id, question_id)';
  END IF;
END $$;

-- 3) Speed up questions filtering by section (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_questions_section_lower ON public.questions ((lower(section)));

-- 4) Foreign key constraints (safe re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'answer_attempts_session_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_sessions_user_id_fkey'
  ) THEN
    ALTER TABLE public.practice_sessions
      ADD CONSTRAINT practice_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'answer_attempts_user_id_fkey'
  ) THEN
    ALTER TABLE public.answer_attempts
      ADD CONSTRAINT answer_attempts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5) Enable RLS (safe: already-enabled tables are idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'practice_sessions') THEN
    ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'answer_attempts') THEN
    ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- 6) Ensure practice_sessions has section column for session isolation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'practice_sessions'
      AND column_name = 'section'
  ) THEN
    ALTER TABLE public.practice_sessions ADD COLUMN section TEXT;
  END IF;
END $$;

-- 7) Index on practice_sessions for efficient lookups
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_mode_section 
  ON public.practice_sessions (user_id, mode, section, completed);

-- 8) RLS Policies (idempotent via DO blocks)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_select_own') THEN
    EXECUTE $p$
      CREATE POLICY "practice_sessions_select_own" ON public.practice_sessions FOR SELECT USING (auth.uid() = user_id)
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_insert_own') THEN
    EXECUTE $p$
      CREATE POLICY "practice_sessions_insert_own" ON public.practice_sessions FOR INSERT WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_sessions' AND policyname='practice_sessions_update_own') THEN
    EXECUTE $p$
      CREATE POLICY "practice_sessions_update_own" ON public.practice_sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answer_attempts' AND policyname='answer_attempts_select_own') THEN
    EXECUTE $p$
      CREATE POLICY "answer_attempts_select_own" ON public.answer_attempts FOR SELECT USING (auth.uid() = user_id)
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answer_attempts' AND policyname='answer_attempts_insert_own') THEN
    EXECUTE $p$
      CREATE POLICY "answer_attempts_insert_own" ON public.answer_attempts FOR INSERT WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;
END $$;
