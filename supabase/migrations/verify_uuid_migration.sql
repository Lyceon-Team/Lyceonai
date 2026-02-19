-- Verification Script for UUID Migration
-- Run this after applying 20260216_full_length_exam_uuid_types.sql

-- ============================================================================
-- PART 1: Verify Column Types
-- ============================================================================

\echo '=== Column Type Verification ==='
SELECT 
    table_name, 
    column_name, 
    data_type,
    CASE 
        WHEN data_type = 'uuid' THEN '✓'
        ELSE '✗ EXPECTED UUID, GOT ' || data_type
    END as status
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

-- ============================================================================
-- PART 2: Verify Foreign Key Constraints
-- ============================================================================

\echo '=== Foreign Key Constraints Verification ==='
SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    '✓' as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
AND tc.table_name IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
)
ORDER BY tc.table_name, kcu.column_name;

-- ============================================================================
-- PART 3: Verify Unique Constraints
-- ============================================================================

\echo '=== Unique Constraints Verification ==='
SELECT 
    conname as constraint_name,
    conrelid::regclass as table_name,
    pg_get_constraintdef(oid) as constraint_definition,
    '✓' as status
FROM pg_constraint
WHERE contype = 'u'
AND conrelid::regclass::text IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
)
AND conname IN (
    'full_length_exam_responses_unique_session_module_question',
    'full_length_exam_questions_unique_module_question',
    'full_length_exam_questions_unique_module_order'
)
ORDER BY table_name, constraint_name;

-- ============================================================================
-- PART 4: Verify Partial Unique Index
-- ============================================================================

\echo '=== Partial Unique Index Verification ==='
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef,
    CASE 
        WHEN indexname = 'idx_one_active_exam_session_per_user' 
        AND indexdef LIKE '%WHERE%status%' 
        THEN '✓'
        ELSE '✗'
    END as status
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'full_length_exam_sessions'
AND indexname = 'idx_one_active_exam_session_per_user';

-- ============================================================================
-- PART 5: Verify RLS Policies (No ::text casts)
-- ============================================================================

\echo '=== RLS Policies Verification ==='
SELECT 
    schemaname,
    tablename,
    policyname,
    CASE 
        WHEN definition LIKE '%::text%' THEN '✗ CONTAINS ::text CAST'
        WHEN definition LIKE '%auth.uid()%' THEN '✓ Uses auth.uid() directly'
        ELSE '✓'
    END as status,
    substring(definition from 1 for 100) as definition_preview
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
)
ORDER BY tablename, policyname;

-- ============================================================================
-- Summary
-- ============================================================================

\echo '=== Migration Verification Summary ==='
SELECT 
    'Column Types' as check_type,
    COUNT(*) FILTER (WHERE data_type = 'uuid') as passed,
    COUNT(*) FILTER (WHERE data_type != 'uuid') as failed,
    COUNT(*) as total
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
)
AND column_name IN ('id', 'user_id', 'session_id', 'module_id', 'question_id')

UNION ALL

SELECT 
    'RLS Policies (no ::text)' as check_type,
    COUNT(*) FILTER (WHERE definition NOT LIKE '%::text%') as passed,
    COUNT(*) FILTER (WHERE definition LIKE '%::text%') as failed,
    COUNT(*) as total
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules', 
    'full_length_exam_questions',
    'full_length_exam_responses'
);
