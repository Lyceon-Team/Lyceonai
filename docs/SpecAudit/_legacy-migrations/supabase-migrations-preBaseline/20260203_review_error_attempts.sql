-- Review Error Attempts Table
-- Stores student attempts during error review sessions
-- Part of Sprint 2 Final Closeout (Gap 1)

-- ============================================================================
-- Table: review_error_attempts
-- Stores review error practice attempts with idempotency support
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.review_error_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  
  -- Context must be 'review_errors' to distinguish from other practice types
  context TEXT NOT NULL CHECK (context = 'review_errors'),
  
  selected_answer TEXT,
  is_correct BOOLEAN NOT NULL,
  seconds_spent INTEGER,
  
  -- Idempotency support: client can provide unique ID to prevent duplicates
  client_attempt_id TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_review_error_attempts_student_id 
  ON public.review_error_attempts(student_id);

CREATE INDEX IF NOT EXISTS idx_review_error_attempts_student_created 
  ON public.review_error_attempts(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_error_attempts_student_question 
  ON public.review_error_attempts(student_id, question_id);

-- Unique index for idempotency (only when client_attempt_id is provided)
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_error_attempts_client_id 
  ON public.review_error_attempts(student_id, client_attempt_id) 
  WHERE client_attempt_id IS NOT NULL;

-- ============================================================================
-- RLS Policies for review_error_attempts
-- ============================================================================
ALTER TABLE public.review_error_attempts ENABLE ROW LEVEL SECURITY;

-- Students can view their own attempts
DROP POLICY IF EXISTS "Students can view own review error attempts" ON public.review_error_attempts;
CREATE POLICY "Students can view own review error attempts"
  ON public.review_error_attempts
  FOR SELECT
  USING (auth.uid() = student_id);

-- Students can insert their own attempts
DROP POLICY IF EXISTS "Students can create own review error attempts" ON public.review_error_attempts;
CREATE POLICY "Students can create own review error attempts"
  ON public.review_error_attempts
  FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Admins can read all attempts
DROP POLICY IF EXISTS "Admins can view all review error attempts" ON public.review_error_attempts;
CREATE POLICY "Admins can view all review error attempts"
  ON public.review_error_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS "Service role full access to review error attempts" ON public.review_error_attempts;
CREATE POLICY "Service role full access to review error attempts"
  ON public.review_error_attempts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
