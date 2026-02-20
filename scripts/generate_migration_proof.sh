#!/bin/bash
# PROOF Generation Script for UUID Migration
# This script generates the outputs required to demonstrate successful migration

set -e

echo "======================================================================"
echo "PROOF: Full-Length Exam UUID Migration"
echo "======================================================================"
echo ""

# Check if database connection is available
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL not set"
    echo "Please set DATABASE_URL environment variable:"
    echo "  export DATABASE_URL='postgresql://user:password@host:port/database'"
    exit 1
fi

echo "✓ Database connection configured"
echo ""

# PROOF 1: Migration Apply Success
echo "======================================================================"
echo "PROOF 1: Migration Apply Success"
echo "======================================================================"
echo ""
echo "Running migration..."
psql "$DATABASE_URL" -f supabase/migrations/20260216_full_length_exam_uuid_types.sql
echo ""

# PROOF 2: Column Data Types
echo "======================================================================"
echo "PROOF 2: Column Data Types (All should be 'uuid')"
echo "======================================================================"
echo ""
psql "$DATABASE_URL" -c "
SELECT 
    table_name, 
    column_name, 
    data_type,
    CASE 
        WHEN data_type = 'uuid' THEN '✓ PASS'
        ELSE '✗ FAIL - Expected uuid, got ' || data_type
    END as verification
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
"
echo ""

# PROOF 3: Constraints & Indexes
echo "======================================================================"
echo "PROOF 3: Constraints & Indexes"
echo "======================================================================"
echo ""
echo "--- full_length_exam_sessions ---"
psql "$DATABASE_URL" -c "\d full_length_exam_sessions"
echo ""
echo "--- full_length_exam_modules ---"
psql "$DATABASE_URL" -c "\d full_length_exam_modules"
echo ""
echo "--- full_length_exam_questions ---"
psql "$DATABASE_URL" -c "\d full_length_exam_questions"
echo ""
echo "--- full_length_exam_responses ---"
psql "$DATABASE_URL" -c "\d full_length_exam_responses"
echo ""

# Verify unique constraints exist
echo "--- Unique Constraints Verification ---"
psql "$DATABASE_URL" -c "
SELECT 
    conrelid::regclass as table_name,
    conname as constraint_name,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE contype = 'u'
AND conname IN (
    'full_length_exam_responses_unique_session_module_question',
    'full_length_exam_questions_unique_module_question',
    'full_length_exam_questions_unique_module_order'
)
ORDER BY table_name, constraint_name;
"
echo ""

# Verify partial unique index
echo "--- Partial Unique Index Verification ---"
psql "$DATABASE_URL" -c "
SELECT 
    indexname,
    indexdef,
    CASE 
        WHEN indexdef LIKE '%WHERE%status%' THEN '✓ PASS - Partial index on status'
        ELSE '✗ FAIL - Missing WHERE clause'
    END as verification
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'full_length_exam_sessions'
AND indexname = 'idx_one_active_exam_session_per_user';
"
echo ""

# PROOF 4: RLS Policies (No ::text casts)
echo "======================================================================"
echo "PROOF 4: RLS Policies (No ::text casts)"
echo "======================================================================"
echo ""
psql "$DATABASE_URL" -c "
SELECT 
    tablename,
    policyname,
    cmd as operation,
    CASE 
        WHEN definition LIKE '%::text%' THEN '✗ FAIL - Contains ::text cast'
        WHEN definition LIKE '%auth.uid()%' THEN '✓ PASS - Uses auth.uid() directly'
        ELSE '✓ PASS'
    END as verification,
    substring(definition from 1 for 80) || '...' as definition_preview
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules',
    'full_length_exam_questions',
    'full_length_exam_responses'
)
ORDER BY tablename, policyname;
"
echo ""

# Summary
echo "======================================================================"
echo "PROOF SUMMARY"
echo "======================================================================"
echo ""
psql "$DATABASE_URL" -c "
SELECT 
    'Column Types' as check,
    COUNT(*) FILTER (WHERE data_type = 'uuid') || ' / ' || COUNT(*) as result,
    CASE 
        WHEN COUNT(*) FILTER (WHERE data_type = 'uuid') = COUNT(*) THEN '✓ PASS'
        ELSE '✗ FAIL'
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

UNION ALL

SELECT 
    'Unique Constraints' as check,
    COUNT(*)::text || ' / 3' as result,
    CASE 
        WHEN COUNT(*) = 3 THEN '✓ PASS'
        ELSE '✗ FAIL'
    END as status
FROM pg_constraint
WHERE contype = 'u'
AND conname IN (
    'full_length_exam_responses_unique_session_module_question',
    'full_length_exam_questions_unique_module_question',
    'full_length_exam_questions_unique_module_order'
)

UNION ALL

SELECT 
    'Partial Unique Index' as check,
    COUNT(*)::text || ' / 1' as result,
    CASE 
        WHEN COUNT(*) = 1 THEN '✓ PASS'
        ELSE '✗ FAIL'
    END as status
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname = 'idx_one_active_exam_session_per_user'

UNION ALL

SELECT 
    'RLS Policies (no ::text)' as check,
    COUNT(*) FILTER (WHERE definition NOT LIKE '%::text%') || ' / ' || COUNT(*) as result,
    CASE 
        WHEN COUNT(*) FILTER (WHERE definition NOT LIKE '%::text%') = COUNT(*) THEN '✓ PASS'
        ELSE '✗ FAIL'
    END as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules',
    'full_length_exam_questions',
    'full_length_exam_responses'
);
"
echo ""
echo "======================================================================"
echo "✓ PROOF Generation Complete"
echo "======================================================================"
