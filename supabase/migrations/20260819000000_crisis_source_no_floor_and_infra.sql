-- ============================================================================
-- B1.5: Widen crisis_review_cases.source CHECK to accept new fail-closed sources
-- @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21.2, B1.5]
-- @implemented 2026-08-19
--
-- plain English: When Layer 2 (model classifier) fails AND Layer 1 has zero
-- crisis signatures (classifier_degraded_no_floor), or when the entire
-- classifier pipeline throws an unexpected error (infrastructure_failure),
-- the system now fails closed — returning a crisis-safe response instead of
-- proceeding to normal tutoring. Both cases create a crisis_review_cases row.
-- This migration widens the CHECK constraint to accept the new source values.
--
-- expected outcome: INSERT with source = 'classifier_degraded_no_floor' or
-- source = 'infrastructure_failure' succeeds. All existing rows and queries
-- remain unchanged.
--
-- trade-offs: ALTER TABLE + DROP/ADD CHECK is a brief ACCESS EXCLUSIVE lock
-- on crisis_review_cases. At current data volumes (single-digit rows), this
-- is negligible.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

-- Widen the source CHECK constraint.
-- Dropping by name requires the name; the original migration did not name it,
-- so PostgreSQL auto-generated a name. We drop all CHECKs on source and re-add.
ALTER TABLE public.crisis_review_cases
  DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check;

-- If the auto-generated name differs, also try the common pattern:
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.crisis_review_cases'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.crisis_review_cases DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.crisis_review_cases
  ADD CONSTRAINT crisis_review_cases_source_check
  CHECK (source IN (
    'signature',
    'model',
    'both',
    'classifier_degraded',
    'classifier_degraded_no_floor',
    'infrastructure_failure'
  ));

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.crisis_review_cases
--   DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check;
-- ALTER TABLE public.crisis_review_cases
--   ADD CONSTRAINT crisis_review_cases_source_check
--   CHECK (source IN ('signature', 'model', 'both', 'classifier_degraded'));
-- COMMIT;
