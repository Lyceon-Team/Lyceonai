-- ============================================================================
-- Extend practice_sessions.mode for diagnostic sessions
-- ============================================================================
-- @spec [Doc-02B_V4 §20; Coding Standards §4] | @implemented [2026-08-07]
-- plain English: adds 'diagnostic' to the mode CHECK constraint. Diagnostic
--   sessions use the same practice engine — same serve/grade/emit pipeline —
--   with a per-domain-count pool selector (select_diagnostic_pool).
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
-- ROLLBACK (INV-06): revert to flow|structured|balanced|timed.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — constraint revert only.
-- ============================================================================

BEGIN;

ALTER TABLE public.practice_sessions
  DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;

ALTER TABLE public.practice_sessions
  ADD CONSTRAINT practice_sessions_mode_check
  CHECK (mode IN ('flow', 'structured', 'balanced', 'timed', 'diagnostic'));

COMMIT;
