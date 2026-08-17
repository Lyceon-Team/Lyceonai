-- ============================================================================
-- MIGRATION HISTORY REPAIR — record two already-applied versions, run nothing
-- ============================================================================
-- WRITES (one or two rows into supabase_migrations.schema_migrations).
-- It executes NO migration SQL and touches NO application table.
--
-- DO NOT RUN THIS UNTIL migration-history-audit.sql REPORTS
--   'REPAIR — objects exist but the version is not recorded'
-- for the versions below, AND migration-schema-parity.sql reports OK.
--
-- ============================================================================
-- PREFER THE MANAGED PATH
-- ============================================================================
--   supabase migration repair --status applied 20260816000000
--   supabase migration repair --status applied 20260816010000
--
-- That is the Supabase CLI's supported mechanism for exactly this situation and
-- it is what should be used if the CLI can reach the project. This file exists
-- because the standing rule is that every statement executed against production
-- must be a committed, reviewable file — so this is both the reviewable record
-- of what the CLI does, and the fallback when the CLI is not an option.
--
-- Whichever path is taken, run it ONCE. Both are idempotent, but the audit file
-- is the check that says so.
--
-- ============================================================================
-- THE SAFETY PROPERTY
-- ============================================================================
-- Marking a version applied is a claim that its objects are already in the
-- database. If that claim is false the migration is silently skipped forever and
-- the schema drifts permanently, which is far worse than the duplicate-apply
-- failure this repairs.
--
-- So this file REFUSES unless it can see the objects itself. It does not trust
-- the operator having run the audit first, and it does not trust this comment.
-- Each version is gated on its own object check, and a missing object aborts the
-- whole block — no partial recording.
--
-- It is also idempotent: a version already recorded is left alone, so re-running
-- is safe and reports 0 inserted.
--
-- ============================================================================
-- WHY THE INSERT IS BUILT DYNAMICALLY
-- ============================================================================
-- supabase_migrations.schema_migrations has changed shape across CLI versions —
-- older projects have only `version`, newer ones add `name` and `statements`.
-- Hardcoding a column list would fail on whichever shape we guessed wrong. The
-- block reads information_schema and inserts only the columns that exist.
-- migration-history-audit.sql prints the actual column list; read it first.
--
-- USAGE: paste into the SQL console. Two statements; the verdict is the last.
-- ============================================================================

DO $repair$
DECLARE
  v_targets  text[][] := ARRAY[
    ARRAY['20260816000000', 'psi_occurred_at_backfill_and_seal'],
    ARRAY['20260816010000', 'canonical_domain_checks']
  ];
  v_version  text;
  v_name     text;
  v_present  boolean;
  v_recorded boolean;
  v_has_name boolean;
  v_has_stmt boolean;
  v_cols     text;
  v_vals     text;
  v_inserted integer := 0;
  i          integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION
      'MIGRATION_REPAIR: supabase_migrations.schema_migrations does not exist — this is not a project managed by the Supabase migration runner';
  END IF;

  SELECT
    bool_or(column_name = 'name'),
    bool_or(column_name = 'statements')
  INTO v_has_name, v_has_stmt
  FROM information_schema.columns
  WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations';

  FOR i IN 1..array_length(v_targets, 1) LOOP
    v_version := v_targets[i][1];
    v_name    := v_targets[i][2];

    -- Object check. This is the safety property — do not weaken it.
    IF v_version = '20260816000000' THEN
      v_present := (
        to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'psi_resolved_requires_occurred_at'
                       AND convalidated)
      );
    ELSIF v_version = '20260816010000' THEN
      v_present := (
        EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'questions_domain_section_canonical' AND convalidated)
        AND EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'psi_question_domain_section_canonical' AND convalidated)
      );
    ELSE
      RAISE EXCEPTION 'MIGRATION_REPAIR: no object check defined for version % — refusing to record it', v_version;
    END IF;

    IF NOT v_present THEN
      RAISE EXCEPTION
        'MIGRATION_REPAIR: refusing to record % as applied — its objects are NOT present (or a constraint is NOT VALID). Recording it would skip the migration permanently. Run migration-schema-parity.sql and investigate.',
        v_version;
    END IF;

    SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_version)
      INTO v_recorded;

    IF v_recorded THEN
      RAISE NOTICE 'MIGRATION_REPAIR: % already recorded, leaving it alone', v_version;
      CONTINUE;
    END IF;

    v_cols := 'version';
    v_vals := quote_literal(v_version);
    IF v_has_name THEN
      v_cols := v_cols || ', name';
      v_vals := v_vals || ', ' || quote_literal(v_name);
    END IF;
    IF v_has_stmt THEN
      -- NULL, not the migration body. The runner uses `statements` for its own
      -- diffing; claiming we executed statements we did not execute here would be
      -- a second, subtler lie on top of the one being repaired.
      v_cols := v_cols || ', statements';
      v_vals := v_vals || ', NULL::text[]';
    END IF;

    EXECUTE format('INSERT INTO supabase_migrations.schema_migrations (%s) VALUES (%s)',
                   v_cols, v_vals);
    v_inserted := v_inserted + 1;
    RAISE NOTICE 'MIGRATION_REPAIR: recorded % as applied (columns: %)', v_version, v_cols;
  END LOOP;

  RAISE NOTICE 'MIGRATION_REPAIR: % version(s) recorded', v_inserted;
END $repair$;

-- Post-state. Both versions must now be recorded AND their objects present.
SELECT
  (SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260816000000','20260816010000'))              AS versions_recorded,
  2                                                                     AS versions_expected,
  (to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL)      AS backfill_log_present,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'psi_resolved_requires_occurred_at')         AS seal_present,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'questions_domain_section_canonical')        AS questions_check_present,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'psi_question_domain_section_canonical')     AS psi_check_present,
  CASE
    WHEN (SELECT count(*) FROM supabase_migrations.schema_migrations
           WHERE version IN ('20260816000000','20260816010000')) <> 2
      THEN 'STOP — one or both versions still unrecorded; the next db push will re-run them'
    WHEN to_regclass('public.psi_occurred_at_backfill_log') IS NULL
      THEN 'STOP — recorded as applied but the backfill log table is missing'
    ELSE 'OK — both versions recorded as applied; nothing was re-executed'
  END                                                                   AS verdict;
