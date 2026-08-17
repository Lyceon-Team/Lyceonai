-- ============================================================================
-- PRE-APPLY VERIFICATION — migration 20260816000000_psi_occurred_at_backfill_and_seal
-- ============================================================================
-- READ-ONLY. Run immediately before applying the migration.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console and run it. It is ONE statement
--   and returns ONE row. The last column is the verdict. See README.md in this
--   directory for the rules every file here follows and why.
--
-- WHAT THIS PROVES
--   The repair set is exactly the 42 rows we reasoned about, and it is the SAME
--   42 rows — not merely the same count. target_set_hash pins identity: if a row
--   was answered, repaired, or deleted since the audit, the hash changes even
--   when the count does not.
--
-- WHY THE EXACT-TARGET FACTS LIVE HERE AND NOT IN THE MIGRATION
--   The migration runs in every environment — genesis-fresh-apply, every
--   throwaway rehearsal DB, the transport-test substrate — where the correct
--   count is 0. An environment-specific fact inside an artifact that executes in
--   every environment reds all of them. The migration therefore carries only a
--   portable SHAPE invariant (no unrepairable rows; repairable <= 42) and the
--   exact-target proof lives in this file.
--
-- EXPECTED VALUES (a deviation in ANY column means STOP, do not apply)
--   repairable                = 42    rows the UPDATE will touch
--   unrepairable              = 0     resolved rows with no repair source
--   legit_null                = 70    unresolved rows whose NULL is correct
--   total_rows                = 154   whole-table size
--   target_set_hash_matches   = true  identity, not just count
--   verdict                   = 'OK — safe to apply 20260816000000'
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
--   hash mismatch     READ README.md BEFORE DOING ANYTHING. Do not re-pin.
--
-- Row-by-row listing: run 1.1-pre-apply-detail.sql and record its output.
-- ============================================================================

WITH pinned AS (
  -- The pinned exact-target hash. A mismatch against this value is a STOP signal,
  -- not a stale constant — see README.md. Do NOT regenerate it.
  -- 1.1-post-apply.sql carries the identical literal; CI asserts they agree.
  SELECT '55025a91663cc7a097deb089e9a327c2ba02de79efd8654106097c4d273ce9d9'::text
           AS expected_hash
),
target_set AS (
  -- Exactly the rows the migration's UPDATE will touch.
  SELECT id
  FROM public.practice_session_items
  WHERE status IN ('answered', 'skipped')
    AND occurred_at IS NULL
    AND answered_at IS NOT NULL
),
census AS (
  SELECT
    (SELECT count(*) FROM target_set)                                  AS repairable,
    (SELECT count(*) FROM public.practice_session_items
      WHERE status IN ('answered','skipped')
        AND occurred_at IS NULL AND answered_at IS NULL)               AS unrepairable,
    (SELECT count(*) FROM public.practice_session_items
      WHERE status NOT IN ('answered','skipped')
        AND occurred_at IS NULL)                                       AS legit_null,
    (SELECT count(*) FROM public.practice_session_items)               AS total_rows,
    -- Exact-target proof. Hash of the ordered id list of precisely the rows the
    -- UPDATE will touch. 1.1-post-apply.sql recomputes this identical
    -- construction over the rows that were actually repaired.
    (SELECT encode(
              extensions.digest(
                COALESCE(string_agg(id::text, ',' ORDER BY id), ''),
                'sha256'),
              'hex')
       FROM target_set)                                                AS target_set_hash
)
SELECT
  c.repairable,
  42                                            AS repairable_expected,
  c.unrepairable,
  0                                             AS unrepairable_expected,
  c.legit_null,
  70                                            AS legit_null_expected,
  c.total_rows,
  154                                           AS total_rows_expected,
  c.target_set_hash,
  p.expected_hash                               AS target_set_hash_pinned,
  c.target_set_hash = p.expected_hash           AS target_set_hash_matches,

  -- Verdict in one column so a wrong result is visibly wrong, not a number to
  -- squint at. Ordered cheapest-diagnosis-first; the hash check is LAST because
  -- it is the strictest — the count can match while the identity of the rows has
  -- changed underneath it.
  CASE
    WHEN c.unrepairable > 0
      THEN 'STOP — unrepairable rows present; migration will abort'
    WHEN c.repairable > 42
      THEN 'STOP — scope expanded beyond 42; re-audit before applying'
    WHEN c.repairable <> 42
      THEN 'STOP — repairable count is not 42; something changed these rows'
    WHEN c.target_set_hash IS DISTINCT FROM p.expected_hash
      THEN 'STOP — DO NOT APPLY. Exact-target hash mismatch: the repairable set has MOVED since it was pinned. Read scripts/prod-verify/README.md before doing anything — do NOT re-pin the constant.'
    ELSE 'OK — safe to apply 20260816000000'
  END                                           AS verdict
FROM census c CROSS JOIN pinned p;
