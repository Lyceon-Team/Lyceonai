-- Full-Length Exam Hardening Migration
-- Sprint 4 Audit: P0 Blockers - Database constraints and RLS policies
-- 
-- Changes:
-- 1. Ensure full_length_exam_* tables exist (idempotent)
-- 2. Add unique constraints for data integrity
-- 3. Add partial unique index for one active session per user
-- 4. Enable Row Level Security (RLS) on all exam tables
-- 5. Add RLS policies for user isolation

-- ============================================================================
-- PART A: Ensure Tables Exist (Idempotent)
-- ============================================================================

-- Full-Length Exam Sessions Table
CREATE TABLE IF NOT EXISTS public.full_length_exam_sessions (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Session state
    status TEXT NOT NULL DEFAULT 'not_started',
    current_section TEXT,
    current_module INTEGER,
    
    -- Deterministic selection
    seed TEXT NOT NULL,
    
    -- Timestamps
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-Length Exam Modules Table
CREATE TABLE IF NOT EXISTS public.full_length_exam_modules (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR NOT NULL REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE,
    
    -- Module identification
    section TEXT NOT NULL,
    module_index INTEGER NOT NULL,
    
    -- Adaptive difficulty
    difficulty_bucket TEXT,
    
    -- Timing (server-authoritative)
    target_duration_ms INTEGER NOT NULL,
    started_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    
    -- State
    status TEXT NOT NULL DEFAULT 'not_started',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-Length Exam Questions Table
CREATE TABLE IF NOT EXISTS public.full_length_exam_questions (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id VARCHAR NOT NULL REFERENCES public.full_length_exam_modules(id) ON DELETE CASCADE,
    question_id VARCHAR NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    
    -- Ordering
    order_index INTEGER NOT NULL,
    
    -- Presentation tracking
    presented_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-Length Exam Responses Table
CREATE TABLE IF NOT EXISTS public.full_length_exam_responses (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR NOT NULL REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE,
    module_id VARCHAR NOT NULL REFERENCES public.full_length_exam_modules(id) ON DELETE CASCADE,
    question_id VARCHAR NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    
    -- Answer
    selected_answer TEXT,
    free_response_answer TEXT,
    
    -- Correctness (computed server-side)
    is_correct BOOLEAN,
    
    -- Timestamps
    answered_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PART B: Add Constraints
-- ============================================================================

-- B1: Unique constraint on responses (idempotent answer submission)
-- Ensures one response per question per module per session
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_responses_unique_session_module_question'
    ) THEN
        ALTER TABLE public.full_length_exam_responses
        ADD CONSTRAINT full_length_exam_responses_unique_session_module_question
        UNIQUE (session_id, module_id, question_id);
    END IF;
END $$;

-- B2: Unique constraint on questions (no duplicate questions in a module)
-- Ensures each question appears only once per module
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_questions_unique_module_question'
    ) THEN
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_unique_module_question
        UNIQUE (module_id, question_id);
    END IF;
END $$;

-- B3: Unique constraint on question ordering within module
-- Ensures no duplicate order indices within a module
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_questions_unique_module_order'
    ) THEN
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_unique_module_order
        UNIQUE (module_id, order_index);
    END IF;
END $$;

-- B4: Partial unique index - one active session per user
-- Only one session can be in 'not_started', 'in_progress', or 'break' status per user
DROP INDEX IF EXISTS public.idx_one_active_exam_session_per_user;
CREATE UNIQUE INDEX idx_one_active_exam_session_per_user
ON public.full_length_exam_sessions(user_id)
WHERE status IN ('not_started', 'in_progress', 'break');

-- ============================================================================
-- PART C: Enable Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on all exam tables
ALTER TABLE public.full_length_exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_length_exam_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_length_exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_length_exam_responses ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART D: RLS Policies
-- ============================================================================

-- D1: Sessions - user can only access their own sessions
DROP POLICY IF EXISTS sessions_select_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_select_own ON public.full_length_exam_sessions
    FOR SELECT USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS sessions_insert_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_insert_own ON public.full_length_exam_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS sessions_update_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_update_own ON public.full_length_exam_sessions
    FOR UPDATE USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS sessions_delete_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_delete_own ON public.full_length_exam_sessions
    FOR DELETE USING (user_id = auth.uid()::text);

-- D2: Modules - user can only access modules from their own sessions
DROP POLICY IF EXISTS modules_select_own ON public.full_length_exam_modules;
CREATE POLICY modules_select_own ON public.full_length_exam_modules
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS modules_insert_own ON public.full_length_exam_modules;
CREATE POLICY modules_insert_own ON public.full_length_exam_modules
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS modules_update_own ON public.full_length_exam_modules;
CREATE POLICY modules_update_own ON public.full_length_exam_modules
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS modules_delete_own ON public.full_length_exam_modules;
CREATE POLICY modules_delete_own ON public.full_length_exam_modules
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()::text
        )
    );

-- D3: Questions - user can only access questions from their own session modules
DROP POLICY IF EXISTS questions_select_own ON public.full_length_exam_questions;
CREATE POLICY questions_select_own ON public.full_length_exam_questions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS questions_insert_own ON public.full_length_exam_questions;
CREATE POLICY questions_insert_own ON public.full_length_exam_questions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS questions_update_own ON public.full_length_exam_questions;
CREATE POLICY questions_update_own ON public.full_length_exam_questions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS questions_delete_own ON public.full_length_exam_questions;
CREATE POLICY questions_delete_own ON public.full_length_exam_questions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()::text
        )
    );

-- D4: Responses - user can only access responses from their own sessions
DROP POLICY IF EXISTS responses_select_own ON public.full_length_exam_responses;
CREATE POLICY responses_select_own ON public.full_length_exam_responses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS responses_insert_own ON public.full_length_exam_responses;
CREATE POLICY responses_insert_own ON public.full_length_exam_responses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS responses_update_own ON public.full_length_exam_responses;
CREATE POLICY responses_update_own ON public.full_length_exam_responses
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS responses_delete_own ON public.full_length_exam_responses;
CREATE POLICY responses_delete_own ON public.full_length_exam_responses
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()::text
        )
    );

-- ============================================================================
-- Verification
-- ============================================================================

SELECT 'Full-length exam hardening migration completed successfully' AS status;
