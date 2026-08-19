-- ============================================================================
-- MIGRATION HISTORY AUDIT — what does the migration runner think is applied?
-- ============================================================================
-- READ-ONLY. One statement, one row per migration version. RUN THIS FIRST.
--
-- WHY
--   Two migrations were applied to production by executing their SQL directly
--   rather than through the migration runner. Their objects exist, but
--   supabase_migrations.schema_migrations has no row for either version. The
--   runner therefore still believes they are pending, and the next
--   `supabase db push` will try to re-run them:
--
--     20260816000000  the backfill guard aborts (PSI_BACKFILL_SCOPE_EXPANDED or
--                     PSI_BACKFILL_UNREPAIRABLE), or the seal fails as a
--                     duplicate constraint
--     20260816010000  ADD CONSTRAINT fails, already exists
--
--   This file establishes the facts before anything is changed. It answers three
--   questions per version: is it recorded, do its objects exist, and therefore
--   what is the correct action.
--
-- WHAT IT REPORTS
--   history_table_present   does supabase_migrations.schema_migrations exist at all
--   history_columns         its actual column list — the shape differs across CLI
--                           versions (older: version only; newer: version, name,
--                           statements). migration-history-repair.sql adapts to
--                           whatever this reports, but read it before running that.
--   recorded                is there a row for this version
--   objects_present         do the objects the migration creates actually exist
--   verdict                 what to do about this version
--
-- HOW TO READ `verdict` (one row per version, not one verdict for the file)
--   'consistent — nothing to do'
--        recorded and present, or absent and not present. The runner agrees with
--        reality either way.
--   'REPAIR — objects exist but the version is not recorded'
--        the drift this workstream is about. Record it as applied WITHOUT
--        re-executing. See MIGRATION-HISTORY-RECONCILIATION.md.
--   'INVESTIGATE — recorded as applied but the objects are missing'
--        the dangerous inverse. Something dropped the objects, or the version was
--        recorded against a different database. Do NOT repair; find out first.
--   'PENDING — not applied and not recorded'
--        normal. Apply it through the runner in the usual way.
--
-- USAGE: paste into the SQL console. See README.md for the rules this file follows.
-- ============================================================================

WITH history AS (
  SELECT
    (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) AS history_table_present,
    (SELECT string_agg(c.column_name, ', ' ORDER BY c.ordinal_position)
       FROM information_schema.columns c
      WHERE c.table_schema = 'supabase_migrations'
        AND c.table_name   = 'schema_migrations')                      AS history_columns
),
expected(version, description) AS (
  VALUES
    ('20260816000000', 'psi occurred_at backfill + seal + backfill log'),
    ('20260816010000', 'canonical (section, domain) CHECK constraints'),
    ('20260816020000', 'mastery derivation gap detection')
),
objects AS (
  SELECT
    '20260816000000'::text AS version,
    (
      to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'psi_resolved_requires_occurred_at')
    )                                                                  AS objects_present
  UNION ALL
  SELECT
    '20260816010000',
    (
      EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'questions_domain_section_canonical')
      AND EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'psi_question_domain_section_canonical')
    )
  UNION ALL
  SELECT
    '20260816020000',
    (
      to_regclass('public.mastery_derivation_gaps') IS NOT NULL
      AND to_regclass('public.mastery_derivation_gap_ledger') IS NOT NULL
    )
),
recorded AS (
  -- Reading the history table by name would fail at PARSE time when it does not
  -- exist, so the presence probe above is authoritative and this join is only
  -- meaningful when history_table_present is true. On a Supabase project the
  -- table always exists; this stays safe on a plain Postgres.
  SELECT e.version,
         EXISTS (
           SELECT 1 FROM supabase_migrations.schema_migrations sm
            WHERE sm.version = e.version
         ) AS is_recorded
  FROM expected e
)
SELECT
  e.version,
  e.description,
  h.history_table_present,
  h.history_columns,
  r.is_recorded                                       AS recorded,
  o.objects_present,
  CASE
    WHEN r.is_recorded AND o.objects_present
      THEN 'consistent — nothing to do'
    WHEN NOT r.is_recorded AND o.objects_present
      THEN 'REPAIR — objects exist but the version is not recorded'
    WHEN r.is_recorded AND NOT o.objects_present
      THEN 'INVESTIGATE — recorded as applied but the objects are missing'
    ELSE 'PENDING — not applied and not recorded'
  END                                                 AS verdict
FROM expected e
JOIN objects  o ON o.version = e.version
JOIN recorded r ON r.version = e.version
CROSS JOIN history h
ORDER BY e.version;
