-- ============================================================================
-- LISA Session Lifecycle — additive schema changes
-- ============================================================================
-- @spec  [CC Brief "LISA Session Lifecycle" §5.1–§5.5]
-- @implemented [2026-09-22]
--
-- Additive changes — no data loss, no column drops:
--   1. tutor_conversations: widen status CHECK (active|ended), add title,
--      surface, crisis_paused_at, ended_at columns.
--   2. tutor_messages: add status column (pending|completed|failed).
--   3. New table: crisis_review_events (per-message crisis event log).
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. tutor_conversations — lifecycle columns
-- ============================================================================

-- 1a. Widen status CHECK to include 'ended' alongside existing values.
--     Existing 'closed'/'abandoned' rows remain valid; new code writes 'ended'.
ALTER TABLE public.tutor_conversations
  DROP CONSTRAINT IF EXISTS tutor_conversations_status_check;
ALTER TABLE public.tutor_conversations
  ADD CONSTRAINT tutor_conversations_status_check
    CHECK (status IN ('active', 'closed', 'abandoned', 'ended'));

-- 1b. Add title column — set on first student message, immutable after.
ALTER TABLE public.tutor_conversations
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'New session';

-- 1c. Add surface column — display surface (standalone|practice|review).
ALTER TABLE public.tutor_conversations
  ADD COLUMN IF NOT EXISTS surface TEXT
    CHECK (surface IS NULL OR surface IN ('standalone', 'practice', 'review'));

-- 1d. Add crisis_paused_at — non-null when conversation is crisis-paused.
ALTER TABLE public.tutor_conversations
  ADD COLUMN IF NOT EXISTS crisis_paused_at TIMESTAMPTZ;

-- 1e. Add ended_at — timestamp when student explicitly ended the session.
ALTER TABLE public.tutor_conversations
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- 1f. Index for sidebar listing: standalone surface, active, ordered by update.
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_standalone_active
  ON public.tutor_conversations (student_id, updated_at DESC)
  WHERE surface = 'standalone' AND status = 'active' AND deleted_at IS NULL;

-- ============================================================================
-- 2. tutor_messages — message status tracking
-- ============================================================================

-- 2a. Add status column. Default 'completed' preserves semantics for
--     existing rows (they were all successfully persisted).
ALTER TABLE public.tutor_messages
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed'));

-- 2b. Index for finding pending/failed messages (turn recovery).
CREATE INDEX IF NOT EXISTS idx_tutor_messages_status
  ON public.tutor_messages (conversation_id, status)
  WHERE status IN ('pending', 'failed');

-- ============================================================================
-- 3. crisis_review_events — per-message crisis event log
--    Replaces one-case-per-conversation with one-case + N events.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crisis_review_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL
                    REFERENCES public.crisis_review_cases(id)
                    ON DELETE CASCADE,
  conversation_id   UUID NOT NULL
                    REFERENCES public.tutor_conversations(id)
                    ON DELETE RESTRICT,
  student_id        UUID NOT NULL
                    REFERENCES public.profiles(id)
                    ON DELETE RESTRICT,

  event_type        TEXT NOT NULL
                    CHECK (event_type IN (
                      'case_opened',
                      'signal_received',
                      'notification_sent',
                      'assigned',
                      'resolved'
                    )),

  -- Which message triggered this event (null for lifecycle events)
  message_id        UUID REFERENCES public.tutor_messages(id) ON DELETE SET NULL,

  -- Classification source for signal_received events
  source            TEXT
                    CHECK (source IS NULL OR source IN (
                      'signature', 'model', 'both',
                      'classifier_degraded', 'classifier_degraded_no_floor',
                      'infrastructure_failure'
                    )),
  signature_id      UUID,
  model_confidence  NUMERIC,
  category          TEXT
                    CHECK (category IS NULL OR category IN ('crisis', 'safeguarding')),

  -- Notification throttle metadata
  notification_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Events by case (timeline view in crisis dashboard)
CREATE INDEX IF NOT EXISTS idx_crisis_review_events_case
  ON public.crisis_review_events (case_id, created_at ASC);

-- Events by conversation (all signals for a conversation)
CREATE INDEX IF NOT EXISTS idx_crisis_review_events_conversation
  ON public.crisis_review_events (conversation_id, created_at ASC);

-- RLS
ALTER TABLE public.crisis_review_events ENABLE ROW LEVEL SECURITY;

-- Students cannot see crisis review events (admin-only table)
CREATE POLICY crisis_review_events_service_role ON public.crisis_review_events
  FOR ALL TO service_role USING (true);

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- ============================================================================
-- All changes are additive (new columns, new table, widened CHECK).
-- Rollback:
--   DROP TABLE IF EXISTS public.crisis_review_events CASCADE;
--   DROP INDEX IF EXISTS idx_tutor_messages_status;
--   ALTER TABLE public.tutor_messages DROP COLUMN IF EXISTS status;
--   DROP INDEX IF EXISTS idx_tutor_conversations_standalone_active;
--   ALTER TABLE public.tutor_conversations DROP COLUMN IF EXISTS ended_at;
--   ALTER TABLE public.tutor_conversations DROP COLUMN IF EXISTS crisis_paused_at;
--   ALTER TABLE public.tutor_conversations DROP COLUMN IF EXISTS surface;
--   ALTER TABLE public.tutor_conversations DROP COLUMN IF EXISTS title;
--   ALTER TABLE public.tutor_conversations DROP CONSTRAINT IF EXISTS tutor_conversations_status_check;
--   ALTER TABLE public.tutor_conversations ADD CONSTRAINT tutor_conversations_status_check
--     CHECK (status IN ('active', 'closed', 'abandoned'));
