-- ============================================================================
-- 3.1 POST-APPLY — 20260817000000 (one completed diagnostic per student)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- Asserts the index EXISTS, is UNIQUE, and carries the exact partial predicate.
-- All three matter and the third is the one worth naming: an index built without
-- `AND status = 'completed'` still exists and is still unique, and it would make a
-- student's abandoned diagnostic collide with their completed one — turning a
-- rule that protects data quality into a dead end for the student who closed their
-- laptop at question 3. Presence is not the property; the predicate is.
--
-- pg_get_indexdef renders the predicate in normalised form, so the comparison is
-- against what the server actually stored rather than against the text of the
-- migration file.
--
-- EXPECTED
--   index_present   = 1
--   is_unique       = true
--   predicate_exact = true
--   verdict = 'OK — 20260817000000 applied; one completed diagnostic per student is enforced'
-- ============================================================================

SELECT
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'practice_sessions_one_completed_diagnostic_uq')  AS index_present,
  (SELECT i.indisunique FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'practice_sessions_one_completed_diagnostic_uq')  AS is_unique,
  (SELECT pg_get_indexdef(c.oid) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'practice_sessions_one_completed_diagnostic_uq')  AS index_definition,
  (SELECT count(*) FROM public.practice_sessions
    WHERE mode = 'diagnostic' AND status = 'completed')                 AS completed_diagnostics,
  (SELECT count(*) FROM public.practice_sessions
    WHERE mode = 'diagnostic' AND status = 'abandoned')                 AS abandoned_diagnostics,
  CASE
    WHEN (SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname = 'practice_sessions_one_completed_diagnostic_uq') = 0
      THEN 'STOP — the index is absent; 20260817000000 did not apply'
    WHEN NOT (SELECT i.indisunique FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_index i ON i.indexrelid = c.oid
               WHERE n.nspname = 'public'
                 AND c.relname = 'practice_sessions_one_completed_diagnostic_uq')
      THEN 'STOP — the index exists but is NOT unique; it enforces nothing'
    WHEN (SELECT pg_get_indexdef(c.oid) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname = 'practice_sessions_one_completed_diagnostic_uq')
         NOT LIKE '%WHERE ((mode = ''diagnostic''::text) AND (status = ''completed''::text))'
      THEN 'STOP — the partial predicate is not exactly (mode=diagnostic AND status=completed). A wider predicate makes an abandoned diagnostic collide with a completed one.'
    ELSE 'OK — 20260817000000 applied; one completed diagnostic per student is enforced'
  END                                                                   AS verdict;
