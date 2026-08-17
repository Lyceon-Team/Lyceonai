-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816010000_canonical_domain_checks
-- ============================================================================
-- READ-ONLY. No transaction, no INSERT, no ROLLBACK. Run after Karl applies the
-- migration.
--
-- WHY THIS FILE NO LONGER ATTEMPTS SPOT INSERTS
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
--   Definition equality is also not sufficient on its own. pg_get_constraintdef()
--   does not render NOT VALID, so a constraint that was never checked against
--   existing rows produces byte-identical text to one that was. convalidated
--   therefore participates in the verdict below, not merely in the diagnostic
--   listing — a NOT VALID constraint enforces future writes while silently
--   tolerating the pre-existing violations this migration exists to rule out.
--
-- EXPECTED
--   questions_constraint_ok            = t   (exact definition AND validated)
--   psi_constraint_ok                  = t   (exact definition AND validated)
--   constraints_found                  = 2
--   all_validated                      = t
--   verdict  = 'OK — 1.2 applied, both constraints exact AND validated'
--
-- HOW TO READ A DEVIATION
--   present but not matching → the constraint exists with a DIFFERENT definition
--     than this migration authored. Print the actual text (second query below)
--     and compare against the expected literal. Do not assume it is equivalent.
--   exact but NOT VALID      → the constraint guards future writes only. Existing
--     rows were never checked, so a pre-existing non-canonical domain can survive
--     and keep breaking refresh_domain_mastery. Investigate how it was created.
--   absent                   → the migration did not apply.
--
-- Note the M list is 'Problem Solving and Data Analysis' WITHOUT a hyphen, which
-- is what refresh_domain_mastery's canonical list uses and what the data uses.
--
-- USAGE: psql -f scripts/prod-verify/1.2-post-apply.sql
-- ============================================================================

\pset footer off
\echo '=== 1.2 POST-APPLY — canonical domain constraints present and EXACT ==='

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
)
-- convalidated participates in the VERDICT, not just the diagnostic listing below.
-- pg_get_constraintdef() does NOT render the NOT VALID qualifier, so two constraints
-- with byte-identical definitions can differ in whether they were ever checked against
-- existing rows. A NOT VALID constraint enforces future writes but silently tolerates
-- pre-existing violations — exactly the state this migration exists to make
-- impossible. Definition equality alone would report OK for it.
SELECT
  bool_or(e.conname = 'questions_domain_section_canonical'
          AND pg_get_constraintdef(c.oid) = e.definition
          AND c.convalidated)                                  AS questions_constraint_ok,
  bool_or(e.conname = 'psi_question_domain_section_canonical'
          AND pg_get_constraintdef(c.oid) = e.definition
          AND c.convalidated)                                  AS psi_constraint_ok,
  count(c.oid)                                                 AS constraints_found,
  2                                                            AS constraints_expected,
  bool_and(COALESCE(c.convalidated, false))                    AS all_validated,
  -- convalidated is tested BEFORE definition equality so the NOT VALID case reports
  -- the accurate diagnosis. pg_get_constraintdef() appends ' NOT VALID', so such a
  -- constraint also fails the text comparison — but "definition does NOT match" would
  -- send the operator hunting for a difference in the domain lists that isn't there.
  CASE
    WHEN count(c.oid) <> 2
      THEN 'STOP — one or both canonical-domain constraints are missing'
    WHEN NOT bool_and(COALESCE(c.convalidated, false))
      THEN 'STOP — constraint is NOT VALID: existing rows were never checked, so a pre-existing non-canonical domain can survive'
    WHEN NOT bool_and(pg_get_constraintdef(c.oid) = e.definition)
      THEN 'STOP — a constraint exists but its definition does NOT match the migration'
    ELSE 'OK — 1.2 applied, both constraints exact AND validated'
  END                                                          AS verdict
FROM expected e
LEFT JOIN pg_constraint c ON c.conname = e.conname;

\echo ''
\echo '--- actual definitions (compare by eye against the literals above on any deviation) ---'

SELECT
  conname,
  conrelid::regclass AS on_table,
  convalidated       AS is_validated,
  pg_get_constraintdef(oid) AS actual_definition
FROM pg_constraint
WHERE conname IN ('questions_domain_section_canonical',
                  'psi_question_domain_section_canonical')
ORDER BY conname;

\echo ''
\echo '--- corroboration: no row in either table violates the pairing (0/0 expected) ---'
\echo '--- a NOT VALID constraint would let pre-existing violations survive ---'

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
    ))                                                          AS bad_questions,
  (SELECT count(*) FROM public.practice_session_items pi
    WHERE NOT (
      (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                             'Problem Solving and Data Analysis',
                                                             'Geometry and Trigonometry'))
      OR
      (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                             'Expression of Ideas',
                                                             'Standard English Conventions'))
    ))                                                          AS bad_items;
