-- Verification Script for UUID Migration (Supabase SQL Editor compatible)
-- No psql meta-commands (\echo). Uses pg_policies.qual/with_check instead of "definition".

-- ============================================================================
-- PART 1: Verify Column Types
-- ============================================================================
SELECT
  table_name,
  column_name,
  data_type,
  CASE
    WHEN data_type = 'uuid' THEN 'PASS'
    ELSE 'FAIL: expected uuid, got ' || data_type
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
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  'PASS' AS status
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
SELECT
  conname AS constraint_name,
  conrelid::regclass::text AS table_name,
  pg_get_constraintdef(oid) AS constraint_definition,
  'PASS' AS status
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
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef,
  CASE
    WHEN indexname = 'idx_one_active_exam_session_per_user'
     AND indexdef ILIKE '%where%'
     AND indexdef ILIKE '%status%'
    THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'full_length_exam_sessions'
  AND indexname = 'idx_one_active_exam_session_per_user';

-- ============================================================================
-- PART 5: Verify RLS Policies (search qual/with_check for ::text)
-- ============================================================================
SELECT
  schemaname,
  tablename,
  policyname,
  CASE
    WHEN (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) LIKE '%::text%'
      THEN 'FAIL: contains ::text cast'
    WHEN (COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) LIKE '%auth.uid()%'
      THEN 'PASS: references auth.uid()'
    ELSE 'PASS'
  END AS status,
  LEFT(COALESCE(qual::text, ''), 120) AS qual_preview,
  LEFT(COALESCE(with_check::text, ''), 120) AS with_check_preview
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
-- SUMMARY
-- ============================================================================
SELECT
  'Column Types' AS check_type,
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
  'RLS Policies (no ::text)' AS check_type,
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
