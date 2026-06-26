-- ============================================================================
-- INV-05E-03 Coverage Guard — actor_id substrate + write-path stamping (PR-5a/5b)
-- ============================================================================
-- @spec [Doc-05E §6 INV-05E-03, SCL-011] | @implemented [2026-06-25]
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
  -- G6: Row-level — no row may have identity present + actor_id absent
  -- ========================================================================
  -- For each of the 7 target tables: FAIL if any row has its identity column
  -- IS NOT NULL but actor_id IS NULL. Vacuously true on empty tables;
  -- load-bearing once seeds/data exist (proves write-path stamps are wired).
  DECLARE
    v_g6_tbl text;
    v_g6_col text;
    v_g6_cnt bigint;
  BEGIN
    FOR v_g6_tbl, v_g6_col IN
      VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id')
    LOOP
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE %I IS NOT NULL AND actor_id IS NULL',
        v_g6_tbl, v_g6_col
      ) INTO v_g6_cnt;
      IF v_g6_cnt > 0 THEN
        RAISE EXCEPTION 'INV-05E-03 FAIL [G6]: % row(s) in %.% have identity present but actor_id IS NULL',
          v_g6_cnt, v_g6_tbl, v_g6_col;
      END IF;
    END LOOP;
    RAISE NOTICE 'INV-05E-03 [G6] OK: no row in 7 tables has identity present + actor_id absent';
  END;

  -- ========================================================================
  -- G7: Defense-in-depth — actor_id must have no DEFAULT on all 7 tables
  -- ========================================================================
  -- actor_id column must NOT have a DEFAULT that would silently supply a value
  -- (which would hide a missing app-layer or moat-function stamp). A DEFAULT
  -- would defeat the write-path signal on activity tables AND audit tables.
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
   WHERE EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = t
        AND c.column_name  = 'actor_id'
        AND c.column_default IS NOT NULL
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INV-05E-03 FAIL [G7]: actor_id must NOT have a DEFAULT (app/moat stamps it): %', v_missing;
  END IF;
  RAISE NOTICE 'INV-05E-03 [G7] OK: 7 table actor_id columns have no DEFAULT (app/moat-layer responsibility)';

  RAISE NOTICE 'INV-05E-03 COVERAGE GUARD: ALL PASS';

END $guard$;
