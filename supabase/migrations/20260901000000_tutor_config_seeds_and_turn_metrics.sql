-- ──────────────────────────────────────────────────────────────────────
-- Production defects: config seed rows + tutor observability tables
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec  [Doc-03A_V1 §11.3, §11.5; CR-03C-V3-01 §3.4; Doc-03D §8.1;
--         Doc 03C V3 §5.2, §30.1]
-- @implemented [2026-09-02]
--
-- Rollback:
--   DELETE FROM public.tutor_context_runtime_config
--     WHERE key IN (
--       'crisis_classifier_model_alias', 'crisis_retry_count',
--       'model_armor_input_template_id', 'model_armor_output_template_id',
--       'vertex.model.flash_class_alias', 'vertex.model.pro_class_alias'
--     );
--   DROP TABLE IF EXISTS public.tutor_turn_metrics;
--   DROP TABLE IF EXISTS public.tutor_context_resolution_log;
--
-- Part 1: Seeds 6 config keys into tutor_context_runtime_config (crisis
--   classifier alias, retry count, Model Armor template IDs, and the two
--   spec-mandated vertex model alias keys from Doc 03C V3 §5.2/§30.1).
--   ON CONFLICT DO NOTHING — safe to reapply.
--
-- Part 2: CREATE TABLE tutor_turn_metrics — operational telemetry for every
--   tutor turn (Doc 03A §11.5). Includes crisis_classifier_outcome for Cloud
--   Monitoring log-based metric alerting (CR-03C-V3-01 §3.4), and prompt_version
--   + context_hash for prompt-version tracing (Doc 03D §8.1).
--
-- Part 3: CREATE TABLE tutor_context_resolution_log — records what context was
--   assembled for each turn (Doc 03A §11.3).
--
-- NO tutor_policy_decisions — ruled dead in WS-L9 (0 write call sites, no spec
-- reference, logPolicyDecision function does not exist).
--
-- RLS: enabled on both tables. These are service-internal audit/observability
-- tables — no anon/authenticated access. service_role gets full access per
-- established tutor-table pattern.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- ──────────────────────────────────────────────────────────────────────

-- =====================================================================
-- PART 1: Config seed rows
-- =====================================================================

-- Crisis classifier model alias (CR-03C-V3-01 §3.2)
-- The value "classifier_class" is the alias name that the vertex client
-- resolves to a Flash-Lite-class provider model string.
INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('crisis_classifier_model_alias', '"classifier_class"', 'string', 'engineering',
   'CR-03C-V3-01 §3.2: crisis classifier model alias — resolves to Flash-Lite-class provider string')
ON CONFLICT (key) DO NOTHING;

-- Crisis retry count (Doc 03 §21.1)
INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('crisis_retry_count', '1', 'integer', 'engineering',
   'Doc 03 §21.1: crisis classifier retry count on Layer 2 failure')
ON CONFLICT (key) DO NOTHING;

-- Model Armor template IDs (Doc 03B §12B.8)
-- Values are the Terraform-provisioned template names from model-armor.tf.
INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('model_armor_input_template_id', '"lyceon-lisa-input-v1"', 'string', 'engineering',
   'Doc 03B §12B.8: Model Armor input scanning template ID (Terraform: lyceon-lisa-input-v1)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('model_armor_output_template_id', '"lyceon-lisa-output-v1"', 'string', 'engineering',
   'Doc 03B §12B.8: Model Armor output scanning template ID (Terraform: lyceon-lisa-output-v1)')
ON CONFLICT (key) DO NOTHING;

-- Spec-mandated model alias keys (Doc 03C V3 §5.2, §30.1)
-- These are read by the Cloud Run worker via env vars with hardcoded
-- fallbacks, so the worker path is NOT broken. Seeding them here so
-- any future runtime-config-based resolution also works.
INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('vertex.model.flash_class_alias', '"gemini-2.5-flash"', 'string', 'engineering',
   'Doc 03C §5.2/§30.1: flash_class alias → provider model string')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.tutor_context_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('vertex.model.pro_class_alias', '"gemini-2.5-pro"', 'string', 'engineering',
   'Doc 03C §5.2/§30.1: pro_class alias → provider model string')
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- PART 2: tutor_turn_metrics table (Doc 03A §11.5)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.tutor_turn_metrics (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL
                              REFERENCES public.tutor_conversations(id)
                              ON DELETE CASCADE,
  turn_ordinal                INTEGER NOT NULL,
  orchestration_duration_ms   INTEGER NOT NULL,
  model_name                  TEXT NOT NULL,
  tokens_in                   INTEGER NOT NULL DEFAULT 0,
  tokens_out                  INTEGER NOT NULL DEFAULT 0,
  cache_hit                   BOOLEAN NOT NULL DEFAULT false,
  compaction_recommended      BOOLEAN NOT NULL DEFAULT false,
  anti_leak_triggered         BOOLEAN NOT NULL DEFAULT false,
  injection_detected          BOOLEAN NOT NULL DEFAULT false,
  crisis_triggered            BOOLEAN NOT NULL DEFAULT false,
  crisis_classifier_outcome   TEXT,
  -- Doc 03D §8.1: required for attribution (nullable until call sites updated)
  prompt_version              TEXT,
  context_hash                TEXT,
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for per-conversation lookups and Cloud Monitoring queries
CREATE INDEX IF NOT EXISTS idx_tutor_turn_metrics_conversation
  ON public.tutor_turn_metrics (conversation_id, turn_ordinal);

-- Index for Cloud Monitoring log-based metric on crisis_classifier_outcome
CREATE INDEX IF NOT EXISTS idx_tutor_turn_metrics_crisis_outcome
  ON public.tutor_turn_metrics (crisis_classifier_outcome)
  WHERE crisis_classifier_outcome IS NOT NULL;

-- RLS: service-role only (no student/guardian access to telemetry)
ALTER TABLE public.tutor_turn_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_turn_metrics_service_role ON public.tutor_turn_metrics
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE public.tutor_turn_metrics IS
  'Doc 03A §11.5: per-turn operational telemetry. Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';


-- =====================================================================
-- PART 3: tutor_context_resolution_log (Doc 03A §11.3)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.tutor_context_resolution_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL
                              REFERENCES public.tutor_conversations(id)
                              ON DELETE CASCADE,
  turn_ordinal                INTEGER NOT NULL,
  context_version             TEXT,
  memory_summaries_count      INTEGER NOT NULL DEFAULT 0,
  recent_messages_count       INTEGER NOT NULL DEFAULT 0,
  mastery_snapshot_present    BOOLEAN NOT NULL DEFAULT false,
  friction_signals_present    BOOLEAN NOT NULL DEFAULT false,
  scope_type                  TEXT,
  resolved_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_context_resolution_log_conversation
  ON public.tutor_context_resolution_log (conversation_id, turn_ordinal);

ALTER TABLE public.tutor_context_resolution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_context_resolution_log_service_role ON public.tutor_context_resolution_log
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE public.tutor_context_resolution_log IS
  'Doc 03A §11.3: per-turn context assembly audit. Records what context was assembled (version, counts, flags). Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';
