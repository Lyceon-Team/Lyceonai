-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816010000_canonical_domain_checks
-- ============================================================================
-- READ-ONLY. No writes of any kind. Run after applying the migration.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console. ONE statement, ONE row. The last
--   column is the verdict. See README.md for the rules every file here follows.
--
-- WHY THIS FILE DOES NOT ATTEMPT SPOT INSERTS
--   An earlier revision opened a transaction and issued three INSERTs against
--   public.questions — two expected to fail, one expected to succeed — before
--   ROLLBACK. That is not read-only in any sense that matters on production:
--   rollback does not undo trigger side effects that reach outside the
--   transaction, the attempts still consume sequence values and take locks, and
--   an operator whose session dies mid-file leaves an open transaction on prod.
--
--   It was also unnecessary. Proving that PostgreSQL enforces a CHECK constraint
--   is CI's job against an ephemeral database, and it is already done there:
--   scripts/ci/mastery-unblock-gates.sh case (F) rejects the hyphenated form and
--   the cross-section pair, and accepts the canonical form. Prod does not need to
--   re-prove the database engine.
--
-- WHAT REPLACES IT — AND WHY IT IS STRONGER
--   Exact comparison of pg_get_constraintdef() against the expected definition
--   text. A rejection test only proves the constraint refuses ONE probe value; a
--   constraint could reject 'Problem-Solving and Data Analysis' while being
--   subtly wrong elsewhere in the pairing — a missing RW domain, a swapped
--   section, a stray extra literal — and still pass every probe an operator would
--   think to type. Comparing the full normalized definition catches all of that
--   at once, with no write.
--
--   Definition equality is not sufficient on its own either. A constraint added
--   NOT VALID enforces future writes while silently tolerating the pre-existing
--   violations this migration exists to rule out, so convalidated participates in
--   the verdict rather than merely appearing in the output.
--
-- EXPECTED VALUES
--   questions_constraint_ok = true    (exact definition AND validated)
--   psi_constraint_ok       = true    (exact definition AND validated)
--   constraints_found       = 2
--   bad_questions           = 0       corroboration: no row violates the pairing
--   bad_items               = 0
--   verdict                 = 'OK — 1.2 applied, both constraints exact AND validated'
--
-- HOW TO READ A DEVIATION
--   present but not matching  the constraint exists with a DIFFERENT definition
--     than this migration authored. Compare the *_definition columns against the
--     expected literals below. Do not assume it is equivalent.
--   exact but NOT VALID       the constraint guards future writes only. Existing
--     rows were never checked, so a pre-existing non-canonical domain can survive
--     and keep breaking refresh_domain_mastery. Investigate how it was created.
--   absent                    the migration did not apply.
--
-- Note the M list is 'Problem Solving and Data Analysis' WITHOUT a hyphen.
-- ============================================================================

WITH expected(conname, definition) AS (
  VALUES
    (
      'questions_domain_section_canonical',
      'CHECK ((((section = ''M''::text) AND (domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((section = ''RW''::text) AND (domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
    ),
    (
      'psi_question_domain_section_canonical',
      'CHECK ((((question_section = ''M''::text) AND (question_domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((question_section = ''RW''::text) AND (question_domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
    )
),
found AS (
  SELECT
    e.conname,
    e.definition                                        AS expected_definition,
    pg_get_constraintdef(c.oid)                         AS actual_definition,
    c.convalidated,
    (c.oid IS NOT NULL)                                 AS present,
    (pg_get_constraintdef(c.oid) = e.definition
       AND c.convalidated)                              AS ok
  FROM expected e
  LEFT JOIN pg_constraint c ON c.conname = e.conname
),
corroboration AS (
  -- A NOT VALID constraint would let pre-existing violations survive, so count
  -- them independently of what the catalog says about the constraint.
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
      ))                                                AS bad_questions,
    (SELECT count(*) FROM public.practice_session_items pi
      WHERE NOT (
        (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                               'Problem Solving and Data Analysis',
                                                               'Geometry and Trigonometry'))
        OR
        (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                               'Expression of Ideas',
                                                               'Standard English Conventions'))
      ))                                                AS bad_items
)
SELECT
  bool_or(f.conname = 'questions_domain_section_canonical'    AND f.ok)  AS questions_constraint_ok,
  bool_or(f.conname = 'psi_question_domain_section_canonical' AND f.ok)  AS psi_constraint_ok,
  count(*) FILTER (WHERE f.present)                                      AS constraints_found,
  2                                                                      AS constraints_expected,
  bool_and(COALESCE(f.convalidated, false))                              AS all_validated,
  min(co.bad_questions)                                                  AS bad_questions,
  min(co.bad_items)                                                      AS bad_items,
  max(f.actual_definition) FILTER (
    WHERE f.conname = 'questions_domain_section_canonical')               AS questions_definition,
  max(f.actual_definition) FILTER (
    WHERE f.conname = 'psi_question_domain_section_canonical')            AS psi_definition,

  -- convalidated is tested BEFORE definition equality so the NOT VALID case
  -- reports the accurate diagnosis. pg_get_constraintdef() appends ' NOT VALID',
  -- so such a constraint also fails the text comparison — but "definition does
  -- NOT match" would send the operator hunting for a difference in the domain
  -- lists that isn't there.
  CASE
    WHEN count(*) FILTER (WHERE f.present) <> 2
      THEN 'STOP — one or both canonical-domain constraints are missing'
    WHEN NOT bool_and(COALESCE(f.convalidated, false))
      THEN 'STOP — constraint is NOT VALID: existing rows were never checked, so a pre-existing non-canonical domain can survive'
    WHEN NOT bool_and(f.actual_definition = f.expected_definition)
      THEN 'STOP — a constraint exists but its definition does NOT match the migration'
    WHEN min(co.bad_questions) > 0 OR min(co.bad_items) > 0
      THEN 'STOP — constraints report valid but violating rows are present; the catalog and the data disagree'
    ELSE 'OK — 1.2 applied, both constraints exact AND validated'
  END                                                                    AS verdict
FROM found f CROSS JOIN corroboration co;
