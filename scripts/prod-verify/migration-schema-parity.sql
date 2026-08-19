-- ============================================================================
-- SCHEMA PARITY — does prod match what 20260816000000 + 20260816010000 produce?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- WHY THIS EXISTS
--   Those two migrations were applied by executing their SQL directly rather than
--   through the migration runner. "The constraints are there" is not the same
--   claim as "the database is in the state the migration file produces" — a
--   hand-run apply can miss a statement silently, and the most likely things to
--   miss are the ones that are easy to skip and invisible afterwards: RLS,
--   REVOKE/GRANT, a COMMENT, a primary key.
--
--   migration-history-repair.sql will record these versions as applied, which
--   means the runner will never look at them again. That is only safe if the
--   schema really does match. This file is the evidence for that, and it checks
--   the boring statements precisely because those are the ones a manual apply
--   drops.
--
-- WHAT IT CHECKS — every object those two migrations create
--
--   20260816000000
--     log_table_present        public.psi_occurred_at_backfill_log exists
--     log_columns_ok           item_id / occurred_at_applied / applied_at /
--                              migration_version all present
--     log_pk_ok                primary key on item_id
--     log_rls_enabled          RLS ON  (genesis gate A.4 requires it on every
--                              public table; a manual apply that skipped
--                              ENABLE ROW LEVEL SECURITY leaves the table
--                              readable by any role holding table privileges)
--     log_no_policies          RLS on with NO policy = service-role-only by
--                              design; a policy here would widen access
--     log_grants_ok            service_role has SELECT+INSERT, PUBLIC has none
--     seal_present/validated   psi_resolved_requires_occurred_at, VALID
--
--   20260816010000
--     questions_check_ok       exact definition AND validated
--     psi_check_ok             exact definition AND validated
--
--   Data-level corroboration, independent of the catalog:
--     unrepaired_rows = 0      no resolved row still has NULL occurred_at
--     bad_domain_rows = 0      no row violates the canonical pairing
--
-- HOW TO READ A DEVIATION
--   Any false/non-zero means the hand-run apply did NOT reproduce the migration.
--   Do NOT record the version as applied — fix the gap first, otherwise the
--   runner will skip the migration forever and the drift becomes permanent.
--
-- USAGE: paste into the SQL console. Run BEFORE migration-history-repair.sql.
-- ============================================================================

WITH expected_defs(conname, definition) AS (
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
facts AS (
  SELECT
    (to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL)      AS log_table_present,

    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'psi_occurred_at_backfill_log'
        AND column_name IN ('item_id','occurred_at_applied','applied_at','migration_version')
    ) = 4                                                                 AS log_columns_ok,

    EXISTS (SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = to_regclass('public.psi_occurred_at_backfill_log')
               AND c.contype = 'p')                                       AS log_pk_ok,

    COALESCE((SELECT c.relrowsecurity FROM pg_class c
               WHERE c.oid = to_regclass('public.psi_occurred_at_backfill_log')), false)
                                                                          AS log_rls_enabled,

    COALESCE((SELECT count(*) FROM pg_policies
               WHERE schemaname = 'public'
                 AND tablename = 'psi_occurred_at_backfill_log'), 0) = 0   AS log_no_policies,

    (
      has_table_privilege('service_role', 'public.psi_occurred_at_backfill_log', 'SELECT')
      AND has_table_privilege('service_role', 'public.psi_occurred_at_backfill_log', 'INSERT')
      AND NOT has_table_privilege('public', 'public.psi_occurred_at_backfill_log', 'SELECT')
    )                                                                     AS log_grants_ok,

    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'psi_resolved_requires_occurred_at')          AS seal_present,
    COALESCE((SELECT bool_and(convalidated) FROM pg_constraint
               WHERE conname = 'psi_resolved_requires_occurred_at'), false) AS seal_validated,

    (SELECT count(*) FROM public.practice_session_items
      WHERE status IN ('answered','skipped') AND occurred_at IS NULL)      AS unrepaired_rows,

    (
      (SELECT count(*) FROM public.questions q
        WHERE NOT (
          (q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                             'Problem Solving and Data Analysis',
                                             'Geometry and Trigonometry'))
          OR
          (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                             'Expression of Ideas',
                                             'Standard English Conventions'))))
      +
      (SELECT count(*) FROM public.practice_session_items pi
        WHERE NOT (
          (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                                 'Problem Solving and Data Analysis',
                                                                 'Geometry and Trigonometry'))
          OR
          (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                                 'Expression of Ideas',
                                                                 'Standard English Conventions'))))
    )                                                                     AS bad_domain_rows
),
checks AS (
  SELECT
    bool_and(pg_get_constraintdef(c.oid) = e.definition AND c.convalidated)
      FILTER (WHERE e.conname = 'questions_domain_section_canonical')      AS questions_check_ok,
    bool_and(pg_get_constraintdef(c.oid) = e.definition AND c.convalidated)
      FILTER (WHERE e.conname = 'psi_question_domain_section_canonical')   AS psi_check_ok
  FROM expected_defs e
  LEFT JOIN pg_constraint c ON c.conname = e.conname
)
SELECT
  f.log_table_present,
  f.log_columns_ok,
  f.log_pk_ok,
  f.log_rls_enabled,
  f.log_no_policies,
  f.log_grants_ok,
  f.seal_present,
  f.seal_validated,
  COALESCE(k.questions_check_ok, false)  AS questions_check_ok,
  COALESCE(k.psi_check_ok, false)        AS psi_check_ok,
  f.unrepaired_rows,
  f.bad_domain_rows,
  CASE
    WHEN NOT f.log_table_present
      THEN 'STOP — psi_occurred_at_backfill_log is missing; 20260816000000 did not fully apply'
    WHEN NOT f.log_columns_ok
      THEN 'STOP — backfill log exists but its columns do not match the migration'
    WHEN NOT f.log_pk_ok
      THEN 'STOP — backfill log has no primary key; the manual apply dropped it'
    WHEN NOT f.log_rls_enabled
      THEN 'STOP — RLS is NOT enabled on psi_occurred_at_backfill_log; the manual apply skipped ENABLE ROW LEVEL SECURITY'
    WHEN NOT f.log_no_policies
      THEN 'STOP — a policy exists on the backfill log; it is meant to be service-role-only with no policy'
    WHEN NOT f.log_grants_ok
      THEN 'STOP — grants on the backfill log do not match (service_role needs SELECT+INSERT, PUBLIC none)'
    WHEN NOT f.seal_present
      THEN 'STOP — psi_resolved_requires_occurred_at is missing'
    WHEN NOT f.seal_validated
      THEN 'STOP — psi_resolved_requires_occurred_at is NOT VALID; existing rows were never checked'
    WHEN NOT COALESCE(k.questions_check_ok, false)
      THEN 'STOP — questions_domain_section_canonical is missing, not exact, or NOT VALID'
    WHEN NOT COALESCE(k.psi_check_ok, false)
      THEN 'STOP — psi_question_domain_section_canonical is missing, not exact, or NOT VALID'
    WHEN f.unrepaired_rows > 0
      THEN 'STOP — ' || f.unrepaired_rows::text || ' resolved row(s) still have NULL occurred_at'
    WHEN f.bad_domain_rows > 0
      THEN 'STOP — ' || f.bad_domain_rows::text || ' row(s) violate the canonical pairing'
    ELSE 'OK — prod schema matches both migrations; safe to record them as applied'
  END                                    AS verdict
FROM facts f CROSS JOIN checks k;
