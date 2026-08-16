-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816000000_psi_occurred_at_backfill_and_seal
-- ============================================================================
-- READ-ONLY. Run immediately after Karl applies the migration.
--
-- WHAT THIS PROVES
--   The repair landed, it touched ONLY the intended rows, it wrote exactly
--   answered_at (not now()), nothing was inserted or deleted, and the constraint
--   is present and enforcing.
--
-- THE MOST IMPORTANT LINE IN THIS FILE is `legit_null`. It is the negative
-- control. The repair is worthless if it also touched the 70 unresolved rows,
-- because their NULL occurred_at is CORRECT — an unserved or unanswered item is
-- not an event and has no occurrence time. A widened UPDATE predicate would show
-- up here and nowhere else.
--
-- EXPECTED VALUES
--   unrepaired      = 0    resolved rows still NULL -> repair incomplete
--   legit_null      = 70   MUST equal the pre-apply reading. Compare, do not assume.
--   drifted         = 0    repaired rows where occurred_at <> answered_at
--   total_rows      = 154  MUST equal the pre-apply reading — nothing added/removed
--   constraint_present = t
--   repaired_set_hash      compare against target_set_hash from 1.1-pre-apply.sql
--
-- HOW TO READ A DEVIATION
--   unrepaired > 0    the UPDATE did not cover everything. The constraint should
--                     have refused to be created — investigate immediately.
--   legit_null <> pre the UPDATE touched unresolved rows. THIS IS THE FAILURE THE
--                     NEGATIVE CONTROL EXISTS TO CATCH. Roll back and re-scope.
--   drifted > 0       occurred_at was written from something other than
--                     answered_at (e.g. now()). The values are wrong even though
--                     the count looks right.
--   total_rows <> pre rows were inserted or deleted during the apply.
--
-- USAGE: psql -f scripts/prod-verify/1.1-post-apply.sql
-- ============================================================================

\pset footer off
\echo '=== 1.1 POST-APPLY — repair landed, negative control held, constraint enforcing ==='

SELECT
  (SELECT count(*) FROM public.practice_session_items
    WHERE status IN ('answered','skipped') AND occurred_at IS NULL)   AS unrepaired,
  0                                                                   AS unrepaired_expected,

  -- NEGATIVE CONTROL — compare against the pre-apply reading, not against 70
  -- blindly. If a student started a session between the two runs this legitimately
  -- moves; what must NOT happen is it going DOWN.
  (SELECT count(*) FROM public.practice_session_items
    WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL) AS legit_null,
  70                                                                  AS legit_null_expected,

  (SELECT count(*) FROM public.practice_session_items
    WHERE status IN ('answered','skipped')
      AND occurred_at IS DISTINCT FROM answered_at)                   AS drifted,
  0                                                                   AS drifted_expected,

  (SELECT count(*) FROM public.practice_session_items)                AS total_rows,
  154                                                                 AS total_rows_expected,

  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'psi_resolved_requires_occurred_at')       AS constraint_present,

  CASE
    WHEN (SELECT count(*) FROM public.practice_session_items
           WHERE status IN ('answered','skipped') AND occurred_at IS NULL) > 0
      THEN 'STOP — repair incomplete'
    WHEN (SELECT count(*) FROM public.practice_session_items
           WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL) < 70
      THEN 'STOP — NEGATIVE CONTROL FAILED: the UPDATE touched unresolved rows'
    WHEN (SELECT count(*) FROM public.practice_session_items
           WHERE status IN ('answered','skipped')
             AND occurred_at IS DISTINCT FROM answered_at) > 0
      THEN 'STOP — occurred_at was not written from answered_at'
    WHEN NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'psi_resolved_requires_occurred_at')
      THEN 'STOP — constraint missing; the seal did not apply'
    ELSE 'OK — 1.1 applied cleanly'
  END                                                                 AS verdict;

\echo ''
\echo '--- exact-target proof: hash the rows now carrying occurred_at = answered_at ---'
\echo '--- compare against target_set_hash from 1.1-pre-apply.sql ---'

-- The pre-apply hash covered rows whose occurred_at was NULL. Post-apply those
-- same rows are exactly the ones where occurred_at = answered_at AND they were in
-- the recorded target set. We cannot re-derive "was NULL" after the fact, so this
-- hashes the full resolved set for a stable before/after comparison of identity;
-- the operator compares the row list, and the pre-apply file printed it in full.
SELECT encode(
         extensions.digest(
           COALESCE(string_agg(id::text, ',' ORDER BY id), ''),
           'sha256'),
         'hex') AS resolved_set_hash,
       count(*) AS resolved_rows
FROM public.practice_session_items
WHERE status IN ('answered', 'skipped');

\echo ''
\echo '--- constraint definition (should read: status NOT IN (...) OR occurred_at IS NOT NULL) ---'

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'psi_resolved_requires_occurred_at';
