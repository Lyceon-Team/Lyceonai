-- Full-Length Exam UUID Types Migration
-- Convert VARCHAR columns to UUID for type safety and consistency
-- 
-- Changes:
-- 1. Convert all id columns from VARCHAR to UUID (with gen_random_uuid() default)
-- 2. Convert all foreign key columns to UUID
-- 3. Update RLS policies to remove ::text casts (auth.uid() is already UUID)
-- 4. Preserve all unique constraints and indexes
-- 
-- IDEMPOTENT: Can be run multiple times safely

-- ============================================================================
-- PART A: Helper Functions for Idempotent Type Conversion
-- ============================================================================

DO $$ 
DECLARE
    col_exists BOOLEAN;
    col_type TEXT;
BEGIN
    -- Helper: Check if a column exists and get its type
    -- This will be used to make the migration idempotent
    RAISE NOTICE 'Starting Full-Length Exam UUID migration...';
END $$;

-- ============================================================================
-- PART B: Convert full_length_exam_sessions table
-- ============================================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current type of sessions.id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_sessions'
    AND column_name = 'id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_sessions.id from VARCHAR to UUID...';
        
        -- Drop dependent constraints first (will be recreated)
        -- Note: Foreign keys from other tables need to be dropped before altering the PK
        ALTER TABLE public.full_length_exam_modules DROP CONSTRAINT IF EXISTS full_length_exam_modules_session_id_fkey;
        ALTER TABLE public.full_length_exam_responses DROP CONSTRAINT IF EXISTS full_length_exam_responses_session_id_fkey;
        
        -- Drop the partial unique index (will be recreated)
        DROP INDEX IF EXISTS public.idx_one_active_exam_session_per_user;
        
        -- Convert id column
        ALTER TABLE public.full_length_exam_sessions 
        ALTER COLUMN id TYPE UUID USING id::uuid;
        
        RAISE NOTICE 'Converted full_length_exam_sessions.id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_sessions.id already UUID, skipping';
    END IF;
    
    -- Check current type of sessions.user_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_sessions'
    AND column_name = 'user_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_sessions.user_id from VARCHAR to UUID...';
        
        -- Drop FK constraint to auth.users (will be recreated)
        ALTER TABLE public.full_length_exam_sessions DROP CONSTRAINT IF EXISTS full_length_exam_sessions_user_id_fkey;
        
        -- Convert user_id column
        ALTER TABLE public.full_length_exam_sessions 
        ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
        
        -- Recreate FK constraint to auth.users
        ALTER TABLE public.full_length_exam_sessions
        ADD CONSTRAINT full_length_exam_sessions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_sessions.user_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_sessions.user_id already UUID, skipping';
    END IF;
END $$;

-- ============================================================================
-- PART C: Convert full_length_exam_modules table
-- ============================================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current type of modules.id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_modules'
    AND column_name = 'id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_modules.id from VARCHAR to UUID...';
        
        -- Drop dependent constraints first
        ALTER TABLE public.full_length_exam_questions DROP CONSTRAINT IF EXISTS full_length_exam_questions_module_id_fkey;
        ALTER TABLE public.full_length_exam_responses DROP CONSTRAINT IF EXISTS full_length_exam_responses_module_id_fkey;
        
        -- Convert id column
        ALTER TABLE public.full_length_exam_modules 
        ALTER COLUMN id TYPE UUID USING id::uuid;
        
        RAISE NOTICE 'Converted full_length_exam_modules.id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_modules.id already UUID, skipping';
    END IF;
    
    -- Check current type of modules.session_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_modules'
    AND column_name = 'session_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_modules.session_id from VARCHAR to UUID...';
        
        -- FK was already dropped in sessions conversion
        -- Convert session_id column
        ALTER TABLE public.full_length_exam_modules 
        ALTER COLUMN session_id TYPE UUID USING session_id::uuid;
        
        -- Recreate FK constraint to sessions
        ALTER TABLE public.full_length_exam_modules
        ADD CONSTRAINT full_length_exam_modules_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_modules.session_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_modules.session_id already UUID, skipping';
    END IF;
END $$;

-- ============================================================================
-- PART D: Convert full_length_exam_questions table
-- ============================================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current type of questions.id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_questions'
    AND column_name = 'id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_questions.id from VARCHAR to UUID...';
        
        -- No dependent FKs on this table's id
        -- Convert id column
        ALTER TABLE public.full_length_exam_questions 
        ALTER COLUMN id TYPE UUID USING id::uuid;
        
        RAISE NOTICE 'Converted full_length_exam_questions.id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_questions.id already UUID, skipping';
    END IF;
    
    -- Check current type of questions.module_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_questions'
    AND column_name = 'module_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_questions.module_id from VARCHAR to UUID...';
        
        -- FK was already dropped in modules conversion
        -- Convert module_id column
        ALTER TABLE public.full_length_exam_questions 
        ALTER COLUMN module_id TYPE UUID USING module_id::uuid;
        
        -- Recreate FK constraint to modules
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_module_id_fkey
        FOREIGN KEY (module_id) REFERENCES public.full_length_exam_modules(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_questions.module_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_questions.module_id already UUID, skipping';
    END IF;
    
    -- Check current type of questions.question_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_questions'
    AND column_name = 'question_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_questions.question_id from VARCHAR to UUID...';
        
        -- Drop FK constraint to questions
        ALTER TABLE public.full_length_exam_questions DROP CONSTRAINT IF EXISTS full_length_exam_questions_question_id_fkey;
        
        -- Convert question_id column
        ALTER TABLE public.full_length_exam_questions 
        ALTER COLUMN question_id TYPE UUID USING question_id::uuid;
        
        -- Recreate FK constraint to questions
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_question_id_fkey
        FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_questions.question_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_questions.question_id already UUID, skipping';
    END IF;
END $$;

-- ============================================================================
-- PART E: Convert full_length_exam_responses table
-- ============================================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current type of responses.id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_responses'
    AND column_name = 'id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_responses.id from VARCHAR to UUID...';
        
        -- No dependent FKs on this table's id
        -- Convert id column
        ALTER TABLE public.full_length_exam_responses 
        ALTER COLUMN id TYPE UUID USING id::uuid;
        
        RAISE NOTICE 'Converted full_length_exam_responses.id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_responses.id already UUID, skipping';
    END IF;
    
    -- Check current type of responses.session_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_responses'
    AND column_name = 'session_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_responses.session_id from VARCHAR to UUID...';
        
        -- FK was already dropped in sessions conversion
        -- Convert session_id column
        ALTER TABLE public.full_length_exam_responses 
        ALTER COLUMN session_id TYPE UUID USING session_id::uuid;
        
        -- Recreate FK constraint to sessions
        ALTER TABLE public.full_length_exam_responses
        ADD CONSTRAINT full_length_exam_responses_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES public.full_length_exam_sessions(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_responses.session_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_responses.session_id already UUID, skipping';
    END IF;
    
    -- Check current type of responses.module_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_responses'
    AND column_name = 'module_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_responses.module_id from VARCHAR to UUID...';
        
        -- FK was already dropped in modules conversion
        -- Convert module_id column
        ALTER TABLE public.full_length_exam_responses 
        ALTER COLUMN module_id TYPE UUID USING module_id::uuid;
        
        -- Recreate FK constraint to modules
        ALTER TABLE public.full_length_exam_responses
        ADD CONSTRAINT full_length_exam_responses_module_id_fkey
        FOREIGN KEY (module_id) REFERENCES public.full_length_exam_modules(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_responses.module_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_responses.module_id already UUID, skipping';
    END IF;
    
    -- Check current type of responses.question_id
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'full_length_exam_responses'
    AND column_name = 'question_id';
    
    IF col_type = 'character varying' THEN
        RAISE NOTICE 'Converting full_length_exam_responses.question_id from VARCHAR to UUID...';
        
        -- Drop FK constraint to questions
        ALTER TABLE public.full_length_exam_responses DROP CONSTRAINT IF EXISTS full_length_exam_responses_question_id_fkey;
        
        -- Convert question_id column
        ALTER TABLE public.full_length_exam_responses 
        ALTER COLUMN question_id TYPE UUID USING question_id::uuid;
        
        -- Recreate FK constraint to questions
        ALTER TABLE public.full_length_exam_responses
        ADD CONSTRAINT full_length_exam_responses_question_id_fkey
        FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Converted full_length_exam_responses.question_id to UUID';
    ELSE
        RAISE NOTICE 'full_length_exam_responses.question_id already UUID, skipping';
    END IF;
END $$;

-- ============================================================================
-- PART F: Recreate Unique Constraints (Idempotent)
-- ============================================================================

-- F1: Unique constraint on responses (idempotent answer submission)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_responses_unique_session_module_question'
    ) THEN
        ALTER TABLE public.full_length_exam_responses
        ADD CONSTRAINT full_length_exam_responses_unique_session_module_question
        UNIQUE (session_id, module_id, question_id);
        RAISE NOTICE 'Created constraint: full_length_exam_responses_unique_session_module_question';
    ELSE
        RAISE NOTICE 'Constraint full_length_exam_responses_unique_session_module_question already exists';
    END IF;
END $$;

-- F2: Unique constraint on questions (no duplicate questions in a module)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_questions_unique_module_question'
    ) THEN
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_unique_module_question
        UNIQUE (module_id, question_id);
        RAISE NOTICE 'Created constraint: full_length_exam_questions_unique_module_question';
    ELSE
        RAISE NOTICE 'Constraint full_length_exam_questions_unique_module_question already exists';
    END IF;
END $$;

-- F3: Unique constraint on question ordering within module
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'full_length_exam_questions_unique_module_order'
    ) THEN
        ALTER TABLE public.full_length_exam_questions
        ADD CONSTRAINT full_length_exam_questions_unique_module_order
        UNIQUE (module_id, order_index);
        RAISE NOTICE 'Created constraint: full_length_exam_questions_unique_module_order';
    ELSE
        RAISE NOTICE 'Constraint full_length_exam_questions_unique_module_order already exists';
    END IF;
END $$;

-- F4: Partial unique index - one active session per user
-- Recreate the partial unique index (works with UUID types)
DROP INDEX IF EXISTS public.idx_one_active_exam_session_per_user;
CREATE UNIQUE INDEX idx_one_active_exam_session_per_user
ON public.full_length_exam_sessions(user_id)
WHERE status IN ('not_started', 'in_progress', 'break');

RAISE NOTICE 'Recreated partial unique index: idx_one_active_exam_session_per_user';

-- ============================================================================
-- PART G: Update RLS Policies to Remove ::text Casts
-- ============================================================================

-- G1: Sessions - user can only access their own sessions
-- auth.uid() returns UUID, so we can compare directly without ::text cast
DROP POLICY IF EXISTS sessions_select_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_select_own ON public.full_length_exam_sessions
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS sessions_insert_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_insert_own ON public.full_length_exam_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS sessions_update_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_update_own ON public.full_length_exam_sessions
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS sessions_delete_own ON public.full_length_exam_sessions;
CREATE POLICY sessions_delete_own ON public.full_length_exam_sessions
    FOR DELETE USING (user_id = auth.uid());

-- G2: Modules - user can only access modules from their own sessions
DROP POLICY IF EXISTS modules_select_own ON public.full_length_exam_modules;
CREATE POLICY modules_select_own ON public.full_length_exam_modules
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS modules_insert_own ON public.full_length_exam_modules;
CREATE POLICY modules_insert_own ON public.full_length_exam_modules
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS modules_update_own ON public.full_length_exam_modules;
CREATE POLICY modules_update_own ON public.full_length_exam_modules
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS modules_delete_own ON public.full_length_exam_modules;
CREATE POLICY modules_delete_own ON public.full_length_exam_modules
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_modules.session_id
            AND s.user_id = auth.uid()
        )
    );

-- G3: Questions - user can only access questions from their own session modules
DROP POLICY IF EXISTS questions_select_own ON public.full_length_exam_questions;
CREATE POLICY questions_select_own ON public.full_length_exam_questions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS questions_insert_own ON public.full_length_exam_questions;
CREATE POLICY questions_insert_own ON public.full_length_exam_questions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS questions_update_own ON public.full_length_exam_questions;
CREATE POLICY questions_update_own ON public.full_length_exam_questions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS questions_delete_own ON public.full_length_exam_questions;
CREATE POLICY questions_delete_own ON public.full_length_exam_questions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_modules m
            INNER JOIN public.full_length_exam_sessions s ON s.id = m.session_id
            WHERE m.id = full_length_exam_questions.module_id
            AND s.user_id = auth.uid()
        )
    );

-- G4: Responses - user can only access responses from their own sessions
DROP POLICY IF EXISTS responses_select_own ON public.full_length_exam_responses;
CREATE POLICY responses_select_own ON public.full_length_exam_responses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS responses_insert_own ON public.full_length_exam_responses;
CREATE POLICY responses_insert_own ON public.full_length_exam_responses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS responses_update_own ON public.full_length_exam_responses;
CREATE POLICY responses_update_own ON public.full_length_exam_responses
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS responses_delete_own ON public.full_length_exam_responses;
CREATE POLICY responses_delete_own ON public.full_length_exam_responses
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.full_length_exam_sessions s
            WHERE s.id = full_length_exam_responses.session_id
            AND s.user_id = auth.uid()
        )
    );

-- ============================================================================
-- PART H: Verification
-- ============================================================================

SELECT 'Full-length exam UUID migration completed successfully' AS status;

-- Display converted column types for verification
SELECT 
    table_name, 
    column_name, 
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
)
AND column_name IN ('id', 'user_id', 'session_id', 'module_id', 'question_id')
ORDER BY table_name, column_name;
