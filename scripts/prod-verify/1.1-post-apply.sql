-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816000000_psi_occurred_at_backfill_and_seal
-- ============================================================================
-- READ-ONLY. Run immediately after Karl applies the migration.
--
-- WHAT THIS PROVES
--   The repair touched exactly the 42 rows that 1.1-pre-apply.sql identified —
--   by identity, not by count — wrote exactly answered_at into each, touched
--   nothing else, inserted and deleted nothing, and left the constraint enforcing.
--
-- HOW THE EXACT-TARGET PROOF WORKS NOW
--   An earlier revision tried to hash the post-state and compare against
--   target_set_hash. That cannot work: once occurred_at is filled, no predicate
--   distinguishes a repaired row from one that always had
--   occurred_at = answered_at, so the post-state hash necessarily covered the
--   whole resolved population (84 rows) rather than the repaired target (42).
--   Two different sets — the comparison could never match and proved nothing.
--
--   The migration now records its own effect. Statement (1) writes one row per
--   repaired item into psi_occurred_at_backfill_log in the SAME statement as the
--   UPDATE, via a data-modifying CTE, so the log cannot diverge from the
--   mutation. This file hashes the log's ordered item-id list using the IDENTICAL
--   construction the pre-apply file used over its target_set:
--
--       encode(digest(string_agg(<id>::text, ',' ORDER BY <id>), 'sha256'), 'hex')
--
--   backfill_set_hash MUST EQUAL the target_set_hash recorded from
--   1.1-pre-apply.sql. That equality is the exact-target proof.
--
-- EXPECTED VALUES
--   backfill_logged     = 42    one log row per repaired item
--   backfill_set_hash          MUST EQUAL target_set_hash from 1.1-pre-apply.sql
--   log_mismatched      = 0     logged items whose occurred_at <> the logged value
--   unrepaired          = 0     resolved rows still NULL
--   legit_null          = 70    MUST equal the pre-apply reading — NEGATIVE CONTROL
--   drifted             = 0     resolved rows where occurred_at <> answered_at
--   total_rows          = 154   MUST equal the pre-apply reading
--   constraint_present  = t
--
-- THE TWO MOST IMPORTANT LINES IN THIS FILE are legit_null and total_rows.
--   legit_null proves the UPDATE did not touch the 70 unresolved rows, whose NULL
--   occurred_at is CORRECT — an unserved or unanswered item is not an event and
--   has no occurrence time. A widened UPDATE predicate shows up there and nowhere
--   else. total_rows proves nothing was inserted or deleted during the apply.
--   Neither is superseded by the hash: the hash proves the right rows were
--   changed, these two prove nothing else was.
--
-- HOW TO READ A DEVIATION
--   hash mismatch     → a DIFFERENT set of rows was repaired than the pre-apply
--                       run identified. Rows changed between verification and
--                       apply. STOP and re-audit; do not proceed to Step 8.
--   backfill_logged<>42 → the repaired population was not the pinned target.
--   log_mismatched > 0  → a logged row's occurred_at no longer matches what the
--                       backfill wrote — something modified it afterwards.
--   legit_null < pre  → THE NEGATIVE CONTROL FAILED. The UPDATE touched
--                       unresolved rows. Roll back and re-scope.
--   drifted > 0       → occurred_at was written from something other than
--                       answered_at (e.g. now()). Values wrong, count right.
--   total_rows <> pre → rows were inserted or deleted during the apply.
--
-- USAGE: psql -f scripts/prod-verify/1.1-post-apply.sql
-- ============================================================================

\pset footer off
\echo '=== 1.1 POST-APPLY — exact-target proof, negative controls, constraint ==='

SELECT
  -- ---------- exact-target identity ----------
  (SELECT count(*) FROM public.psi_occurred_at_backfill_log)          AS backfill_logged,
  42                                                                  AS backfill_logged_expected,

  -- Identical construction to 1.1-pre-apply.sql's target_set_hash.
  (SELECT encode(
            extensions.digest(
              COALESCE(string_agg(l.item_id::text, ',' ORDER BY l.item_id), ''),
              'sha256'),
            'hex')
     FROM public.psi_occurred_at_backfill_log l)                      AS backfill_set_hash,

  -- every logged row still carries the value the backfill wrote
  (SELECT count(*)
     FROM public.psi_occurred_at_backfill_log l
     JOIN public.practice_session_items pi ON pi.id = l.item_id
    WHERE pi.occurred_at IS DISTINCT FROM l.occurred_at_applied)      AS log_mismatched,
  0                                                                   AS log_mismatched_expected,

  -- ---------- completeness ----------
  (SELECT count(*) FROM public.practice_session_items
    WHERE status IN ('answered','skipped') AND occurred_at IS NULL)   AS unrepaired,
  0                                                                   AS unrepaired_expected,

  -- ---------- NEGATIVE CONTROLS ----------
  (SELECT count(*) FROM public.practice_session_items
    WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL) AS legit_null,
  70                                                                  AS legit_null_expected,

  (SELECT count(*) FROM public.practice_session_items)                AS total_rows,
  154                                                                 AS total_rows_expected,

  (SELECT count(*) FROM public.practice_session_items
    WHERE status IN ('answered','skipped')
      AND occurred_at IS DISTINCT FROM answered_at)                   AS drifted,
  0                                                                   AS drifted_expected,

  -- ---------- seal ----------
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'psi_resolved_requires_occurred_at')       AS constraint_present;

\echo ''
\echo '--- verdict (compare backfill_set_hash above against target_set_hash from 1.1-pre-apply.sql) ---'

SELECT CASE
  WHEN (SELECT count(*) FROM public.psi_occurred_at_backfill_log) <> 42
    THEN 'STOP — backfill log has ' ||
         (SELECT count(*) FROM public.psi_occurred_at_backfill_log)::text ||
         ' rows, expected 42; a different set was repaired'
  WHEN (SELECT count(*) FROM public.practice_session_items
         WHERE status IN ('answered','skipped') AND occurred_at IS NULL) > 0
    THEN 'STOP — repair incomplete'
  WHEN (SELECT count(*) FROM public.practice_session_items
         WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL) < 70
    THEN 'STOP — NEGATIVE CONTROL FAILED: the UPDATE touched unresolved rows'
  WHEN (SELECT count(*) FROM public.practice_session_items) <> 154
    THEN 'STOP — total row count changed during apply'
  WHEN (SELECT count(*) FROM public.practice_session_items
         WHERE status IN ('answered','skipped')
           AND occurred_at IS DISTINCT FROM answered_at) > 0
    THEN 'STOP — occurred_at was not written from answered_at'
  WHEN (SELECT count(*)
          FROM public.psi_occurred_at_backfill_log l
          JOIN public.practice_session_items pi ON pi.id = l.item_id
         WHERE pi.occurred_at IS DISTINCT FROM l.occurred_at_applied) > 0
    THEN 'STOP — a logged row no longer carries the value the backfill wrote'
  WHEN NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'psi_resolved_requires_occurred_at')
    THEN 'STOP — constraint missing; the seal did not apply'
  ELSE 'OK on counts — now CONFIRM backfill_set_hash = target_set_hash by eye before proceeding'
END AS verdict;

\echo ''
\echo '--- the exact rows the backfill touched (compare against the pre-apply row list) ---'

SELECT
  l.item_id,
  l.occurred_at_applied,
  pi.status,
  pi.question_section AS section,
  pi.question_domain  AS domain,
  (pi.occurred_at = l.occurred_at_applied) AS value_intact
FROM public.psi_occurred_at_backfill_log l
LEFT JOIN public.practice_session_items pi ON pi.id = l.item_id
ORDER BY l.item_id;

\echo ''
\echo '--- constraint definition (expect: status NOT IN (answered, skipped) OR occurred_at IS NOT NULL) ---'

SELECT conname, convalidated AS is_validated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'psi_resolved_requires_occurred_at';
