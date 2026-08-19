-- ============================================================================
-- STEP 8 PREFLIGHT — is it safe to recompute?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- Run this before step8-recompute.sql. Recomputing on top of un-repaired data
-- would fail per-student with KPI_HISTORICAL_DATA_INVALID and leave a confusing
-- partial result.
--
-- This file is advisory: it tells you what is wrong in readable form instead of
-- throwing. step8-recompute.sql re-checks all of these itself and refuses to
-- write if any of them regressed between the two runs — the write path does not
-- trust this file having been run.
--
-- EXPECTED
--   unrepaired_items    = 0      1.1 has been applied
--   seal_present        = true   psi_resolved_requires_occurred_at exists
--   seed_residue_rows   = 0      purge-seed-residue.sql has been run
--   students_with_answers = 4    matches the pinned recompute set
--   pinned_profiles_found = 4    the four prefixes still resolve
--   verdict             = 'OK — ready to recompute'
-- ============================================================================

WITH census AS (
  SELECT
    (SELECT count(*) FROM public.practice_session_items
      WHERE status IN ('answered','skipped') AND occurred_at IS NULL)      AS unrepaired_items,
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'psi_resolved_requires_occurred_at')                 AS seal_count,
    (SELECT count(*) FROM public.mastery_event_audit_log
      WHERE constants_snapshot_hash = 'seedhash')                          AS seed_residue_rows,
    (SELECT count(DISTINCT pi.user_id) FROM public.practice_session_items pi
      WHERE pi.status = 'answered' AND pi.user_id IS NOT NULL)             AS students_with_answers,
    (SELECT count(*) FROM public.profiles p
      WHERE p.id::text LIKE '3f18cbe2%'
         OR p.id::text LIKE 'c3c97b64%'
         OR p.id::text LIKE 'f95b29f3%'
         OR p.id::text LIKE '0ebe43d9%')                                   AS pinned_profiles_found
)
SELECT
  c.unrepaired_items,
  0                                  AS unrepaired_items_expected,
  (c.seal_count = 1)                 AS seal_present,
  c.seed_residue_rows,
  0                                  AS seed_residue_rows_expected,
  c.students_with_answers,
  4                                  AS students_with_answers_expected,
  c.pinned_profiles_found,
  4                                  AS pinned_profiles_found_expected,
  CASE
    WHEN c.unrepaired_items > 0
      THEN 'STOP — ' || c.unrepaired_items::text ||
           ' resolved row(s) still have NULL occurred_at; apply 20260816000000 first'
    WHEN c.seal_count <> 1
      THEN 'STOP — psi_resolved_requires_occurred_at missing; 1.1 has not been applied'
    WHEN c.seed_residue_rows > 0
      THEN 'STOP — ' || c.seed_residue_rows::text ||
           ' seed-residue audit row(s) present; run purge-seed-residue.sql first'
    WHEN c.pinned_profiles_found <> 4
      THEN 'STOP — resolved ' || c.pinned_profiles_found::text ||
           ' of the 4 pinned profiles; verify the prefixes before recomputing'
    WHEN c.students_with_answers <> 4
      THEN 'STOP — ' || c.students_with_answers::text ||
           ' distinct students now have answered items, but 4 are pinned; re-scope before recomputing'
    ELSE 'OK — ready to recompute'
  END                                AS verdict
FROM census c;
