-- ============================================================================
-- LYCEON PRACTICE ENGINE - COMPETENCY TABLES
-- Run in Supabase SQL Editor to enable weakness tracking
-- Safe to re-run (idempotent)
-- ============================================================================

-- User Competencies Table - tracks mastery by competency key
CREATE TABLE IF NOT EXISTS public.user_competencies (
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
  ON public.user_competencies(user_id, score DESC);

-- Competency Events Table - logs each answer event for analytics
CREATE TABLE IF NOT EXISTS public.competency_events (
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
  ON public.competency_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_competency_events_user_question 
  ON public.competency_events(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_competency_events_user_unit 
  ON public.competency_events(user_id, unit_tag);
CREATE INDEX IF NOT EXISTS idx_competency_events_tags 
  ON public.competency_events USING GIN (competency_tags);

-- Enable RLS on competency tables
ALTER TABLE public.user_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competency_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_competencies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_select_own') THEN
    CREATE POLICY user_competencies_select_own ON public.user_competencies FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_insert_own') THEN
    CREATE POLICY user_competencies_insert_own ON public.user_competencies FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_update_own') THEN
    CREATE POLICY user_competencies_update_own ON public.user_competencies FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_service') THEN
    CREATE POLICY user_competencies_service ON public.user_competencies FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- RLS Policies for competency_events
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_select_own') THEN
    CREATE POLICY competency_events_select_own ON public.competency_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_insert_own') THEN
    CREATE POLICY competency_events_insert_own ON public.competency_events FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'competency_events_service') THEN
    CREATE POLICY competency_events_service ON public.competency_events FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Guardian access policy: Allow guardians to view their linked students' competencies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_competencies_guardian_read') THEN
    CREATE POLICY user_competencies_guardian_read ON public.user_competencies FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_id
          AND p.guardian_profile_id = auth.uid()
      )
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION QUERY (run after migration to confirm tables exist)
-- ============================================================================
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name IN ('user_competencies', 'competency_events');
