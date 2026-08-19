-- ============================================================================
-- PRE-APPLY VERIFICATION — 20260816010000_canonical_domain_checks
-- ============================================================================
-- READ-ONLY. Run immediately before applying the migration.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console. ONE statement, ONE row. The last
--   column is the verdict. See README.md for the rules every file here follows.
--
-- WHAT THIS PROVES
--   No existing row in `questions` or `practice_session_items` carries a
--   (section, domain) pair outside the canonical eight, so both CHECK constraints
--   can be added without the ALTER failing on pre-existing data.
--
-- WHY IT MATTERS
--   refresh_domain_mastery hard-blocks on these exact strings and raises
--   DOMAIN_SECTION_MISMATCH otherwise, rolling back the whole mastery event.
--   apply_mastery_event deliberately does NOT check domain canonicality (§4.2
--   Step 4 is consultative and skipped in V1.0), so nothing catches a bad value
--   before that blocking check.
--
--   Note the M list is 'Problem Solving and Data Analysis' WITHOUT a hyphen,
--   which is what refresh_domain_mastery's canonical list uses and what the data
--   uses.
--
-- EXPECTED VALUES
--   bad_questions = 0
--   bad_items     = 0
--   verdict       = 'OK — safe to apply 20260816010000'
--
-- HOW TO READ A DEVIATION
--   Either count > 0: the migration will abort with CANONICAL_DOMAIN_VIOLATION.
--   Run 1.2-pre-apply-detail.sql to see the offending rows, then decide whether
--   the data is wrong (fix the rows) or the canonical list is wrong (a spec
--   question, not a data fix). Do NOT silently normalize — that would mask a bad
--   authoring pipeline.
-- ============================================================================

WITH census AS (
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
      ))                                                            AS bad_questions,
    (SELECT count(*) FROM public.practice_session_items pi
      WHERE NOT (
        (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                               'Problem Solving and Data Analysis',
                                                               'Geometry and Trigonometry'))
        OR
        (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                               'Expression of Ideas',
                                                               'Standard English Conventions'))
      ))                                                            AS bad_items,
    (SELECT count(*) FROM public.questions)                         AS total_questions,
    (SELECT count(*) FROM public.practice_session_items)            AS total_items
)
SELECT
  c.bad_questions,
  0                                             AS bad_questions_expected,
  c.bad_items,
  0                                             AS bad_items_expected,
  c.total_questions,
  c.total_items,
  CASE
    WHEN c.bad_questions > 0
      THEN 'STOP — non-canonical domains in questions; migration will abort. Run 1.2-pre-apply-detail.sql.'
    WHEN c.bad_items > 0
      THEN 'STOP — non-canonical domains in practice_session_items; migration will abort. Run 1.2-pre-apply-detail.sql.'
    ELSE 'OK — safe to apply 20260816010000'
  END                                           AS verdict
FROM census c;
