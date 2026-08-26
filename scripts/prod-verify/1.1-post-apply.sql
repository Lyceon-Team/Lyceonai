-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816000000_psi_occurred_at_backfill_and_seal
-- ============================================================================
-- READ-ONLY. Run immediately after applying the migration.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console. ONE statement, ONE row. The last
--   column is the verdict. See README.md for the rules every file here follows.
--
-- WHAT THIS PROVES
--   The repair touched exactly the 42 rows that 1.1-pre-apply.sql identified —
--   by identity, not by count — wrote exactly answered_at into each, touched
--   nothing else, inserted and deleted nothing, and left the constraint enforcing
--   and VALIDATED.
--
-- HOW THE EXACT-TARGET PROOF WORKS
--   An earlier revision tried to hash the post-state and compare against
--   target_set_hash. That cannot work: once occurred_at is filled, no predicate
--   distinguishes a repaired row from one that always had
--   occurred_at = answered_at, so the post-state hash necessarily covered the
--   whole resolved population (84 rows) rather than the repaired target (42).
--   Two different sets — the comparison could never match and proved nothing.
--
--   The migration records its own effect. It writes one row per repaired item
--   into psi_occurred_at_backfill_log in the SAME statement as the UPDATE, via a
--   data-modifying CTE, so the log cannot diverge from the mutation. This file
--   hashes the log's ordered item-id list using the IDENTICAL construction
--   1.1-pre-apply.sql used over its target_set:
--
--       encode(extensions.digest(string_agg(<id>::text, ',' ORDER BY <id>), 'sha256'), 'hex')
--
--   That hash is ASSERTED — not eyeballed — against the same pinned literal.
--   Equality means the rows the migration actually repaired are the rows that
--   were audited, by identity. Inequality is a STOP in the verdict below.
--
-- EXPECTED VALUES
--   backfill_logged            = 42     one log row per repaired item
--   backfill_set_hash_matches  = true   asserted, not eyeballed
--   log_mismatched             = 0      logged items whose occurred_at <> logged value
--   unrepaired                 = 0      resolved rows still NULL
--   legit_null                 = 70     MUST equal the pre-apply reading — NEGATIVE CONTROL
--   total_rows                 = 154    MUST equal the pre-apply reading
--   drifted                    = 0      resolved rows where occurred_at <> answered_at
--   constraint_present         = true
--   constraint_validated       = true   NOT VALID would tolerate pre-existing violations
--
-- THE TWO MOST IMPORTANT COLUMNS are legit_null and total_rows.
--   legit_null proves the UPDATE did not touch the 70 unresolved rows, whose NULL
--   occurred_at is CORRECT — an unserved or unanswered item is not an event and
--   has no occurrence time. A widened UPDATE predicate shows up there and nowhere
--   else. total_rows proves nothing was inserted or deleted during the apply.
--   Neither is superseded by the hash: the hash proves the right rows were
--   changed, these two prove nothing else was.
--
-- HOW TO READ A DEVIATION
--   hash mismatch       a DIFFERENT set of rows was repaired than the pre-apply
--                       run identified. STOP and re-audit; do not proceed to Step 8.
--   backfill_logged<>42 the repaired population was not the pinned target.
--   log_mismatched > 0  a logged row's occurred_at no longer matches what the
--                       backfill wrote — something modified it afterwards.
--   legit_null < pre    THE NEGATIVE CONTROL FAILED. The UPDATE touched
--                       unresolved rows. Roll back and re-scope.
--   drifted > 0         occurred_at was written from something other than
--                       answered_at (e.g. now()). Values wrong, count right.
--   total_rows <> pre   rows were inserted or deleted during the apply.
--
-- Row-by-row listing: run 1.1-post-apply-detail.sql and compare against 1a.
-- ============================================================================

WITH pinned AS (
  -- IDENTICAL literal to 1.1-pre-apply.sql. CI asserts the two agree, which is
  -- what stops them drifting apart now that there is no psql \ir include.
  -- A mismatch against this value is a STOP signal, not a stale constant.
  SELECT '55025a91663cc7a097deb089e9a327c2ba02de79efd8654106097c4d273ce9d9'::text
           AS expected_hash
),
census AS (
  SELECT
    (SELECT count(*) FROM public.psi_occurred_at_backfill_log)          AS backfill_logged,

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

    (SELECT count(*) FROM public.practice_session_items
      WHERE status IN ('answered','skipped') AND occurred_at IS NULL)   AS unrepaired,

    -- NEGATIVE CONTROLS
    (SELECT count(*) FROM public.practice_session_items
      WHERE status NOT IN ('answered','skipped')
        AND occurred_at IS NULL)                                        AS legit_null,
    (SELECT count(*) FROM public.practice_session_items)                AS total_rows,
    (SELECT count(*) FROM public.practice_session_items
      WHERE status IN ('answered','skipped')
        AND occurred_at IS DISTINCT FROM answered_at)                   AS drifted,

    -- seal
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'psi_resolved_requires_occurred_at')              AS constraint_count,
    (SELECT bool_and(c.convalidated) FROM pg_constraint c
      WHERE c.conname = 'psi_resolved_requires_occurred_at')            AS constraint_validated,
    (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conname = 'psi_resolved_requires_occurred_at')            AS constraint_definition
)
SELECT
  c.backfill_logged,
  42                                            AS backfill_logged_expected,
  c.backfill_set_hash,
  p.expected_hash                               AS backfill_set_hash_pinned,
  c.backfill_set_hash = p.expected_hash         AS backfill_set_hash_matches,
  c.log_mismatched,
  0                                             AS log_mismatched_expected,
  c.unrepaired,
  0                                             AS unrepaired_expected,
  c.legit_null,
  70                                            AS legit_null_expected,
  c.total_rows,
  154                                           AS total_rows_expected,
  c.drifted,
  0                                             AS drifted_expected,
  (c.constraint_count = 1)                      AS constraint_present,
  COALESCE(c.constraint_validated, false)       AS constraint_validated,
  c.constraint_definition,

  -- The hash equality is ASSERTED here, not left to the operator to eyeball.
  CASE
    WHEN c.backfill_logged <> 42
      THEN 'STOP — backfill log has ' || c.backfill_logged::text ||
           ' rows, expected 42; a different set was repaired'
    WHEN c.unrepaired > 0
      THEN 'STOP — repair incomplete'
    WHEN c.legit_null < 70
      THEN 'STOP — NEGATIVE CONTROL FAILED: the UPDATE touched unresolved rows'
    WHEN c.total_rows <> 154
      THEN 'STOP — total row count changed during apply'
    WHEN c.drifted > 0
      THEN 'STOP — occurred_at was not written from answered_at'
    WHEN c.log_mismatched > 0
      THEN 'STOP — a logged row no longer carries the value the backfill wrote'
    WHEN c.constraint_count <> 1
      THEN 'STOP — constraint missing; the seal did not apply'
    WHEN NOT COALESCE(c.constraint_validated, false)
      THEN 'STOP — constraint is NOT VALID: existing rows were never checked, so a resolved row with NULL occurred_at can survive'
    -- EXACT-TARGET PROOF. The log names the rows the migration actually repaired;
    -- the pinned literal names the rows 1.1-pre-apply audited. Equality means
    -- those are the same 42 rows, by identity.
    WHEN c.backfill_set_hash IS DISTINCT FROM p.expected_hash
      THEN 'STOP — EXACT-TARGET PROOF FAILED. The rows repaired are not the rows that were audited. Do not proceed to Step 8; read scripts/prod-verify/README.md.'
    ELSE 'OK — 42 rows repaired, identity matches the pinned target, negative controls held, constraint enforcing'
  END                                           AS verdict
FROM census c CROSS JOIN pinned p;
