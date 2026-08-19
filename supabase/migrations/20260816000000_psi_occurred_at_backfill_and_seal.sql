-- ---------------------------------------------------------------------------
-- Mastery unblock 1/2: repair NULL practice_session_items.occurred_at, then seal it.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05A_V1.0 §4.1 insert-then-call; Doc-05B_V1.0 §4.9 KPI fan-out;
--        Doc-05B RB-05B-V1-02 KPI_HISTORICAL_DATA_INVALID]
-- @implemented 2026-08-16
--
-- plain English: the answer handler did not write occurred_at until commit
-- f0bc31e (2026-08-08). The rows it left behind are not a cosmetic gap — they
-- disable the mastery pipeline for the WHOLE STUDENT. refresh_domain_mastery
-- §4.9 fans out to refresh_section_kpi (student+section scope) and
-- refresh_overall_kpi (student scope, no section or domain filter). Both
-- re-validate every answered practice_session_item in their scope and RAISE
-- KPI_HISTORICAL_DATA_INVALID on a NULL occurred_at, inside the mastery event's
-- own transaction. So ONE bad row anywhere in a student's history rolls back
-- every subsequent mastery write for that student — every skill, every domain,
-- every section. This migration repairs the rows and makes the state
-- unreachable again.
--
-- expected outcome: every resolved item (status 'answered' or 'skipped') has a
-- non-NULL occurred_at, and the CHECK makes a regression of f0bc31e fail at
-- write time instead of silently poisoning a student. Unresolved items
-- ('pending' / 'served') keep their legitimate NULL — they are not events yet.
--
-- NO PARTIAL CREDIT: 41 of 42 rows repaired produces exactly the same output as
-- zero repaired, because refresh_overall_kpi counts bad rows student-wide.
-- Repair (1) and seal (2) therefore ship as one migration and cannot be applied
-- apart. Statement (2) fails on its own if (1) left anything behind.
--
-- PORTABILITY: statement (0) asserts a SHAPE INVARIANT, not an environment fact.
-- An exact-target count belongs in the pre-apply verification file
-- (scripts/prod-verify/1.1-pre-apply.sql), which pins both the count (42) and
-- the identity of the rows via target_set_hash. A hardcoded prod row count in
-- THIS file would raise on every fresh apply — genesis-fresh-apply, every
-- throwaway DB from setup_deletion_rehearsal_db, and the ephemeral PG16 behind
-- the transport test — where the count is legitimately 0.
--
-- trade-offs: occurred_at := answered_at is the only defensible source in the
-- row (owner ruling Q4, 2026-08-16). It is not a formula constant, so no
-- mastery_constants_change_log entry is required.
--
-- SELF-AUDITING: statement (1) writes one row per repaired item into
-- psi_occurred_at_backfill_log, in the SAME statement as the UPDATE via a
-- data-modifying CTE. Two reasons, and the second stands on its own:
--
--   1. Exact-target proof. Once occurred_at is filled, NO predicate over the
--      post-state can identify which rows were repaired — a row set to
--      occurred_at = answered_at is indistinguishable from one that always had
--      them equal. Without the log, post-apply verification can only hash the
--      whole resolved population, which is a different set than the pre-apply
--      target hash and therefore proves nothing about identity. The log makes
--      the proof about THESE 42 rows rather than SOME 42 rows.
--
--   2. Provenance. A backfill that mutates production data and leaves no record
--      of what it touched is a gap regardless of the hash question. Every other
--      mutation on the mastery surface leaves an audit trail; this one should
--      too.
--
-- rollback (reviewed): LYCEON-MIGRATION-REVIEWED
--   ALTER TABLE public.practice_session_items
--     DROP CONSTRAINT IF EXISTS psi_resolved_requires_occurred_at;
--   DROP TABLE IF EXISTS public.psi_occurred_at_backfill_log;
--   -- the UPDATE is not rolled back: occurred_at = answered_at is the correct
--   -- value for these rows, and reverting it would re-break the pipeline. Drop
--   -- the log only if the backfill itself is being abandoned — it is the only
--   -- record of which rows were touched.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- (0) Shape guards — portable, environment-independent.
--
-- Guard A (unrepairable rows): a resolved row with NULL occurred_at AND NULL
--   answered_at has no defensible repair source. It is also the ONLY condition
--   under which statement (2) could fail after (1) has run, so catching it here
--   turns an opaque 23514 into a named error. Expected 0 everywhere.
--
-- Guard B (scope expansion): `>` not `<>`. On prod the repairable set is 42
--   (pinned by identity in 1.1-pre-apply.sql). A larger set means rows appeared
--   after the pre-apply verification and the exact-target proof is stale — stop.
--   A smaller set is normal on any fresh database, where it is 0.
--
-- status is CHECK-constrained to exactly {pending, served, answered, skipped}
-- (practice_session_items_status_check), so ('answered','skipped') covers every
-- resolved state with no escape hatch.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_unrepairable integer;
  v_repairable   integer;
BEGIN
  SELECT count(*) INTO v_unrepairable
  FROM public.practice_session_items
  WHERE status IN ('answered', 'skipped')
    AND occurred_at IS NULL
    AND answered_at IS NULL;

  IF v_unrepairable > 0 THEN
    RAISE EXCEPTION
      'PSI_BACKFILL_UNREPAIRABLE: % resolved row(s) have NULL occurred_at AND NULL answered_at — no defensible repair source; resolve manually before applying',
      v_unrepairable;
  END IF;

  SELECT count(*) INTO v_repairable
  FROM public.practice_session_items
  WHERE status IN ('answered', 'skipped')
    AND occurred_at IS NULL
    AND answered_at IS NOT NULL;

  IF v_repairable > 42 THEN
    RAISE EXCEPTION
      'PSI_BACKFILL_SCOPE_EXPANDED: % repairable row(s) exceeds the 42 pinned by scripts/prod-verify/1.1-pre-apply.sql — re-run pre-apply verification before applying',
      v_repairable;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- (0b) Backfill log. Created before the repair so statement (1) can write it in
--      the same statement.
--
--      item_id is the PRIMARY KEY, not a surrogate: exactly one log row per
--      repaired item is the property post-apply verification asserts, and the PK
--      enforces it rather than merely expecting it.
--
--      Deliberately NO foreign key to practice_session_items and NO student_id
--      column. A FK would make this table a participant in the 05D §10 account-
--      deletion cascade, which enumerates its in-scope tables explicitly — adding
--      an unlisted FK child would break the cascade rather than extend it, and
--      extending the cascade is outside this workstream. Omitting student_id
--      keeps the log operational-only: it records which ROWS were touched, not
--      who they belong to. LYCEON-MIGRATION-REVIEWED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.psi_occurred_at_backfill_log (
  item_id             uuid        NOT NULL,
  occurred_at_applied timestamptz NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now(),
  migration_version   text        NOT NULL,
  CONSTRAINT psi_occurred_at_backfill_log_pkey PRIMARY KEY (item_id)
);

COMMENT ON TABLE public.psi_occurred_at_backfill_log IS
  'One row per practice_session_items row repaired by migration 20260816000000. The only record of which rows the backfill touched — post-state cannot re-derive the set, because a repaired row is indistinguishable from one that always had occurred_at = answered_at.';

-- Same posture as mastery_derivation_gap_ledger and mastery_event_audit_log:
-- RLS on with no policy (deny-all to anon/authenticated; service_role bypasses),
-- revoked from PUBLIC, service_role-only grants. genesis requires RLS on every
-- public table (genesis-fresh-apply gate A.4). LYCEON-MIGRATION-REVIEWED
ALTER TABLE public.psi_occurred_at_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.psi_occurred_at_backfill_log FROM PUBLIC;
GRANT SELECT, INSERT ON public.psi_occurred_at_backfill_log TO service_role;

-- ---------------------------------------------------------------------------
-- (1) Repair, and log exactly what it repaired — ONE statement.
--
--     A data-modifying CTE, not an UPDATE followed by a separate INSERT: the
--     RETURNING set IS the log source, so the log and the mutation cannot
--     diverge even in principle. A separate INSERT could drift if the predicate
--     were edited in one place and not the other.
--
--     Scoped so the unresolved rows ('pending' / 'served') are outside the
--     predicate entirely — their NULL occurred_at is correct and must not be
--     touched. 1.1-post-apply.sql asserts that count is unchanged; it is the
--     negative control for this statement.
-- ---------------------------------------------------------------------------
WITH repaired AS (
  UPDATE public.practice_session_items
     SET occurred_at = answered_at
   WHERE status IN ('answered', 'skipped')
     AND occurred_at IS NULL
     AND answered_at IS NOT NULL
  RETURNING id, answered_at
)
INSERT INTO public.psi_occurred_at_backfill_log
  (item_id, occurred_at_applied, applied_at, migration_version)
SELECT r.id, r.answered_at, now(), '20260816000000'
FROM repaired r;

-- ---------------------------------------------------------------------------
-- (2) Seal. A resolved item is a mastery event; an event without an occurrence
--     time is not representable. Mirrors the existing column-level discipline
--     on question_section (practice_session_items_question_section_check).
-- ---------------------------------------------------------------------------
ALTER TABLE public.practice_session_items
  ADD CONSTRAINT psi_resolved_requires_occurred_at
  CHECK (status NOT IN ('answered', 'skipped') OR occurred_at IS NOT NULL);

COMMIT;
