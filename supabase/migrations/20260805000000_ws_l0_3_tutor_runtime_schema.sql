-- ============================================================================
-- WS-L0.3: LISA Tutor Runtime Schema — 9 new tables + seeds into 1 existing
-- ============================================================================
-- @spec  [Doc-03A_V3.0, §17–§18, §6.4, Appendix B]
-- @implemented [2026-08-05]
--
-- Creates 9 tutor tables per Doc 03A V3.0 §17 and seeds Layer-2/memory keys
-- into the pre-existing tutor_context_runtime_config (from WS2):
--   6 runtime tables:  tutor_conversations, tutor_messages,
--                      tutor_memory_summaries, tutor_instruction_assignments,
--                      tutor_question_links, tutor_instruction_exposures
--   2 config/obs tables: tutor_injection_signatures, tutor_injection_log
--   1 config table:      tutor_prompt_chips (§6.4 V1 chips)
--   + INSERT 4 keys into tutor_context_runtime_config (owned by WS2 migration)
--
-- RLS enabled on every student-scoped table with student_id-bound SELECT
-- policies per INV-03-14. service_role gets full access per existing prod
-- pattern; §17.4 dedicated roles (tutor_runtime_writer, tutor_memory_writer,
-- tutor_archival_writer, tutor_injection_writer, tutor_context_reader) are a
-- SEPARATE launch-blocking migration — NOT created here.
--
-- Type adaptation TA-1: source_question_row_id is TEXT (not UUID) because
-- questions.id is TEXT (SAT canonical ID format). The spec §18 DDL shows
-- UUID; the actual questions table uses TEXT PK. FK type must match target.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Utility: update_updated_at_column()
--    Defined in database/migrations/0001_core_schema.sql (legacy path) but
--    NOT in the supabase/migrations/ pipeline. CREATE OR REPLACE is idempotent
--    — a no-op in prod where it already exists, and creates it in CI's fresh
--    PostgreSQL context (genesis-fresh-apply).
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 1. tutor_conversations — conversation envelopes with scope metadata
--    @spec [Doc-03A_V3.0, §18.1]
-- ============================================================================

CREATE TABLE public.tutor_conversations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Entry metadata (immutable after creation)
  entry_mode                  TEXT NOT NULL CHECK (entry_mode IN ('scoped_question', 'scoped_session', 'general')),
  source_surface              TEXT NOT NULL CHECK (source_surface IN ('practice', 'review', 'test_review', 'dashboard')),
  source_session_id           UUID,
  source_session_item_id      UUID,
  source_question_row_id      TEXT REFERENCES public.questions(id) ON DELETE SET NULL, -- TA-1: TEXT to match questions.id
  source_question_canonical_id TEXT,

  -- Default/initialized policy state
  policy_family               TEXT NOT NULL DEFAULT 'instructional_tutor',
  policy_variant              TEXT NOT NULL DEFAULT 'scaffolded'
    CHECK (policy_variant IN ('concise', 'scaffolded', 'socratic', 'strategy_first')),
  policy_version              TEXT NOT NULL DEFAULT '1.0',
  prompt_version              TEXT,
  assignment_mode             TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (assignment_mode IN ('deterministic', 'explore', 'manual_override')),
  assignment_key              TEXT,
  initialization_snapshot     JSONB,

  -- Status
  status                      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'abandoned')),
  crisis_flagged              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Soft-delete and retention
  deleted_at                  TIMESTAMPTZ,
  entitlement_lost_at         TIMESTAMPTZ,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                   TIMESTAMPTZ
);

-- Conversation reuse envelope lookup (NOT unique — multiple active conversations
-- per envelope are allowed; API layer picks most-recently-updated matching one
-- per Doc 03B reuse rules, consistent with original runtime contract semantic
-- of "reuse preferred" rather than "uniqueness enforced")
-- @spec [Doc-03A_V3.0, §18.1, CR-03A-17]
CREATE INDEX idx_tutor_conversations_reuse_envelope
  ON public.tutor_conversations (student_id, source_surface, entry_mode,
                                 source_session_id, source_question_row_id, status, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX idx_tutor_conversations_student_status
  ON public.tutor_conversations (student_id, status, updated_at DESC);

CREATE INDEX idx_tutor_conversations_crisis
  ON public.tutor_conversations (crisis_flagged, created_at DESC)
  WHERE crisis_flagged = TRUE;

CREATE INDEX idx_tutor_conversations_deletion_window
  ON public.tutor_conversations (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_conversations_select_own ON public.tutor_conversations
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY tutor_conversations_insert_own ON public.tutor_conversations
  FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY tutor_conversations_update_own ON public.tutor_conversations
  FOR UPDATE USING (student_id = auth.uid());

-- Service role full access for orchestrator writes
-- §17.4 NOTE: production must narrow to tutor_runtime_writer + tutor_archival_writer
CREATE POLICY tutor_conversations_service_role ON public.tutor_conversations
  FOR ALL TO service_role USING (true);

-- Trigger: updated_at (reuses existing function from genesis schema)
CREATE TRIGGER tutor_conversations_updated_at
  BEFORE UPDATE ON public.tutor_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- 2. tutor_messages — line-by-line conversation history
--    @spec [Doc-03A_V3.0, §18.2]
-- ============================================================================

CREATE TABLE public.tutor_messages (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Message content
  role                        TEXT NOT NULL CHECK (role IN ('student', 'tutor', 'system')),
  content_kind                TEXT NOT NULL DEFAULT 'message'
    CHECK (content_kind IN ('message', 'suggestion', 'consent_prompt', 'system_note')),
  message                     TEXT NOT NULL,
  content_json                JSONB,
  explanation_level           TEXT,

  -- Optional turn-level scope linkage (may differ from conversation-level if student navigates)
  source_session_id           UUID,
  source_session_item_id      UUID,
  source_question_row_id      TEXT REFERENCES public.questions(id) ON DELETE SET NULL, -- TA-1
  source_question_canonical_id TEXT,

  -- Client idempotency
  client_turn_id              UUID,

  -- Injection defense metadata
  injection_flag              BOOLEAN NOT NULL DEFAULT FALSE,
  injection_signature_matched TEXT,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tutor_messages_client_turn_unique
    UNIQUE (conversation_id, client_turn_id)
    -- idempotency enforcement per Doc 03B §8.4
);

CREATE INDEX idx_tutor_messages_conversation
  ON public.tutor_messages (conversation_id, created_at ASC);

CREATE INDEX idx_tutor_messages_student_recent
  ON public.tutor_messages (student_id, created_at DESC);

CREATE INDEX idx_tutor_messages_injection
  ON public.tutor_messages (injection_flag, created_at DESC)
  WHERE injection_flag = TRUE;

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_messages_select_own ON public.tutor_messages
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY tutor_messages_insert_own ON public.tutor_messages
  FOR INSERT WITH CHECK (student_id = auth.uid());

-- No UPDATE/DELETE for student (append-only from student perspective)
CREATE POLICY tutor_messages_service_role ON public.tutor_messages
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 3. tutor_memory_summaries — durable compact summaries (with V1 structured
--    fields in teaching_profile)
--    @spec [Doc-03A_V3.0, §18.3, §10, Appendix A]
-- ============================================================================

CREATE TABLE public.tutor_memory_summaries (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Summary type and versioning
  summary_type                TEXT NOT NULL CHECK (summary_type IN (
    'teaching_profile',
    'chat_compaction',
    'recent_learning_pattern',
    'study_context'
  )),
  summary_version             TEXT NOT NULL DEFAULT '1.0',

  -- Content (schema-validated per §10 based on summary_type)
  content_json                JSONB NOT NULL,

  -- Source window
  source_window_start         TIMESTAMPTZ,
  source_window_end           TIMESTAMPTZ,

  -- Freshness tracking
  last_refreshed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_trigger             TEXT,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One current summary per student per type; history via soft-versioning in content_json
  CONSTRAINT tutor_memory_summaries_current_unique
    UNIQUE (student_id, summary_type)
);

CREATE INDEX idx_tutor_memory_summaries_student_type
  ON public.tutor_memory_summaries (student_id, summary_type);

CREATE INDEX idx_tutor_memory_summaries_staleness
  ON public.tutor_memory_summaries (last_refreshed_at);

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_memory_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_memory_summaries_select_own ON public.tutor_memory_summaries
  FOR SELECT USING (student_id = auth.uid());

-- No student INSERT/UPDATE/DELETE — memory is written by trusted code only (§7.6 Layer A)
-- §17.4 NOTE: production must narrow to tutor_memory_writer
CREATE POLICY tutor_memory_summaries_service_role ON public.tutor_memory_summaries
  FOR ALL TO service_role USING (true);

-- Trigger: updated_at
CREATE TRIGGER tutor_memory_summaries_updated_at
  BEFORE UPDATE ON public.tutor_memory_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- 3a. Schema validation trigger for tutor_memory_summaries
--     @spec [Doc-03A_V3.0, §10.5, Appendix B]
--     Structural invariants only — semantic correctness is the writer's
--     responsibility per §9.2 SQL-vs-code boundary rule.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_memory_summary_schema()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_content JSONB := NEW.content_json;
  v_type    TEXT  := NEW.summary_type;
  v_version TEXT;
BEGIN
  -- Every summary must have summary_version
  IF NOT (v_content ? 'summary_version') THEN
    RAISE EXCEPTION 'Memory summary missing summary_version';
  END IF;

  v_version := v_content->>'summary_version';

  IF v_version != '1.0' THEN
    RAISE EXCEPTION 'Unsupported summary_version: %', v_version;
  END IF;

  -- Per-type validation
  IF v_type = 'teaching_profile' THEN
    IF NOT (v_content ? 'learning_style_signals'
      AND v_content ? 'last_struggled_skill'
      AND v_content ? 'last_mastered_skill'
      AND v_content ? 'engagement_summary') THEN
      RAISE EXCEPTION 'teaching_profile missing required fields';
    END IF;

  ELSIF v_type = 'chat_compaction' THEN
    IF NOT (v_content ? 'conversation_id'
      AND v_content ? 'source_window_start'
      AND v_content ? 'source_window_end'
      AND v_content ? 'turns_compacted'
      AND v_content ? 'topics_discussed'
      AND v_content ? 'skills_referenced'
      AND v_content ? 'key_insights'
      AND v_content ? 'unresolved_confusion') THEN
      RAISE EXCEPTION 'chat_compaction missing required fields';
    END IF;

    -- Bounds check
    IF jsonb_array_length(v_content->'key_insights') > 5 THEN
      RAISE EXCEPTION 'chat_compaction key_insights exceeds 5 entries';
    END IF;
    IF jsonb_array_length(v_content->'unresolved_confusion') > 5 THEN
      RAISE EXCEPTION 'chat_compaction unresolved_confusion exceeds 5 entries';
    END IF;
    IF jsonb_array_length(v_content->'topics_discussed') > 10 THEN
      RAISE EXCEPTION 'chat_compaction topics_discussed exceeds 10 entries';
    END IF;

  ELSIF v_type = 'recent_learning_pattern' THEN
    IF NOT (v_content ? 'window_days'
      AND v_content ? 'sections_active'
      AND v_content ? 'skills_improved'
      AND v_content ? 'skills_regressed'
      AND v_content ? 'skills_stuck'
      AND v_content ? 'attempts_total'
      AND v_content ? 'pass_rate') THEN
      RAISE EXCEPTION 'recent_learning_pattern missing required fields';
    END IF;

  ELSIF v_type = 'study_context' THEN
    IF NOT (v_content ? 'current_focus_skills'
      AND v_content ? 'upcoming_scheduled_sessions') THEN
      RAISE EXCEPTION 'study_context missing required fields';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown summary_type: %', v_type;
  END IF;

  -- Size bound (10KB max)
  IF pg_column_size(v_content) > 10240 THEN
    RAISE EXCEPTION 'Memory summary exceeds 10KB size bound';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.validate_memory_summary_schema() FROM PUBLIC;

CREATE TRIGGER tutor_memory_summaries_validate_schema
  BEFORE INSERT OR UPDATE ON public.tutor_memory_summaries
  FOR EACH ROW EXECUTE FUNCTION public.validate_memory_summary_schema();


-- ============================================================================
-- 4. tutor_instruction_assignments — policy decision log
--    @spec [Doc-03A_V3.0, §18.4, §11]
-- ============================================================================

CREATE TABLE public.tutor_instruction_assignments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  related_message_id          UUID REFERENCES public.tutor_messages(id) ON DELETE SET NULL,

  -- Scope linkage at assignment time
  source_session_id           UUID,
  source_session_item_id      UUID,
  source_question_row_id      TEXT, -- TA-1: TEXT to match questions.id (no FK per §18.4 — link may outlive question)
  source_question_canonical_id TEXT,

  -- Policy decision
  policy_family               TEXT NOT NULL DEFAULT 'instructional_tutor',
  policy_variant              TEXT NOT NULL
    CHECK (policy_variant IN ('concise', 'scaffolded', 'socratic', 'strategy_first')),
  policy_version              TEXT NOT NULL,
  prompt_version              TEXT,
  assignment_mode             TEXT NOT NULL
    CHECK (assignment_mode IN ('deterministic', 'explore', 'manual_override')),
  assignment_key              TEXT,

  -- Emotional register (per Doc 03 Main §4.11)
  emotional_register          TEXT NOT NULL DEFAULT 'default'
    CHECK (emotional_register IN ('default', 'elite', 'recovery', 'sprint', 'calm')),

  -- Decision audit
  reason_snapshot             JSONB NOT NULL,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tutor_instruction_assignments_conversation
  ON public.tutor_instruction_assignments (conversation_id, created_at ASC);

CREATE INDEX idx_tutor_instruction_assignments_student_recent
  ON public.tutor_instruction_assignments (student_id, created_at DESC);

CREATE INDEX idx_tutor_instruction_assignments_register
  ON public.tutor_instruction_assignments (emotional_register, created_at DESC)
  WHERE emotional_register != 'default';

-- Enforce reason_snapshot size bound (§11.3: bounded under 2KB)
ALTER TABLE public.tutor_instruction_assignments
  ADD CONSTRAINT reason_snapshot_size_bound
  CHECK (pg_column_size(reason_snapshot) < 2048);

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_instruction_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_instruction_assignments_select_own ON public.tutor_instruction_assignments
  FOR SELECT USING (student_id = auth.uid());

-- §17.4 NOTE: production must narrow to tutor_runtime_writer + tutor_archival_writer
CREATE POLICY tutor_instruction_assignments_service_role ON public.tutor_instruction_assignments
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 5. tutor_question_links — question relationship log
--    @spec [Doc-03A_V3.0, §18.5, §8.5]
-- ============================================================================

CREATE TABLE public.tutor_question_links (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Source question (the one being discussed)
  source_question_row_id      TEXT REFERENCES public.questions(id) ON DELETE SET NULL, -- TA-1
  source_question_canonical_id TEXT,

  -- Related question (the one being offered/proposed)
  related_question_row_id     TEXT REFERENCES public.questions(id) ON DELETE SET NULL, -- TA-1
  related_question_canonical_id TEXT,

  -- Relationship metadata
  relationship_type           TEXT NOT NULL CHECK (relationship_type IN (
    'current',            -- same question, retry
    'similar_retry',      -- same skill+difficulty, different question
    'simpler_variant',    -- same skill, easier difficulty
    'harder_variant',     -- same skill, harder difficulty
    'concept_extension'   -- related skill or domain
  )),
  difficulty_delta            INTEGER, -- -2, -1, 0, +1, +2
  reason_code                 TEXT NOT NULL,

  -- Snapshot of decision context
  link_snapshot               JSONB,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tutor_question_links_conversation
  ON public.tutor_question_links (conversation_id, created_at ASC);

CREATE INDEX idx_tutor_question_links_student
  ON public.tutor_question_links (student_id, created_at DESC);

CREATE INDEX idx_tutor_question_links_source
  ON public.tutor_question_links (source_question_canonical_id);

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_question_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_question_links_select_own ON public.tutor_question_links
  FOR SELECT USING (student_id = auth.uid());

-- §17.4 NOTE: production must narrow to tutor_runtime_writer
CREATE POLICY tutor_question_links_service_role ON public.tutor_question_links
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 6. tutor_instruction_exposures — rendered surface log
--    @spec [Doc-03A_V3.0, §18.6]
-- ============================================================================

CREATE TABLE public.tutor_instruction_exposures (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id               UUID NOT NULL REFERENCES public.tutor_instruction_assignments(id) ON DELETE CASCADE,
  conversation_id             UUID NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  student_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Exposure details
  exposure_type               TEXT NOT NULL CHECK (exposure_type IN (
    'hint',
    'explanation',
    'strategy',
    'similar_question_offer',
    'broader_coaching_offer',
    'consent_prompt'
  )),
  content_variant_key         TEXT,
  content_version             TEXT,

  -- Rendering metadata
  rendered_difficulty         INTEGER,
  hint_depth                  INTEGER,
  tone_style                  TEXT,
  sequence_ordinal            INTEGER NOT NULL,

  -- Interaction
  shown_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_ms                 INTEGER
);

CREATE INDEX idx_tutor_instruction_exposures_assignment
  ON public.tutor_instruction_exposures (assignment_id, sequence_ordinal);

CREATE INDEX idx_tutor_instruction_exposures_student_type
  ON public.tutor_instruction_exposures (student_id, exposure_type, shown_at DESC);

-- RLS — student_id-bound per INV-03-14
ALTER TABLE public.tutor_instruction_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_instruction_exposures_select_own ON public.tutor_instruction_exposures
  FOR SELECT USING (student_id = auth.uid());

-- §17.4 NOTE: production must narrow to tutor_runtime_writer + tutor_archival_writer
CREATE POLICY tutor_instruction_exposures_service_role ON public.tutor_instruction_exposures
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 7. tutor_context_runtime_config — ALREADY EXISTS (20260610000000_ws2_config_constants.sql)
--    @spec [Doc-03A_V3.0, §18.7, CR-03A-30]
--    Table created by WS2 migration using 01A §8 template (key/value/value_type/owner).
--    RLS, grants, and Doc 03 §24 seeds already applied there.
--    We only INSERT the Doc 03A §18.7 Layer-2/memory keys not seeded in WS2.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback includes DELETE of these keys.
-- ============================================================================

INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description) VALUES
  ('recent_message_window',                '12',   'integer', 'engineering', 'Doc 03A §18.7: recent messages loaded in Layer 2'),
  ('memory_summary_staleness_days',        '14',   'integer', 'product',    'Doc 03A §18.7: days before teaching_profile is stale'),
  ('injection_length_bound_chars',         '4000', 'integer', 'engineering', 'Doc 03A §18.7: max student message length before rejection'),
  ('study_context_relevance_window_days',  '7',    'integer', 'product',    'Doc 03A §18.7: days before exam_date that triggers study context');


-- ============================================================================
-- 8. tutor_injection_signatures — known attack patterns
--    @spec [Doc-03A_V3.0, §18.7, §12.3]
--    Pattern-data table — no student_id, no student RLS policy.
--    service_role read/write only. Retains its name per CR-03A-30 (not a
--    *_runtime_config scalar table).
-- ============================================================================

CREATE TABLE public.tutor_injection_signatures (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_pattern           TEXT NOT NULL,
  signature_type              TEXT NOT NULL,
  severity                    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  action                      TEXT NOT NULL CHECK (action IN ('flag', 'reject', 'silent_redirect')),
  added_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by                    TEXT
);

ALTER TABLE public.tutor_injection_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_injection_signatures_service_role ON public.tutor_injection_signatures
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 9. tutor_injection_log — injection detection events (observability)
--    @spec [Doc-03A_V3.0, §18.7, §12.8, §12A.8]
--    Service role only — students do not see injection log (INV-03-13).
-- ============================================================================

CREATE TABLE public.tutor_injection_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID REFERENCES public.tutor_conversations(id) ON DELETE SET NULL,
  student_id                  UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message_id                  UUID REFERENCES public.tutor_messages(id) ON DELETE SET NULL,
  signature_matched           TEXT,
  detection_layer             TEXT NOT NULL, -- 'layer_3_sanitization', 'layer_4_output', 'retry_storm', 'bot_pattern', etc.
  action_taken                TEXT NOT NULL,
  response_substituted        TEXT,
  detected_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tutor_injection_log_student_recent
  ON public.tutor_injection_log (student_id, detected_at DESC);

CREATE INDEX idx_tutor_injection_log_signature
  ON public.tutor_injection_log (signature_matched, detected_at DESC);

ALTER TABLE public.tutor_injection_log ENABLE ROW LEVEL SECURITY;

-- Service role only — students do not see injection log (INV-03-13)
-- §17.4 NOTE: production must narrow to tutor_injection_writer + tutor_archival_writer
CREATE POLICY tutor_injection_log_service_role ON public.tutor_injection_log
  FOR ALL TO service_role USING (true);


-- ============================================================================
-- 10. tutor_prompt_chips — V1 dashboard/general chips
--     @spec [Doc-03A_V3.0, §6.4]
--     Config table — product inputs for dashboard entry. Admin-managed.
--     Not explicitly listed in §17 catalog (which enumerates 9 tables) but
--     named in §6.4 as "stored in tutor_prompt_chips config".
-- ============================================================================

CREATE TABLE public.tutor_prompt_chips (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chip_key                    TEXT NOT NULL UNIQUE,
  chip_text                   TEXT NOT NULL,
  sort_order                  INTEGER NOT NULL DEFAULT 0,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_prompt_chips ENABLE ROW LEVEL SECURITY;

-- Service role read/write only — admin-managed config
CREATE POLICY tutor_prompt_chips_service_role ON public.tutor_prompt_chips
  FOR ALL TO service_role USING (true);

-- Students need SELECT for chip rendering in the UI (general/dashboard entry)
CREATE POLICY tutor_prompt_chips_select_authenticated ON public.tutor_prompt_chips
  FOR SELECT TO authenticated USING (active = TRUE);

-- Seed V1 chips per §6.4 (Doc 03 Main §20)
INSERT INTO public.tutor_prompt_chips (chip_key, chip_text, sort_order) VALUES
  ('review_mistakes',   'Review my recent mistakes',          1),
  ('help_full_length',  'Help with my last full-length',      2),
  ('explain_topic',     'Explain a topic or skill',           3),
  ('study_today',       'Help me decide what to study today', 4),
  ('general_question',  'Ask a general question',             5);

-- Trigger: updated_at
CREATE TRIGGER tutor_prompt_chips_updated_at
  BEFORE UPDATE ON public.tutor_prompt_chips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- COMMENTS — table-level documentation
-- ============================================================================

COMMENT ON TABLE public.tutor_conversations IS
  'LISA conversation envelopes with scope metadata. §18.1. Owner: tutor_runtime_writer (§17.4).';
COMMENT ON TABLE public.tutor_messages IS
  'LISA line-by-line conversation history. Append-only from student perspective. §18.2.';
COMMENT ON TABLE public.tutor_memory_summaries IS
  'Durable compact summaries with V1 structured fields. Written by trusted code only (§7.6). §18.3.';
COMMENT ON TABLE public.tutor_instruction_assignments IS
  'Policy decision log — every material instructional decision (INV-03-11). §18.4.';
COMMENT ON TABLE public.tutor_question_links IS
  'Question relationship log — audit trail for tutor-suggested retries (§8.5). §18.5.';
COMMENT ON TABLE public.tutor_instruction_exposures IS
  'Rendered surface log — what the student actually saw. §18.6.';
-- tutor_context_runtime_config: not created here (WS2 owns it); comment already set there.
COMMENT ON TABLE public.tutor_injection_signatures IS
  'Known injection attack patterns. Admin-managed. §18.7.';
COMMENT ON TABLE public.tutor_injection_log IS
  'Injection/abuse detection events for safety review queue (INV-03-13). §18.7.';
COMMENT ON TABLE public.tutor_prompt_chips IS
  'V1 dashboard/general entry chips (§6.4). Admin-managed product config.';

COMMIT;


-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- To reverse this migration, run the following statements in order.
-- Dependencies require reverse-creation order.
-- tutor_context_runtime_config is NOT dropped (owned by WS2); only seeded keys are deleted.
--
-- BEGIN;
-- DROP TABLE IF EXISTS public.tutor_prompt_chips CASCADE;
-- DROP TABLE IF EXISTS public.tutor_injection_log CASCADE;
-- DROP TABLE IF EXISTS public.tutor_injection_signatures CASCADE;
-- DELETE FROM public.tutor_context_runtime_config WHERE key IN (
--   'recent_message_window', 'memory_summary_staleness_days',
--   'injection_length_bound_chars', 'study_context_relevance_window_days'
-- );
-- DROP TABLE IF EXISTS public.tutor_instruction_exposures CASCADE;
-- DROP TABLE IF EXISTS public.tutor_question_links CASCADE;
-- DROP TABLE IF EXISTS public.tutor_instruction_assignments CASCADE;
-- DROP TABLE IF EXISTS public.tutor_memory_summaries CASCADE;
-- DROP TABLE IF EXISTS public.tutor_messages CASCADE;
-- DROP TABLE IF EXISTS public.tutor_conversations CASCADE;
-- DROP FUNCTION IF EXISTS public.validate_memory_summary_schema();
-- COMMIT;
