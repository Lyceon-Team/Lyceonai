-- ============================================================================
-- E6 — schedule the exam abandonment sweep with pg_cron (OWNER-RUN)
-- ============================================================================
-- @spec [Doc-04A_V2.2, §14.3 ("A scheduled job runs every 5 minutes"), §13.3
--        (outbox publisher); E6 ruling R6 (scheduler = pg_cron; a build decision)]
-- @implemented [2026-09-24]
--
-- WHAT THIS IS. Binds public.exam_abandonment_sweep() (migration
-- 20260930070000_exam_runtime_api.sql) to pg_cron, every 5 minutes. The sweep
-- is the BACKSTOP: every API touch already finalises a past-grace session and
-- scores a completed one inline. The sweep catches sessions nobody touches
-- again and re-drives any outbox row whose inline scoring failed.
--
-- WHY IT IS NOT A MIGRATION. genesis excludes platform-managed extensions
-- (pg_cron, pg_net — 00000000000000_genesis.sql:80), so cron.schedule() in a
-- migration would fail every fresh apply (genesis-fresh-apply, every CI gate,
-- every rehearsal database). pg_cron 1.6.4 is installed in production
-- (pg_available_extensions, read 2026-09-24).
--
-- THE AGENT DID NOT RUN THIS. Run it once, after the E6 migrations are applied:
--   psql "<production connection string>" -v ON_ERROR_STOP=1 -f scripts/ops/exam-abandonment-sweep-cron.sql
--
-- IDEMPOTENT: cron.schedule with a job name replaces that job (pg_cron >= 1.3).
--
-- TO REMOVE:  SELECT cron.unschedule('exam-abandonment-sweep');
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not enabled in this database';
  END IF;
  IF to_regprocedure('public.exam_abandonment_sweep(integer)') IS NULL THEN
    RAISE EXCEPTION 'public.exam_abandonment_sweep(int) is missing: apply 20260930070000_exam_runtime_api.sql first';
  END IF;
END $$;

SELECT cron.schedule(
  'exam-abandonment-sweep',
  '*/5 * * * *',
  $cron$SELECT public.exam_abandonment_sweep(100)$cron$
);

SELECT jobid, jobname, schedule, command, active
  FROM cron.job WHERE jobname = 'exam-abandonment-sweep';

COMMIT;
