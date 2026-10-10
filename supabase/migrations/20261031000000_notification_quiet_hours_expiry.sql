-- ===========================================================================
-- Notification quiet hours, expiry for time-sensitive types, and the week notice after the
-- weekly re-plan.
--
-- @spec [owner rulings, Karl 2026-10-09, schedule audit Step 2: items 2 (quiet hours in the
--       shared sender: deferred to the next 08:00 America/Chicago, never dropped) and 3 (1) (the
--       exam reminder expires at the start of the test day in the student's zone; qotd_daily at
--       the end of its Chicago day; expired = dropped and logged, never sent late), 3 (4) (the
--       "this week" notice always comes after that student's weekly re-plan for that week);
--       contracts/notifications.contract.md §1, §4, §6 (amended in the same change);
--       Doc-05F_V1.0 §12.5 (the weekly predicate, R-08-30)] | @implemented [2026-10-09]
--
-- plain English:
--  1. `notification_events.expires_at` (nullable). Set by the emitter, at creation, from facts
--     the emitter already holds: the exam block's local date and zone, and the QOTD's Chicago
--     day. NULL means "never expires" (every other type). The dispatcher drops an email whose
--     event has expired, and one whose quiet-hours deferral would land at or after the expiry.
--  2. `notification_messages.not_before` (nullable). The quiet-hours deferral: an email row due
--     in the 21:00–08:00 America/Chicago window stays `queued`, with `not_before` = the next
--     08:00 Chicago, and the dispatcher does not select it before then. A deferral is not an
--     attempt: `attempts` and `last_error` are untouched (contract C4.2 still holds). The
--     recipient column guard now refuses a recipient write to it, like every other delivery
--     column.
--  3. `emit_notification_event` gains a six-argument form carrying `p_expires_at`; the
--     five-argument form keeps its signature and delegates with NULL, so the four emitters that
--     do not expire are untouched.
--  4. `notification_dispatch_queue(...)`: THE dispatch predicate, in one place — email, queued,
--     under the attempt cap, `not_before` passed, optionally one event and/or one event type
--     (the 17:00 QOTD run sends `qotd_daily` only, ruling item 3 (3)).
--  5. `defer_notification_send(message, not_before)`: the one writer of `not_before`.
--  6. `calendar_weekly_candidate(student, now)`: §12.5's per-student weekly predicate, now
--     the ONE definition; `calendar_weekly_candidates(limit)` reads it per student.
--  7. `calendar_emit_exam_notification` gains `p_now` (default now()) and two rules at the
--     chokepoint: a `full_length_week` notice is refused (`skipped_not_replanned`) while the
--     student's weekly predicate still says "generate" for that local week, and both notices
--     carry `expires_at` = the start of the test day in the plan date's zone.
--     `calendar_job_runs.outcome` admits `skipped_not_replanned`.
--  8. `qotd_daily_notify` emits with `expires_at` = the start of the next America/Chicago day.
--     The body is otherwise byte-identical to 20261029020000; home-qotd.mutations.sh H8, H11,
--     N1–N3 are re-pointed here in the same change.
--  9. `account_deletion_runtime_config.scheduled_deletion_job_cron` follows the moved cron:
--     `daily_at_15_utc` (vercel.json `0 15 * * *`, ruling item 1). The row is descriptive (Vercel
--     reads vercel.json) and the PG suite holds the two equal; Doc 01 App A.5 lists
--     `daily_at_02_utc` as its LAUNCH value for this Engineering-owned key.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order; the functions first, then the columns):
--   DROP FUNCTION IF EXISTS public.calendar_emit_exam_notification(uuid, uuid, text, date, text, timestamptz);
--   -- then re-run section 5 of 20261012000000_calendar_exam_notifications.sql (the 5-arg body)
--   -- and its REVOKE; re-run 3d of 20260917140000_calendar_route_constants.sql
--   -- (calendar_weekly_candidates) and section 6 of 20261029020000_qotd_daily_notification.sql
--   -- (qotd_daily_notify); re-run the emit_notification_event and
--   -- notification_messages_guard_recipient_update bodies from 20260903000000.
--   DROP FUNCTION IF EXISTS public.calendar_weekly_candidate(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.notification_dispatch_queue(timestamptz, integer, integer, uuid, text);
--   DROP FUNCTION IF EXISTS public.defer_notification_send(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.emit_notification_event(uuid, text, uuid, jsonb, jsonb, timestamptz);
--   ALTER TABLE public.calendar_job_runs DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
--   ALTER TABLE public.calendar_job_runs ADD CONSTRAINT calendar_job_runs_outcome_check
--     CHECK (outcome IN ('ok','skipped_fresh','skipped_custom','skipped_no_entitlement',
--                        'skipped_complete','skipped_duplicate','skipped_cancel_pending',
--                        'skipped_new_exam_date','skipped_answered','canceled_no_answer','failed'));
--   -- (fails while skipped_not_replanned rows exist; delete those calendar_job_runs rows first)
--   UPDATE public.account_deletion_runtime_config SET value = '"daily_at_02_utc"'::jsonb
--    WHERE key = 'scheduled_deletion_job_cron';   -- with vercel.json back at 0 2 * * *
--   ALTER TABLE public.notification_messages DROP COLUMN IF EXISTS not_before;
--   ALTER TABLE public.notification_events DROP COLUMN IF EXISTS expires_at;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;
COMMENT ON COLUMN public.notification_events.expires_at IS
  'Owner ruling 2026-10-09 (schedule audit Step 2, item 3(1)): the instant after which this event''s email is dropped, never sent late. Set once by the emitter. NULL = no expiry.';

ALTER TABLE public.notification_messages
  ADD COLUMN IF NOT EXISTS not_before timestamptz NULL;
COMMENT ON COLUMN public.notification_messages.not_before IS
  'Owner ruling 2026-10-09 (schedule audit Step 2, item 2): quiet-hours deferral. A queued email is not selected for dispatch before this instant. Written only by defer_notification_send; not an attempt.';

-- ---------------------------------------------------------------------------
-- 2. Recipient column guard: not_before is a delivery column, not a recipient one
--    (body restated from 20260903000000 with the one added line)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_messages_guard_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- SECURITY INVOKER: current_user is the role issuing the UPDATE. The dispatcher and the
  -- webhook receiver run as service_role (or as the SECURITY DEFINER owner) and pass through.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.message_id           IS DISTINCT FROM OLD.message_id
    OR NEW.event_id             IS DISTINCT FROM OLD.event_id
    OR NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
    OR NEW.channel              IS DISTINCT FROM OLD.channel
    OR NEW.status               IS DISTINCT FROM OLD.status
    OR NEW.provider_message_id  IS DISTINCT FROM OLD.provider_message_id
    OR NEW.attempts             IS DISTINCT FROM OLD.attempts
    OR NEW.last_error           IS DISTINCT FROM OLD.last_error
    OR NEW.sent_at              IS DISTINCT FROM OLD.sent_at
    OR NEW.delivered_at         IS DISTINCT FROM OLD.delivered_at
    OR NEW.created_at           IS DISTINCT FROM OLD.created_at
    OR NEW.not_before           IS DISTINCT FROM OLD.not_before
    THEN
      RAISE EXCEPTION 'notification_messages: a recipient may change only seen_at, read_at and archived_at'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Emit, with an expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_notification_event(
  p_event_id            uuid,
  p_event_type          text,
  p_subject_profile_id  uuid,
  p_recipients          jsonb,   -- [{"profile_id": "...", "channels": ["in_app","email"]}, ...]
  p_payload             jsonb,
  p_expires_at          timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'emit_notification_event: p_recipients must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_events (event_id, event_type, subject_profile_id, payload, expires_at)
  VALUES (p_event_id, p_event_type, p_subject_profile_id, coalesce(p_payload, '{}'::jsonb), p_expires_at)
  ON CONFLICT (event_id) DO NOTHING;

  -- in_app rows are the delivery: delivered on insert. email rows start queued.
  INSERT INTO public.notification_messages
    (event_id, recipient_profile_id, channel, status, delivered_at)
  SELECT
    p_event_id,
    (r ->> 'profile_id')::uuid,
    c.channel,
    CASE WHEN c.channel = 'in_app' THEN 'delivered' ELSE 'queued' END,
    CASE WHEN c.channel = 'in_app' THEN now() ELSE NULL END
  FROM jsonb_array_elements(p_recipients) AS r
  CROSS JOIN LATERAL jsonb_array_elements_text(r -> 'channels') AS c(channel)
  ON CONFLICT (event_id, recipient_profile_id, channel) DO NOTHING;
END;
$$;

-- The five-argument form keeps its signature for the emitters that never expire.
CREATE OR REPLACE FUNCTION public.emit_notification_event(
  p_event_id            uuid,
  p_event_type          text,
  p_subject_profile_id  uuid,
  p_recipients          jsonb,
  p_payload             jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.emit_notification_event(
    p_event_id, p_event_type, p_subject_profile_id, p_recipients, p_payload, NULL::timestamptz);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The dispatch predicate, in one place (contract C6.3, amended)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_dispatch_queue(
  p_now           timestamptz,
  p_limit         integer,
  p_max_attempts  integer,
  p_event_id      uuid DEFAULT NULL,
  p_event_type    text DEFAULT NULL
) RETURNS SETOF public.notification_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.*
    FROM public.notification_messages m
   WHERE m.channel = 'email'
     AND m.status = 'queued'
     AND m.attempts < p_max_attempts
     AND (m.not_before IS NULL OR m.not_before <= p_now)
     AND (p_event_id IS NULL OR m.event_id = p_event_id)
     AND (p_event_type IS NULL OR EXISTS (
           SELECT 1 FROM public.notification_events e
            WHERE e.event_id = m.event_id AND e.event_type = p_event_type))
   ORDER BY m.created_at, m.message_id
   LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 5. The one writer of not_before. A deferral is not an attempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.defer_notification_send(
  p_message_id  uuid,
  p_not_before  timestamptz
) RETURNS SETOF public.notification_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.notification_messages;
BEGIN
  IF p_not_before IS NULL THEN
    RAISE EXCEPTION 'defer_notification_send: p_not_before is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row
    FROM public.notification_messages
   WHERE message_id = p_message_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'defer_notification_send: message % not found', p_message_id
      USING ERRCODE = 'LYN01';
  END IF;
  IF v_row.channel <> 'email' OR v_row.status <> 'queued' THEN
    RAISE EXCEPTION 'defer_notification_send: message % is not a queued email (channel=%, status=%)',
      p_message_id, v_row.channel, v_row.status
      USING ERRCODE = 'LYN02';
  END IF;

  UPDATE public.notification_messages
     SET not_before = p_not_before
   WHERE message_id = p_message_id;

  RETURN QUERY SELECT * FROM public.notification_messages WHERE message_id = p_message_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The weekly predicate, per student (Doc 05F §12.5, R-08-30) — ONE definition
--
-- Byte-for-byte the CASE of 20260917140000's calendar_weekly_candidates, with `now()` made a
-- parameter so a caller can ask "has this student's week been re-planned at this instant"
-- (the exam notice below) and a gate can ask it on a fixed date. outcome NULL = generate.
-- No row = not in the population (no profile, or setup unfinished): nothing will re-plan them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_weekly_candidate(
  p_student_id uuid,
  p_now        timestamptz DEFAULT now()
) RETURNS TABLE (student_id uuid, period_key date, outcome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.student_id,
         (date_trunc('week', p_now AT TIME ZONE p.timezone))::date AS period_key,
         CASE
           WHEN p.planner_mode <> 'auto' THEN 'skipped_custom'
           WHEN NOT public.entitlement_active(p.student_id) THEN 'skipped_no_entitlement'
           WHEN EXISTS (
             SELECT 1 FROM public.calendar_plan_versions v
             WHERE v.student_id = p.student_id
               AND v.validator_result = 'accepted'
               AND v.trigger IN ('setup','profile_change','weekly','student_refresh','post_exam')
               AND (v.created_at AT TIME ZONE p.timezone)
                     >= date_trunc('week', p_now AT TIME ZONE p.timezone)
           ) THEN 'skipped_fresh'
           ELSE NULL
         END AS outcome
  FROM public.student_study_profile p
  WHERE p.student_id = p_student_id
    AND p.setup_completed_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.calendar_weekly_candidate(uuid, timestamptz) IS
  'Doc 05F §12.5 / R-08-30: the weekly predicate for ONE student at p_now (outcome NULL = generate). The one definition: calendar_weekly_candidates reads it per student, and calendar_emit_exam_notification refuses a week notice while it says generate (owner ruling 2026-10-09, schedule audit Step 2 item 3(4)).';

CREATE OR REPLACE FUNCTION public.calendar_weekly_candidates(p_limit integer DEFAULT 500)
RETURNS TABLE (student_id uuid, period_key date, outcome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.student_id, c.period_key, c.outcome
  FROM public.student_study_profile p
  CROSS JOIN LATERAL public.calendar_weekly_candidate(p.student_id, now()) c
  WHERE p.setup_completed_at IS NOT NULL
  ORDER BY p.student_id
  LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 7. The exam notices: week notice after the re-plan; both expire at the test day's start
-- ---------------------------------------------------------------------------
ALTER TABLE public.calendar_job_runs
  DROP CONSTRAINT IF EXISTS calendar_job_runs_outcome_check;
ALTER TABLE public.calendar_job_runs
  ADD CONSTRAINT calendar_job_runs_outcome_check
  CHECK (outcome IN ('ok',
                     'skipped_fresh',
                     'skipped_custom',
                     'skipped_no_entitlement',
                     'skipped_complete',
                     'skipped_duplicate',
                     'skipped_cancel_pending',
                     'skipped_new_exam_date',
                     'skipped_answered',
                     'skipped_not_replanned',
                     'canceled_no_answer',
                     'failed'));

-- A new signature (p_now), so the old one is dropped rather than overloaded: two overloads
-- that a five-named-argument call could both match would be ambiguous.
DROP FUNCTION IF EXISTS public.calendar_emit_exam_notification(uuid, uuid, text, date, text);

CREATE OR REPLACE FUNCTION public.calendar_emit_exam_notification(
  p_student_id uuid,
  p_block_id   uuid,
  p_kind       text,
  p_local_date date,
  p_timezone   text,
  p_now        timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event_id uuid;
  v_channels jsonb;
BEGIN
  IF p_kind NOT IN ('full_length_week', 'full_length_tomorrow') THEN
    RAISE EXCEPTION 'calendar_emit_exam_notification: unknown kind %', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- The rule, at the chokepoint. One call site for one derivation.
  IF public.calendar_full_length_complete(p_student_id, p_local_date, p_timezone) THEN
    RETURN 'skipped_complete';
  END IF;

  -- Owner ruling 2026-10-09 (schedule audit Step 2, item 3(4)): "this week" is announced only
  -- after this student's weekly re-plan for this local week, because the re-plan may move the
  -- exam. While §12.5's predicate still says "generate", the notice is refused here, whoever
  -- calls; the job re-plans first (exam-notify-job.ts) and asks again.
  IF p_kind = 'full_length_week' AND EXISTS (
       SELECT 1 FROM public.calendar_weekly_candidate(p_student_id, p_now) w
        WHERE w.outcome IS NULL) THEN
    RETURN 'skipped_not_replanned';
  END IF;

  v_event_id := public.notification_event_id(p_kind, p_block_id::text);

  IF EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id = v_event_id) THEN
    RETURN 'duplicate';
  END IF;

  v_channels := CASE WHEN p_kind = 'full_length_tomorrow'
                     THEN jsonb_build_array('in_app', 'email')
                     ELSE jsonb_build_array('in_app')
                END;

  PERFORM public.emit_notification_event(
    v_event_id,
    p_kind,
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id, 'channels', v_channels)
    ),
    jsonb_build_object('block_id', p_block_id, 'local_date', p_local_date),
    -- Owner ruling 2026-10-09 item 3(1): an exam reminder is worthless once the test day has
    -- begun in the student's zone (the plan date's own zone, as everywhere in this file).
    (p_local_date::timestamp AT TIME ZONE p_timezone)
  );

  RETURN 'emitted';
END;
$fn$;

COMMENT ON FUNCTION public.calendar_emit_exam_notification(uuid, uuid, text, date, text, timestamptz) IS
  'Brief 14 Step 5 / notifications contract §2.2, §5.1, §8.1: the one write path for the two practice-test notices. Returns emitted | skipped_complete | skipped_not_replanned | duplicate. A week notice is refused while the student''s weekly predicate says generate (owner ruling 2026-10-09). Both notices expire at the start of the test day in the plan date''s zone. Idempotent per (block_id, kind). Recipient is the student alone.';


-- ---------------------------------------------------------------------------
-- 8. The QOTD rule, with its expiry (body restated from 20261029020000, one change: the
--    emit carries expires_at). Mutations H8, H11, N1-N3 in scripts/ci/home-qotd.mutations.sh
--    now aim here.
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
      ),
      -- Owner ruling 2026-10-09 (schedule audit Step 2, item 3(1)): today's question expires
      -- when its America/Chicago day ends; a late send is a dropped send.
      ((v_today + 1)::timestamp AT TIME ZONE 'America/Chicago')
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
-- 9. The deletion job's declared schedule follows vercel.json (ruling item 1)
-- ---------------------------------------------------------------------------
UPDATE public.account_deletion_runtime_config
   SET value = '"daily_at_15_utc"'::jsonb,
       description = 'Schedule for the T+7 deletion job. Descriptive: Vercel reads vercel.json; this row is the declared intent the PG suite holds vercel.json to. 15:00 UTC since 2026-10-09 (owner ruling, schedule audit Step 2: daytime in Chicago, so the deletion-completed email is never sent in quiet hours).'
 WHERE key = 'scheduled_deletion_job_cron';

-- ---------------------------------------------------------------------------
-- 10. Privileges: service role only (Doc 05F §7.12; contract §9)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.emit_notification_event(uuid, text, uuid, jsonb, jsonb, timestamptz),
  public.notification_dispatch_queue(timestamptz, integer, integer, uuid, text),
  public.defer_notification_send(uuid, timestamptz),
  public.calendar_weekly_candidate(uuid, timestamptz),
  public.calendar_emit_exam_notification(uuid, uuid, text, date, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.emit_notification_event(uuid, text, uuid, jsonb, jsonb, timestamptz),
  public.notification_dispatch_queue(timestamptz, integer, integer, uuid, text),
  public.defer_notification_send(uuid, timestamptz),
  public.calendar_weekly_candidate(uuid, timestamptz),
  public.calendar_emit_exam_notification(uuid, uuid, text, date, text, timestamptz)
  TO service_role;

COMMIT;
