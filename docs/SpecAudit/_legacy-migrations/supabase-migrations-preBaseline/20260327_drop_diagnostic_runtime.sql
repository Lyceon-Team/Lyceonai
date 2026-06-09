-- 20260327_drop_diagnostic_runtime.sql
-- Destructive cleanup for diagnostic runtime hard-kill.
-- Run after diagnostic routes are contract-disabled in application code.

BEGIN;

DROP TABLE IF EXISTS public.diagnostic_responses;
DROP TABLE IF EXISTS public.diagnostic_sessions;

COMMIT;

