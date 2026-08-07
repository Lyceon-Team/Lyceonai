-- LYCEON-MIGRATION-REVIEWED
-- Migration: diagnostic_pool_plain_invoker
-- @spec [Codex audit Fix 3 / Coding Standards §17] select_diagnostic_pool was
--   SECURITY DEFINER with no identified privilege-boundary need. Its sibling
--   select_practice_pool_random is plain invoker. This migration aligns the
--   posture: drop SECURITY DEFINER, keep the locked search_path and ACL.
--
-- Rollback: ALTER FUNCTION public.select_diagnostic_pool(integer, text[])
--           SECURITY DEFINER SET search_path = public, pg_temp;
--
-- Risk: LOW — the only caller is the server via service_role, which already has
-- SELECT on servable_questions. No privilege escalation path changes.

BEGIN;

-- Remove SECURITY DEFINER; the function becomes plain invoker (the PG default).
-- Keep SET search_path for determinism.
ALTER FUNCTION public.select_diagnostic_pool(integer, text[])
  SECURITY INVOKER
  SET search_path = public, pg_temp;

COMMIT;
