-- ──────────────────────────────────────────────────────────────────────
-- Production defects: config seed rows + tutor_turn_metrics table
-- LYCEON-MIGRATION-REVIEWED
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
--   DROP TABLE IF EXISTS public.tutor_policy_decisions;
--
-- Defect 1: Model alias config keys are not in production.
--   tutor_context_runtime_config has ZERO rows for model alias, classifier,
--   crisis retry, or Model Armor template keys. The classifier reads
--   "crisis_classifier_model_alias" and gets PGRST116 (0 rows). Layer 2
--   cannot run → every turn falls to the degraded crisis path.
--
--   Seeds the 4 missing keys from the tutor-config.ts registry that have
--   no migration. Also seeds the 2 spec-mandated alias keys from
--   Doc 03C V3 §5.2 / §30.1 (flash_class, pro_class).
--
-- Defect 4: tutor_turn_metrics table does not exist.
--   Code writes to it at 11 call sites (non-blocking), all producing
--   PGRST205. Doc 03D §8.1 requires prompt_version and context_hash on
--   every turn for attribution — nothing is being recorded.
--
--   Creates the table with the 13 columns logTurnMetrics() expects, plus
--   prompt_version and context_hash for Doc 03D §8.1 compliance (nullable
--   until the call sites are updated to pass them).
--
-- Also creates tutor_policy_decisions and tutor_context_resolution_log
-- (the two sibling audit tables referenced by tutor-policy-logger.ts
-- that are equally missing).
--
-- @spec [Doc 03C V3 §5.2, §30.1; Doc 03D §8.1; CR-03C-V3-01 §3.2]
-- ──────────────────────────────────────────────────────────────────────

-- =====================================================================
-- PART 1: Config seed rows (Defect 1)
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
-- PART 2: tutor_turn_metrics table (Defect 4)
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


-- =====================================================================
-- PART 3: Sibling audit tables (also missing, same logger)
-- =====================================================================

-- tutor_context_resolution_log (Doc 03A V1 §11.3)
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


-- tutor_policy_decisions (Doc 03A V1 §11.4)
CREATE TABLE IF NOT EXISTS public.tutor_policy_decisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL
                              REFERENCES public.tutor_conversations(id)
                              ON DELETE CASCADE,
  turn_ordinal                INTEGER NOT NULL,
  policy_name                 TEXT NOT NULL,
  decision                    TEXT NOT NULL,
  reason                      TEXT,
  decided_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_policy_decisions_conversation
  ON public.tutor_policy_decisions (conversation_id, turn_ordinal);

ALTER TABLE public.tutor_policy_decisions ENABLE ROW LEVEL SECURITY;
