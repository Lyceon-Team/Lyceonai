-- ============================================================================
-- SCHEMA PARITY DETAIL — every check, one row each
-- ============================================================================
-- READ-ONLY listing. Companion to migration-schema-parity.sql, which carries the
-- verdict and names only the FIRST deviation. Run this when that file says STOP,
-- to see the whole picture before deciding what to do.
--
-- Failing checks sort first. `ok = false` on a row means prod does not match what
-- that migration's file produces — the object is missing, or present with a
-- different definition, or present without the grant/flag that makes it work.
--
-- The two files share their check list by construction: this is the same VALUES
-- block with a different final SELECT. If you edit one, edit both — and
-- scripts/ci/migration-history-gate.sh case R5 fails if a check exists in one and
-- not the other.
-- ============================================================================

WITH checks(version, object, ok) AS (
  VALUES

  ('20260816000000', 'table public.psi_occurred_at_backfill_log',
    (to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL)),

  ('20260816000000', 'public.psi_occurred_at_backfill_log columns (item_id, occurred_at_applied, applied_at, migration_version)',
    ((SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'psi_occurred_at_backfill_log'
         AND column_name IN ('item_id','occurred_at_applied','applied_at','migration_version')) = 4)),

  ('20260816000000', 'public.psi_occurred_at_backfill_log primary key',
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('public.psi_occurred_at_backfill_log') AND contype = 'p')),

  ('20260816000000', 'public.psi_occurred_at_backfill_log RLS is NOT enabled unless this passes',
    COALESCE((SELECT relrowsecurity FROM pg_class
               WHERE oid = to_regclass('public.psi_occurred_at_backfill_log')), false)),

  ('20260816000000', 'public.psi_occurred_at_backfill_log has NO policy (service-role-only by design)',
    (COALESCE((SELECT count(*) FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'psi_occurred_at_backfill_log'), 0) = 0)),

  ('20260816000000', 'public.psi_occurred_at_backfill_log grants (service_role SELECT+INSERT, PUBLIC none)',
    (CASE WHEN to_regclass('public.psi_occurred_at_backfill_log') IS NULL THEN false ELSE
       has_table_privilege('service_role', 'public.psi_occurred_at_backfill_log', 'SELECT')
       AND has_table_privilege('service_role', 'public.psi_occurred_at_backfill_log', 'INSERT')
       AND NOT has_table_privilege('public', 'public.psi_occurred_at_backfill_log', 'SELECT') END)),

  ('20260816000000', 'CHECK psi_resolved_requires_occurred_at (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK (((status <> ALL (ARRAY[''answered''::text, ''skipped''::text])) OR (occurred_at IS NOT NULL)))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'psi_resolved_requires_occurred_at'), false)),

  ('20260816010000', 'CHECK questions_domain_section_canonical (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK ((((section = ''M''::text) AND (domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((section = ''RW''::text) AND (domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'questions_domain_section_canonical'), false)),

  ('20260816010000', 'CHECK psi_question_domain_section_canonical (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK ((((question_section = ''M''::text) AND (question_domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((question_section = ''RW''::text) AND (question_domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'psi_question_domain_section_canonical'), false)),

  ('20260816020000', 'view public.mastery_derivation_gaps',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gaps')),

  ('20260816020000', 'view public.mastery_derivation_gap_summary',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gap_summary')),

  ('20260816020000', 'table public.mastery_derivation_gap_ledger',
    (to_regclass('public.mastery_derivation_gap_ledger') IS NOT NULL)),

  ('20260816020000', 'public.mastery_derivation_gap_ledger RLS enabled',
    COALESCE((SELECT relrowsecurity FROM pg_class
               WHERE oid = to_regclass('public.mastery_derivation_gap_ledger')), false)),

  ('20260816020000', 'index idx_mastery_gap_ledger_observed_at (exact definition)',
    COALESCE((SELECT indexdef = 'CREATE INDEX idx_mastery_gap_ledger_observed_at ON public.mastery_derivation_gap_ledger USING btree (observed_at DESC)'
                FROM pg_indexes
               WHERE schemaname = 'public' AND indexname = 'idx_mastery_gap_ledger_observed_at'), false)),

  ('20260816020000', 'function record_mastery_derivation_gap() (SECURITY DEFINER)',
    COALESCE((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'record_mastery_derivation_gap'), false)),

  ('20260816020000', 'grants on mastery_derivation_gaps/_summary/_ledger + record_mastery_derivation_gap()',
    (CASE WHEN to_regclass('public.mastery_derivation_gaps') IS NULL
           OR to_regclass('public.mastery_derivation_gap_summary') IS NULL
           OR to_regclass('public.mastery_derivation_gap_ledger') IS NULL
           OR to_regprocedure('public.record_mastery_derivation_gap()') IS NULL THEN false ELSE
       has_table_privilege('service_role', 'public.mastery_derivation_gaps', 'SELECT')
       AND has_table_privilege('service_role', 'public.mastery_derivation_gap_summary', 'SELECT')
       AND has_table_privilege('service_role', 'public.mastery_derivation_gap_ledger', 'SELECT')
       AND has_table_privilege('service_role', 'public.mastery_derivation_gap_ledger', 'INSERT')
       AND has_function_privilege('service_role', 'public.record_mastery_derivation_gap()', 'EXECUTE') END)),

  ('20260817000000', 'unique index practice_sessions_one_completed_diagnostic_uq (exact definition)',
    COALESCE((SELECT indexdef = 'CREATE UNIQUE INDEX practice_sessions_one_completed_diagnostic_uq ON public.practice_sessions USING btree (user_id) WHERE ((mode = ''diagnostic''::text) AND (status = ''completed''::text))'
                FROM pg_indexes
               WHERE schemaname = 'public' AND indexname = 'practice_sessions_one_completed_diagnostic_uq'), false)),

  ('20260817000000', 'index practice_sessions_one_completed_diagnostic_uq is UNIQUE, VALID and READY',
    COALESCE((SELECT i.indisunique AND i.indisvalid AND i.indisready
                FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'practice_sessions_one_completed_diagnostic_uq'), false)),

  ('20260817010000', 'view public.student_diagnostic_states',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'student_diagnostic_states')),

  ('20260817010000', 'function student_diagnostic_state(uuid) (SECURITY DEFINER)',
    COALESCE((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'student_diagnostic_state'
                 AND pg_get_function_identity_arguments(p.oid) = 'p_student_id uuid'), false)),

  ('20260817010000', 'grants on student_diagnostic_states + student_diagnostic_state(uuid)',
    (CASE WHEN to_regclass('public.student_diagnostic_states') IS NULL
           OR to_regprocedure('public.student_diagnostic_state(uuid)') IS NULL THEN false ELSE
       has_table_privilege('service_role', 'public.student_diagnostic_states', 'SELECT')
       AND has_function_privilege('service_role', 'public.student_diagnostic_state(uuid)', 'EXECUTE') END)),

  ('20260817020000', 'column public.practice_sessions.abandoned_at',
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'practice_sessions'
               AND column_name = 'abandoned_at')),

  ('20260817020000', 'CHECK practice_sessions_abandoned_not_completed (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK (((status <> ''abandoned''::text) OR ((completed_at IS NULL) AND (abandoned_at IS NOT NULL))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'practice_sessions_abandoned_not_completed'), false)),

  ('20260817030000', 'view public.student_baseline_pending',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'student_baseline_pending')),

  ('20260817030000', 'grant on student_baseline_pending (service_role SELECT)',
    (CASE WHEN to_regclass('public.student_baseline_pending') IS NULL THEN false ELSE
       has_table_privilege('service_role', 'public.student_baseline_pending', 'SELECT') END)),

  ('20260816000000', 'DATA: no resolved item still has NULL occurred_at',
    ((SELECT count(*) FROM public.practice_session_items
       WHERE status IN ('answered','skipped') AND occurred_at IS NULL) = 0)),

  ('20260816010000', 'DATA: no row violates the canonical section/domain pairing',
    (((SELECT count(*) FROM public.questions q
        WHERE NOT ((q.section = 'M'  AND q.domain IN ('Algebra','Advanced Math',
                                                      'Problem Solving and Data Analysis',
                                                      'Geometry and Trigonometry'))
                OR (q.section = 'RW' AND q.domain IN ('Information and Ideas','Craft and Structure',
                                                      'Expression of Ideas',
                                                      'Standard English Conventions'))))
      +
      (SELECT count(*) FROM public.practice_session_items pi
        WHERE NOT ((pi.question_section = 'M'  AND pi.question_domain IN ('Algebra','Advanced Math',
                                                                         'Problem Solving and Data Analysis',
                                                                         'Geometry and Trigonometry'))
                OR (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas','Craft and Structure',
                                                                          'Expression of Ideas',
                                                                          'Standard English Conventions'))))) = 0)),

  ('20260817020000', 'DATA: no abandoned session carries completed_at, none lacks abandoned_at',
    ((SELECT count(*) FROM public.practice_sessions
       WHERE status = 'abandoned'
         AND (completed_at IS NOT NULL OR abandoned_at IS NULL)) = 0))
)
SELECT
  version,
  CASE WHEN ok THEN 'ok' ELSE 'DEVIATION' END AS result,
  object
FROM checks
ORDER BY ok, version, object;
