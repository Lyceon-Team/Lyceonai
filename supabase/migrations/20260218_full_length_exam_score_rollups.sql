-- Full-Length Exam Score Rollups Migration (UUID-safe)
-- Fixes: session_id + user_id types must be UUID after UUID hardening

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- PART A: Create Score Rollups Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.full_length_exam_score_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UUID columns to match referenced tables
  session_id UUID NOT NULL REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Module-level scores
  rw_module1_correct   INT NOT NULL,
  rw_module1_total     INT NOT NULL,
  rw_module2_correct   INT NOT NULL,
  rw_module2_total     INT NOT NULL,
  math_module1_correct INT NOT NULL,
  math_module1_total   INT NOT NULL,
  math_module2_correct INT NOT NULL,
  math_module2_total   INT NOT NULL,

  -- Overall score (raw correct count)
  overall_score INT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PART B: Add Constraints (idempotent)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'full_length_exam_score_rollups_unique_session'
      AND conrelid = 'public.full_length_exam_score_rollups'::regclass
  ) THEN
    ALTER TABLE public.full_length_exam_score_rollups
      ADD CONSTRAINT full_length_exam_score_rollups_unique_session
      UNIQUE (session_id);
  END IF;
END $$;

-- ============================================================================
-- PART C: Indexes (idempotent)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_full_length_exam_score_rollups_user_created
  ON public.full_length_exam_score_rollups(user_id, created_at DESC);

-- ============================================================================
-- PART D: Enable RLS
-- ============================================================================
ALTER TABLE public.full_length_exam_score_rollups ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART E: RLS Policies (UUID-to-UUID comparisons)
-- ============================================================================
DROP POLICY IF EXISTS score_rollups_select_own ON public.full_length_exam_score_rollups;
CREATE POLICY score_rollups_select_own
  ON public.full_length_exam_score_rollups
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS score_rollups_insert_own ON public.full_length_exam_score_rollups;
CREATE POLICY score_rollups_insert_own
  ON public.full_length_exam_score_rollups
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- Verification
-- ============================================================================
SELECT 'full_length_exam_score_rollups migration applied' AS status;

