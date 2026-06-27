-- ============================================================================
-- Vertical A — practice_runtime_config updates (CEO model alignment)
-- ============================================================================
-- @spec [Doc-02B_V4 §14/§41; CEO model Vertical A] | @implemented [2026-06-27]
-- plain English: updates default_session_count_web from 20→10 per CEO model,
--   adds max_concurrent_sessions (5), answer rate-limit config, and
--   target_seconds_per_question for time-mode derivation. All constants that
--   were previously hardcoded in practice-canonical.ts now live in config.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
-- ROLLBACK (INV-06): UPDATE revert + DELETE the 3 new keys.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — revert UPDATE, DELETE new keys.
-- ============================================================================

BEGIN;

-- 1. Update default_session_count_web from 20 → 10 per CEO model
UPDATE public.practice_runtime_config
SET value = '10', updated_at = now()
WHERE key = 'default_session_count_web';

-- 2. Add max_concurrent_sessions (was hardcoded SESSION_LIMIT = 3, CEO model = 5)
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description) VALUES
  ('max_concurrent_sessions', '5', 'integer', 'product', 'Doc 02B §14: max active practice sessions per user (CEO model)');

-- 3. Add answer rate-limit config (was hardcoded windowMs: 60_000, max: 30)
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description) VALUES
  ('answer_rate_limit_window_ms', '60000', 'integer', 'engineering', 'Doc 02B §14: answer/skip rate-limit window (ms)'),
  ('answer_rate_limit_max',       '30',    'integer', 'engineering', 'Doc 02B §14: answer/skip rate-limit max per window');

-- 4. Add target_seconds_per_question for time-mode derivation (was hardcoded = 90)
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description) VALUES
  ('target_seconds_per_question', '90', 'integer', 'product', 'Doc 02B §14: seconds per question for time-mode count derivation');

COMMIT;
