-- LYCEON-MIGRATION-REVIEWED
-- @spec [CR-03C-V3-01 §3.4]
-- @implemented 2026-08-20
--
-- plain English: Adds crisis_classifier_outcome TEXT column to
-- tutor_turn_metrics for per-turn crisis classifier outcome tracking.
-- Used by Cloud Monitoring log-based metric alerting to detect
-- classifier degradation (Vertex AI availability issues).
--
-- The tutor_turn_metrics table may live on a different branch.
-- Wrapped in DO $$ ... IF EXISTS to be safe on branches where the
-- table hasn't landed yet. The ALTER is idempotent (IF NOT EXISTS
-- on the column check).
--
-- Values: "no_crisis", "crisis_signature", "crisis_model", "crisis_both",
--         "classifier_degraded_no_floor", "infrastructure_failure",
--         "classifier_degraded", or NULL (pre-pipeline exit).
--
-- Rollback:
-- DO $$ BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_schema = 'public'
--       AND table_name = 'tutor_turn_metrics'
--       AND column_name = 'crisis_classifier_outcome'
--   ) THEN
--     ALTER TABLE public.tutor_turn_metrics
--       DROP COLUMN crisis_classifier_outcome;
--   END IF;
-- END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tutor_turn_metrics'
  ) THEN
    -- Only add if column doesn't already exist (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tutor_turn_metrics'
        AND column_name = 'crisis_classifier_outcome'
    ) THEN
      ALTER TABLE public.tutor_turn_metrics
        ADD COLUMN crisis_classifier_outcome TEXT;
    END IF;
  END IF;
END $$;
