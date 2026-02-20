-- Verification Script for UUID Migration (Supabase SQL Editor compatible)
-- Run after applying: 20260216_full_length_exam_uuid_types.sql

-- ============================================================================
-- PART 1: Verify Column Types
-- ============================================================================

SELECT '=== Column Type Verification ===' AS section;

SELECT
  table_name,
  column_name,
  data_type,
  CASE
    WHEN data_type = 'uuid' THEN '✓'
    ELSE '✗ EXPECTED UUID, GOT ' || data_type
  END AS status
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

SELECT '=== Foreign Key Constraints Verification ===' AS section;

SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  '✓' AS status
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

SELECT '=== Unique Constraints Verification ===' AS section;

SELECT
  c.conname AS constraint_name,
  c.conrelid::regclass::text AS table_name,
  pg_get_constraintdef(c.oid) AS constraint_definition,
  '✓' AS status
FROM pg_constraint c
WHERE c.contype = 'u'
  AND c.conrelid = ANY (ARRAY[
    to_regclass('public.full_length_exam_sessions'),
    to_regclass('public.full_length_exam_modules'),
    to_regclass('public.full_length_exam_questions'),
    to_regclass('public.full_length_exam_responses')
  ])
  AND c.conname IN (
    'full_length_exam_responses_unique_session_module_question',
    'full_length_exam_questions_unique_module_question',
    'full_length_exam_questions_unique_module_order'
  )
ORDER BY table_name, constraint_name;

-- ============================================================================
-- PART 4: Verify Partial Unique Index (one active session per user)
-- Notes:
-- - Your repo/migration history may have used either index name.
-- - This checks both common names.
-- ============================================================================

SELECT '=== Partial Unique Index Verification ===' AS section;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef,
  CASE
    WHEN indexdef ILIKE '%unique%'
     AND indexdef ILIKE '%where%'
     AND indexdef ILIKE '%status%'
    THEN '✓'
    ELSE '✗'
  END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'full_length_exam_sessions'
  AND indexname IN (
    'idx_one_active_exam_session_per_user',
    'full_length_exam_sessions_one_active_per_user'
  )
ORDER BY indexname;

-- ============================================================================
-- PART 5: Verify RLS Policies (No ::text casts)
-- Supabase SQL Editor does NOT support psql meta commands (\echo).
-- Also, pg_policies does NOT have a "definition" column; it has "qual" and "with_check".
-- ============================================================================

SELECT '=== RLS Policies Verification (no ::text casts) ===' AS section;

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  CASE
    WHEN (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) LIKE '%::text%'
      THEN '✗ CONTAINS ::text CAST'
    WHEN (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) LIKE '%auth.uid()%'
      THEN '✓ Uses auth.uid()'
    ELSE '✓'
  END AS status,
  LEFT((COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')), 140) AS definition_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules',
    'full_length_exam_questions',
    'full_length_exam_responses'
  )
ORDER BY tablename, policyname, cmd;

-- ============================================================================
-- SUMMARY
-- ============================================================================

SELECT '=== Migration Verification Summary ===' AS section;

SELECT
  'Column Types (expected uuid)' AS check_type,
  COUNT(*) FILTER (WHERE data_type = 'uuid') AS passed,
  COUNT(*) FILTER (WHERE data_type <> 'uuid') AS failed,
  COUNT(*) AS total
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
  'RLS Policies (no ::text casts in qual/with_check)' AS check_type,
  COUNT(*) FILTER (
    WHERE (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) NOT LIKE '%::text%'
  ) AS passed,
  COUNT(*) FILTER (
    WHERE (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) LIKE '%::text%'
  ) AS failed,
  COUNT(*) AS total
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'full_length_exam_sessions',
    'full_length_exam_modules',
    'full_length_exam_questions',
    'full_length_exam_responses'
  );
