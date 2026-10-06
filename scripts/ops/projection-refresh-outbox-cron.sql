-- ============================================================================
-- SCL-206 — schedule the projection-refresh outbox drain with pg_cron (OWNER-RUN)
-- ============================================================================
-- @spec [Doc-05C_V1 §8.3 step 2-3 ("the worker drains the outbox on a short interval
--        (seconds, not the daily sweep cadence)"); SCL-206; scheduler = pg_cron, the
--        E6 R6 precedent (scripts/ops/exam-abandonment-sweep-cron.sql)]
-- @implemented [2026-10-03]
--
-- WHAT THIS IS. Binds public.projection_refresh_outbox_drain(50) (migration
-- 20261022000000_05c_full_length_blend.sql) to pg_cron every 30 seconds. It is the
-- BACKSTOP: the API already refreshes the projection in the request that finished
-- the exam (projection_refresh_after_exam). The drain catches a completion the
-- sweep scored (nobody touched the session again), a read-through that failed,
-- and the rows written before this change went live.
--
-- WHY IT IS NOT A MIGRATION. genesis excludes platform-managed extensions
-- (pg_cron, pg_net — 00000000000000_genesis.sql:80), so cron.schedule() in a
-- migration would fail every fresh apply. pg_cron 1.6.4 is installed in production
-- and already runs 'exam-abandonment-sweep' (read 2026-10-03); 1.5+ accepts the
-- 'N seconds' schedule.
--
-- THE AGENT DID NOT RUN THIS. Run it once, after the migration is applied:
--   psql "<production connection string>" -v ON_ERROR_STOP=1 -f scripts/ops/projection-refresh-outbox-cron.sql
--
-- IDEMPOTENT: cron.schedule with a job name replaces that job (pg_cron >= 1.3).
--
-- TO REMOVE:  SELECT cron.unschedule('projection-refresh-outbox-drain');
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not enabled in this database';
  END IF;
  IF to_regprocedure('public.projection_refresh_outbox_drain(integer)') IS NULL THEN
    RAISE EXCEPTION 'public.projection_refresh_outbox_drain(int) is missing: apply 20261022000000_05c_full_length_blend.sql first';
  END IF;
END $$;

SELECT cron.schedule(
  'projection-refresh-outbox-drain',
  '30 seconds',
  $cron$SELECT public.projection_refresh_outbox_drain(50)$cron$
);

SELECT jobid, jobname, schedule, command, active
  FROM cron.job WHERE jobname = 'projection-refresh-outbox-drain';

COMMIT;
