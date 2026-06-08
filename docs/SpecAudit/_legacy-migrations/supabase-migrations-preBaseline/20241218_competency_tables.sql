-- ============================================================================
-- SAT Copilot Competency Tracking Tables Migration
-- Run in Supabase SQL Editor - Idempotent (safe to re-run)
-- ============================================================================

-- Practice Sessions Table (if not exists)
CREATE TABLE IF NOT EXISTS practice_sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  section text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  total_questions int DEFAULT 0,
  correct_count int DEFAULT 0,
  incorrect_count int DEFAULT 0,
  skipped_count int DEFAULT 0,
  accuracy numeric,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user 
  ON practice_sessions(user_id, started_at DESC);

-- Answer Attempts Table (if not exists)
CREATE TABLE IF NOT EXISTS answer_attempts (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES practice_sessions(id),
  user_id uuid NOT NULL,
  question_id uuid NOT NULL,
  selected_answer text NOT NULL,
  is_correct boolean NOT NULL,
  outcome text NOT NULL DEFAULT 'correct' CHECK (outcome IN ('correct', 'incorrect', 'skipped')),
  time_spent_ms int,
  attempted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_attempts_session 
  ON answer_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_user 
  ON answer_attempts(user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_question 
  ON answer_attempts(question_id);

-- Competency Events Table
CREATE TABLE IF NOT EXISTS competency_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  question_id uuid NOT NULL,
  session_id text,
  event_source text NOT NULL CHECK (event_source IN ('practice', 'review')),
  event_type text NOT NULL CHECK (event_type IN ('correct', 'incorrect', 'skipped')),
  delta numeric NOT NULL,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  section text,
  competency_tags jsonb DEFAULT '[]'::jsonb,
  unit_tag text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competency_events_user_occurred 
  ON competency_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_competency_events_user_question 
  ON competency_events(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_competency_events_user_unit 
  ON competency_events(user_id, unit_tag);
CREATE INDEX IF NOT EXISTS idx_competency_events_tags 
  ON competency_events USING GIN (competency_tags);

-- User Competencies Table
CREATE TABLE IF NOT EXISTS user_competencies (
  user_id uuid NOT NULL,
  competency_key text NOT NULL,
  section text,
  score numeric DEFAULT 0 NOT NULL,
  last_event_at timestamptz,
  attempt_count int DEFAULT 0 NOT NULL,
  incorrect_count int DEFAULT 0 NOT NULL,
  review_incorrect_count int DEFAULT 0 NOT NULL,
  skipped_count int DEFAULT 0 NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, competency_key)
);

CREATE INDEX IF NOT EXISTS idx_user_competencies_user_score 
  ON user_competencies(user_id, score DESC);

-- Enable RLS on all tables
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_competencies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for practice_sessions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'practice_sessions_select_own') THEN
    CREATE POLICY practice_sessions_select_own ON practice_sessions FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'practice_sessions_insert_own') THEN
    CREATE POLICY practice_sessions_insert_own ON practice_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'practice_sessions_update_own') THEN
    CREATE POLICY practice_sessions_update_own ON practice_sessions FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'practice_sessions_service') THEN
    CREATE POLICY practice_sessions_service ON practice_sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- RLS Policies for answer_attempts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'answer_attempts_select_own') THEN
    CREATE POLICY answer_attempts_select_own ON answer_attempts FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'answer_attempts_insert_own') THEN
    CREATE POLICY answer_attempts_insert_own ON answer_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'answer_attempts_service') THEN
    CREATE POLICY answer_attempts_service ON answer_attempts FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- RLS Policies for competency_events
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_select_own') THEN
    CREATE POLICY competency_events_select_own ON competency_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_insert_own') THEN
    CREATE POLICY competency_events_insert_own ON competency_events FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_service') THEN
    CREATE POLICY competency_events_service ON competency_events FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- RLS Policies for user_competencies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_select_own') THEN
    CREATE POLICY user_competencies_select_own ON user_competencies FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_insert_own') THEN
    CREATE POLICY user_competencies_insert_own ON user_competencies FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_update_own') THEN
    CREATE POLICY user_competencies_update_own ON user_competencies FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_service') THEN
    CREATE POLICY user_competencies_service ON user_competencies FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================================
-- PATCHES: Defensive fixes for existing tables
-- ============================================================================

-- PATCH: If competency_events already existed, ensure occurred_at exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='competency_events'
      AND column_name='occurred_at'
  ) THEN
    ALTER TABLE public.competency_events
      ADD COLUMN occurred_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Backfill any NULL occurred_at values
UPDATE public.competency_events
SET occurred_at = COALESCE(occurred_at, created_at, now())
WHERE occurred_at IS NULL;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_competency_events_user_occurred
  ON public.competency_events (user_id, occurred_at DESC);
