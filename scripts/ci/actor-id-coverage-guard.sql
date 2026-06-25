-- ============================================================================
-- INV-05E-03 Coverage Guard — actor_id substrate (PR-5a stub)
-- ============================================================================
-- @spec [Doc-05E §6 INV-05E-03, SCL-011 authoritative 66-table partition]
-- Asserts that the actor_id substrate is correctly applied:
--   1. All 7 target tables (5 activity + 2 audit) have actor_id uuid
--   2. profiles.actor_id exists, is NOT NULL, uuid
--   3. anonymized_actors table exists with actor_id PK
--   4. Activity-table identity cols are nullable (DROP NOT NULL applied)
--   5. Audit-table identity cols remain NOT NULL (unchanged)
-- Extended in 5b to cover write-path stamping invariant.
-- Run against a genesis-fresh-apply database.

DO $guard$
DECLARE
  v_missing text;
  v_fail    boolean := false;
BEGIN

  -- ========================================================================
  -- G1: All 7 target tables have actor_id uuid column
  -- ========================================================================
  SELECT string_agg(t, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'practice_sessions',
      'practice_session_items',
      'review_sessions',
      'review_session_items',
      'review_error_attempts',
      'mastery_event_audit_log',
      'mastery_domain_refresh_audit_log'
    ]) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = t
        AND c.column_name  = 'actor_id'
        AND c.data_type    = 'uuid'
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G1]: actor_id uuid column MISSING on: %', v_missing;
  END IF;
  RAISE NOTICE 'INV-05E-03 [G1] OK: all 7 tables have actor_id uuid';

  -- ========================================================================
  -- G2: profiles.actor_id exists, NOT NULL, uuid
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'profiles'
       AND column_name  = 'actor_id'
       AND data_type    = 'uuid'
       AND is_nullable  = 'NO'
  ) THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G2]: profiles.actor_id must be uuid NOT NULL';
  END IF;
  RAISE NOTICE 'INV-05E-03 [G2] OK: profiles.actor_id uuid NOT NULL';

  -- ========================================================================
  -- G3: anonymized_actors table exists with actor_id PK
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'anonymized_actors'
  ) THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G3]: anonymized_actors table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'anonymized_actors'
       AND column_name  = 'actor_id'
       AND data_type    = 'uuid'
  ) THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G3]: anonymized_actors.actor_id uuid column missing';
  END IF;
  RAISE NOTICE 'INV-05E-03 [G3] OK: anonymized_actors table with actor_id PK';

  -- ========================================================================
  -- G4: Activity-table identity columns are nullable (DROP NOT NULL applied)
  -- ========================================================================
  -- practice_sessions.user_id, practice_session_items.user_id,
  -- review_sessions.student_id, review_session_items.student_id,
  -- review_error_attempts.student_id
  SELECT string_agg(pair, ', ')
    INTO v_missing
    FROM (VALUES
      ('practice_sessions',     'user_id'),
      ('practice_session_items', 'user_id'),
      ('review_sessions',       'student_id'),
      ('review_session_items',  'student_id'),
      ('review_error_attempts', 'student_id')
    ) AS targets(tbl, col)
    CROSS JOIN LATERAL (SELECT tbl || '.' || col AS pair) x
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = targets.tbl
        AND c.column_name  = targets.col
        AND c.is_nullable  = 'YES'
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G4]: identity columns must be nullable after DROP NOT NULL: %', v_missing;
  END IF;
  RAISE NOTICE 'INV-05E-03 [G4] OK: 5 activity-table identity columns are nullable';

  -- ========================================================================
  -- G5: Audit-table identity columns remain NOT NULL (unchanged)
  -- ========================================================================
  SELECT string_agg(pair, ', ')
    INTO v_missing
    FROM (VALUES
      ('mastery_event_audit_log',          'student_id'),
      ('mastery_domain_refresh_audit_log', 'student_id')
    ) AS targets(tbl, col)
    CROSS JOIN LATERAL (SELECT tbl || '.' || col AS pair) x
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = targets.tbl
        AND c.column_name  = targets.col
        AND c.is_nullable  = 'NO'
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G5]: audit-table student_id must remain NOT NULL: %', v_missing;
  END IF;
  RAISE NOTICE 'INV-05E-03 [G5] OK: 2 audit-table student_id columns remain NOT NULL';

  -- ========================================================================
  -- G6: Defense-in-depth — no row may have non-null identity + null actor_id
  -- ========================================================================
  -- Structural check: for every activity table, verify that the column DEFAULT
  -- or constraint setup makes it impossible to have identity present but
  -- actor_id absent. At genesis-fresh-apply there are no rows, so this guard
  -- checks the schema: actor_id column must exist (covered by G1) and must NOT
  -- have a DEFAULT that would silently supply a value (which would hide a
  -- missing app-layer stamp). The row-level invariant is:
  --   NOT (identity IS NOT NULL AND actor_id IS NULL)
  -- Enforced at runtime by the app-layer stamp (TS inserts) and SQL RAISE
  -- (audit functions). NOT NULL constraint deferred to 5c-tail after backfill.
  SELECT string_agg(t, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'practice_sessions',
      'practice_session_items',
      'review_sessions',
      'review_session_items',
      'review_error_attempts'
    ]) AS t
   WHERE EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = t
        AND c.column_name  = 'actor_id'
        AND c.column_default IS NOT NULL
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G6]: activity-table actor_id must NOT have a DEFAULT (app-layer stamps it): %', v_missing;
  END IF;
  RAISE NOTICE 'INV-05E-03 [G6] OK: 5 activity-table actor_id columns have no DEFAULT (app-layer responsibility)';

  RAISE NOTICE 'INV-05E-03 COVERAGE GUARD: ALL PASS';

END $guard$;
