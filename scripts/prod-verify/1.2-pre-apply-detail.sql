-- ============================================================================
-- PRE-APPLY DETAIL — every observed (section, domain) pair, canonical or not
-- ============================================================================
-- READ-ONLY. One statement. Run alongside 1.2-pre-apply.sql.
--
-- One row per distinct (source, section, domain) combination actually present in
-- the data, with is_canonical flagging whether the pair survives the constraint
-- the migration is about to add.
--
-- EXPECT: is_canonical = true on EVERY row. Non-canonical pairs sort to the top.
--
-- This supersedes the separate "offending rows" listing an earlier revision
-- carried: a pair that appears here with is_canonical = false IS the violation,
-- and n tells you how many rows carry it. To pull the individual row ids for a
-- flagged pair, filter the underlying table on that exact (section, domain).
--
-- Watch for near-misses rather than absent domains — the failure mode this
-- guards is a hyphenated 'Problem-Solving and Data Analysis' or a valid RW
-- domain filed under section M, not a domain nobody has ever written.
-- ============================================================================

SELECT
  t.source,
  t.section,
  t.domain,
  t.n,
  t.is_canonical
FROM (
  SELECT
    'questions'                   AS source,
    q.section                     AS section,
    q.domain                      AS domain,
    count(*)                      AS n,
    (
      (q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                         'Problem Solving and Data Analysis',
                                         'Geometry and Trigonometry'))
      OR
      (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                         'Expression of Ideas',
                                         'Standard English Conventions'))
    )                             AS is_canonical
  FROM public.questions q
  GROUP BY q.section, q.domain

  UNION ALL

  SELECT
    'practice_session_items',
    pi.question_section,
    pi.question_domain,
    count(*),
    (
      (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                             'Problem Solving and Data Analysis',
                                                             'Geometry and Trigonometry'))
      OR
      (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                             'Expression of Ideas',
                                                             'Standard English Conventions'))
    )
  FROM public.practice_session_items pi
  GROUP BY pi.question_section, pi.question_domain
) t
ORDER BY t.is_canonical, t.source, t.section, t.domain;
