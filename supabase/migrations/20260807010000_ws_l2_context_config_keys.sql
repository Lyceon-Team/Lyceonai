-- ============================================================================
-- WS-L2 — Context pipeline config keys (Doc 03A §7.4 freshness thresholds)
-- ============================================================================
-- @spec [Doc-03A_V3.2 §7.4 (freshness thresholds)] | @implemented [2026-08-07]
-- plain English: seeds tutor_context_runtime_config with the freshness threshold
--   keys specified by §7.4. These control how Layer 3 memory retrieval decides
--   whether a summary is stale and needs refresh. Values are in days.
--   Also adds friction-signal and observation config keys for Layer 4 / L2.3.
--
-- OWNER-RUN: config-only (tutor_context_runtime_config inserts, no schema change).
-- ROLLBACK (INV-06): transactional. Revert =
--   DELETE FROM tutor_context_runtime_config WHERE key IN (
--     'teaching_profile_freshness_days',
--     'recent_learning_pattern_freshness_days',
--     'study_context_freshness_days',
--     'friction_long_pause_seconds',
--     'observation_promotion_threshold'
--   );
--   INSERT-only; no forward-data destruction. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- §7.4 freshness thresholds — teaching_profile refresh cadence
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('teaching_profile_freshness_days', '14', 'integer', 'product',
   'Doc 03A §7.4: teaching_profile refresh cadence in days. Summaries older than this are flagged stale.')
ON CONFLICT (key) DO NOTHING;

-- §7.4 freshness thresholds — recent_learning_pattern refresh cadence
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('recent_learning_pattern_freshness_days', '7', 'integer', 'product',
   'Doc 03A §7.4: recent_learning_pattern refresh cadence in days.')
ON CONFLICT (key) DO NOTHING;

-- §7.4 freshness thresholds — study_context refresh cadence
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('study_context_freshness_days', '3', 'integer', 'product',
   'Doc 03A §7.4: study_context refresh cadence in days. Shortened to 1 when scheduled_exam_date within 14 days.')
ON CONFLICT (key) DO NOTHING;

-- §5.4.1 friction signal — long pause threshold in seconds
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('friction_long_pause_seconds', '120', 'integer', 'product',
   'Doc 03A §5.4.1: gap between consecutive student messages (seconds) to flag long_pause_detected.')
ON CONFLICT (key) DO NOTHING;

-- L2.3 learner observation — minimum observations before promoting a preferred style
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('observation_promotion_threshold', '5', 'integer', 'product',
   'SCL-026: minimum total_style_observations before deriving a preferred_explanation_style. Karl ruling: 5.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
