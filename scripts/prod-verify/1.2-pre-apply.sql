-- ============================================================================
-- PRE-APPLY VERIFICATION — 20260816010000_canonical_domain_checks
-- ============================================================================
-- READ-ONLY. Run immediately before Karl applies the migration.
--
-- WHAT THIS PROVES
--   No existing row in `questions` or `practice_session_items` carries a
--   (section, domain) pair outside the canonical eight, so both CHECK constraints
--   can be added without a table rewrite failure.
--
-- WHY IT MATTERS
--   refresh_domain_mastery hard-blocks on these exact strings and raises
--   DOMAIN_SECTION_MISMATCH otherwise, rolling back the whole mastery event.
--   apply_mastery_event deliberately does NOT check domain canonicality (§4.2
--   Step 4 is consultative and skipped in V1.0), so nothing catches a bad value
--   before that blocking check.
--
--   Note the M list is 'Problem Solving and Data Analysis' WITHOUT a hyphen.
--
-- EXPECTED VALUES
--   bad_questions = 0
--   bad_items     = 0
--
-- HOW TO READ A DEVIATION
--   Either count > 0: the migration will abort with CANONICAL_DOMAIN_VIOLATION.
--   The offending rows are listed below. Decide whether the data is wrong (fix
--   the rows) or the canonical list is wrong (a spec question, not a data fix).
--   Do NOT silently normalize — that would mask a bad authoring pipeline.
--
-- USAGE: psql -f scripts/prod-verify/1.2-pre-apply.sql
-- ============================================================================

\pset footer off
\echo '=== 1.2 PRE-APPLY — canonical (section, domain) pairing ==='

SELECT
  (SELECT count(*) FROM public.questions q
    WHERE NOT (
      (q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                         'Problem Solving and Data Analysis',
                                         'Geometry and Trigonometry'))
      OR
      (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                         'Expression of Ideas',
                                         'Standard English Conventions'))
    ))                                                              AS bad_questions,
  0                                                                 AS bad_questions_expected,

  (SELECT count(*) FROM public.practice_session_items pi
    WHERE NOT (
      (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                             'Problem Solving and Data Analysis',
                                                             'Geometry and Trigonometry'))
      OR
      (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                             'Expression of Ideas',
                                                             'Standard English Conventions'))
    ))                                                              AS bad_items,
  0                                                                 AS bad_items_expected,

  (SELECT count(*) FROM public.questions)                           AS total_questions,
  (SELECT count(*) FROM public.practice_session_items)              AS total_items,

  CASE
    WHEN (SELECT count(*) FROM public.questions q
           WHERE NOT (
             (q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                                'Problem Solving and Data Analysis',
                                                'Geometry and Trigonometry'))
             OR
             (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                                'Expression of Ideas',
                                                'Standard English Conventions')))) > 0
      THEN 'STOP — non-canonical domains in questions; migration will abort'
    WHEN (SELECT count(*) FROM public.practice_session_items pi
           WHERE NOT (
             (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                                    'Problem Solving and Data Analysis',
                                                                    'Geometry and Trigonometry'))
             OR
             (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                                    'Expression of Ideas',
                                                                    'Standard English Conventions')))) > 0
      THEN 'STOP — non-canonical domains in practice_session_items; migration will abort'
    ELSE 'OK — safe to apply 20260816010000'
  END                                                               AS verdict;

\echo ''
\echo '--- observed (section, domain) pairs in the question bank ---'
SELECT section, domain, count(*) AS n
FROM public.questions
GROUP BY section, domain
ORDER BY section, domain;

\echo ''
\echo '--- observed (section, domain) pairs in served items ---'
SELECT question_section AS section, question_domain AS domain, count(*) AS n
FROM public.practice_session_items
GROUP BY question_section, question_domain
ORDER BY question_section, question_domain;

\echo ''
\echo '--- offending rows, if any (empty is the expected result) ---'
SELECT 'questions' AS source, q.id::text AS row_id, q.section, q.domain
FROM public.questions q
WHERE NOT (
  (q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                     'Problem Solving and Data Analysis',
                                     'Geometry and Trigonometry'))
  OR
  (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                     'Expression of Ideas',
                                     'Standard English Conventions'))
)
UNION ALL
SELECT 'practice_session_items', pi.id::text, pi.question_section, pi.question_domain
FROM public.practice_session_items pi
WHERE NOT (
  (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                         'Problem Solving and Data Analysis',
                                                         'Geometry and Trigonometry'))
  OR
  (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                         'Expression of Ideas',
                                                         'Standard English Conventions'))
)
ORDER BY 1, 2;
