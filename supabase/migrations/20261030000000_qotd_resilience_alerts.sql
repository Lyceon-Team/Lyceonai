-- ===========================================================================
-- QOTD resilience: the schedule horizon, and a once-per-condition-per-day ops alert ledger.
--
-- @spec [owner brief "QOTD resilience (no-question state, error logging, alerting)" (Karl,
--       2026-10-09) §1 (a day with no question), §3 (alert when the schedule job fails or
--       inserts nothing, when the horizon is under 7 days, when today has no question; at most
--       one alert per condition per day; a recovery message once the horizon is back at 7), and
--       "Alert delivery" (Slack and email, each channel independent, idempotent per condition
--       per day across both channels)] | @implemented [2026-10-09]
--
-- plain English:
--  1. `qotd_servable(date)`: the date has a scheduled question that is still published and
--     unflagged — the same test `qotd_question_for` applies when a card reads it. A row whose
--     question was later unpublished is NOT a question for that day.
--  2. `qotd_horizon(now)`: today (America/Chicago), whether today is servable, the FIRST date
--     from today on with no servable question (`runs_out_on`), and the horizon = whole days
--     after today that are covered back to back (0..60). The schedule job fills today + 7, so a
--     healthy schedule reads 7 right after it runs.
--  3. `ops_alert_deliveries`: one row per (condition, America/Chicago day, channel), claimed
--     BEFORE anything is sent. A second check the same day finds the claim and sends nothing,
--     so each condition alerts at most once a day on each channel, whichever job finds it.
--     A claim whose send FAILED can be claimed again the same day (nothing was delivered, so a
--     retry is not a repeat): the evening checks retry a channel that failed in the morning.
--     Recovery is its own condition: it is due when any QOTD alert row is newer than the last
--     recovery message that was actually SENT on some channel.
--
-- No question content and no student data is stored: conditions, dates, a horizon number.
-- RLS on, service role only.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Servable, and the horizon
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_servable(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.qotd_schedule s
      JOIN public.questions q ON q.id = s.question_id
     WHERE s.qotd_date = p_date
       AND q.status = 'published'
       AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.qotd_horizon(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH t AS (SELECT public.chicago_day(p_now) AS today),
  gap AS (
    SELECT COALESCE(
             (SELECT min((SELECT today FROM t) + k)
                FROM generate_series(0, 61) AS k
               WHERE NOT public.qotd_servable((SELECT today FROM t) + k)),
             (SELECT today FROM t) + 62
           ) AS first_gap
  )
  SELECT jsonb_build_object(
    'today', (SELECT today FROM t),
    'today_covered', (SELECT first_gap FROM gap) > (SELECT today FROM t),
    'runs_out_on', (SELECT first_gap FROM gap),
    'horizon', GREATEST((SELECT first_gap FROM gap) - (SELECT today FROM t) - 1, 0)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 2. The alert ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_alert_deliveries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  condition   text        NOT NULL CHECK (condition IN (
                'qotd_schedule_failed',
                'qotd_horizon_low',
                'qotd_no_question_today',
                'qotd_recovered',
                'ops_test',
                'ops_slack_unconfigured',
                'ops_email_unconfigured'
              )),
  alert_day   date        NOT NULL,
  channel     text        NOT NULL CHECK (channel IN ('slack', 'email', 'log')),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT ops_alert_deliveries_once_per_day UNIQUE (condition, alert_day, channel)
);
COMMENT ON TABLE public.ops_alert_deliveries IS
  'Ops alerts (QOTD resilience brief, Karl 2026-10-09): one row per (condition, America/Chicago day, channel), claimed before sending, so a condition alerts at most once a day per channel. No content, no student data.';
ALTER TABLE public.ops_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_alert_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ops_alert_deliveries TO service_role;

-- Claims (condition, day, channel). Returns the delivery id, or NULL when already claimed (sent,
-- skipped, or in flight). A FAILED claim is re-claimed: nothing was delivered, so retrying it is
-- not a duplicate.
CREATE OR REPLACE FUNCTION public.ops_alert_claim(
  p_condition text, p_channel text, p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.ops_alert_deliveries (condition, alert_day, channel, created_at)
  VALUES (p_condition, public.chicago_day(p_now), p_channel, p_now)
  ON CONFLICT (condition, alert_day, channel) DO UPDATE
     SET status = 'pending', created_at = EXCLUDED.created_at, finished_at = NULL
   WHERE public.ops_alert_deliveries.status = 'failed'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_alert_record(
  p_id uuid, p_status text, p_now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.ops_alert_deliveries
     SET status = p_status, finished_at = p_now
   WHERE id = p_id AND status = 'pending';
$fn$;

-- A recovery message is due when any QOTD alert row is newer than the last recovery message
-- that actually went out (status 'sent'). A recovery that failed on every channel stays due.
CREATE OR REPLACE FUNCTION public.qotd_recovery_due()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.ops_alert_deliveries a
     WHERE a.condition IN ('qotd_schedule_failed', 'qotd_horizon_low', 'qotd_no_question_today')
       AND a.created_at > COALESCE(
             (SELECT max(r.created_at) FROM public.ops_alert_deliveries r
               WHERE r.condition = 'qotd_recovered' AND r.status = 'sent'),
             '-infinity'::timestamptz)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.qotd_servable(date),
  public.qotd_horizon(timestamptz),
  public.ops_alert_claim(text, text, timestamptz),
  public.ops_alert_record(uuid, text, timestamptz),
  public.qotd_recovery_due()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.qotd_servable(date),
  public.qotd_horizon(timestamptz),
  public.ops_alert_claim(text, text, timestamptz),
  public.ops_alert_record(uuid, text, timestamptz),
  public.qotd_recovery_due()
  TO service_role;

COMMIT;
