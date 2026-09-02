-- ============================================================================
-- WS-T1: Config seeds + tutor observability tables (turn metrics & context log)
-- ============================================================================
-- @spec  [Doc-03A_V1 §11.3, §11.5; CR-03C-V3-01 §3.4; Doc-03D §8.1]
-- @implemented [2026-09-02]
--
-- Part 1: Seeds 4 config keys into tutor_context_runtime_config that the tutor
--   runtime requires at boot (crisis classifier alias, retry count, Model Armor
--   template IDs). ON CONFLICT DO NOTHING — safe to reapply.
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
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback — DROP TABLE IF EXISTS for both.
-- ============================================================================

BEGIN;

-- ============================================================================
-- Part 1: Config seeds
-- ============================================================================

-- Crisis classifier model alias — the key that classifyCrisis queries to
-- resolve which Vertex AI model to call. Default: "classifier_class".
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('crisis_classifier_model_alias', '"classifier_class"', 'string', 'engineering',
   'CR-03C-V3-01 §3.2: alias that classifyCrisis passes to invokeClassifier. Resolves to a Vertex AI model via env var.')
ON CONFLICT (key) DO NOTHING;

-- Crisis retry count — how many times classifyCrisis retries on transient failure.
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('crisis_retry_count', '1', 'integer', 'engineering',
   'CR-03C-V3-01 §3.2: number of retries for crisis classifier invocation on transient failure.')
ON CONFLICT (key) DO NOTHING;

-- Model Armor input template ID — Vertex AI Model Armor sanitization template
-- applied to inbound student messages.
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('model_armor_input_template_id', '"lyceon-lisa-input-v1"', 'string', 'engineering',
   'Doc 03A §14: Model Armor template ID for sanitizing inbound student messages.')
ON CONFLICT (key) DO NOTHING;

-- Model Armor output template ID — Vertex AI Model Armor sanitization template
-- applied to outbound tutor responses.
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES
  ('model_armor_output_template_id', '"lyceon-lisa-output-v1"', 'string', 'engineering',
   'Doc 03A §14: Model Armor template ID for sanitizing outbound tutor responses.')
ON CONFLICT (key) DO NOTHING;


-- ============================================================================
-- Part 2: tutor_turn_metrics — per-turn operational telemetry
-- @spec [Doc-03A_V1 §11.5, CR-03C-V3-01 §3.4, Doc-03D §8.1]
-- ============================================================================

CREATE TABLE public.tutor_turn_metrics (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE RESTRICT,
  turn_ordinal                INTEGER NOT NULL,
  orchestration_duration_ms   INTEGER NOT NULL,
  model_name                  TEXT NOT NULL,
  tokens_in                   INTEGER NOT NULL,
  tokens_out                  INTEGER NOT NULL,
  cache_hit                   BOOLEAN NOT NULL DEFAULT false,
  compaction_recommended      BOOLEAN NOT NULL DEFAULT false,
  anti_leak_triggered         BOOLEAN NOT NULL DEFAULT false,
  injection_detected          BOOLEAN NOT NULL DEFAULT false,
  crisis_triggered            BOOLEAN NOT NULL DEFAULT false,
  -- CR-03C-V3-01 §3.4: structured crisis classifier outcome for Cloud Monitoring
  -- log-based metric alerting. Nullable TEXT (not ENUM) — new values without migration.
  crisis_classifier_outcome   TEXT,
  -- Doc 03D §8.1: prompt version and context hash for prompt-version tracing.
  prompt_version              TEXT,
  context_hash                TEXT,
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying metrics by conversation
CREATE INDEX idx_tutor_turn_metrics_conversation
  ON public.tutor_turn_metrics (conversation_id, turn_ordinal);

ALTER TABLE public.tutor_turn_metrics ENABLE ROW LEVEL SECURITY;

-- Service-internal only — no anon/authenticated access
CREATE POLICY tutor_turn_metrics_service_role ON public.tutor_turn_metrics
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE public.tutor_turn_metrics IS
  'Doc 03A §11.5: per-turn operational telemetry. Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';


-- ============================================================================
-- Part 3: tutor_context_resolution_log — per-turn context assembly audit
-- @spec [Doc-03A_V1 §11.3]
-- ============================================================================

CREATE TABLE public.tutor_context_resolution_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE RESTRICT,
  turn_ordinal                INTEGER NOT NULL,
  context_version             TEXT NOT NULL,
  memory_summaries_count      INTEGER NOT NULL DEFAULT 0,
  recent_messages_count       INTEGER NOT NULL DEFAULT 0,
  mastery_snapshot_present    BOOLEAN NOT NULL DEFAULT false,
  friction_signals_present    BOOLEAN NOT NULL DEFAULT false,
  scope_type                  TEXT NOT NULL,
  resolved_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying context logs by conversation
CREATE INDEX idx_tutor_context_resolution_log_conversation
  ON public.tutor_context_resolution_log (conversation_id, turn_ordinal);

ALTER TABLE public.tutor_context_resolution_log ENABLE ROW LEVEL SECURITY;

-- Service-internal only — no anon/authenticated access
CREATE POLICY tutor_context_resolution_log_service_role ON public.tutor_context_resolution_log
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE public.tutor_context_resolution_log IS
  'Doc 03A §11.3: per-turn context assembly audit. Records what context was assembled (version, counts, flags). Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';

COMMIT;
