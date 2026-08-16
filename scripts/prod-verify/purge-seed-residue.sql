-- ============================================================================
-- PURGE — June 2026 seed/QA residue in the mastery tables
-- ============================================================================
-- DESTRUCTIVE. This is the only file under scripts/prod-verify/ that deletes.
--
-- WHAT IT REMOVES
--   * 6 rows in mastery_event_audit_log with constants_snapshot_hash = 'seedhash'
--   * 1 row in student_skill_mastery for 30d5d035-ab51-4b2f-9882-4ce87219a054
--     (event_count_total = 0, same 'seedhash')
--
-- WHY THE PREDICATE IS EXACT-TARGET BY CONSTRUCTION
--   'seedhash' is a literal the real function CANNOT emit. apply_mastery_event
--   computes constants_snapshot_hash as
--     encode(extensions.digest(canonicalize_mastery_constants_serialized(), 'sha256'), 'hex')
--   — a 64-character lowercase hex string. No genuine row can carry an 8-character
--   word. The predicate therefore cannot reach a real mastery row even in
--   principle, which is a stronger guarantee than an id list (an id list can be
--   stale; this cannot be wrong).
--
-- WHY THEY MUST GO
--   1. They are unattributable rows sitting in an audit table whose entire
--      purpose is attribution: constants_snapshot_hash the function cannot emit,
--      actor_ids matching no profile, event_ids matching no practice_session_item.
--   2. The seeded student_skill_mastery row makes a student with zero events look
--      "incomplete-derived" to backfill_recompute_student's selection driver,
--      which Doc 05D scopes to never-computed students. Left in place it would
--      distort Step 8.
--
-- ORIGIN (audit finding G, unresolved): the literal 'seedhash' appears in NO file
-- on ANY branch and in NO commit in this repository — verified by git grep across
-- every remote ref and by pickaxe across all history. The closest analogue is
-- scripts/ci/deletion-cascade-rehearsal.sql, which writes rows of exactly this
-- shape using 'testhash'; its commit history clusters 2026-06-25..28, bracketing
-- the 06-26/27 residue timestamps. Most probable origin is an ad-hoc SQL session
-- derived from that script. Step 1.3 of this workstream adds a host guard to the
-- shared rehearsal lib so the same path cannot reach a hosted database again.
--
-- SEQUENCING: after Step 3.1 has captured these rows as evidence, before Step 8.
--
-- USAGE: psql -f scripts/prod-verify/purge-seed-residue.sql
--   Runs inside a transaction with a built-in negative control. If the control
--   trips, the whole thing rolls back and nothing is deleted.
-- ============================================================================

\set ON_ERROR_STOP on
\pset footer off

\echo '=== PURGE seed residue — pre-state ==='

SELECT
  (SELECT count(*) FROM public.mastery_event_audit_log
    WHERE constants_snapshot_hash = 'seedhash')                     AS seedhash_audit_rows,
  6                                                                 AS seedhash_audit_expected,
  (SELECT count(*) FROM public.student_skill_mastery
    WHERE constants_snapshot_hash = 'seedhash')                     AS seedhash_mastery_rows,
  1                                                                 AS seedhash_mastery_expected,
  (SELECT count(*) FROM public.mastery_event_audit_log
    WHERE constants_snapshot_hash <> 'seedhash')                    AS real_audit_rows_before,
  (SELECT count(*) FROM public.student_skill_mastery
    WHERE constants_snapshot_hash <> 'seedhash')                    AS real_mastery_rows_before;

\echo ''
\echo '--- the exact rows to be deleted ---'
SELECT 'mastery_event_audit_log' AS tbl, audit_row_id::text AS row_id,
       student_id::text, event_source_kind, event_id::text, applied_at
FROM public.mastery_event_audit_log
WHERE constants_snapshot_hash = 'seedhash'
ORDER BY applied_at;

SELECT 'student_skill_mastery' AS tbl, student_id::text AS row_id,
       section, domain, skill, event_count_total, computed_at
FROM public.student_skill_mastery
WHERE constants_snapshot_hash = 'seedhash'
ORDER BY student_id;

\echo ''
\echo '=== PURGE — executing with negative control ==='

BEGIN;

DO $purge$
DECLARE
  v_real_audit_before   integer;
  v_real_mastery_before integer;
  v_real_audit_after    integer;
  v_real_mastery_after  integer;
  v_deleted_audit       integer;
  v_deleted_mastery     integer;
BEGIN
  -- Baseline of everything that is NOT residue. This is the negative control.
  SELECT count(*) INTO v_real_audit_before
    FROM public.mastery_event_audit_log WHERE constants_snapshot_hash <> 'seedhash';
  SELECT count(*) INTO v_real_mastery_before
    FROM public.student_skill_mastery WHERE constants_snapshot_hash <> 'seedhash';

  DELETE FROM public.mastery_event_audit_log
   WHERE constants_snapshot_hash = 'seedhash';
  GET DIAGNOSTICS v_deleted_audit = ROW_COUNT;

  DELETE FROM public.student_skill_mastery
   WHERE constants_snapshot_hash = 'seedhash'
     AND student_id = '30d5d035-ab51-4b2f-9882-4ce87219a054'::uuid;
  GET DIAGNOSTICS v_deleted_mastery = ROW_COUNT;

  -- NEGATIVE CONTROL: nothing outside the residue predicate may have moved.
  SELECT count(*) INTO v_real_audit_after
    FROM public.mastery_event_audit_log WHERE constants_snapshot_hash <> 'seedhash';
  SELECT count(*) INTO v_real_mastery_after
    FROM public.student_skill_mastery WHERE constants_snapshot_hash <> 'seedhash';

  IF v_real_audit_after <> v_real_audit_before THEN
    RAISE EXCEPTION
      'PURGE NEGATIVE CONTROL FAILED: non-seedhash audit rows went % -> %; rolling back',
      v_real_audit_before, v_real_audit_after;
  END IF;
  IF v_real_mastery_after <> v_real_mastery_before THEN
    RAISE EXCEPTION
      'PURGE NEGATIVE CONTROL FAILED: non-seedhash skill-mastery rows went % -> %; rolling back',
      v_real_mastery_before, v_real_mastery_after;
  END IF;

  IF v_deleted_audit > 6 THEN
    RAISE EXCEPTION 'PURGE: deleted % audit rows, expected at most 6; rolling back', v_deleted_audit;
  END IF;
  IF v_deleted_mastery > 1 THEN
    RAISE EXCEPTION 'PURGE: deleted % mastery rows, expected at most 1; rolling back', v_deleted_mastery;
  END IF;

  RAISE NOTICE 'PURGE ok: % audit row(s), % skill-mastery row(s) deleted; % audit / % mastery real rows untouched',
    v_deleted_audit, v_deleted_mastery, v_real_audit_after, v_real_mastery_after;
END $purge$;

COMMIT;

\echo ''
\echo '=== PURGE — post-state (both seedhash counts must be 0) ==='

SELECT
  (SELECT count(*) FROM public.mastery_event_audit_log
    WHERE constants_snapshot_hash = 'seedhash')                     AS seedhash_audit_rows,
  (SELECT count(*) FROM public.student_skill_mastery
    WHERE constants_snapshot_hash = 'seedhash')                     AS seedhash_mastery_rows,
  (SELECT count(*) FROM public.mastery_event_audit_log)             AS total_audit_rows,
  (SELECT count(*) FROM public.student_skill_mastery)               AS total_mastery_rows,
  CASE
    WHEN (SELECT count(*) FROM public.mastery_event_audit_log
           WHERE constants_snapshot_hash = 'seedhash') = 0
     AND (SELECT count(*) FROM public.student_skill_mastery
           WHERE constants_snapshot_hash = 'seedhash') = 0
      THEN 'OK — residue purged'
    ELSE 'STOP — residue still present'
  END                                                               AS verdict;
