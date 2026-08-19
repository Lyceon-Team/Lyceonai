-- @spec [CR-03C-V3-01 §3.4, Doc-03A_V1 §11.5]
-- @implemented 2026-08-19
-- LYCEON-MIGRATION-REVIEWED
--
-- plain English: adds crisis_classifier_outcome column to tutor_turn_metrics.
-- This column captures the structured classifier outcome string on every turn
-- for Cloud Monitoring log-based metric alerting (SCL-023 §3.4).
--
-- Values: 'no_crisis', 'crisis_signature', 'crisis_model', 'crisis_both',
-- 'classifier_degraded_no_floor', 'infrastructure_failure',
-- 'classifier_degraded' (Layer 2 failed, Layer 1 stands).
--
-- trade-offs: nullable TEXT rather than an ENUM — new source values can be
-- added without a migration. The logTurnMetrics function is fire-and-forget,
-- so if this migration is not yet applied the insert simply fails silently
-- (the existing columns still write) and the turn proceeds unblocked.
--
-- rollback: ALTER TABLE tutor_turn_metrics DROP COLUMN IF EXISTS crisis_classifier_outcome;

ALTER TABLE tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS crisis_classifier_outcome TEXT;

COMMENT ON COLUMN tutor_turn_metrics.crisis_classifier_outcome IS
  'Structured classifier outcome for SCL-023 Cloud Monitoring alerting. Nullable TEXT; values match CrisisResult.source plus no_crisis and classifier_degraded.';
