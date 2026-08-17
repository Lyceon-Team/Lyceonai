-- ============================================================================
-- PRE-APPLY VERIFICATION — migration 20260816000000_psi_occurred_at_backfill_and_seal
-- ============================================================================
-- READ-ONLY. Run immediately before Karl applies the migration.
--
-- WHAT THIS PROVES
--   The repair set is exactly the 42 rows we reasoned about, and it is the SAME
--   42 rows — not merely the same count. target_set_hash pins identity: if a row
--   was answered, repaired, or deleted since the audit, the hash changes even
--   when the count does not.
--
-- WHY IT LIVES HERE AND NOT IN THE MIGRATION
--   The migration runs in every environment — genesis-fresh-apply, every
--   throwaway rehearsal DB, the transport-test substrate — where the correct
--   count is 0. An environment-specific fact inside an artifact that executes in
--   every environment reds all of them. The migration therefore carries only a
--   portable SHAPE invariant (no unrepairable rows; repairable <= 42) and the
--   exact-target proof lives in this file.
--
-- EXPECTED VALUES (a deviation in ANY row means STOP, do not apply)
--   repairable      = 42     rows the UPDATE will touch
--   unrepairable    = 0      resolved rows with no repair source -> migration aborts
--   legit_null      = 70     unresolved rows whose NULL occurred_at is correct
--   total_rows      = 154    whole-table size (42 + 12 already-repaired + 70 + …)
--   target_set_hash = record it, and compare against 1.1-post-apply.sql
--
-- HOW TO READ A DEVIATION
--   repairable > 42   new answers landed after the audit. The migration will
--                     self-abort (PSI_BACKFILL_SCOPE_EXPANDED). Re-audit first.
--   repairable < 42   something already modified these rows. STOP — find out what.
--   unrepairable > 0  a resolved row has neither occurred_at nor answered_at.
--                     The migration will abort. Resolve manually first.
--   legit_null <> 70  the unresolved population changed. Not necessarily wrong
--                     (students may have started sessions), but the post-apply
--                     negative control compares against whatever you record HERE,
--                     so record it rather than assuming 70.
--
-- USAGE: psql -f scripts/prod-verify/1.1-pre-apply.sql
-- ============================================================================

\pset footer off

-- The pinned exact-target hash, single-sourced so pre- and post-apply cannot drift.
-- Read its header before reacting to any mismatch: a mismatch is a STOP signal, not
-- a stale constant, and regenerating it destroys the guarantee.
\ir _target-set-hash.psql

\echo '=== 1.1 PRE-APPLY — practice_session_items.occurred_at repair scope ==='

WITH target_set AS (
  SELECT id
  FROM public.practice_session_items
  WHERE status IN ('answered', 'skipped')
    AND occurred_at IS NULL
    AND answered_at IS NOT NULL
  ORDER BY id
)
SELECT
  (SELECT count(*) FROM target_set)                                  AS repairable,
  42                                                                 AS repairable_expected,

  (SELECT count(*) FROM public.practice_session_items
    WHERE status IN ('answered','skipped')
      AND occurred_at IS NULL AND answered_at IS NULL)               AS unrepairable,
  0                                                                  AS unrepairable_expected,

  (SELECT count(*) FROM public.practice_session_items
    WHERE status NOT IN ('answered','skipped')
      AND occurred_at IS NULL)                                       AS legit_null,
  70                                                                 AS legit_null_expected,

  (SELECT count(*) FROM public.practice_session_items)               AS total_rows,
  154                                                                AS total_rows_expected,

  -- Exact-target proof. Hash of the ordered id list of precisely the rows the
  -- UPDATE will touch. Asserted against the pinned constant below, and recomputed
  -- by 1.1-post-apply.sql over the rows that were actually repaired.
  (SELECT encode(
            extensions.digest(
              COALESCE(string_agg(id::text, ',' ORDER BY id), ''),
              'sha256'),
            'hex')
     FROM target_set)                                                AS target_set_hash,
  :'expected_target_set_hash'                                        AS target_set_hash_pinned,
  (SELECT encode(
            extensions.digest(
              COALESCE(string_agg(id::text, ',' ORDER BY id), ''),
              'sha256'),
            'hex')
     FROM target_set) = :'expected_target_set_hash'                  AS target_set_hash_matches,

  -- Verdict in one column so a wrong result is visibly wrong, not a number to
  -- squint at.
  CASE
    WHEN (SELECT count(*) FROM public.practice_session_items
           WHERE status IN ('answered','skipped')
             AND occurred_at IS NULL AND answered_at IS NULL) > 0
      THEN 'STOP — unrepairable rows present; migration will abort'
    WHEN (SELECT count(*) FROM target_set) > 42
      THEN 'STOP — scope expanded beyond 42; re-audit before applying'
    WHEN (SELECT count(*) FROM target_set) <> 42
      THEN 'STOP — repairable count is not 42; something changed these rows'
    -- The hash check is LAST because it is the strictest: the count can match
    -- while the identity of the rows has changed underneath it.
    WHEN (SELECT encode(extensions.digest(
                    COALESCE(string_agg(id::text, ',' ORDER BY id), ''), 'sha256'), 'hex')
            FROM target_set) IS DISTINCT FROM :'expected_target_set_hash'
      THEN 'STOP — DO NOT APPLY. Exact-target hash mismatch: the repairable set has MOVED since it was pinned. Read scripts/prod-verify/_target-set-hash.psql before doing anything — do NOT re-pin the constant.'
    ELSE 'OK — safe to apply 20260816000000'
  END                                                                AS verdict;

\echo ''
\echo '--- the exact rows that will be repaired (record alongside target_set_hash) ---'

SELECT
  pi.id,
  pi.user_id,
  pi.status,
  pi.question_section AS section,
  pi.question_domain  AS domain,
  pi.question_skill   AS skill,
  pi.answered_at      AS will_become_occurred_at
FROM public.practice_session_items pi
WHERE pi.status IN ('answered', 'skipped')
  AND pi.occurred_at IS NULL
  AND pi.answered_at IS NOT NULL
ORDER BY pi.id;
