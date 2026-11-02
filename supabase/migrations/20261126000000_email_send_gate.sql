-- ===========================================================================
-- Email send gate — who may be emailed what, and when to stop
-- ===========================================================================
-- @spec [owner brief "Email send gate" (Karl, 2026-10-30); owner rulings 2026-11-02 rounds 1
--       and 2 (plan-aware inactivity, the two post-test milestones, governed emails from a
--       tracked sender, the QOTD pause folded into the gate, QOTD exempt from the cooling cap);
--       contracts/notifications.contract.md C15; SCL register entry for this change]
--       | @implemented [2026-11-02]
--
-- OWNER-RUN. Karl applies to production by hand. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English. Every email Lyceon sends is one of four kinds (`email_category`):
--   * always    — account, billing and guardian-link mail. The gate never blocks it.
--   * governed  — reminders, digests, lifecycle nudges, review asks, manual campaigns. The gate
--                 decides by the recipient's state.
--   * milestone — the three SAT-date emails (a week before, the day after, score release day).
--                 Allowed in every state, once per test date (insert-once event ids).
--   * notice    — the gate's own two emails (the student pause note, the parent pause email).
--
-- A student is in one of three states (`email_gate_state`, refreshed by `email_gate_refresh`):
--   * active  — studied within 7 days (or, on a study plan, fewer than 2 missed planned days
--               in a row).
--   * cooling — 7 days without activity (on a plan: 2 missed planned days in a row). At most one
--               governed email per 7 days; the QOTD reminder is exempt (ruling 2026-11-02 (4)).
--   * paused  — 14+ days without activity AND the last 3+ governed emails had no click and no
--               return (on a plan: 3 missed planned days in a row AND 14+ days without
--               activity AND the same 3 unengaged emails). No governed email at all. Entering
--               it sends the pause note once per episode. Sticky until a wake: any activity
--               or the signed "Keep me posted" link.
-- A planned day counts as missed only if there was no activity of any kind that day; days with
-- no planned block never count; off-plan activity is activity (ruling 2026-11-02, section 2).
--
-- Parents: after 7 days without student activity (on a plan: 2 missed planned days in a row AND
-- 7 days without activity), the guardian gets one pause email for that student and the daily
-- digest stops reporting that student (`email_gate_guardian_pauses`). Resumes when the student
-- studies, the guardian signs in, or taps Keep me posted. Once per episode: a new pause needs
-- student activity after the last one.
--
-- Every state change is recorded (`email_gate_transitions`: who, from → to, when, why) and
-- queued for Resend's `email_state` contact property (`email_gate_resend_outbox`), which the
-- server flushes with retry and backoff; a failed mirror never blocks a send.
--
-- Engagement: Resend's email.opened / email.clicked webhooks are stored in
-- notification_delivery_events (idempotent by svix-id) with the recipient's profile, and only
-- clicks count (opens are inflated by Apple Mail). Manual campaigns are recorded by
-- `record_campaign_send` and read the read-only `email_gate_status` view.
--
-- The QOTD reminder's own 7-send sunset is retired: students it had paused become `paused` here
-- (backfill, no second note), and `qotd_daily_notify` asks the gate's state instead.
-- Mutations re-pointed in the same change: H8, N1, N2, N3 (scripts/ci/home-qotd.mutations.sh)
-- and Q15 (scripts/ci/notification-quiet-hours.mutations.sh) now aim at section 9 of this file,
-- which LAST defines `qotd_daily_notify`; H11 (the retired sunset) is replaced by G-plants in
-- scripts/ci/email-gate.mutations.sh; N5 aims at section 9's `qotd_email_resume`.
--
-- rollback (by hand, in this order):
--   DROP VIEW IF EXISTS public.email_gate_status;
--   -- re-run section 7 of 20261101000000_guardian_accountability.sql (guardian_daily_digest_notify),
--   -- section 8 of 20261031000000 (qotd_daily_notify), and the qotd_daily_email_preference and
--   -- qotd_email_resume definitions in 20261029020000. Students paused by the gate keep their
--   -- student_qotd_email_prefs.paused_at row, so the old sunset resumes where it stopped.
--   DROP FUNCTION IF EXISTS public.email_milestones_notify(timestamptz, jsonb),
--     public.email_gate_outbox_mark(uuid, text, boolean, text, timestamptz),
--     public.email_gate_outbox_due(timestamptz, integer),
--     public.record_campaign_send(text, text, text, timestamptz, text),
--     public.record_email_engagement_event(text, text, text, timestamptz, text[]),
--     public.email_gate_guardian_refresh(timestamptz),
--     public.email_gate_record_plan_days(uuid, jsonb, text, date, timestamptz),
--     public.email_gate_sweep(timestamptz, integer, uuid),
--     public.email_gate_keep_posted(uuid, timestamptz),
--     public.email_gate_decide(uuid, text, timestamptz),
--     public.email_gate_refresh(uuid, timestamptz, text),
--     public.email_gate_enqueue_mirror(uuid, text, timestamptz),
--     public.email_gate_verdict(uuid, text, text, timestamptz),
--     public.email_gate_compute(uuid, timestamptz),
--     public.email_gate_last_capped_send(uuid, timestamptz),
--     public.email_gate_unengaged_count(uuid, timestamptz),
--     public.email_gate_last_click(uuid, timestamptz),
--     public.email_gate_governed_sends(uuid, timestamptz),
--     public.email_gate_active_on(uuid, date, text),
--     public.email_gate_last_activity(uuid, timestamptz),
--     public.email_gate_activity_between(uuid, timestamptz, timestamptz),
--     public.email_gate_last_sign_in(uuid),
--     public.email_category(text), public.email_category_unknown(text),
--     public.email_gate_config_bool(text), public.email_gate_config_int(text);
--   DELETE FROM public.notification_events WHERE event_type IN ('sat_week_before', 'sat_day_after',
--     'sat_scores_released', 'email_gate_paused_notice', 'email_gate_guardian_paused');
--   -- re-run section 1 of 20261111000000_lifecycle_triggers.sql (notification_events_type_check)
--   DROP INDEX IF EXISTS public.notification_delivery_events_recipient_idx;
--   ALTER TABLE public.notification_delivery_events DROP COLUMN IF EXISTS recipient_profile_id;
--   DROP TABLE IF EXISTS public.email_campaign_sends, public.email_gate_guardian_pauses,
--     public.email_gate_resend_outbox, public.email_gate_transitions, public.email_gate_state,
--     public.notification_runtime_config_history, public.notification_runtime_config;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Configuration (the runtime-config pattern; readers fail closed)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_runtime_config (
  key            TEXT PRIMARY KEY,
  value          JSONB NOT NULL,
  value_type     TEXT NOT NULL CHECK (value_type IN ('integer','string','boolean','array','object','float')),
  min_value      JSONB,
  max_value      JSONB,
  allowed_values JSONB,
  owner          TEXT NOT NULL,
  description    TEXT NOT NULL,
  environment    TEXT NOT NULL DEFAULT 'all' CHECK (environment IN ('all','development','staging','production')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.notification_runtime_config_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name            TEXT NOT NULL,
  key                   TEXT NOT NULL,
  old_value             JSONB,
  new_value             JSONB NOT NULL,
  changed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_reason         TEXT,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_runtime_config_notify
  AFTER INSERT OR UPDATE ON public.notification_runtime_config
  FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();

CREATE TRIGGER notification_runtime_config_history_no_mutate
  BEFORE UPDATE OR DELETE ON public.notification_runtime_config_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();

INSERT INTO public.notification_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('email_gate_enabled', 'true', 'boolean', NULL, NULL, 'karl',
   'Email send gate master switch. false = every governed email is allowed (the gate still records state).'),
  ('email_gate_active_days', '7', 'integer', '1', '60', 'karl',
   'No plan: days without activity before a student is cooling.'),
  ('email_gate_pause_inactive_days', '14', 'integer', '1', '120', 'karl',
   'No plan: days without activity before a student can be paused (with the unengaged count).'),
  ('email_gate_cooling_min_interval_days', '7', 'integer', '1', '60', 'karl',
   'Cooling: at most one governed email (QOTD exempt) per this many days.'),
  ('email_gate_pause_unengaged_sends', '3', 'integer', '1', '20', 'karl',
   'Governed emails in a row with no click and no return before a student can be paused.'),
  ('email_gate_engagement_window_hours', '72', 'integer', '1', '336', 'karl',
   'Hours after a governed send before it can count as unengaged.'),
  ('email_gate_milestone_days_before_test', '7', 'integer', '1', '30', 'karl',
   'The week-before milestone opens this many days before the test date.'),
  ('email_gate_guardian_inactive_days', '7', 'integer', '1', '60', 'karl',
   'No plan: days without student activity before the parent pause email.'),
  ('email_gate_plan_cooling_missed_days', '2', 'integer', '1', '30', 'karl',
   'On a plan: missed planned days in a row before cooling.'),
  ('email_gate_plan_pause_missed_days', '3', 'integer', '1', '30', 'karl',
   'On a plan: missed planned days in a row before paused (with the inactivity floor and unengaged count).'),
  ('email_gate_plan_pause_min_inactive_days', '14', 'integer', '1', '120', 'karl',
   'On a plan: days without any activity required for paused.'),
  ('email_gate_plan_guardian_missed_days', '2', 'integer', '1', '30', 'karl',
   'On a plan: missed planned days in a row before the parent pause email.'),
  ('email_gate_plan_guardian_min_inactive_days', '7', 'integer', '1', '60', 'karl',
   'On a plan: days without any activity required for the parent pause email.'),
  ('email_gate_plan_recent_days', '14', 'integer', '1', '60', 'karl',
   'A student is on a plan while a planned day falls within this many days; otherwise the calendar rules apply.');

-- Reads one integer key; a missing or malformed key is an error, never a default.
CREATE OR REPLACE FUNCTION public.email_gate_config_int(p_key text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v jsonb;
BEGIN
  SELECT c.value INTO v FROM public.notification_runtime_config c
   WHERE c.key = p_key AND c.value_type = 'integer';
  IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
    RAISE EXCEPTION 'email_gate_config_int: missing or invalid key %', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN (v #>> '{}')::integer;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.email_gate_config_bool(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v jsonb;
BEGIN
  SELECT c.value INTO v FROM public.notification_runtime_config c
   WHERE c.key = p_key AND c.value_type = 'boolean';
  IF v IS NULL OR jsonb_typeof(v) <> 'boolean' THEN
    RAISE EXCEPTION 'email_gate_config_bool: missing or invalid key %', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN (v #>> '{}')::boolean;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.email_gate_state (
  profile_id               uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  state                    text NOT NULL DEFAULT 'active'
                             CHECK (state IN ('active', 'cooling', 'paused')),
  reason                   text NOT NULL DEFAULT 'initial',
  state_since              timestamptz NOT NULL DEFAULT now(),
  pause_episode            integer NOT NULL DEFAULT 0 CHECK (pause_episode >= 0),
  resumed_at               timestamptz NULL,
  plan_timezone            text NULL,
  plan_missed_run          integer NOT NULL DEFAULT 0 CHECK (plan_missed_run >= 0),
  plan_last_missed_date    date NULL,
  plan_last_planned_date   date NULL,
  plan_last_evaluated_date date NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.email_gate_state IS
  'Email send gate: a student''s or guardian''s state (active | cooling | paused), the pause episode count, the last Keep-me-posted, and the missed-planned-day run (plan-aware rules). Written only by the email_gate_* functions. ON DELETE CASCADE from profiles.';

CREATE TABLE public.email_gate_transitions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_state  text NULL CHECK (from_state IN ('active', 'cooling', 'paused')),
  to_state    text NOT NULL CHECK (to_state IN ('active', 'cooling', 'paused')),
  reason      text NOT NULL,
  actor       text NOT NULL CHECK (actor IN ('system', 'keep_me_posted', 'backfill')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX email_gate_transitions_profile_idx
  ON public.email_gate_transitions (profile_id, occurred_at);
COMMENT ON TABLE public.email_gate_transitions IS
  'Email send gate: every state change (who, from → to, when, why). Append-only by convention; ON DELETE CASCADE from profiles.';

CREATE TABLE public.email_gate_resend_outbox (
  profile_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_state     text NOT NULL CHECK (email_state IN ('active', 'cooling', 'paused')),
  enqueued_at     timestamptz NOT NULL,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  last_error      text NULL,
  synced_at       timestamptz NULL
);
CREATE INDEX email_gate_resend_outbox_due_idx
  ON public.email_gate_resend_outbox (next_attempt_at) WHERE synced_at IS NULL;
COMMENT ON TABLE public.email_gate_resend_outbox IS
  'Email send gate: the latest state to mirror to the Resend contact property email_state, with retry and backoff. Never written for an under-13. A failed mirror never blocks a send.';

CREATE TABLE public.email_gate_guardian_pauses (
  guardian_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  episode       integer NOT NULL CHECK (episode >= 1),
  paused_at     timestamptz NOT NULL,
  resumed_at    timestamptz NULL,
  resume_reason text NULL CHECK (resume_reason IN ('student_active', 'guardian_login', 'keep_me_posted', 'link_inactive')),
  PRIMARY KEY (guardian_id, student_id, episode),
  CHECK ((resumed_at IS NULL) = (resume_reason IS NULL))
);
CREATE UNIQUE INDEX email_gate_guardian_pauses_open_idx
  ON public.email_gate_guardian_pauses (guardian_id, student_id) WHERE resumed_at IS NULL;
COMMENT ON TABLE public.email_gate_guardian_pauses IS
  'Email send gate: a guardian''s daily digest paused for one linked student after the student went quiet; one row per episode, open while resumed_at IS NULL. ON DELETE CASCADE from both profiles.';

CREATE TABLE public.email_campaign_sends (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign   text NOT NULL CHECK (length(btrim(campaign)) BETWEEN 1 AND 200),
  variant    text NULL CHECK (variant IS NULL OR length(variant) <= 200),
  sent_at    timestamptz NOT NULL,
  resend_id  text NOT NULL UNIQUE CHECK (length(btrim(resend_id)) > 0)
);
CREATE INDEX email_campaign_sends_profile_idx ON public.email_campaign_sends (profile_id, sent_at);
COMMENT ON TABLE public.email_campaign_sends IS
  'Manual campaign sends (record_campaign_send), counted by the gate as governed emails. One row per Resend email id. ON DELETE CASCADE from profiles.';

-- Engagement events carry their recipient, so a click can be counted for any email (pipeline,
-- lifecycle automation or manual campaign).
ALTER TABLE public.notification_delivery_events
  ADD COLUMN IF NOT EXISTS recipient_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notification_delivery_events_recipient_idx
  ON public.notification_delivery_events (recipient_profile_id, event_type, occurred_at)
  WHERE recipient_profile_id IS NOT NULL;

ALTER TABLE public.notification_runtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_runtime_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_gate_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_gate_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_gate_resend_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_gate_guardian_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Event types (contract C1.1; list otherwise identical to 20261111000000)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (event_type IN ('guardian_linked',
                        'guardian_unlinked',
                        'full_length_week',
                        'full_length_tomorrow',
                        'exam_score_report_requested',
                        'renewal_decision_requested',
                        'qotd_daily',
                        'study_plan_changed',
                        'missed_plan_alert',
                        'back_on_track',
                        'guardian_daily_digest',
                        'review_ask',
                        'lifecycle_reminder_due',
                        'lifecycle_diagnostic_unfinished',
                        'lifecycle_pro_no_plan',
                        'lifecycle_practising_free',
                        'sat_week_before',
                        'sat_day_after',
                        'sat_scores_released',
                        'email_gate_paused_notice',
                        'email_gate_guardian_paused'));

-- ---------------------------------------------------------------------------
-- 4. The category of every email kind (mirrored by EMAIL_KIND_CATEGORY in packages/shared;
--    tests/ci/email-gate.pg.ci.test.ts holds the two equal). An unknown kind is an error.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_category(p_kind text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN CASE
    WHEN p_kind IN ('guardian_linked', 'guardian_unlinked', 'exam_score_report_requested',
                    'renewal_decision_requested', 'welcome', 'entitled')
      THEN 'always'
    WHEN p_kind IN ('qotd_daily', 'study_plan_changed', 'missed_plan_alert', 'back_on_track',
                    'full_length_week', 'full_length_tomorrow', 'guardian_daily_digest',
                    'review_ask', 'lifecycle_reminder_due', 'lifecycle_diagnostic_unfinished',
                    'lifecycle_pro_no_plan', 'lifecycle_practising_free', 'manual_campaign')
      THEN 'governed'
    WHEN p_kind IN ('sat_week_before', 'sat_day_after', 'sat_scores_released')
      THEN 'milestone'
    WHEN p_kind IN ('email_gate_paused_notice', 'email_gate_guardian_paused')
      THEN 'notice'
    ELSE public.email_category_unknown(p_kind)
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.email_category_unknown(p_kind text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'email_category: unknown email kind %', p_kind USING ERRCODE = 'invalid_parameter_value';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Activity and engagement (reads only)
-- ---------------------------------------------------------------------------
-- auth.users.last_sign_in_at, read dynamically: some harness schemas omit the column.
CREATE OR REPLACE FUNCTION public.email_gate_last_sign_in(p_profile_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('auth.users')
                    AND a.attname = 'last_sign_in_at' AND NOT a.attisdropped) THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT last_sign_in_at FROM auth.users WHERE id = $1' INTO v USING p_profile_id;
  RETURN v;
END;
$fn$;

-- The latest activity of any kind in [p_from, p_to): an answered practice, QOTD or review item,
-- a practice test started or answered, or a sign-in. NULL when none.
CREATE OR REPLACE FUNCTION public.email_gate_activity_between(
  p_profile_id uuid,
  p_from       timestamptz,
  p_to         timestamptz
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sign_in timestamptz := public.email_gate_last_sign_in(p_profile_id);
BEGIN
  RETURN (
    SELECT max(t) FROM (
      SELECT max(i.occurred_at) AS t
        FROM public.practice_session_items i
       WHERE i.user_id = p_profile_id AND i.status = 'answered'
         AND i.occurred_at >= p_from AND i.occurred_at < p_to
      UNION ALL
      SELECT max(COALESCE(r.occurred_at, r.answered_at))
        FROM public.review_session_items r
       WHERE r.student_id = p_profile_id AND r.status = 'answered'
         AND COALESCE(r.occurred_at, r.answered_at) >= p_from
         AND COALESCE(r.occurred_at, r.answered_at) < p_to
      UNION ALL
      SELECT max(s.started_at)
        FROM public.test_sessions s
       WHERE s.student_id = p_profile_id
         AND s.started_at >= p_from AND s.started_at < p_to
      UNION ALL
      SELECT max(a.created_at)
        FROM public.test_answer_submissions a
        JOIN public.test_sessions s ON s.id = a.test_session_id
       WHERE s.student_id = p_profile_id
         AND a.created_at >= p_from AND a.created_at < p_to
      UNION ALL
      SELECT v_sign_in WHERE v_sign_in >= p_from AND v_sign_in < p_to
    ) x
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.email_gate_last_activity(p_profile_id uuid, p_now timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT public.email_gate_activity_between(p_profile_id, '-infinity'::timestamptz, p_now);
$fn$;

-- Was there activity of any kind on a local calendar day?
CREATE OR REPLACE FUNCTION public.email_gate_active_on(p_profile_id uuid, p_day date, p_timezone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT public.email_gate_activity_between(
           p_profile_id,
           (p_day::timestamp AT TIME ZONE p_timezone),
           ((p_day + 1)::timestamp AT TIME ZONE p_timezone)) IS NOT NULL;
$fn$;

-- Every governed email a profile was sent, from the three ledgers: the notification pipeline
-- (sent or delivered email messages), the lifecycle automations (their claim ledger), and
-- manual campaigns.
CREATE OR REPLACE FUNCTION public.email_gate_governed_sends(p_profile_id uuid, p_now timestamptz)
RETURNS TABLE (kind text, sent_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT e.event_type, m.sent_at
    FROM public.notification_messages m
    JOIN public.notification_events e ON e.event_id = m.event_id
   WHERE m.recipient_profile_id = p_profile_id
     AND m.channel = 'email'
     AND m.status IN ('sent', 'delivered')
     AND m.sent_at IS NOT NULL AND m.sent_at <= p_now
     AND public.email_category(e.event_type) = 'governed'
  UNION ALL
  SELECT e.event_type,
         CASE WHEN e.payload = '{}'::jsonb THEN e.created_at
              ELSE (e.payload ->> 'sent_at')::timestamptz END
    FROM public.notification_events e
   WHERE e.subject_profile_id = p_profile_id
     AND e.event_type IN ('lifecycle_reminder_due', 'lifecycle_diagnostic_unfinished',
                          'lifecycle_pro_no_plan', 'lifecycle_practising_free')
     AND (e.payload = '{}'::jsonb OR e.payload ->> 'state' = 'sent')
     AND CASE WHEN e.payload = '{}'::jsonb THEN e.created_at
              ELSE (e.payload ->> 'sent_at')::timestamptz END <= p_now
  UNION ALL
  SELECT 'manual_campaign', c.sent_at
    FROM public.email_campaign_sends c
   WHERE c.profile_id = p_profile_id AND c.sent_at <= p_now;
$fn$;

CREATE OR REPLACE FUNCTION public.email_gate_last_click(p_profile_id uuid, p_now timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT max(d.occurred_at)
    FROM public.notification_delivery_events d
   WHERE d.recipient_profile_id = p_profile_id
     AND d.event_type = 'email.clicked'
     AND d.occurred_at <= p_now;
$fn$;

-- Governed emails in a row with no click and no return: those sent after the latest of
-- (activity, Keep me posted, the last click, account creation) whose engagement window has
-- passed. Clicks, never opens.
CREATE OR REPLACE FUNCTION public.email_gate_unengaged_count(p_profile_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH anchor AS (
    SELECT GREATEST(
             public.email_gate_last_activity(p_profile_id, p_now),
             (SELECT g.resumed_at FROM public.email_gate_state g WHERE g.profile_id = p_profile_id),
             public.email_gate_last_click(p_profile_id, p_now),
             (SELECT p.created_at FROM public.profiles p WHERE p.id = p_profile_id)
           ) AS at
  )
  SELECT count(*)::integer
    FROM public.email_gate_governed_sends(p_profile_id, p_now) s, anchor
   WHERE s.sent_at > COALESCE(anchor.at, '-infinity'::timestamptz)
     AND s.sent_at + make_interval(hours => public.email_gate_config_int('email_gate_engagement_window_hours')) <= p_now;
$fn$;

-- The latest governed email that counts against the cooling cap (the QOTD reminder is exempt).
CREATE OR REPLACE FUNCTION public.email_gate_last_capped_send(p_profile_id uuid, p_now timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT max(s.sent_at)
    FROM public.email_gate_governed_sends(p_profile_id, p_now) s
   WHERE s.kind <> 'qotd_daily';
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The state rule (pure read: what the state should be now)
-- ---------------------------------------------------------------------------
-- Returns {state, reason, last_active, unengaged, on_plan, plan_run}.
CREATE OR REPLACE FUNCTION public.email_gate_compute(p_profile_id uuid, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_profile   record;
  v_row       public.email_gate_state%ROWTYPE;
  v_activity  timestamptz;
  v_wake      timestamptz;
  v_since     timestamptz;
  v_idle_days numeric;
  v_unengaged integer;
  v_on_plan   boolean := false;
  v_run       integer := 0;
  v_today     date;
  v_state     text;
  v_reason    text;
BEGIN
  SELECT p.id, p.role::text AS role, p.created_at INTO v_profile
    FROM public.profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email_gate_compute: no profile %', p_profile_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_row FROM public.email_gate_state g WHERE g.profile_id = p_profile_id;

  v_activity := public.email_gate_last_activity(p_profile_id, p_now);

  -- A guardian: paused while every actively linked student's digest is paused for them.
  IF v_profile.role = 'guardian' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links l
                WHERE l.guardian_profile_id = p_profile_id AND l.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM public.guardian_links l
                        WHERE l.guardian_profile_id = p_profile_id AND l.status = 'active'
                          AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses gp
                                           WHERE gp.guardian_id = p_profile_id
                                             AND gp.student_id = l.student_profile_id
                                             AND gp.resumed_at IS NULL)) THEN
      v_state := 'paused'; v_reason := 'all_students_paused';
    ELSE
      v_state := 'active'; v_reason := 'guardian';
    END IF;
    RETURN jsonb_build_object('state', v_state, 'reason', v_reason, 'last_active', v_activity,
                              'unengaged', NULL, 'on_plan', false, 'plan_run', 0);
  END IF;

  v_wake := GREATEST(v_activity, v_row.resumed_at);
  v_since := COALESCE(v_wake, v_profile.created_at);
  IF v_profile.created_at > v_since THEN v_since := v_profile.created_at; END IF;
  v_idle_days := EXTRACT(EPOCH FROM (p_now - v_since)) / 86400.0;
  v_unengaged := public.email_gate_unengaged_count(p_profile_id, p_now);

  IF v_row.plan_timezone IS NOT NULL AND v_row.plan_last_planned_date IS NOT NULL THEN
    v_today := (p_now AT TIME ZONE v_row.plan_timezone)::date;
    v_on_plan := v_row.plan_last_planned_date >= v_today - public.email_gate_config_int('email_gate_plan_recent_days');
    v_run := v_row.plan_missed_run;
    -- Any activity after the last missed day ended breaks the run (off-plan activity counts).
    IF v_row.plan_last_missed_date IS NULL
       OR (v_wake IS NOT NULL
           AND v_wake >= ((v_row.plan_last_missed_date + 1)::timestamp AT TIME ZONE v_row.plan_timezone)) THEN
      v_run := 0;
    END IF;
  END IF;

  -- Paused is sticky until a wake (activity or Keep me posted) after it began.
  IF v_row.state = 'paused' AND (v_wake IS NULL OR v_wake <= v_row.state_since) THEN
    RETURN jsonb_build_object('state', 'paused', 'reason', v_row.reason, 'last_active', v_activity,
                              'unengaged', v_unengaged, 'on_plan', v_on_plan, 'plan_run', v_run);
  END IF;

  IF v_on_plan THEN
    IF v_run >= public.email_gate_config_int('email_gate_plan_pause_missed_days')
       AND v_idle_days >= public.email_gate_config_int('email_gate_plan_pause_min_inactive_days')
       AND v_unengaged >= public.email_gate_config_int('email_gate_pause_unengaged_sends') THEN
      v_state := 'paused'; v_reason := 'plan_missed_and_unengaged';
    ELSIF v_run >= public.email_gate_config_int('email_gate_plan_cooling_missed_days') THEN
      v_state := 'cooling'; v_reason := 'plan_missed';
    ELSE
      v_state := 'active'; v_reason := 'plan_on_track';
    END IF;
  ELSE
    IF v_idle_days >= public.email_gate_config_int('email_gate_pause_inactive_days')
       AND v_unengaged >= public.email_gate_config_int('email_gate_pause_unengaged_sends') THEN
      v_state := 'paused'; v_reason := 'inactive_and_unengaged';
    ELSIF v_idle_days >= public.email_gate_config_int('email_gate_active_days') THEN
      v_state := 'cooling'; v_reason := 'inactive';
    ELSE
      v_state := 'active'; v_reason := 'recent_activity';
    END IF;
  END IF;

  RETURN jsonb_build_object('state', v_state, 'reason', v_reason, 'last_active', v_activity,
                            'unengaged', v_unengaged, 'on_plan', v_on_plan, 'plan_run', v_run);
END;
$fn$;

-- The verdict for one email kind in a given state (pure). {allow, reason}.
CREATE OR REPLACE FUNCTION public.email_gate_verdict(
  p_profile_id uuid,
  p_kind       text,
  p_state      text,
  p_now        timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_category text := public.email_category(p_kind);
  v_profile  record;
  v_last     timestamptz;
BEGIN
  IF v_category IN ('always', 'notice') THEN
    RETURN jsonb_build_object('allow', true, 'reason', v_category);
  END IF;
  SELECT p.deleted_at, COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
           OR p.role::text <> 'student' AS adult_or_13
    INTO v_profile
    FROM public.profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'no_recipient');
  END IF;
  -- Under-13 handling is unchanged for the existing governed emails; the new marketing-shaped
  -- kinds (manual campaigns, milestones) are 13+ only (Doctrine rule 7).
  IF (p_kind = 'manual_campaign' OR v_category = 'milestone') AND NOT v_profile.adult_or_13 THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'under_13');
  END IF;
  IF v_category = 'milestone' THEN
    RETURN jsonb_build_object('allow', true, 'reason', 'milestone');
  END IF;
  IF NOT public.email_gate_config_bool('email_gate_enabled') THEN
    RETURN jsonb_build_object('allow', true, 'reason', 'gate_disabled');
  END IF;
  IF p_state = 'paused' THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'paused');
  END IF;
  IF p_state = 'cooling' THEN
    IF p_kind = 'qotd_daily' THEN
      RETURN jsonb_build_object('allow', true, 'reason', 'cooling_qotd_exempt');
    END IF;
    v_last := public.email_gate_last_capped_send(p_profile_id, p_now);
    IF v_last IS NOT NULL
       AND v_last > p_now - make_interval(days => public.email_gate_config_int('email_gate_cooling_min_interval_days')) THEN
      RETURN jsonb_build_object('allow', false, 'reason', 'cooling_cap');
    END IF;
    RETURN jsonb_build_object('allow', true, 'reason', 'cooling');
  END IF;
  RETURN jsonb_build_object('allow', true, 'reason', 'active');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Writers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_gate_enqueue_mirror(p_profile_id uuid, p_state text, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Never for an under-13 (Doctrine rule 7: no marketing data); guardians and 13+ students only.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_profile_id AND p.deleted_at IS NULL
                    AND (p.role::text = 'guardian'
                         OR COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false))) THEN
    RETURN;
  END IF;
  INSERT INTO public.email_gate_resend_outbox
    (profile_id, email_state, enqueued_at, attempts, next_attempt_at, last_error, synced_at)
  VALUES (p_profile_id, p_state, p_now, 0, p_now, NULL, NULL)
  ON CONFLICT (profile_id) DO UPDATE
     SET email_state = EXCLUDED.email_state, enqueued_at = p_now, attempts = 0,
         next_attempt_at = p_now, last_error = NULL, synced_at = NULL;
END;
$fn$;

-- Brings the stored state up to date, recording any change. Returns the state.
CREATE OR REPLACE FUNCTION public.email_gate_refresh(
  p_profile_id uuid,
  p_now        timestamptz DEFAULT now(),
  p_actor      text DEFAULT 'system'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row      public.email_gate_state%ROWTYPE;
  v_found    boolean;
  v_computed jsonb;
  v_state    text;
  v_reason   text;
  v_profile  record;
  v_test     date;
  v_from     text;
BEGIN
  IF p_actor NOT IN ('system', 'keep_me_posted', 'backfill') THEN
    RAISE EXCEPTION 'email_gate_refresh: unknown actor %', p_actor USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('email_gate:' || p_profile_id::text));
  SELECT * INTO v_row FROM public.email_gate_state WHERE profile_id = p_profile_id FOR UPDATE;
  v_found := FOUND;

  v_computed := public.email_gate_compute(p_profile_id, p_now);
  v_state := v_computed ->> 'state';
  v_reason := v_computed ->> 'reason';

  IF NOT v_found THEN
    INSERT INTO public.email_gate_state (profile_id, state, reason, state_since, updated_at)
    VALUES (p_profile_id, 'active', 'initial', p_now, p_now);
    SELECT * INTO v_row FROM public.email_gate_state WHERE profile_id = p_profile_id;
  END IF;

  IF v_row.state = v_state THEN
    RETURN v_state;
  END IF;
  v_from := v_row.state;

  UPDATE public.email_gate_state
     SET state = v_state,
         reason = v_reason,
         state_since = p_now,
         pause_episode = pause_episode + CASE WHEN v_state = 'paused' THEN 1 ELSE 0 END,
         updated_at = p_now
   WHERE profile_id = p_profile_id
  RETURNING * INTO v_row;

  INSERT INTO public.email_gate_transitions (profile_id, from_state, to_state, reason, actor, occurred_at)
  VALUES (p_profile_id, v_from, v_state, v_reason, p_actor, p_now);

  PERFORM public.email_gate_enqueue_mirror(p_profile_id, v_state, p_now);

  -- Entering paused: the student pause note, once per episode, 13+ students only.
  IF v_state = 'paused' THEN
    SELECT p.role::text AS role, p.deleted_at,
           COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false) AS of_age
      INTO v_profile
      FROM public.profiles p WHERE p.id = p_profile_id;
    IF v_profile.role = 'student' AND v_profile.deleted_at IS NULL AND v_profile.of_age
       AND p_actor <> 'backfill' THEN
      SELECT public.study_profile_effective_exam_date(sp.target_exam_dates, (p_now AT TIME ZONE sp.timezone)::date)
        INTO v_test
        FROM public.student_study_profile sp WHERE sp.student_id = p_profile_id;
      PERFORM public.emit_notification_event(
        public.notification_event_id('email_gate_paused_notice',
                                     p_profile_id::text || ':' || v_row.pause_episode::text),
        'email_gate_paused_notice',
        p_profile_id,
        jsonb_build_array(jsonb_build_object('profile_id', p_profile_id,
                                             'channels', jsonb_build_array('email'))),
        jsonb_build_object('first_name', public.accountability_student_first_name(p_profile_id),
                           'episode', v_row.pause_episode, 'test_date', v_test),
        p_now + interval '3 days');
    END IF;
  END IF;
  RETURN v_state;
END;
$fn$;

-- THE gate. Every governed sender calls it before sending. {allow, reason, state}.
CREATE OR REPLACE FUNCTION public.email_gate_decide(
  p_profile_id uuid,
  p_kind       text,
  p_now        timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_category text := public.email_category(p_kind);
  v_state    text;
BEGIN
  IF v_category IN ('always', 'notice') THEN
    RETURN jsonb_build_object('allow', true, 'reason', v_category, 'state', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'no_recipient', 'state', NULL);
  END IF;
  v_state := public.email_gate_refresh(p_profile_id, p_now, 'system');
  RETURN public.email_gate_verdict(p_profile_id, p_kind, v_state, p_now)
         || jsonb_build_object('state', v_state);
END;
$fn$;

-- The signed "Keep me posted" link: lifts a pause now (a student) or every digest pause (a
-- guardian). Idempotent. Returns {ok, changed, state}.
CREATE OR REPLACE FUNCTION public.email_gate_keep_posted(p_profile_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before  text;
  v_after   text;
  v_closed  integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'state', NULL);
  END IF;
  PERFORM public.email_gate_refresh(p_profile_id, p_now, 'system');
  SELECT state INTO v_before FROM public.email_gate_state WHERE profile_id = p_profile_id;

  UPDATE public.email_gate_guardian_pauses
     SET resumed_at = p_now, resume_reason = 'keep_me_posted'
   WHERE guardian_id = p_profile_id AND resumed_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE public.email_gate_state SET resumed_at = p_now, updated_at = p_now
   WHERE profile_id = p_profile_id;
  v_after := public.email_gate_refresh(p_profile_id, p_now, 'keep_me_posted');
  RETURN jsonb_build_object('ok', true, 'changed', v_before IS DISTINCT FROM v_after OR v_closed > 0,
                            'state', v_after);
END;
$fn$;

-- The daily sweep: refreshes every student and guardian, in pages. {processed, changed, last_id}.
CREATE OR REPLACE FUNCTION public.email_gate_sweep(
  p_now   timestamptz DEFAULT now(),
  p_limit integer DEFAULT 500,
  p_after uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r         record;
  v_before  text;
  v_after   text;
  v_n       integer := 0;
  v_changed integer := 0;
  v_last    uuid := NULL;
BEGIN
  FOR r IN
    SELECT p.id FROM public.profiles p
     WHERE p.role::text IN ('student', 'guardian') AND p.deleted_at IS NULL
       AND (p_after IS NULL OR p.id > p_after)
     ORDER BY p.id
     LIMIT p_limit
  LOOP
    SELECT state INTO v_before FROM public.email_gate_state WHERE profile_id = r.id;
    v_after := public.email_gate_refresh(r.id, p_now, 'system');
    IF v_before IS DISTINCT FROM v_after AND NOT (v_before IS NULL AND v_after = 'active') THEN
      v_changed := v_changed + 1;
    END IF;
    v_n := v_n + 1;
    v_last := r.id;
  END LOOP;
  RETURN jsonb_build_object('processed', v_n, 'changed', v_changed, 'last_id', v_last);
END;
$fn$;

-- The plan-aware input: the accountability job hands over each student's evaluated planned
-- days. A planned day is missed only if there was no activity of any kind that day. Days already
-- recorded, and days after p_through (not yet ended), are skipped, so a rerun changes nothing.
-- p_days: [{"date": "YYYY-MM-DD", "outcome": "did_work" | "missed"}], ascending.
CREATE OR REPLACE FUNCTION public.email_gate_record_plan_days(
  p_student_id uuid,
  p_days       jsonb,
  p_timezone   text,
  p_through    date,
  p_now        timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row      public.email_gate_state%ROWTYPE;
  d          record;
  v_recorded integer := 0;
  v_state    text;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'email_gate_record_plan_days: p_days must be a JSON array' USING ERRCODE = '22023';
  END IF;
  PERFORM public.email_gate_refresh(p_student_id, p_now, 'system');
  PERFORM pg_advisory_xact_lock(hashtext('email_gate:' || p_student_id::text));
  SELECT * INTO v_row FROM public.email_gate_state WHERE profile_id = p_student_id FOR UPDATE;

  FOR d IN
    SELECT (x ->> 'date')::date AS day, x ->> 'outcome' AS outcome
      FROM jsonb_array_elements(p_days) AS x
     ORDER BY 1
  LOOP
    IF d.outcome NOT IN ('did_work', 'missed') THEN
      RAISE EXCEPTION 'email_gate_record_plan_days: unknown outcome %', d.outcome USING ERRCODE = '22023';
    END IF;
    CONTINUE WHEN d.day > p_through;
    CONTINUE WHEN v_row.plan_last_evaluated_date IS NOT NULL AND d.day <= v_row.plan_last_evaluated_date;
    IF d.outcome = 'missed' AND NOT public.email_gate_active_on(p_student_id, d.day, p_timezone) THEN
      v_row.plan_missed_run := v_row.plan_missed_run + 1;
      v_row.plan_last_missed_date := d.day;
    ELSE
      v_row.plan_missed_run := 0;
    END IF;
    v_row.plan_last_planned_date := d.day;
    v_row.plan_last_evaluated_date := d.day;
    v_recorded := v_recorded + 1;
  END LOOP;

  UPDATE public.email_gate_state
     SET plan_timezone = p_timezone,
         plan_missed_run = v_row.plan_missed_run,
         plan_last_missed_date = v_row.plan_last_missed_date,
         plan_last_planned_date = v_row.plan_last_planned_date,
         plan_last_evaluated_date = v_row.plan_last_evaluated_date,
         updated_at = p_now
   WHERE profile_id = p_student_id;

  v_state := public.email_gate_refresh(p_student_id, p_now, 'system');
  RETURN jsonb_build_object('recorded', v_recorded, 'run', v_row.plan_missed_run, 'state', v_state);
END;
$fn$;

-- Parents: open and close the per-student digest pauses, and send the one pause email per
-- episode. {opened, closed}.
CREATE OR REPLACE FUNCTION public.email_gate_guardian_refresh(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r          record;
  v_opened   integer := 0;
  v_closed   integer := 0;
  v_n        integer;
  v_episode  integer;
  v_activity timestamptz;
  v_idle     numeric;
  v_run      integer;
  v_on_plan  boolean;
  v_g        public.email_gate_state%ROWTYPE;
  v_test     date;
BEGIN
  -- Close: the link ended, the student studied, or the guardian signed in.
  UPDATE public.email_gate_guardian_pauses gp
     SET resumed_at = p_now, resume_reason = 'link_inactive'
   WHERE gp.resumed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.guardian_links l
                      WHERE l.guardian_profile_id = gp.guardian_id
                        AND l.student_profile_id = gp.student_id AND l.status = 'active');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_closed := v_closed + v_n;

  UPDATE public.email_gate_guardian_pauses gp
     SET resumed_at = p_now, resume_reason = 'student_active'
   WHERE gp.resumed_at IS NULL
     AND public.email_gate_activity_between(gp.student_id, gp.paused_at, p_now) IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_closed := v_closed + v_n;

  UPDATE public.email_gate_guardian_pauses gp
     SET resumed_at = p_now, resume_reason = 'guardian_login'
   WHERE gp.resumed_at IS NULL
     AND public.email_gate_last_sign_in(gp.guardian_id) > gp.paused_at
     AND public.email_gate_last_sign_in(gp.guardian_id) <= p_now;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_closed := v_closed + v_n;

  -- Open: a digest guardian whose student went quiet, once per episode.
  FOR r IN
    SELECT DISTINCT l.guardian_profile_id AS guardian_id, l.student_profile_id AS student_id,
           s.created_at AS student_created_at
      FROM public.guardian_links l
      JOIN public.profiles g ON g.id = l.guardian_profile_id
      JOIN public.profiles s ON s.id = l.student_profile_id
     WHERE l.status = 'active'
       AND g.role::text = 'guardian' AND g.deleted_at IS NULL
       AND s.deleted_at IS NULL
       AND public.guardian_daily_digest_email_enabled(g.id)
       AND public.guardian_view_decision(g.id, s.id) = 'allow'
       AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses gp
                        WHERE gp.guardian_id = g.id AND gp.student_id = s.id AND gp.resumed_at IS NULL)
     ORDER BY 1, 2
  LOOP
    v_activity := public.email_gate_last_activity(r.student_id, p_now);
    -- Once per episode: after a pause, a new one needs student activity since it began.
    SELECT max(gp.episode) INTO v_episode
      FROM public.email_gate_guardian_pauses gp
     WHERE gp.guardian_id = r.guardian_id AND gp.student_id = r.student_id;
    IF v_episode IS NOT NULL AND (v_activity IS NULL OR v_activity <= (
         SELECT gp.paused_at FROM public.email_gate_guardian_pauses gp
          WHERE gp.guardian_id = r.guardian_id AND gp.student_id = r.student_id
            AND gp.episode = v_episode)) THEN
      CONTINUE;
    END IF;
    v_idle := EXTRACT(EPOCH FROM (p_now - GREATEST(COALESCE(v_activity, r.student_created_at), r.student_created_at))) / 86400.0;

    SELECT * INTO v_g FROM public.email_gate_state WHERE profile_id = r.student_id;
    v_on_plan := v_g.plan_timezone IS NOT NULL AND v_g.plan_last_planned_date IS NOT NULL
      AND v_g.plan_last_planned_date >= (p_now AT TIME ZONE v_g.plan_timezone)::date
                                        - public.email_gate_config_int('email_gate_plan_recent_days');
    v_run := COALESCE(v_g.plan_missed_run, 0);
    IF v_g.plan_last_missed_date IS NULL
       OR (v_activity IS NOT NULL
           AND v_activity >= ((v_g.plan_last_missed_date + 1)::timestamp AT TIME ZONE v_g.plan_timezone)) THEN
      v_run := 0;
    END IF;

    IF (v_on_plan
        AND v_run >= public.email_gate_config_int('email_gate_plan_guardian_missed_days')
        AND v_idle >= public.email_gate_config_int('email_gate_plan_guardian_min_inactive_days'))
       OR (NOT v_on_plan
           AND v_idle >= public.email_gate_config_int('email_gate_guardian_inactive_days')) THEN
      v_episode := COALESCE(v_episode, 0) + 1;
      INSERT INTO public.email_gate_guardian_pauses (guardian_id, student_id, episode, paused_at)
      VALUES (r.guardian_id, r.student_id, v_episode, p_now);
      SELECT public.study_profile_effective_exam_date(sp.target_exam_dates, (p_now AT TIME ZONE sp.timezone)::date)
        INTO v_test
        FROM public.student_study_profile sp WHERE sp.student_id = r.student_id;
      PERFORM public.emit_notification_event(
        public.notification_event_id('email_gate_guardian_paused',
                                     r.guardian_id::text || ':' || r.student_id::text || ':' || v_episode::text),
        'email_gate_guardian_paused',
        r.student_id,
        jsonb_build_array(jsonb_build_object('profile_id', r.guardian_id,
                                             'channels', jsonb_build_array('email'))),
        jsonb_build_object('student_first_name', public.accountability_student_first_name(r.student_id),
                           'guardian_first_name', public.accountability_student_first_name(r.guardian_id),
                           'test_date', v_test,
                           'episode', v_episode),
        p_now + interval '3 days');
      v_opened := v_opened + 1;
      v_test := NULL;
    END IF;
  END LOOP;

  -- Guardians whose pauses changed: bring their own state up to date.
  FOR r IN
    SELECT DISTINCT gp.guardian_id FROM public.email_gate_guardian_pauses gp
     WHERE gp.paused_at = p_now OR gp.resumed_at = p_now
  LOOP
    PERFORM public.email_gate_refresh(r.guardian_id, p_now, 'system');
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'closed', v_closed);
END;
$fn$;

-- Resend email.opened / email.clicked, stored once per svix-id with the recipient's profile.
-- Returns 'recorded' | 'duplicate'.
CREATE OR REPLACE FUNCTION public.record_email_engagement_event(
  p_provider_event_id   text,
  p_provider_message_id text,
  p_event_type          text,
  p_occurred_at         timestamptz,
  p_recipients          text[]
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_message   uuid;
  v_recipient uuid;
BEGIN
  IF p_event_type NOT IN ('email.opened', 'email.clicked') THEN
    RAISE EXCEPTION 'record_email_engagement_event: not an engagement event: %', p_event_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT m.message_id, m.recipient_profile_id INTO v_message, v_recipient
    FROM public.notification_messages m
   WHERE m.provider_message_id = p_provider_message_id AND m.channel = 'email'
   LIMIT 1;
  IF v_recipient IS NULL THEN
    SELECT p.id INTO v_recipient
      FROM unnest(COALESCE(p_recipients, '{}'::text[])) WITH ORDINALITY AS t(addr, n)
      JOIN public.profiles p ON lower(p.email) = lower(btrim(t.addr)) AND p.deleted_at IS NULL
     ORDER BY t.n, p.id
     LIMIT 1;
  END IF;
  INSERT INTO public.notification_delivery_events
    (provider_event_id, provider_message_id, event_type, occurred_at, message_id, outcome,
     applied_at, recipient_profile_id)
  VALUES (p_provider_event_id, p_provider_message_id, p_event_type, p_occurred_at, v_message,
          CASE WHEN v_message IS NULL THEN 'unmatched' ELSE 'ignored' END,
          CASE WHEN v_message IS NULL THEN NULL ELSE now() END, v_recipient)
  ON CONFLICT (provider_event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;
  RETURN 'recorded';
END;
$fn$;

-- A manual campaign email, recorded so the gate counts it. Idempotent by Resend id.
-- Returns 'recorded' | 'duplicate' | 'unknown_recipient'.
CREATE OR REPLACE FUNCTION public.record_campaign_send(
  p_email     text,
  p_campaign  text,
  p_variant   text,
  p_sent_at   timestamptz,
  p_resend_id text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_profile uuid;
BEGIN
  SELECT p.id INTO v_profile FROM public.profiles p
   WHERE lower(p.email) = lower(btrim(p_email)) AND p.deleted_at IS NULL
   ORDER BY p.id LIMIT 1;
  IF v_profile IS NULL THEN
    RETURN 'unknown_recipient';
  END IF;
  INSERT INTO public.email_campaign_sends (profile_id, campaign, variant, sent_at, resend_id)
  VALUES (v_profile, p_campaign, p_variant, p_sent_at, p_resend_id)
  ON CONFLICT (resend_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;
  RETURN 'recorded';
END;
$fn$;

-- The Resend mirror's queue. The address is returned for the server's one PATCH; nothing else.
CREATE OR REPLACE FUNCTION public.email_gate_outbox_due(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 100)
RETURNS TABLE (profile_id uuid, email text, email_state text, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT o.profile_id, p.email, o.email_state, o.attempts
    FROM public.email_gate_resend_outbox o
    JOIN public.profiles p ON p.id = o.profile_id
   WHERE o.synced_at IS NULL AND o.next_attempt_at <= p_now
     AND p.deleted_at IS NULL AND p.email IS NOT NULL
   ORDER BY o.next_attempt_at, o.profile_id
   LIMIT p_limit;
$fn$;

-- Marks one mirror attempt. A success counts only for the state it carried (a newer state
-- queued meanwhile stays due). A failure backs off: 2^attempts minutes, at most a day.
CREATE OR REPLACE FUNCTION public.email_gate_outbox_mark(
  p_profile_id  uuid,
  p_email_state text,
  p_ok          boolean,
  p_error       text DEFAULT NULL,
  p_now         timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_ok THEN
    UPDATE public.email_gate_resend_outbox
       SET synced_at = p_now, last_error = NULL
     WHERE profile_id = p_profile_id AND email_state = p_email_state AND synced_at IS NULL;
  ELSE
    UPDATE public.email_gate_resend_outbox
       SET attempts = attempts + 1,
           next_attempt_at = p_now + make_interval(mins => LEAST(power(2, attempts + 1)::integer, 1440)),
           last_error = left(COALESCE(p_error, 'unknown'), 200)
     WHERE profile_id = p_profile_id AND email_state = p_email_state AND synced_at IS NULL;
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. The SAT milestones: a week before, the day after, score release day. 13+ students only,
--    email only, one per (student, test date, kind) by insert-once ids. p_release_dates maps a
--    test date to College Board's published score release date ({"2026-11-07": "2026-11-20"});
--    a date without one skips the release-day email (ruling 2026-11-02, section 2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_milestones_notify(
  p_now           timestamptz DEFAULT now(),
  p_release_dates jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r         record;
  v_today   date;
  v_release date;
  v_week    integer := 0;
  v_after   integer := 0;
  v_scores  integer := 0;
  v_before  integer := public.email_gate_config_int('email_gate_milestone_days_before_test');
BEGIN
  IF p_release_dates IS NULL OR jsonb_typeof(p_release_dates) <> 'object' THEN
    RAISE EXCEPTION 'email_milestones_notify: p_release_dates must be a JSON object' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT p.id AS student_id, sp.timezone, d.test_date
      FROM public.student_study_profile sp
      JOIN public.profiles p ON p.id = sp.student_id
      CROSS JOIN LATERAL unnest(sp.target_exam_dates) AS d(test_date)
     WHERE p.role::text = 'student' AND p.deleted_at IS NULL
       AND COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests x
                        WHERE x.profile_id = p.id AND x.status = 'pending')
     ORDER BY p.id, d.test_date
  LOOP
    v_today := (p_now AT TIME ZONE r.timezone)::date;
    v_release := NULLIF(p_release_dates ->> r.test_date::text, '')::date;

    IF v_today BETWEEN r.test_date - v_before AND r.test_date - (v_before - 2) THEN
      IF NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id =
           public.notification_event_id('sat_week_before', r.student_id::text || ':' || r.test_date::text)) THEN
        PERFORM public.emit_notification_event(
          public.notification_event_id('sat_week_before', r.student_id::text || ':' || r.test_date::text),
          'sat_week_before', r.student_id,
          jsonb_build_array(jsonb_build_object('profile_id', r.student_id, 'channels', jsonb_build_array('email'))),
          jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                             'test_date', r.test_date),
          (r.test_date::timestamp AT TIME ZONE r.timezone));
        v_week := v_week + 1;
      END IF;
    END IF;

    IF v_today BETWEEN r.test_date + 1 AND r.test_date + 3 THEN
      IF NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id =
           public.notification_event_id('sat_day_after', r.student_id::text || ':' || r.test_date::text)) THEN
        PERFORM public.emit_notification_event(
          public.notification_event_id('sat_day_after', r.student_id::text || ':' || r.test_date::text),
          'sat_day_after', r.student_id,
          jsonb_build_array(jsonb_build_object('profile_id', r.student_id, 'channels', jsonb_build_array('email'))),
          jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                             'test_date', r.test_date,
                             'release_date', CASE WHEN v_release > v_today THEN v_release END),
          ((r.test_date + 4)::timestamp AT TIME ZONE r.timezone));
        v_after := v_after + 1;
      END IF;
    END IF;

    IF v_release IS NOT NULL AND v_today BETWEEN v_release AND v_release + 3 THEN
      IF NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id =
           public.notification_event_id('sat_scores_released', r.student_id::text || ':' || r.test_date::text)) THEN
        PERFORM public.emit_notification_event(
          public.notification_event_id('sat_scores_released', r.student_id::text || ':' || r.test_date::text),
          'sat_scores_released', r.student_id,
          jsonb_build_array(jsonb_build_object('profile_id', r.student_id, 'channels', jsonb_build_array('email'))),
          jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                             'test_date', r.test_date, 'release_date', v_release),
          ((v_release + 4)::timestamp AT TIME ZONE r.timezone));
        v_scores := v_scores + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('week_before', v_week, 'day_after', v_after, 'scores_released', v_scores);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. The QOTD reminder folded into the gate (ruling 2026-11-02 (3), (4)). Body restated from
--    20261031000000 with one change: the 7-send sunset is gone; the email goes out unless the
--    gate has the student paused (the QOTD is exempt from the cooling cap). The dispatcher asks
--    the gate again at send time. Mutations H8, N1-N3 (home-qotd) and Q15 (quiet hours) aim here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_daily_notify(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today   date := public.chicago_day(p_now);
  v_emitted integer := 0;
  v_email   integer := 0;
  v_gated   integer := 0;
  r         record;
  v_event   uuid;
  v_email_on boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.qotd_schedule q WHERE q.qotd_date = v_today) THEN
    RETURN jsonb_build_object('emitted', 0, 'mailable', 0, 'gate_paused', 0);
  END IF;

  FOR r IN
    SELECT p.id AS student_id,
           -- Email: the preference is on and 13+ (the gate decides the rest).
           (COALESCE(c.enabled, false)
            AND public.marketing_opt_in_age_eligible(p.date_of_birth)) AS email_wanted,
           g.state AS gate_state
      FROM public.profiles p
      LEFT JOIN public.notification_channel_preferences c
             ON c.profile_id = p.id AND c.event_type = 'qotd_daily' AND c.channel = 'email'
      LEFT JOIN public.email_gate_state g ON g.profile_id = p.id
     WHERE p.role = 'student' AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                        WHERE d.profile_id = p.id AND d.status = 'pending')
       AND NOT EXISTS (SELECT 1 FROM public.notification_events ev
                        WHERE ev.event_id = public.notification_event_id('qotd_daily', p.id::text || ':' || v_today::text))
       AND NOT EXISTS (SELECT 1 FROM public.student_answer_days(p.id, v_today) a WHERE a.day = v_today)
     ORDER BY p.id
     LIMIT p_limit
  LOOP
    v_event := public.notification_event_id('qotd_daily', r.student_id::text || ':' || v_today::text);
    v_email_on := r.email_wanted;
    IF v_email_on AND r.gate_state = 'paused' THEN
      -- Paused: no email unless a wake since then lifts it (refresh records the change).
      v_email_on := public.email_gate_refresh(r.student_id, p_now, 'system') <> 'paused';
      IF NOT v_email_on THEN v_gated := v_gated + 1; END IF;
    END IF;

    PERFORM public.emit_notification_event(
      v_event,
      'qotd_daily',
      r.student_id,
      jsonb_build_array(jsonb_build_object(
        'profile_id', r.student_id,
        'channels', CASE WHEN v_email_on THEN jsonb_build_array('in_app', 'email')
                         ELSE jsonb_build_array('in_app') END
      )),
      jsonb_build_object(
        'qotd_date', v_today,
        'current_streak', COALESCE((SELECT s.current_streak FROM public.student_streak(r.student_id, p_now) s), 0),
        'email_variant', 'daily'
      ),
      -- Owner ruling 2026-10-09 (schedule audit Step 2, item 3(1)): today's question expires
      -- when its America/Chicago day ends; a late send is a dropped send.
      ((v_today + 1)::timestamp AT TIME ZONE 'America/Chicago')
    );
    v_emitted := v_emitted + 1;
    IF v_email_on THEN v_email := v_email + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('emitted', v_emitted, 'mailable', v_email, 'gate_paused', v_gated);
END;
$fn$;

-- The Settings read: "paused" is now the gate's pause.
CREATE OR REPLACE FUNCTION public.qotd_daily_email_preference(p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'eligible', COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
                AND p.role = 'student' AND p.deleted_at IS NULL,
    'enabled', COALESCE(c.enabled, false),
    'paused', COALESCE(g.state = 'paused', false)
  )
    FROM public.profiles p
    LEFT JOIN public.notification_channel_preferences c
           ON c.profile_id = p.id AND c.event_type = 'qotd_daily' AND c.channel = 'email'
    LEFT JOIN public.email_gate_state g ON g.profile_id = p.id
   WHERE p.id = p_student_id;
$fn$;

-- The old paused email's resume link (still in inboxes) and the Settings "Resume": lift the
-- gate's pause, and the legacy QOTD pause through the one writer.
CREATE OR REPLACE FUNCTION public.qotd_email_resume(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_paused boolean;
  v_gate   jsonb := NULL;
  v_result jsonb := NULL;
BEGIN
  SELECT paused_at IS NOT NULL INTO v_paused
    FROM public.student_qotd_email_prefs WHERE student_id = p_student_id;
  IF EXISTS (SELECT 1 FROM public.email_gate_state g WHERE g.profile_id = p_student_id AND g.state = 'paused') THEN
    v_gate := public.email_gate_keep_posted(p_student_id, p_now);
  END IF;
  IF COALESCE(v_paused, false) THEN
  v_result := public.set_qotd_daily_email(p_student_id, true, 'email_resume', NULL, p_now);
  END IF;
  IF v_gate IS NULL AND v_result IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed',
    COALESCE((v_gate->>'changed')::boolean, false)
    OR (COALESCE((v_result->>'enabled')::boolean, false) AND COALESCE((v_result->>'changed')::boolean, false)));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. The guardian digest skips a student whose digest is paused for that guardian. Body
--     restated from 20261101000000 with one change (the NOT EXISTS in the student loop).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardian_daily_digest_notify(
  p_now   timestamptz DEFAULT now(),
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_day      date := public.chicago_day(p_now);
  v_guardian record;
  v_student  record;
  v_sections jsonb;
  v_section  jsonb;
  v_changes  jsonb;
  v_alert    jsonb;
  v_back     boolean;
  v_complete jsonb;
  v_emitted  integer := 0;
  v_seen     integer := 0;
BEGIN
  FOR v_guardian IN
    SELECT g.id
      FROM public.profiles g
     WHERE g.role = 'guardian' AND g.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                        WHERE d.profile_id = g.id AND d.status = 'pending')
       AND EXISTS (SELECT 1 FROM public.guardian_links l
                    WHERE l.guardian_profile_id = g.id AND l.status = 'active')
       AND public.guardian_daily_digest_email_enabled(g.id)
       AND NOT EXISTS (SELECT 1 FROM public.notification_events e
                        WHERE e.event_id = public.notification_event_id(
                          'guardian_daily_digest', g.id::text || ':' || v_day::text))
     ORDER BY g.id
     LIMIT p_limit
  LOOP
    v_seen := v_seen + 1;
    v_sections := '[]'::jsonb;
    FOR v_student IN
      SELECT DISTINCT l.student_profile_id AS id
        FROM public.guardian_links l
       WHERE l.guardian_profile_id = v_guardian.id AND l.status = 'active'
         AND public.guardian_view_decision(v_guardian.id, l.student_profile_id) = 'allow'
         -- Email send gate (2026-11-02): a student whose digest is paused for this guardian.
         AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses gp
                          WHERE gp.guardian_id = v_guardian.id
                            AND gp.student_id = l.student_profile_id
                            AND gp.resumed_at IS NULL)
       ORDER BY 1
    LOOP
      -- Plan changes reported today: a reduced day once, from its first "before" to its last
      -- "after" (the per-day aggregate), and each full-length move or removal.
      SELECT COALESCE(jsonb_agg(c.item ORDER BY c.sort_date, c.sort_kind, c.sort_at), '[]'::jsonb)
        INTO v_changes
        FROM (
          SELECT jsonb_build_object(
                   'kind', 'day_reduced',
                   'plan_date', x.plan_date,
                   'before_minutes', (array_agg(x.before_minutes ORDER BY x.created_at, x.event_id))[1],
                   'after_minutes',  (array_agg(x.after_minutes ORDER BY x.created_at DESC, x.event_id DESC))[1]
                 ) AS item,
                 x.plan_date AS sort_date, 0 AS sort_kind, min(x.created_at) AS sort_at
            FROM (SELECT e.event_id, e.created_at,
                         (e.payload ->> 'plan_date')::date AS plan_date,
                         (e.payload ->> 'before_minutes')::integer AS before_minutes,
                         (e.payload ->> 'after_minutes')::integer AS after_minutes
                    FROM public.notification_events e
                   WHERE e.event_type = 'study_plan_changed'
                     AND e.subject_profile_id = v_student.id
                     AND e.payload ->> 'kind' = 'day_reduced'
                     AND (e.payload ->> 'digest_date')::date = v_day) x
           GROUP BY x.plan_date
          HAVING (array_agg(x.after_minutes ORDER BY x.created_at DESC, x.event_id DESC))[1]
               < (array_agg(x.before_minutes ORDER BY x.created_at, x.event_id))[1]
          UNION ALL
          SELECT CASE WHEN e.payload ->> 'kind' = 'full_length_moved'
                      THEN jsonb_build_object('kind', 'full_length_moved',
                                              'plan_date', e.payload ->> 'plan_date',
                                              'to_date', e.payload ->> 'to_date')
                      ELSE jsonb_build_object('kind', 'full_length_removed',
                                              'plan_date', e.payload ->> 'plan_date') END,
                 (e.payload ->> 'plan_date')::date, 1, e.created_at
            FROM public.notification_events e
           WHERE e.event_type = 'study_plan_changed'
             AND e.subject_profile_id = v_student.id
             AND e.payload ->> 'kind' IN ('full_length_moved', 'full_length_removed')
             AND (e.payload ->> 'digest_date')::date = v_day
          UNION ALL
          -- Schedule changes (SCL-230): once per kind, the first "before" to the last "after";
          -- dropped when the day ended where it began (changed and changed back).
          SELECT CASE y.kind
                   WHEN 'study_days' THEN jsonb_build_object(
                     'kind', 'study_days',
                     'before_days', y.first_p -> 'before_days',
                     'after_days', y.last_p -> 'after_days')
                   WHEN 'daily_minutes' THEN jsonb_build_object(
                     'kind', 'daily_minutes',
                     'before_minutes', y.first_p -> 'before_minutes',
                     'after_minutes', y.last_p -> 'after_minutes')
                   ELSE jsonb_build_object(
                     'kind', 'full_length_frequency',
                     'before_weekday', y.first_p -> 'before_weekday',
                     'before_interval_weeks', y.first_p -> 'before_interval_weeks',
                     'after_weekday', y.last_p -> 'after_weekday',
                     'after_interval_weeks', y.last_p -> 'after_interval_weeks') END,
                 v_day, -1, y.first_at
            FROM (SELECT e.payload ->> 'kind' AS kind,
                         (array_agg(e.payload ORDER BY e.created_at, e.event_id))[1] AS first_p,
                         (array_agg(e.payload ORDER BY e.created_at DESC, e.event_id DESC))[1] AS last_p,
                         min(e.created_at) AS first_at
                    FROM public.notification_events e
                   WHERE e.event_type = 'study_plan_changed'
                     AND e.subject_profile_id = v_student.id
                     AND e.payload ->> 'kind' IN ('study_days', 'daily_minutes', 'full_length_frequency')
                     AND (e.payload ->> 'digest_date')::date = v_day
                   GROUP BY 1) y
           WHERE NOT CASE y.kind
                   WHEN 'study_days' THEN (y.first_p -> 'before_days') = (y.last_p -> 'after_days')
                   WHEN 'daily_minutes' THEN (y.first_p -> 'before_minutes') = (y.last_p -> 'after_minutes')
                   ELSE (y.first_p -> 'before_weekday') = (y.last_p -> 'after_weekday')
                        AND (y.first_p -> 'before_interval_weeks') = (y.last_p -> 'after_interval_weeks') END
        ) c;

      SELECT jsonb_build_object('missed_days', (e.payload ->> 'missed_days')::integer)
        INTO v_alert
        FROM public.notification_events e
       WHERE e.event_type = 'missed_plan_alert'
         AND e.subject_profile_id = v_student.id
         AND (e.payload ->> 'digest_date')::date = v_day
       ORDER BY e.created_at DESC
       LIMIT 1;

      v_back := EXISTS (SELECT 1 FROM public.notification_events e
                         WHERE e.event_type = 'back_on_track'
                           AND e.subject_profile_id = v_student.id
                           AND (e.payload ->> 'digest_date')::date = v_day);

      SELECT jsonb_build_object('planned', st.completion_planned,
                                'completed', st.completion_completed)
        INTO v_complete
        FROM public.accountability_state st
       WHERE st.student_id = v_student.id
         AND st.completion_date = v_day
         AND st.completion_planned > 0;

      IF jsonb_array_length(v_changes) > 0 OR v_alert IS NOT NULL OR v_back
         OR v_complete IS NOT NULL THEN
        v_section := jsonb_build_object(
          'student_first_name', public.accountability_student_first_name(v_student.id),
          'completion', COALESCE(v_complete, 'null'::jsonb),
          'plan_changes', v_changes,
          'missed_plan_alert', COALESCE(v_alert, 'null'::jsonb),
          'back_on_track', v_back);
        v_sections := v_sections || jsonb_build_array(v_section);
      END IF;
    END LOOP;

    -- No empty emails: a guardian with nothing to report today gets nothing.
    IF jsonb_array_length(v_sections) > 0 THEN
      PERFORM public.emit_notification_event(
        public.notification_event_id('guardian_daily_digest', v_guardian.id::text || ':' || v_day::text),
        'guardian_daily_digest',
        v_guardian.id,
        jsonb_build_array(jsonb_build_object('profile_id', v_guardian.id,
                                             'channels', jsonb_build_array('email'))),
        jsonb_build_object('digest_date', v_day, 'students', v_sections),
        ((v_day + 1)::timestamp AT TIME ZONE 'America/Chicago'));
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('emitted', v_emitted, 'guardians', v_seen);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 11. Manual campaigns read this (service role only): who may get a governed email now.
-- ---------------------------------------------------------------------------
CREATE VIEW public.email_gate_status WITH (security_invoker = true) AS
SELECT p.id AS profile_id,
       p.email AS recipient,
       p.role::text AS role,
       c.v ->> 'state' AS state,
       (c.v ->> 'last_active')::timestamptz AS last_active,
       (c.v ->> 'unengaged')::integer AS unengaged_count,
       (NOT x.pending_deletion
        AND (public.email_gate_verdict(p.id, 'manual_campaign', c.v ->> 'state', now()) ->> 'allow')::boolean)
         AS may_send_governed,
       (NOT x.pending_deletion AND p.role::text = 'student'
        AND (public.email_gate_verdict(p.id, 'sat_week_before', c.v ->> 'state', now()) ->> 'allow')::boolean)
         AS may_send_milestone
  FROM public.profiles p
  CROSS JOIN LATERAL (SELECT public.email_gate_compute(p.id, now()) AS v) c
  CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                                      WHERE d.profile_id = p.id AND d.status = 'pending')
                               AS pending_deletion) x
 WHERE p.role::text IN ('student', 'guardian') AND p.deleted_at IS NULL;
COMMENT ON VIEW public.email_gate_status IS
  'Email send gate, read-only, for manual campaigns: each student''s and guardian''s live state, last activity, unengaged count, and whether a governed (campaign) or milestone email may go now. may_send_governed excludes under-13s and pending deletions. Service role only.';

-- ---------------------------------------------------------------------------
-- 12. Backfill: students the QOTD sunset paused are paused here (ruling 2026-11-02 (3)). No
--     second note (they had one); any activity since wakes them on the next refresh.
-- ---------------------------------------------------------------------------
INSERT INTO public.email_gate_state (profile_id, state, reason, state_since, pause_episode, updated_at)
SELECT e.student_id, 'paused', 'qotd_sunset_backfill', e.paused_at, 1, now()
  FROM public.student_qotd_email_prefs e
  JOIN public.profiles p ON p.id = e.student_id AND p.deleted_at IS NULL
 WHERE e.paused_at IS NOT NULL
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.email_gate_transitions (profile_id, from_state, to_state, reason, actor, occurred_at)
SELECT g.profile_id, 'active', 'paused', 'qotd_sunset_backfill', 'backfill', g.state_since
  FROM public.email_gate_state g
 WHERE g.reason = 'qotd_sunset_backfill';

SELECT public.email_gate_enqueue_mirror(g.profile_id, 'paused', now())
  FROM public.email_gate_state g
 WHERE g.reason = 'qotd_sunset_backfill';

-- ---------------------------------------------------------------------------
-- 13. Privileges: service role only (contract §9)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.notification_runtime_config,
  public.notification_runtime_config_history,
  public.email_gate_state,
  public.email_gate_transitions,
  public.email_gate_resend_outbox,
  public.email_gate_guardian_pauses,
  public.email_campaign_sends,
  public.email_gate_status
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.notification_runtime_config,
  public.notification_runtime_config_history,
  public.email_gate_state,
  public.email_gate_transitions,
  public.email_gate_resend_outbox,
  public.email_gate_guardian_pauses,
  public.email_campaign_sends,
  public.email_gate_status
  TO service_role;

REVOKE ALL ON FUNCTION
  public.email_gate_config_int(text),
  public.email_gate_config_bool(text),
  public.email_category(text),
  public.email_category_unknown(text),
  public.email_gate_last_sign_in(uuid),
  public.email_gate_activity_between(uuid, timestamptz, timestamptz),
  public.email_gate_last_activity(uuid, timestamptz),
  public.email_gate_active_on(uuid, date, text),
  public.email_gate_governed_sends(uuid, timestamptz),
  public.email_gate_last_click(uuid, timestamptz),
  public.email_gate_unengaged_count(uuid, timestamptz),
  public.email_gate_last_capped_send(uuid, timestamptz),
  public.email_gate_compute(uuid, timestamptz),
  public.email_gate_verdict(uuid, text, text, timestamptz),
  public.email_gate_enqueue_mirror(uuid, text, timestamptz),
  public.email_gate_refresh(uuid, timestamptz, text),
  public.email_gate_decide(uuid, text, timestamptz),
  public.email_gate_keep_posted(uuid, timestamptz),
  public.email_gate_sweep(timestamptz, integer, uuid),
  public.email_gate_record_plan_days(uuid, jsonb, text, date, timestamptz),
  public.email_gate_guardian_refresh(timestamptz),
  public.record_email_engagement_event(text, text, text, timestamptz, text[]),
  public.record_campaign_send(text, text, text, timestamptz, text),
  public.email_gate_outbox_due(timestamptz, integer),
  public.email_gate_outbox_mark(uuid, text, boolean, text, timestamptz),
  public.email_milestones_notify(timestamptz, jsonb),
  public.qotd_daily_notify(timestamptz, integer),
  public.qotd_daily_email_preference(uuid),
  public.qotd_email_resume(uuid, timestamptz),
  public.guardian_daily_digest_notify(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.email_gate_config_int(text),
  public.email_gate_config_bool(text),
  public.email_category(text),
  public.email_category_unknown(text),
  public.email_gate_last_sign_in(uuid),
  public.email_gate_activity_between(uuid, timestamptz, timestamptz),
  public.email_gate_last_activity(uuid, timestamptz),
  public.email_gate_active_on(uuid, date, text),
  public.email_gate_governed_sends(uuid, timestamptz),
  public.email_gate_last_click(uuid, timestamptz),
  public.email_gate_unengaged_count(uuid, timestamptz),
  public.email_gate_last_capped_send(uuid, timestamptz),
  public.email_gate_compute(uuid, timestamptz),
  public.email_gate_verdict(uuid, text, text, timestamptz),
  public.email_gate_enqueue_mirror(uuid, text, timestamptz),
  public.email_gate_refresh(uuid, timestamptz, text),
  public.email_gate_decide(uuid, text, timestamptz),
  public.email_gate_keep_posted(uuid, timestamptz),
  public.email_gate_sweep(timestamptz, integer, uuid),
  public.email_gate_record_plan_days(uuid, jsonb, text, date, timestamptz),
  public.email_gate_guardian_refresh(timestamptz),
  public.record_email_engagement_event(text, text, text, timestamptz, text[]),
  public.record_campaign_send(text, text, text, timestamptz, text),
  public.email_gate_outbox_due(timestamptz, integer),
  public.email_gate_outbox_mark(uuid, text, boolean, text, timestamptz),
  public.email_milestones_notify(timestamptz, jsonb),
  public.qotd_daily_notify(timestamptz, integer),
  public.qotd_daily_email_preference(uuid),
  public.qotd_email_resume(uuid, timestamptz),
  public.guardian_daily_digest_notify(timestamptz, integer)
  TO service_role;

COMMIT;
