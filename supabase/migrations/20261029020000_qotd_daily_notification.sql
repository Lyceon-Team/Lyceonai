-- ===========================================================================
-- The daily-question reminder is a NOTIFICATION: event type `qotd_daily`, two channels, one rule.
--
-- @spec [owner rulings on #1166 (Karl, 2026-10-09) items 1, 2 and 4: "The QOTD daily reminder is
--       a notification, not a separate flow" — one type `qotd_daily`; in-app for every student
--       (incl. under-13, no consent needed); email only with the QOTD email consent and never
--       under-13; one scheduled rule at 17:00 Chicago; reuse the notification system's sending,
--       ledger, suppression and unsubscribe; remove qotd_email_sends if the ledger already
--       guarantees one per student per day; keep the 7-send pause inside the rule; the pop-up's
--       "Yes" turns the email channel on and still writes the versioned consent log (F-83);
--       Settings → Notifications has one toggle over the same preference; unsubscribing also
--       stops the prompt. contracts/notifications.contract.md C1.1, §2.3, §5.1, §8.1 (a type is
--       a CHECK change plus a §2.3 row; deterministic event id; payload keys are identifiers and
--       rendering parameters only); SCL-225 (consent purpose qotd_daily_email)]
--       | @implemented [2026-10-09]
--
-- plain English:
--  1. `notification_events_type_check` gains `qotd_daily` (list otherwise identical to
--     20261015000000).
--  2. `notification_channel_preferences` is the notification system's per-profile, per-type,
--     per-channel switch. Its only row kind today is (student, qotd_daily, email). ONE WRITER:
--     `set_qotd_daily_email`. The pop-up, Settings, the unsubscribe link and the resume link all
--     go through it, so they cannot disagree. A missing row means OFF.
--  3. `set_qotd_daily_email` turns the email channel on or off. Turning it ON requires a
--     13+ student and (when it changes) a consent version, writes the consent log row
--     (purpose qotd_daily_email) and clears any sunset pause. Turning it OFF writes the
--     withdrawal row and sets never_ask, so the Home prompt never re-asks (ruling 4).
--  4. `qotd_daily_notify` is the one rule, run by the 17:00 Chicago job: for every student who
--     has answered no question today (and today has a question), emit ONE `qotd_daily` event
--     with event id notification_event_id('qotd_daily', '<student>:<chicago day>'). Channels:
--     in_app always; email when the preference is on, the student is 13+ and not paused. The
--     7-send sunset is computed from the notification ledger itself: after 7 delivered daily
--     emails in a row the student left unanswered, the email that day is the one "paused"
--     notice (payload email_variant = 'paused_notice') and the student is paused.
--  5. ONE PER STUDENT PER DAY comes from the ledger: the event id is deterministic per (student,
--     day), notification_events has it as primary key, notification_messages is unique per
--     (event, recipient, channel), and the dispatcher sends with Idempotency-Key = message_id.
--     So `qotd_email_sends`, `qotd_email_claim`, `qotd_email_record` and
--     `qotd_email_candidates` are dropped.
--  6. `student_qotd_email_prefs` keeps only the Home prompt's state and the sunset pause; its
--     consent columns move to (2) and the consent log. REQUIRES 20261029010000 (its tables and
--     functions). Safe whether 20261029010000 was applied long ago (any consent stored there is
--     carried into (2) before its columns are dropped) or just before this one; safe to re-run.
--  7. The pause is recorded when the rule emits the paused notice, not when it is delivered: the
--     sunset is about the student not answering, which is already true. A paused notice that then
--     fails to send leaves the student paused; Settings shows "Paused" with a Resume button.
--  8. The dispatcher re-reads the preference at send time (qotd-daily-send-context.ts), so an
--     email queued at 17:00 is not sent to a student who turned it off before it went out.
--
-- Replaced bodies (were 20261029010000): qotd_email_prompt_state, set_qotd_email_consent,
-- qotd_email_unsubscribe, qotd_email_resume. Plants re-pointed here in
-- scripts/ci/home-qotd.mutations.sh in the same change.
--
-- OWNER-RUN. Karl applies to prod, after 20261029010000 (required). DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The event type
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
                        'qotd_daily'));

-- ---------------------------------------------------------------------------
-- 2. The channel preference
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_channel_preferences (
  profile_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type     text        NOT NULL,
  channel        text        NOT NULL,
  enabled        boolean     NOT NULL,
  updated_source text        NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_channel_preferences_pkey PRIMARY KEY (profile_id, event_type, channel),
  -- Only the opt-in email of qotd_daily is switchable. Every other (type, channel) is fixed by
  -- the emitting function (contract §2.3); a row for one would be a switch nothing reads.
  CONSTRAINT notification_channel_preferences_scope CHECK (event_type = 'qotd_daily' AND channel = 'email'),
  CONSTRAINT notification_channel_preferences_source CHECK (
    updated_source IN ('qotd_prompt', 'settings', 'email_unsubscribe', 'email_resume', 'backfill')
  )
);
COMMENT ON TABLE public.notification_channel_preferences IS
  'Notification channel switches per profile, type and channel. Today only (student, qotd_daily, email). Missing row = off. Written ONLY by set_qotd_daily_email (pop-up, Settings, unsubscribe and resume all call it). ON DELETE CASCADE from profiles.';
ALTER TABLE public.notification_channel_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_channel_preferences FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_channel_preferences TO service_role;

-- Carry any consent 20261029010000 stored (no-op on a fresh database). The consent log rows it
-- wrote stay as they are: they are the record.
DO $carry$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'student_qotd_email_prefs'
       AND column_name = 'consented'
  ) THEN
    EXECUTE $q$
      INSERT INTO public.notification_channel_preferences
        (profile_id, event_type, channel, enabled, updated_source, updated_at)
      SELECT student_id, 'qotd_daily', 'email', true, 'backfill', COALESCE(consented_at, updated_at)
        FROM public.student_qotd_email_prefs
       WHERE consented AND unsubscribed_at IS NULL
      ON CONFLICT (profile_id, event_type, channel) DO NOTHING
    $q$;
  END IF;
END
$carry$;

-- ---------------------------------------------------------------------------
-- 3. Retire the parallel lane
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.qotd_email_candidates(timestamptz, integer);
DROP FUNCTION IF EXISTS public.qotd_email_claim(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.qotd_email_record(uuid, boolean, text, timestamptz);
DROP TABLE IF EXISTS public.qotd_email_sends;

ALTER TABLE public.student_qotd_email_prefs
  DROP CONSTRAINT IF EXISTS qotd_email_prefs_consent_versioned,
  DROP COLUMN IF EXISTS consented,
  DROP COLUMN IF EXISTS consent_version,
  DROP COLUMN IF EXISTS consented_at,
  DROP COLUMN IF EXISTS unsubscribed_at;
COMMENT ON TABLE public.student_qotd_email_prefs IS
  'Home QOTD: the email prompt''s server-side state (asks, last asked/decided, never-ask) and the daily email''s sunset pause (paused_at, run_since). Whether the email is ON lives in notification_channel_preferences. ON DELETE CASCADE from profiles.';

-- ---------------------------------------------------------------------------
-- 4. The one writer
-- ---------------------------------------------------------------------------
-- p_source: qotd_prompt | settings (on or off) | email_unsubscribe (off) | email_resume (clears a
-- pause; never turns the channel on). Returns {ok, enabled, changed} or {ok:false, reason}.
CREATE OR REPLACE FUNCTION public.set_qotd_daily_email(
  p_student_id      uuid,
  p_enabled         boolean,
  p_source          text,
  p_consent_version text,
  p_now             timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today    date := public.chicago_day(p_now);
  v_student  boolean;
  v_eligible boolean;
  v_was      boolean;
  v_paused   boolean;
BEGIN
  IF p_source NOT IN ('qotd_prompt', 'settings', 'email_unsubscribe', 'email_resume') THEN
    RAISE EXCEPTION 'set_qotd_daily_email: unknown source %', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_source = 'email_unsubscribe' AND p_enabled)
     OR (p_source IN ('qotd_prompt', 'email_resume') AND NOT p_enabled) THEN
    RAISE EXCEPTION 'set_qotd_daily_email: source % cannot set enabled=%', p_source, p_enabled
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.role = 'student',
         COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
         AND p.role = 'student' AND p.deleted_at IS NULL
    INTO v_student, v_eligible
    FROM public.profiles p WHERE p.id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_missing');
  END IF;
  IF NOT v_student AND NOT p_enabled THEN
    -- Not a student: there is nothing to turn off, so write nothing (a signed link for another
    -- profile kind is a no-op, not a meaningless row).
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'changed', false);
  END IF;

  -- Serialise concurrent writers for this student (the row may not exist yet, so a row lock
  -- alone cannot): two first grants must not both log a consent.
  PERFORM pg_advisory_xact_lock(hashtext('set_qotd_daily_email:' || p_student_id::text));
  SELECT enabled INTO v_was
    FROM public.notification_channel_preferences
   WHERE profile_id = p_student_id AND event_type = 'qotd_daily' AND channel = 'email'
   FOR UPDATE;
  v_was := COALESCE(v_was, false);
  SELECT paused_at IS NOT NULL INTO v_paused
    FROM public.student_qotd_email_prefs WHERE student_id = p_student_id FOR UPDATE;
  v_paused := COALESCE(v_paused, false);

  IF p_enabled THEN
    IF p_source = 'email_resume' AND NOT v_was THEN
      -- The resume link only lifts a pause; it is not a consent.
      RETURN jsonb_build_object('ok', true, 'enabled', false, 'changed', false);
    END IF;
    IF NOT v_eligible THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ineligible');
    END IF;
    IF NOT v_was AND NULLIF(btrim(COALESCE(p_consent_version, '')), '') IS NULL THEN
      RAISE EXCEPTION 'set_qotd_daily_email: turning the email on requires a consent version'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT v_was AND p_consent_version !~ '^\d+\.\d+\.\d+$' THEN
      RAISE EXCEPTION 'set_qotd_daily_email: malformed consent version'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO public.notification_channel_preferences
      (profile_id, event_type, channel, enabled, updated_source, updated_at)
    VALUES (p_student_id, 'qotd_daily', 'email', true, p_source, p_now)
    ON CONFLICT (profile_id, event_type, channel) DO UPDATE
       SET enabled = true, updated_source = EXCLUDED.updated_source, updated_at = p_now;
    IF NOT v_was OR v_paused THEN
      -- A fresh start for the sunset count: off→on, or a pause lifted.
      INSERT INTO public.student_qotd_email_prefs (student_id, last_decided_on, paused_at, run_since, updated_at)
      VALUES (p_student_id, v_today, NULL, v_today, p_now)
      ON CONFLICT (student_id) DO UPDATE
         SET paused_at = NULL, run_since = v_today,
             last_decided_on = CASE WHEN p_source = 'email_resume'
                                    THEN public.student_qotd_email_prefs.last_decided_on
                                    ELSE v_today END,
             updated_at = p_now;
    END IF;
    IF NOT v_was THEN
      INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version, purpose, captured_at)
      VALUES (p_student_id, true, p_source, p_consent_version, 'qotd_daily_email', p_now);
    END IF;
    RETURN jsonb_build_object('ok', true, 'enabled', true, 'changed', NOT v_was OR v_paused);
  END IF;

  -- OFF (Settings or the unsubscribe link). Also "don't ask again" (ruling 4).
  INSERT INTO public.notification_channel_preferences
    (profile_id, event_type, channel, enabled, updated_source, updated_at)
  VALUES (p_student_id, 'qotd_daily', 'email', false, p_source, p_now)
  ON CONFLICT (profile_id, event_type, channel) DO UPDATE
     SET enabled = false, updated_source = EXCLUDED.updated_source, updated_at = p_now;
  INSERT INTO public.student_qotd_email_prefs (student_id, last_decided_on, never_ask, updated_at)
  VALUES (p_student_id, v_today, true, p_now)
  ON CONFLICT (student_id) DO UPDATE
     SET never_ask = true, last_decided_on = v_today, updated_at = p_now;
  IF v_was THEN
    INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version, purpose, captured_at)
    VALUES (p_student_id, false, p_source, NULL, 'qotd_daily_email', p_now);
  END IF;
  RETURN jsonb_build_object('ok', true, 'enabled', false, 'changed', v_was);
END;
$fn$;

-- The Settings toggle's read: the same row the writer writes.
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
    'paused', COALESCE(e.paused_at IS NOT NULL, false)
  )
    FROM public.profiles p
    LEFT JOIN public.notification_channel_preferences c
           ON c.profile_id = p.id AND c.event_type = 'qotd_daily' AND c.channel = 'email'
    LEFT JOIN public.student_qotd_email_prefs e ON e.student_id = p.id
   WHERE p.id = p_student_id;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The Home prompt, consent, unsubscribe and resume, through the one writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qotd_email_prompt_state(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'eligible', COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
                AND p.role = 'student' AND p.deleted_at IS NULL,
    'consented', COALESCE(c.enabled, false),
    'never_ask', COALESCE(e.never_ask, false),
    'ask_count', COALESCE(e.ask_count, 0),
    'last_asked_on', e.last_asked_on,
    'last_decided_on', e.last_decided_on,
    'today', public.chicago_day(p_now)
  )
    FROM public.profiles p
    LEFT JOIN public.student_qotd_email_prefs e ON e.student_id = p.id
    LEFT JOIN public.notification_channel_preferences c
           ON c.profile_id = p.id AND c.event_type = 'qotd_daily' AND c.channel = 'email'
   WHERE p.id = p_student_id;
$fn$;

-- decision: grant | not_now | never. "grant" is the writer; the other two touch only the prompt.
CREATE OR REPLACE FUNCTION public.set_qotd_email_consent(
  p_student_id      uuid,
  p_decision        text,
  p_consent_version text,
  p_now             timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_state  jsonb := public.qotd_email_prompt_state(p_student_id, p_now);
  v_today  date := public.chicago_day(p_now);
  v_result jsonb;
BEGIN
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_missing');
  END IF;
  IF p_decision NOT IN ('grant', 'not_now', 'never') THEN
    RAISE EXCEPTION 'set_qotd_email_consent: unknown decision %', p_decision
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT (v_state->>'eligible')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ineligible');
  END IF;

  IF p_decision = 'grant' THEN
    IF NULLIF(btrim(COALESCE(p_consent_version, '')), '') IS NULL THEN
      RAISE EXCEPTION 'set_qotd_email_consent: a grant requires a consent version'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_result := public.set_qotd_daily_email(p_student_id, true, 'qotd_prompt', p_consent_version, p_now);
    IF NOT (v_result->>'ok')::boolean THEN
      RETURN v_result;
    END IF;
    RETURN jsonb_build_object('ok', true, 'changed', (v_result->>'changed')::boolean);
  END IF;

  IF p_decision = 'never' AND COALESCE((v_state->>'ask_count')::integer, 0) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'never_not_offered');
  END IF;

  INSERT INTO public.student_qotd_email_prefs (student_id, last_decided_on, never_ask, updated_at)
  VALUES (p_student_id, v_today, p_decision = 'never', p_now)
  ON CONFLICT (student_id) DO UPDATE
     SET last_decided_on = v_today,
         never_ask = public.student_qotd_email_prefs.never_ask OR (p_decision = 'never'),
         updated_at = p_now;
  RETURN jsonb_build_object('ok', true, 'changed', false);
END;
$fn$;

-- The signed one-click unsubscribe (List-Unsubscribe and the footer link). Idempotent.
CREATE OR REPLACE FUNCTION public.qotd_email_unsubscribe(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_student_id) THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;
  v_result := public.set_qotd_daily_email(p_student_id, false, 'email_unsubscribe', NULL, p_now);
  RETURN jsonb_build_object('ok', true, 'changed', COALESCE((v_result->>'changed')::boolean, false));
END;
$fn$;

-- The paused email's resume link. Lifts the pause only while the email is on.
CREATE OR REPLACE FUNCTION public.qotd_email_resume(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_paused boolean;
  v_result jsonb;
BEGIN
  SELECT paused_at IS NOT NULL INTO v_paused
    FROM public.student_qotd_email_prefs WHERE student_id = p_student_id;
  IF NOT COALESCE(v_paused, false) THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;
  v_result := public.set_qotd_daily_email(p_student_id, true, 'email_resume', NULL, p_now);
  RETURN jsonb_build_object('ok', true, 'changed',
    COALESCE((v_result->>'enabled')::boolean, false) AND COALESCE((v_result->>'changed')::boolean, false));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The rule (17:00 America/Chicago; the job checks the hour)
-- ---------------------------------------------------------------------------
-- Emits at most p_limit events per call; the job calls again while a full batch came back.
-- Returns {emitted, mailable, paused_notices}.
CREATE OR REPLACE FUNCTION public.qotd_daily_notify(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today   date := public.chicago_day(p_now);
  v_emitted integer := 0;
  v_email   integer := 0;
  v_paused  integer := 0;
  r         record;
  v_event   uuid;
  v_run     integer;
  v_variant text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.qotd_schedule q WHERE q.qotd_date = v_today) THEN
    RETURN jsonb_build_object('emitted', 0, 'mailable', 0, 'paused_notices', 0);
  END IF;

  FOR r IN
    SELECT p.id AS student_id,
           -- Email: the preference is on, 13+, and not paused by the sunset.
           (COALESCE(c.enabled, false)
            AND public.marketing_opt_in_age_eligible(p.date_of_birth)
            AND e.paused_at IS NULL) AS email_on,
           e.run_since
      FROM public.profiles p
      LEFT JOIN public.notification_channel_preferences c
             ON c.profile_id = p.id AND c.event_type = 'qotd_daily' AND c.channel = 'email'
      LEFT JOIN public.student_qotd_email_prefs e ON e.student_id = p.id
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
    v_variant := 'daily';
    IF r.email_on THEN
      -- The sunset, from the ledger: the leading run (most recent first) of earlier days on which
      -- a daily email went out and the student answered nothing, since the last grant or resume.
      SELECT COALESCE(min(t.rn) FILTER (WHERE t.answered) - 1, count(*))::integer
        INTO v_run
        FROM (
          SELECT row_number() OVER (ORDER BY x.day DESC) AS rn,
                 EXISTS (SELECT 1 FROM public.student_answer_days(r.student_id, x.day) a
                          WHERE a.day = x.day) AS answered
            FROM (
              SELECT (ev.payload->>'qotd_date')::date AS day
                FROM public.notification_events ev
                JOIN public.notification_messages m
                  ON m.event_id = ev.event_id AND m.channel = 'email'
                 AND m.recipient_profile_id = r.student_id
               WHERE ev.event_type = 'qotd_daily' AND ev.subject_profile_id = r.student_id
                 AND ev.payload->>'email_variant' = 'daily'
                 AND m.status IN ('sent', 'delivered')
                 AND (ev.payload->>'qotd_date')::date < v_today
                 AND (ev.payload->>'qotd_date')::date >= COALESCE(r.run_since, (ev.payload->>'qotd_date')::date)
               ORDER BY 1 DESC
               LIMIT 7
            ) x
        ) t;
      IF COALESCE(v_run, 0) >= 7 THEN
        v_variant := 'paused_notice';
      END IF;
    END IF;

    PERFORM public.emit_notification_event(
      v_event,
      'qotd_daily',
      r.student_id,
      jsonb_build_array(jsonb_build_object(
        'profile_id', r.student_id,
        'channels', CASE WHEN r.email_on THEN jsonb_build_array('in_app', 'email')
                         ELSE jsonb_build_array('in_app') END
      )),
      jsonb_build_object(
        'qotd_date', v_today,
        'current_streak', COALESCE((SELECT s.current_streak FROM public.student_streak(r.student_id, p_now) s), 0),
        'email_variant', v_variant
      )
    );
    v_emitted := v_emitted + 1;
    IF r.email_on THEN v_email := v_email + 1; END IF;
    IF v_variant = 'paused_notice' THEN
      UPDATE public.student_qotd_email_prefs
         SET paused_at = p_now, updated_at = p_now
       WHERE student_id = r.student_id;
      v_paused := v_paused + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('emitted', v_emitted, 'mailable', v_email, 'paused_notices', v_paused);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.set_qotd_daily_email(uuid, boolean, text, text, timestamptz),
  public.qotd_daily_email_preference(uuid),
  public.qotd_email_prompt_state(uuid, timestamptz),
  public.set_qotd_email_consent(uuid, text, text, timestamptz),
  public.qotd_email_unsubscribe(uuid, timestamptz),
  public.qotd_email_resume(uuid, timestamptz),
  public.qotd_daily_notify(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.set_qotd_daily_email(uuid, boolean, text, text, timestamptz),
  public.qotd_daily_email_preference(uuid),
  public.qotd_email_prompt_state(uuid, timestamptz),
  public.set_qotd_email_consent(uuid, text, text, timestamptz),
  public.qotd_email_unsubscribe(uuid, timestamptz),
  public.qotd_email_resume(uuid, timestamptz),
  public.qotd_daily_notify(timestamptz, integer)
  TO service_role;

-- SECURITY INVOKER functions: service_role writes through its own table rights.
GRANT INSERT, UPDATE ON TABLE public.notification_channel_preferences TO service_role;

COMMIT;
