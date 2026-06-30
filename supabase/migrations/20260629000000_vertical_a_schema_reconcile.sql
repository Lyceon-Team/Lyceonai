-- ============================================================================
-- Vertical A — schema reconciliation (Codex reject rework)
-- ============================================================================
-- @spec [Doc-02B_V4 §14; CEO model Vertical A] | @implemented [2026-06-29]
-- Reconciles practice_sessions / practice_session_items with the CEO model
-- runtime requirements that the genesis migration did not anticipate:
--   1. Mode CHECK extended for CEO model modes (balanced, timed)
--   2. Option-shuffle columns on session items (anti-leak mechanism)
--
-- Karl applies at step 7 — this migration stays UNAPPLIED until then.
--
-- LYCEON-MIGRATION-REVIEWED
-- Rollback:
--   ALTER TABLE public.practice_session_items DROP COLUMN IF EXISTS client_instance_id;
--   ALTER TABLE public.practice_session_items DROP COLUMN IF EXISTS option_token_map;
--   ALTER TABLE public.practice_session_items DROP COLUMN IF EXISTS option_order;
--   ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;
--   ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_mode_check
--     CHECK (mode IN ('flow', 'structured'));

BEGIN;

-- 1. Extend practice_sessions.mode CHECK for CEO model vocabulary
--    Genesis defined flow|structured; CEO model adds balanced|timed.
ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_mode_check
  CHECK (mode IN ('flow', 'structured', 'balanced', 'timed'));

-- 2. Add option-shuffle columns to practice_session_items
--    The Fisher-Yates option shuffle (anti-leak mechanism) needs per-item
--    storage of the shuffled order and opaque token mapping.
ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS option_order text[],
  ADD COLUMN IF NOT EXISTS option_token_map jsonb,
  ADD COLUMN IF NOT EXISTS client_instance_id text;

COMMIT;
