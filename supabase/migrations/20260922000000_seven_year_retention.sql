-- ===========================================================================
-- Seven-year retention, part one — payment records (§6.2)
--
-- @spec [Privacy Policy v3 §6.2 ("Payment records, kept for 7 years, because
--        tax and financial rules require it"); Doc-01_V8 §5.1 (entitlement /
--        billing events, 7 years, "Financial records minimum");
--        Doc-06D_V1.0 §9 (a retention rule without a mechanism is retention
--        drift); SCL-101; owner ruling 2026-09-22 B2]
-- @implemented 2026-09-22
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: v3 publishes two seven-year periods — payments in §6.2 and
-- configuration records in §6.5. SCL-101 recorded both as commitments with
-- nothing behind them. This migration is the mechanism for §6.2 ONLY.
--
-- WHY §6.5 IS NOT HERE, THOUGH IT WAS RULED IN. The owner ruling of 2026-09-22
-- asked for every config-history table to be swept, catalog-driven. Building it
-- found that it cannot be done without changing an invariant: nineteen of the
-- twenty tables involved are APPEND-ONLY, enforced by the
-- `public.prevent_update_delete()` trigger per Doc 01A §5 ("History is
-- append-only"). A DELETE against any of them raises, so the sweep as ruled
-- fails at run time rather than retaining anything.
--
-- The repo has exactly one precedent for deleting from an append-only table:
-- SCL-087 gave `audit_logs` its own guard function with a single exemption
-- gated on a transaction-local GUC. That same migration states the reason it
-- was scoped to one table — "the shared guard is deliberately not modified:
-- nineteen other append-only tables use it and must not inherit this
-- exemption." Reversing that is a change to a tamper-evidence property, which
-- is an owner ruling and an SCL, not a build detail. It is filed rather than
-- assumed, and §6.5 ships in a second migration once ruled.
--
-- expected outcome: payment records age out at seven years from the
-- cancellation they describe. Zero rows will qualify for years — expected, and
-- not a reason to defer: a published period needs a mechanism on the day it is
-- published, not the day it first matters.
--
-- ONE WINDOW PER PUBLISHED SENTENCE, even though §6.2 and §6.5 both say seven
-- years. They rest on different bases — tax and accounting law for one,
-- operational record-keeping for the other — and are separately amendable. A
-- shared `seven_years()` would mean amending the payment period silently moved
-- the configuration period, which is the coupling this register exists to
-- prevent.
--
-- trade-offs:
--  - `deletion_billing_record` ages on `cancelled_on`, a DATE and the table's
--    only temporal column. That is not an oversight: SCL-088 removed
--    time-of-deletion signals from the evidence side deliberately.
--    `cancelled_on` is NOT NULL and is rewritten to the teardown date when a
--    `failed_manual` retry succeeds, so every row has an age and the age is the
--    one the financial record is actually about.
--  - The set is NAMED, not catalog-driven, unlike the 90-day sweep. "Payment
--    records" is a closed set the policy names; a new financial table should
--    have to be classified by a person rather than captured by a name pattern.
--  - Per-table batch bound, so one large table cannot starve the other.
--
-- edge cases:
--  - A zero-row sweep still returns a row per table with its cutoff, so an
--    unscheduled sweep stays distinguishable from an empty one.
--  - Re-running is safe; already-deleted rows no longer match.
-- ===========================================================================

-- ── 1. The window — one definition ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.financial_record_retention_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 2557;   -- 7 years, leap-inclusive (365*7 + 2)
$$;

COMMENT ON FUNCTION public.financial_record_retention_days() IS
  'Privacy Policy v3 §6.2: how long payment records are kept, in days. THE single definition for that sentence; sweep_financial_record_retention reads it. Deliberately separate from configuration_record_retention_days even though both are 7 years — the two sentences rest on different bases and are separately amendable.';

-- ── 2. Financial records (§6.2) — two named tables ─────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_financial_record_retention(p_batch_size integer)
RETURNS TABLE (
  swept_table   text,
  deleted_count integer,
  cutoff        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- (table, age column). Named, not catalog-driven: "payment records" is a
  -- closed set the policy names, and a new financial table should have to be
  -- classified by a person rather than captured by a name pattern.
  v_targets CONSTANT text[][] := ARRAY[
    ['deletion_billing_record', 'cancelled_on'],
    ['stripe_webhook_events',   'created_at']
  ];
  v_cutoff  timestamptz;
  v_tbl     text;
  v_col     text;
  v_deleted integer;
  i         integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_financial_record_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - make_interval(days => public.financial_record_retention_days());

  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_tbl := v_targets[i][1];
    v_col := v_targets[i][2];

    -- ctid, as in the 90-day sweep: deletion_billing_record is keyed on
    -- log_id and stripe_webhook_events on its own id, so no single key column
    -- name spans both. The subselect and the delete share one snapshot.
    EXECUTE format(
      'WITH doomed AS (
         SELECT t.ctid FROM public.%I t
          WHERE t.%I < $1
          ORDER BY t.%I ASC
          LIMIT $2
       ), gone AS (
         DELETE FROM public.%I d WHERE d.ctid IN (SELECT doomed.ctid FROM doomed)
         RETURNING 1
       )
       SELECT count(*)::integer FROM gone',
      v_tbl, v_col, v_col, v_tbl
    )
    INTO v_deleted
    USING v_cutoff, p_batch_size;

    swept_table   := v_tbl;
    deleted_count := v_deleted;
    cutoff        := v_cutoff;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sweep_financial_record_retention(integer) IS
  'Privacy Policy v3 §6.2 / SCL-101: deletes payment records older than financial_record_retention_days(), oldest first, at most p_batch_size per table per call. Returns one row per table including zero-row tables.';

REVOKE ALL ON FUNCTION public.financial_record_retention_days()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_financial_record_retention(integer)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.financial_record_retention_days()               TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_financial_record_retention(integer)       TO service_role;
