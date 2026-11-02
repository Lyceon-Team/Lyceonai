-- ===========================================================================
-- Email send gate — who moves to paused at launch (Karl's ruling, 2026-11-02, revised)
-- ===========================================================================
-- @spec [owner ruling "Who moves to `paused`" (Karl, 2026-11-02, revised); owner brief "Email
--       send gate" (Karl, 2026-10-30); contracts/notifications.contract.md C15.2a; SCL-263 as
--       amended 2026-11-02] | @implemented [2026-11-02]
--
-- OWNER-RUN. Karl applies to production by hand, after 20261126000000. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see the rollback block below.
--
-- plain English, the ruling:
--  1. Every account, student or guardian, whose last activity was before 2026-09-27 (the live
--     launch date), or which signed up before 2026-09-27 and was never active, is paused.
--     Activity is the gate's own (`email_gate_activity_between`): an answered practice, QOTD or
--     review item, a practice test started or answered, or a sign-in. The date is read as the
--     start of 2026-09-27 in America/Chicago, the product's day, from the config key
--     `email_gate_launch_date`. Any activity or Keep me posted after it wakes the account, and
--     from then on the normal gate rules apply.
--  2. Test and internal accounts are paused whatever their dates, and activity never wakes
--     them; they also get no milestone email. "Internal" is the lifecycle lane's own rule
--     ("test" in the address's local part, `isDenylisted` in server/lib/lifecycle-email.ts) plus
--     the config list `email_gate_internal_denylist`: full addresses or domains, seeded with
--     `lyceon.ai`. OWNER ACTION: add LIFECYCLE_EMAIL_DENYLIST's entries and your own addresses
--     to that list (SQL cannot read a Vercel variable), then run
--     `SELECT public.email_gate_launch_backfill(now());` again.
--  3. Everyone else (active on or after 2026-09-27): no change.
-- Neither group gets the pause note (they are not being told they went quiet), and a guardian
-- the ruling paused gets no parent pause email.
--
-- Redefines (bodies restated from 20261126000000; only the lines marked "launch ruling"
-- change): email_gate_compute, email_gate_verdict, email_gate_refresh,
-- email_gate_guardian_refresh, email_milestones_notify. The plants aimed at them in
-- scripts/ci/email-gate.mutations.sh are re-pointed here in the same change (MIG2).
--
-- rollback (by hand, in this order):
--   -- re-run the five definitions above from 20261126000000_email_send_gate.sql
--   DROP FUNCTION IF EXISTS public.email_gate_launch_backfill(timestamptz),
--     public.email_gate_launch_pause_reason(uuid, timestamptz),
--     public.email_gate_is_internal(uuid), public.email_gate_config_date(text);
--   DELETE FROM public.notification_runtime_config
--    WHERE key IN ('email_gate_launch_date', 'email_gate_internal_denylist');
--   -- accounts the backfill paused stay paused until they wake (activity or Keep me posted);
--   -- they are listed by: SELECT profile_id FROM public.email_gate_transitions
--   --   WHERE actor = 'backfill' AND reason IN ('pre_launch_inactive', 'internal_account');
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Configuration
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_runtime_config
  (key, value, value_type, owner, description)
VALUES
  ('email_gate_launch_date', '"2026-09-27"', 'string', 'karl',
   'The live launch date (America/Chicago). An account quiet since before it, or created before it and never active, is paused (Karl, 2026-11-02).'),
  ('email_gate_internal_denylist', '["lyceon.ai"]', 'array', 'karl',
   'Internal and test accounts, paused for good and never sent a milestone: full addresses or domains (a domain also covers its subdomains). Addresses with "test" in the local part are internal without being listed. Keep in step with LIFECYCLE_EMAIL_DENYLIST.');

CREATE OR REPLACE FUNCTION public.email_gate_config_date(p_key text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v jsonb;
BEGIN
  SELECT c.value INTO v FROM public.notification_runtime_config c
   WHERE c.key = p_key AND c.value_type = 'string';
  IF v IS NULL OR jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'email_gate_config_date: missing or invalid key %', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN (v #>> '{}')::date;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Who the ruling pauses
-- ---------------------------------------------------------------------------
-- An internal or test account: "test" in the local part (the lifecycle lane's rule), or a listed
-- address or domain.
CREATE OR REPLACE FUNCTION public.email_gate_is_internal(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_email  text;
  v_local  text;
  v_domain text;
  v_list   jsonb;
BEGIN
  SELECT lower(btrim(p.email)) INTO v_email FROM public.profiles p WHERE p.id = p_profile_id;
  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RETURN false;
  END IF;
  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  IF position('test' IN v_local) > 0 THEN
    RETURN true;
  END IF;
  SELECT c.value INTO v_list FROM public.notification_runtime_config c
   WHERE c.key = 'email_gate_internal_denylist' AND c.value_type = 'array';
  IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' THEN
    RAISE EXCEPTION 'email_gate_is_internal: missing or invalid key email_gate_internal_denylist'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_list) AS e(entry)
     WHERE lower(btrim(e.entry)) = v_email
        OR (position('@' IN ltrim(lower(btrim(e.entry)), '@')) = 0
            AND (v_domain = ltrim(lower(btrim(e.entry)), '@')
                 OR v_domain LIKE '%.' || ltrim(lower(btrim(e.entry)), '@'))));
END;
$fn$;

-- 'internal_account' | 'pre_launch_inactive' | NULL (the ruling does not apply).
CREATE OR REPLACE FUNCTION public.email_gate_launch_pause_reason(p_profile_id uuid, p_now timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_launch  timestamptz;
  v_created timestamptz;
  v_wake    timestamptz;
BEGIN
  IF public.email_gate_is_internal(p_profile_id) THEN
    RETURN 'internal_account';
  END IF;
  v_launch := public.email_gate_config_date('email_gate_launch_date')::timestamp AT TIME ZONE 'America/Chicago';
  -- Before the launch itself, "quiet since launch" means nothing.
  IF p_now < v_launch THEN
    RETURN NULL;
  END IF;
  SELECT p.created_at INTO v_created FROM public.profiles p WHERE p.id = p_profile_id;
  v_wake := GREATEST(public.email_gate_last_activity(p_profile_id, p_now),
                     (SELECT g.resumed_at FROM public.email_gate_state g WHERE g.profile_id = p_profile_id));
  IF v_wake IS NULL THEN
    RETURN CASE WHEN v_created < v_launch THEN 'pre_launch_inactive' END;
  END IF;
  RETURN CASE WHEN v_wake < v_launch THEN 'pre_launch_inactive' END;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The redefined gate (only the lines marked "launch ruling" change)
-- ---------------------------------------------------------------------------
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
  v_launch_reason text;
BEGIN
  SELECT p.id, p.role::text AS role, p.created_at INTO v_profile
    FROM public.profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email_gate_compute: no profile %', p_profile_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_row FROM public.email_gate_state g WHERE g.profile_id = p_profile_id;

  v_activity := public.email_gate_last_activity(p_profile_id, p_now);

  -- Karl's launch ruling (2026-11-02, revised): internal and test accounts, and accounts quiet
  -- since the live launch, are paused (students and guardians alike).
  v_launch_reason := public.email_gate_launch_pause_reason(p_profile_id, p_now);
  IF v_launch_reason IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'paused', 'reason', v_launch_reason, 'last_active', v_activity,
                              'unengaged', NULL, 'on_plan', false, 'plan_run', 0);
  END IF;

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
       AND p_actor <> 'backfill'
       AND v_reason NOT IN ('pre_launch_inactive', 'internal_account') THEN
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
       -- Karl's launch ruling (2026-11-02): no pause email to a guardian the ruling paused.
       AND public.email_gate_launch_pause_reason(g.id, p_now) IS NULL
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
       -- Karl's launch ruling (2026-11-02): never to internal or test accounts.
       AND NOT public.email_gate_is_internal(p.id)
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
-- 4. The move itself: every account the ruling covers, paused now, recorded as `backfill` (no
--    pause note). Safe to re-run (after the owner extends the internal list).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_gate_launch_backfill(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  FOR r IN
    SELECT p.id FROM public.profiles p
     WHERE p.role::text IN ('student', 'guardian') AND p.deleted_at IS NULL
       AND public.email_gate_launch_pause_reason(p.id, p_now) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.email_gate_state g
                        WHERE g.profile_id = p.id AND g.state = 'paused')
     ORDER BY p.id
  LOOP
    PERFORM public.email_gate_refresh(r.id, p_now, 'backfill');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

SELECT public.email_gate_launch_backfill(now());

-- ---------------------------------------------------------------------------
-- 5. Privileges: service role only (contract §9)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.email_gate_config_date(text),
  public.email_gate_is_internal(uuid),
  public.email_gate_launch_pause_reason(uuid, timestamptz),
  public.email_gate_launch_backfill(timestamptz),
  public.email_gate_compute(uuid, timestamptz),
  public.email_gate_verdict(uuid, text, text, timestamptz),
  public.email_gate_refresh(uuid, timestamptz, text),
  public.email_gate_guardian_refresh(timestamptz),
  public.email_milestones_notify(timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.email_gate_config_date(text),
  public.email_gate_is_internal(uuid),
  public.email_gate_launch_pause_reason(uuid, timestamptz),
  public.email_gate_launch_backfill(timestamptz),
  public.email_gate_compute(uuid, timestamptz),
  public.email_gate_verdict(uuid, text, text, timestamptz),
  public.email_gate_refresh(uuid, timestamptz, text),
  public.email_gate_guardian_refresh(timestamptz),
  public.email_milestones_notify(timestamptz, jsonb)
  TO service_role;

COMMIT;
