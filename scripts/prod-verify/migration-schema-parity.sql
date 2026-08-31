-- ============================================================================
-- SCHEMA PARITY — does prod match what all SEVEN unrecorded migrations produce?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- WHY THIS EXISTS
--   Seven migrations were applied by executing their SQL directly rather than
--   through the migration runner, so supabase_migrations.schema_migrations
--   records none of them. Recording them as applied makes the runner skip them
--   FOREVER. That is only safe if the schema really does match what they produce,
--   and "the constraint is there" is not that claim: a hand-run apply can drop a
--   statement silently, and the statements most likely to be dropped are the ones
--   that are easy to skip and invisible afterwards — RLS, REVOKE/GRANT, an index,
--   a primary key.
--
--   This file is the evidence. It runs FIRST. If it says STOP, nothing is
--   recorded — see MIGRATION-HISTORY-REPAIR.md.
--
-- THE SEVEN
--   20260816000000  psi occurred_at backfill + seal
--   20260816010000  canonical domain CHECKs
--   20260816020000  mastery derivation gap detection
--   20260817000000  one completed diagnostic per student (partial unique index)
--   20260817010000  student_diagnostic_state
--   20260817020000  practice_sessions.abandoned_at + seal
--   20260817030000  student_baseline_pending
--
-- HOW IT IS STRUCTURED — AND WHY IT CHANGED SHAPE
--   The two-migration version of this file returned one column per check. That
--   does not scale to seven, and worse, a wide row makes the reader hunt for the
--   false. Every check is now a ROW in one VALUES list: (version, object, ok).
--   The verdict names the FIRST failing object, so a deviation reads as
--   "STOP — 20260816020000: index idx_mastery_gap_ledger_observed_at is missing"
--   rather than as a false in the fourteenth column.
--
--   Adding a migration to this file means adding rows, not columns. That is the
--   property that keeps it honest as the set grows.
--
-- WHAT COUNTS AS A CHECK
--   Presence is the weakest possible assertion and is never used alone where a
--   stronger one exists:
--     constraints  compared by pg_get_constraintdef TEXT, and convalidated
--     indexes      compared by indexdef TEXT, and indisunique, and indisvalid
--     functions    presence AND prosecdef (a SECURITY DEFINER that came back as
--                  INVOKER runs with the caller's rights — same name, different
--                  security posture)
--     tables       columns, primary key, RLS enabled, policy count, grants
--     views        presence AND service_role can actually SELECT (a view that
--                  exists but lost its grant fails at runtime, not here)
--
-- USAGE: paste into the SQL console. Run BEFORE any migration repair.
-- ============================================================================

WITH checks(version, object, ok) AS (
  VALUES

  -- ── 20260816000000 — psi occurred_at backfill + seal ──────────────────────
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

  -- ── 20260816010000 — canonical domain CHECKs ──────────────────────────────
  ('20260816010000', 'CHECK questions_domain_section_canonical (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK ((((section = ''M''::text) AND (domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((section = ''RW''::text) AND (domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'questions_domain_section_canonical'), false)),

  ('20260816010000', 'CHECK psi_question_domain_section_canonical (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK ((((question_section = ''M''::text) AND (question_domain = ANY (ARRAY[''Algebra''::text, ''Advanced Math''::text, ''Problem Solving and Data Analysis''::text, ''Geometry and Trigonometry''::text]))) OR ((question_section = ''RW''::text) AND (question_domain = ANY (ARRAY[''Information and Ideas''::text, ''Craft and Structure''::text, ''Expression of Ideas''::text, ''Standard English Conventions''::text])))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'psi_question_domain_section_canonical'), false)),

  -- ── 20260816020000 — mastery derivation gap detection ─────────────────────
  ('20260816020000', 'view public.mastery_derivation_gaps',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gaps')),

  ('20260816020000', 'view public.mastery_derivation_gap_summary',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gap_summary')),

  ('20260816020000', 'table public.mastery_derivation_gap_ledger',
    (to_regclass('public.mastery_derivation_gap_ledger') IS NOT NULL)),

  ('20260816020000', 'public.mastery_derivation_gap_ledger RLS enabled',
    COALESCE((SELECT relrowsecurity FROM pg_class
               WHERE oid = to_regclass('public.mastery_derivation_gap_ledger')), false)),

  -- Present in the migration, ABSENT from the 2026-08-17 advisor inventory. If
  -- this row is false, 20260816020000 did not fully apply and must not be
  -- recorded — the alert would read one small table that is never indexed and,
  -- worse, the recorder that writes it would not exist at all.
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

  -- ── 20260817000000 — one completed diagnostic per student ─────────────────
  -- indisunique AND indisvalid are separate from the definition on purpose: an
  -- index left INVALID by a failed concurrent build still appears in pg_indexes
  -- with the right definition and enforces nothing.
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

  -- ── 20260817010000 — student_diagnostic_state ─────────────────────────────
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

  -- ── 20260817020000 — abandoned_at + seal ──────────────────────────────────
  ('20260817020000', 'column public.practice_sessions.abandoned_at',
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'practice_sessions'
               AND column_name = 'abandoned_at')),

  ('20260817020000', 'CHECK practice_sessions_abandoned_not_completed (exact definition, validated)',
    COALESCE((SELECT pg_get_constraintdef(oid) = 'CHECK (((status <> ''abandoned''::text) OR ((completed_at IS NULL) AND (abandoned_at IS NOT NULL))))'
                     AND convalidated
                FROM pg_constraint WHERE conname = 'practice_sessions_abandoned_not_completed'), false)),

  -- ── 20260817030000 — student_baseline_pending ─────────────────────────────
  ('20260817030000', 'view public.student_baseline_pending',
    EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'student_baseline_pending')),

  ('20260817030000', 'grant on student_baseline_pending (service_role SELECT)',
    (CASE WHEN to_regclass('public.student_baseline_pending') IS NULL THEN false ELSE
       has_table_privilege('service_role', 'public.student_baseline_pending', 'SELECT') END)),

  -- ── Data-level corroboration, independent of the catalog ──────────────────
  -- A constraint can be present and validated while the data it describes was
  -- repaired by something other than the migration. These say the repair
  -- happened, not merely that the seal exists.
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
  count(*)                                                        AS checks_run,
  count(*) FILTER (WHERE ok)                                      AS checks_passed,
  count(*) FILTER (WHERE NOT ok)                                  AS checks_failed,
  count(DISTINCT version) FILTER (WHERE NOT ok)                   AS versions_with_deviations,
  COALESCE((SELECT string_agg(DISTINCT c2.version, ', ' ORDER BY c2.version)
              FROM checks c2 WHERE NOT c2.ok), '(none)')          AS deviating_versions,
  CASE
    WHEN count(*) FILTER (WHERE NOT ok) = 0
      THEN 'OK — prod schema matches all seven migrations; safe to record them as applied'
    ELSE 'STOP — ' ||
         (SELECT c3.version || ': ' || c3.object || ' does not match'
            FROM checks c3 WHERE NOT c3.ok ORDER BY c3.version, c3.object LIMIT 1) ||
         ' (' || count(*) FILTER (WHERE NOT ok)::text ||
         ' failing check(s); run migration-schema-parity-detail.sql for the full list). Record NOTHING until this is resolved.'
  END                                                             AS verdict
FROM checks;
