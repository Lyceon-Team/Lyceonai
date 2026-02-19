-- Full-Length Exam Score Rollups Migration
-- Adds persistent score storage for deterministic exam completion
--
-- Changes:
-- 1. Create full_length_exam_score_rollups table for storing computed scores
-- 2. Add unique constraint on session_id (one rollup per session)
-- 3. Add index on (user_id, created_at DESC) for efficient user score history queries
-- 4. Enable RLS with policies for user isolation

-- ============================================================================
-- PART A: Create Score Rollups Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.full_length_exam_score_rollups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR NOT NULL REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Section scores (Reading & Writing combined as RW) - Module level
    rw_module1_correct INT NOT NULL,
    rw_module1_total INT NOT NULL,
    rw_module2_correct INT NOT NULL,
    rw_module2_total INT NOT NULL,
    
    -- Section scores (Math) - Module level
    math_module1_correct INT NOT NULL,
    math_module1_total INT NOT NULL,
    math_module2_correct INT NOT NULL,
    math_module2_total INT NOT NULL,
    
    -- Overall score (raw correct count)
    overall_score INT NOT NULL,
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PART B: Add Constraints
-- ============================================================================

-- B1: Unique constraint - one rollup per session
ALTER TABLE public.full_length_exam_score_rollups
ADD CONSTRAINT full_length_exam_score_rollups_unique_session
UNIQUE (session_id);

-- ============================================================================
-- PART C: Add Indexes
-- ============================================================================

-- C1: Index for user score history queries
CREATE INDEX idx_full_length_exam_score_rollups_user_created
ON public.full_length_exam_score_rollups(user_id, created_at DESC);

-- ============================================================================
-- PART D: Enable Row Level Security (RLS)
-- ============================================================================

ALTER TABLE public.full_length_exam_score_rollups ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART E: RLS Policies
-- ============================================================================

-- E1: Users can select their own score rollups
DROP POLICY IF EXISTS score_rollups_select_own ON public.full_length_exam_score_rollups;
CREATE POLICY score_rollups_select_own ON public.full_length_exam_score_rollups
    FOR SELECT USING (user_id = auth.uid()::text);

-- E2: Users can insert their own score rollups
DROP POLICY IF EXISTS score_rollups_insert_own ON public.full_length_exam_score_rollups;
CREATE POLICY score_rollups_insert_own ON public.full_length_exam_score_rollups
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

-- ============================================================================
-- Verification
-- ============================================================================

SELECT 'Full-length exam score rollups migration completed successfully' AS status;
