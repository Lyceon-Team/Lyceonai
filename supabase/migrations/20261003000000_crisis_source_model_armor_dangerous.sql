-- ============================================================================
-- W3-5: Widen crisis_review_cases.source CHECK to accept 'model_armor_dangerous'
-- @spec [closure plan W3-5; owner ruling 2026-09-24; SCL-142 (PROPOSED)]
-- @implemented 2026-09-24
--
-- plain English: when Model Armor's INPUT scan blocks a student message and
-- the matched filters include `dangerous`, the BFF opens a crisis review case
-- so a human sees it within SLA — the classifier may have missed a crisis
-- that Model Armor's broader, non-clinical filter caught. The student still
-- sees the neutral block copy, not the crisis template. This migration adds
-- the case source that names that signal.
--
-- expected outcome: INSERT with source = 'model_armor_dangerous' succeeds.
-- Existing rows and the six existing values are unchanged.
-- `crisis_source_fallback` is NOT extended: the new value has no coarser
-- equivalent (it is not a classifier signal), so on a database without this
-- migration the insert's CHECK violation propagates. The BFF catches that,
-- logs ERROR `model_armor_crisis_flag_failed`, and still delivers the block
-- copy. APPLY THIS BEFORE DEPLOYING THE W3-5 CODE.
--
-- trade-offs: DROP/ADD CHECK takes a brief ACCESS EXCLUSIVE lock on
-- crisis_review_cases; at current volume (single-digit rows) negligible.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

ALTER TABLE public.crisis_review_cases
  DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check;

ALTER TABLE public.crisis_review_cases
  ADD CONSTRAINT crisis_review_cases_source_check
  CHECK (source IN (
    'signature',
    'model',
    'both',
    'classifier_degraded',
    'classifier_degraded_no_floor',
    'infrastructure_failure',
    'model_armor_dangerous'
  ));

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed. Fails if any row
-- already holds 'model_armor_dangerous' — resolve or re-source those cases
-- first; they are review records and must not be deleted to roll back.
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.crisis_review_cases
--   DROP CONSTRAINT IF EXISTS crisis_review_cases_source_check;
-- ALTER TABLE public.crisis_review_cases
--   ADD CONSTRAINT crisis_review_cases_source_check
--   CHECK (source IN ('signature', 'model', 'both', 'classifier_degraded',
--                     'classifier_degraded_no_floor', 'infrastructure_failure'));
-- COMMIT;
