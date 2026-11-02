-- ===========================================================================
-- Email send gate — milestone send window, spacing and suppressed addresses
-- ===========================================================================
-- @spec [owner brief "Email gate: milestone send window and duplicate guard" (Karl, 2026-11-02);
--       owner brief "Email send gate" (Karl, 2026-10-30); contracts/notifications.contract.md
--       C15.3, C15.7 as amended 2026-11-02; SCL-263 as amended] | @implemented [2026-11-02]
--
-- OWNER-RUN. Karl applies to production by hand, after 20261127000000. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see the rollback block below.
--
-- plain English. On 2026-11-02 the first sweep sent `sat_week_before` for the 7 November test
-- with 5 days left: the windows were three days wide on purpose (so one missed daily run lost
-- nothing), and the first run fell inside the tail. Karl's ruling: milestones are automatic
-- only, never doubled, never a late catch-up.
--  1. SEND WINDOW. Each milestone fires only around its target day, in the student's own zone:
--       sat_week_before      target = test date − 7; window target − 1 … target + 1
--       sat_day_after        target = test date + 1; window target … target + 1
--       sat_scores_released  target = College Board's release date; window target … target + 1
--     The day-after and release-day windows have no early day: one day early would send "you
--     did it" on the morning of the test, and "scores are out" the day before they are. Ruled
--     by Karl 2026-11-02 on #1403 (push-back 1 accepted): target day and the day after only;
--     the week-before email keeps ±1. Past its window, a milestone is never sent: the skip is
--     recorded once in `email_milestone_skips` with reason `window_missed`.
--  2. COPY. `sat_week_before` carries `days_until` (from the day it is emitted); the template
--     keeps "Your SAT is next {weekday}, {date}" at 7 days and says "in N days" otherwise. The
--     event expires at the end of the day it was emitted, so the number is never stale.
--  3. SPACING. No two different milestone emails to one student within
--     `email_gate_milestone_spacing_days` (default 3): the later one is skipped and recorded
--     (`milestone_spacing`).
--  4. SUPPRESSED. A student or guardian whose address complained, or bounced with no delivery
--     since, gets no governed or milestone email (`email_gate_suppressed`, in the verdict: the
--     dispatcher fails the message `email_gate:suppressed`; the lifecycle rule releases its
--     claim). "Always" email is unchanged. Bounces and complaints on lifecycle and campaign
--     email now carry the recipient (`link_email_delivery_recipient`, called by the webhook).
--     Resend's own suppression list is enforced by Resend on every send (contract §11A), so it
--     is not re-read here (ruled by Karl 2026-11-02 on #1403, push-back 2 accepted).
-- Once per student per test date per kind still holds (insert-once event ids), so the 27
-- `sat_week_before` emails sent for 7 November are never sent again.
--
-- Redefines email_milestones_notify and email_gate_verdict (last defined in 20261127000000);
-- the plants aimed at them in scripts/ci/email-gate.mutations.sh are re-pointed here (MIG3).
--
-- rollback (by hand, in this order):
--   -- re-run email_milestones_notify and email_gate_verdict from 20261127000000
--   DROP FUNCTION IF EXISTS public.email_milestone_try(uuid, date, text, date, date, date, date,
--     text, jsonb, timestamptz), public.link_email_delivery_recipient(text, text[]),
--     public.email_gate_suppressed(uuid);
--   DROP TABLE IF EXISTS public.email_milestone_skips;
--   DELETE FROM public.notification_runtime_config WHERE key = 'email_gate_milestone_spacing_days';
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Configuration and the skip record
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('email_gate_milestone_spacing_days', '3', 'integer', '0', '30', 'karl',
   'No two different milestone emails to one student within this many days; the later one is skipped (milestone_spacing). Karl, 2026-11-02.');

CREATE TABLE public.email_milestone_skips (
  student_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_date   date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('sat_week_before', 'sat_day_after', 'sat_scores_released')),
  reason      text NOT NULL CHECK (reason IN ('window_missed', 'milestone_spacing')),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (student_id, test_date, kind)
);
COMMENT ON TABLE public.email_milestone_skips IS
  'A milestone email that was not sent, and why (window_missed: its send window passed; milestone_spacing: another milestone went within the spacing days). One row per student, test date and kind; a recorded skip is final. ON DELETE CASCADE from profiles.';
ALTER TABLE public.email_milestone_skips ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Suppressed addresses
-- ---------------------------------------------------------------------------
-- Complained ever, or bounced with no delivery since: from the pipeline's own messages and from
-- delivery events that carry the recipient (lifecycle and campaign email, linked below).
CREATE OR REPLACE FUNCTION public.email_gate_suppressed(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH ev AS (
    SELECT 'complained'::text AS kind, COALESCE(m.sent_at, m.created_at) AS at
      FROM public.notification_messages m
     WHERE m.recipient_profile_id = p_profile_id AND m.channel = 'email' AND m.status = 'complained'
    UNION ALL
    SELECT 'bounced', COALESCE(m.sent_at, m.created_at)
      FROM public.notification_messages m
     WHERE m.recipient_profile_id = p_profile_id AND m.channel = 'email' AND m.status = 'bounced'
    UNION ALL
    SELECT 'delivered', m.delivered_at
      FROM public.notification_messages m
     WHERE m.recipient_profile_id = p_profile_id AND m.channel = 'email'
       AND m.status = 'delivered' AND m.delivered_at IS NOT NULL
    UNION ALL
    SELECT CASE d.event_type WHEN 'email.complained' THEN 'complained'
                             WHEN 'email.bounced' THEN 'bounced' ELSE 'delivered' END,
           d.occurred_at
      FROM public.notification_delivery_events d
     WHERE d.recipient_profile_id = p_profile_id
       AND d.event_type IN ('email.complained', 'email.bounced', 'email.delivered')
  )
  SELECT EXISTS (SELECT 1 FROM ev WHERE kind = 'complained')
      OR COALESCE((SELECT max(at) FROM ev WHERE kind = 'bounced')
                  > COALESCE((SELECT max(at) FROM ev WHERE kind = 'delivered'), '-infinity'::timestamptz),
                  false);
$fn$;

-- The webhook's call for a delivery status event: record whose address it was (the message's
-- recipient, else the profile with that address). Idempotent. Returns true when linked.
CREATE OR REPLACE FUNCTION public.link_email_delivery_recipient(
  p_provider_event_id text,
  p_recipients        text[]
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_recipient uuid;
  v_rows      integer;
BEGIN
  SELECT m.recipient_profile_id INTO v_recipient
    FROM public.notification_delivery_events d
    JOIN public.notification_messages m ON m.message_id = d.message_id
   WHERE d.provider_event_id = p_provider_event_id;
  IF v_recipient IS NULL THEN
    SELECT p.id INTO v_recipient
      FROM unnest(COALESCE(p_recipients, '{}'::text[])) WITH ORDINALITY AS t(addr, n)
      JOIN public.profiles p ON lower(p.email) = lower(btrim(t.addr)) AND p.deleted_at IS NULL
     ORDER BY t.n, p.id
     LIMIT 1;
  END IF;
  IF v_recipient IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.notification_delivery_events
     SET recipient_profile_id = v_recipient
   WHERE provider_event_id = p_provider_event_id AND recipient_profile_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. One milestone, tried: emitted | window_missed | milestone_spacing | waiting | done
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_milestone_try(
  p_student_id uuid,
  p_test_date  date,
  p_kind       text,
  p_target     date,
  p_window_lo  date,
  p_window_hi  date,
  p_today      date,
  p_timezone   text,
  p_payload    jsonb,
  p_now        timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event uuid := public.notification_event_id(p_kind, p_student_id::text || ':' || p_test_date::text);
BEGIN
  -- Once per student, test date and kind: sent, or skipped for good.
  IF EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.email_milestone_skips s
                 WHERE s.student_id = p_student_id AND s.test_date = p_test_date AND s.kind = p_kind) THEN
    RETURN 'done';
  END IF;
  IF p_today < p_window_lo THEN
    RETURN 'waiting';
  END IF;
  -- Never a late catch-up.
  IF p_today > p_window_hi THEN
    INSERT INTO public.email_milestone_skips (student_id, test_date, kind, reason, recorded_at)
    VALUES (p_student_id, p_test_date, p_kind, 'window_missed', p_now)
    ON CONFLICT DO NOTHING;
    RETURN 'window_missed';
  END IF;
  -- Never two different milestone emails within the spacing days.
  IF EXISTS (SELECT 1 FROM public.notification_events e
              WHERE e.subject_profile_id = p_student_id
                AND e.event_type IN ('sat_week_before', 'sat_day_after', 'sat_scores_released')
                AND e.created_at > p_now - make_interval(days => public.email_gate_config_int('email_gate_milestone_spacing_days'))
                AND e.created_at <= p_now) THEN
    INSERT INTO public.email_milestone_skips (student_id, test_date, kind, reason, recorded_at)
    VALUES (p_student_id, p_test_date, p_kind, 'milestone_spacing', p_now)
    ON CONFLICT DO NOTHING;
    RETURN 'milestone_spacing';
  END IF;
  PERFORM public.emit_notification_event(
    v_event, p_kind, p_student_id,
    jsonb_build_array(jsonb_build_object('profile_id', p_student_id, 'channels', jsonb_build_array('email'))),
    p_payload,
    -- Sent the day it is emitted or not at all (the copy's day count is that day's).
    ((p_today + 1)::timestamp AT TIME ZONE p_timezone));
  -- Stamped with the rule's clock (now() in production), so the spacing check above measures
  -- milestones on one clock.
  UPDATE public.notification_events SET created_at = p_now
   WHERE event_id = v_event AND created_at IS DISTINCT FROM p_now;
  RETURN 'emitted';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The milestone rule, with the windows (replaces 20261127000000's body)
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
  v_target  date;
  v_out     text;
  v_counts  jsonb := jsonb_build_object('week_before', 0, 'day_after', 0, 'scores_released', 0,
                                        'window_missed', 0, 'milestone_spacing', 0);
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
       -- Karl's launch ruling (2026-11-02): never to internal or test accounts.
       AND NOT public.email_gate_is_internal(p.id)
     ORDER BY p.id, d.test_date
  LOOP
    v_today := (p_now AT TIME ZONE r.timezone)::date;
    v_release := NULLIF(p_release_dates ->> r.test_date::text, '')::date;

    -- A week before: target ± 1 day.
    v_target := r.test_date - v_before;
    v_out := public.email_milestone_try(r.student_id, r.test_date, 'sat_week_before',
      v_target, v_target - 1, v_target + 1, v_today, r.timezone,
      jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                         'test_date', r.test_date,
                         'days_until', r.test_date - v_today),
      p_now);
    IF v_out = 'emitted' THEN
      v_counts := jsonb_set(v_counts, '{week_before}', to_jsonb((v_counts->>'week_before')::integer + 1));
    ELSIF v_out IN ('window_missed', 'milestone_spacing') THEN
      v_counts := jsonb_set(v_counts, ARRAY[v_out], to_jsonb((v_counts->>v_out)::integer + 1));
    END IF;

    -- The day after: target and the day after it (never on the test day itself).
    v_target := r.test_date + 1;
    v_out := public.email_milestone_try(r.student_id, r.test_date, 'sat_day_after',
      v_target, v_target, v_target + 1, v_today, r.timezone,
      jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                         'test_date', r.test_date,
                         'release_date', CASE WHEN v_release > v_today THEN v_release END),
      p_now);
    IF v_out = 'emitted' THEN
      v_counts := jsonb_set(v_counts, '{day_after}', to_jsonb((v_counts->>'day_after')::integer + 1));
    ELSIF v_out IN ('window_missed', 'milestone_spacing') THEN
      v_counts := jsonb_set(v_counts, ARRAY[v_out], to_jsonb((v_counts->>v_out)::integer + 1));
    END IF;

    -- Score release day: the release date and the day after (never before scores are out); no
    -- published date, no email.
    IF v_release IS NOT NULL THEN
      v_out := public.email_milestone_try(r.student_id, r.test_date, 'sat_scores_released',
        v_release, v_release, v_release + 1, v_today, r.timezone,
        jsonb_build_object('first_name', public.accountability_student_first_name(r.student_id),
                           'test_date', r.test_date, 'release_date', v_release),
        p_now);
      IF v_out = 'emitted' THEN
        v_counts := jsonb_set(v_counts, '{scores_released}', to_jsonb((v_counts->>'scores_released')::integer + 1));
      ELSIF v_out IN ('window_missed', 'milestone_spacing') THEN
        v_counts := jsonb_set(v_counts, ARRAY[v_out], to_jsonb((v_counts->>v_out)::integer + 1));
      END IF;
    END IF;
  END LOOP;
  RETURN v_counts;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The verdict, with suppressed addresses (body restated from 20261127000000; one block added)
-- ---------------------------------------------------------------------------
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
  -- Karl's launch ruling (2026-11-02): internal and test accounts get no governed or milestone
  -- email (account, billing and link mail still go).
  IF public.email_gate_is_internal(p_profile_id) THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'internal_account');
  END IF;
  -- Karl's ruling 2026-11-02 (milestone window and duplicate guard): an address that bounced
  -- (with no delivery since) or complained gets no governed or milestone email.
  IF public.email_gate_suppressed(p_profile_id) THEN
    RETURN jsonb_build_object('allow', false, 'reason', 'suppressed');
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
-- 6. Privileges: service role only (contract §9)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.email_milestone_skips FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.email_milestone_skips TO service_role;
REVOKE ALL ON FUNCTION
  public.email_gate_suppressed(uuid),
  public.link_email_delivery_recipient(text, text[]),
  public.email_milestone_try(uuid, date, text, date, date, date, date, text, jsonb, timestamptz),
  public.email_milestones_notify(timestamptz, jsonb),
  public.email_gate_verdict(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.email_gate_suppressed(uuid),
  public.link_email_delivery_recipient(text, text[]),
  public.email_milestone_try(uuid, date, text, date, date, date, date, text, jsonb, timestamptz),
  public.email_milestones_notify(timestamptz, jsonb),
  public.email_gate_verdict(uuid, text, text, timestamptz)
  TO service_role;

COMMIT;
