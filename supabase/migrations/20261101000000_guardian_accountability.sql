-- ===========================================================================
-- Guardian accountability loop: plan reductions, missed planned days, back on track, and the
-- guardian's evening digest.
--
-- @spec [owner brief "Guardian accountability loop (plan changes, missed days, daily digest)"
--       (Karl, 2026-10-13): "What gets recorded" items 2 (a full-length test date moved or
--       removed) and 3 (a day's planned work reduced by any means, aggregated per day), "Missed
--       days and back on track", "Delivery"; Doc-05F_V1.0 §12.4 (day edit / blocked-out day),
--       §12.8 (move), §13 (allocator), §14 (day.status — `missed` is "past, has blocks, no
--       progress"; owner ruling B5: partial is never missed), §16 (what a guardian receives);
--       Doc-01_V8 §38.1 (activity trends: yes); contracts/notifications.contract.md §1, §2.3,
--       §2A, §5, §6, §8 (amended in the same change); SCL-230 (PROPOSED: items 1 and the
--       frequency half of item 2 are NOT built here — Doc 05F §16 withholds study days, daily
--       minutes and the exam schedule from a guardian)] | @implemented [2026-10-13]
--
-- plain English:
--  1. Four notification types join the CHECK: `study_plan_changed` (a student-initiated plan
--     reduction: kind day_reduced | full_length_removed | full_length_moved), `missed_plan_alert`,
--     `back_on_track` and `guardian_daily_digest`. Channel-agnostic: each emitter names its
--     channels, so SMS is a CHECK change on notification_messages.channel plus a channel name.
--  2. `notification_channel_preferences` admits a second pair, (guardian_daily_digest, email),
--     whose missing row means ON (the qotd pair's missing row still means OFF). The default has
--     one definition, `guardian_daily_digest_email_enabled`, and the pair one writer,
--     `set_guardian_daily_digest_email`, which refuses a profile that is not a guardian.
--  3. `calendar_write_version` (the single calendar writer, Doc 05F §12.3) records the change
--     when a STUDENT writes a `day_edit` version — the trigger `calendar_edit_day` (clear a day,
--     remove a block, any day edit) and `calendar_move_block` both write. It snapshots the
--     dates it is about to own BEFORE inserting them and again AFTER, from
--     `calendar_current_plan`, and `accountability_record_plan_change` emits one
--     `study_plan_changed` event per date whose planned minutes went down and per full-length
--     block that was removed or moved. Same transaction as the mutation (contract C2.2). Not
--     recorded, by construction: `weekly`, `profile_change`, `student_refresh` (Regenerate),
--     `day_regenerate` / `day_reset`, `do_it_now` (adds to today), `setup`, `post_exam`, and
--     completing blocks (which writes no version at all). SAT dates and the target score are
--     profile columns and never reach this writer.
--  4. `accountability_state` holds the missed-day run per student. `accountability_record_day_outcomes`
--     is the rule: given the student's planned days in order (did_work | missed, from the §14
--     day status the job derives with the shared allocator), two consecutive missed planned
--     days emit ONE `missed_plan_alert`; no other alert until the student has studied again
--     and missed two more in a row; the first day with work after an alert emits ONE
--     `back_on_track`. Rest days and days with no plan are not in the list. The same call
--     records the digest day's completion (blocks planned / completed).
--  5. `guardian_daily_digest_notify` builds one `guardian_daily_digest` event per guardian per
--     America/Chicago day — only when at least one visible student has something to report
--     (a plan change, an alert, back on track, or a planned day's completion) and the guardian's
--     digest email is on. Visible = `guardian_view_decision(guardian, student) = 'allow'` (active
--     link AND student entitlement active), read at emit time, for in-app and digest alike.
--  6. Every accountability event carries `digest_date`: the Chicago day of the digest that
--     reports it. A plan change made before 18:00 Chicago belongs to that day's digest, one made
--     at or after 18:00 to the next day's (`accountability_digest_date`), so each change is in
--     exactly one digest and the 18:00 run never loses one made while it runs.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets calendar_write_version (grep,
-- 2026-10-13: only calendar-schema-gates.sql pins its body, re-recorded in the same change, and
-- calendar-writer-gates.sql calls it). `grep -ln 'FUNCTION public.calendar_write_version'
-- supabase/migrations/*.sql | sort | tail -1` is this file after it.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   -- re-run section 23 (calendar_write_version) of 20260917130000_calendar_v1.sql
--   DROP FUNCTION IF EXISTS public.guardian_daily_digest_notify(timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.accountability_record_day_outcomes(uuid, jsonb, date, date, integer, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.accountability_evaluation_candidates(integer, uuid);
--   DROP FUNCTION IF EXISTS public.accountability_record_plan_change(uuid, uuid, jsonb, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.accountability_plan_snapshot(uuid, date[]);
--   DROP FUNCTION IF EXISTS public.accountability_day_minutes(jsonb, date, jsonb);
--   DROP FUNCTION IF EXISTS public.accountability_guardian_recipients(uuid);
--   DROP FUNCTION IF EXISTS public.accountability_student_first_name(uuid);
--   DROP FUNCTION IF EXISTS public.accountability_digest_date(timestamptz);
--   DROP FUNCTION IF EXISTS public.set_guardian_daily_digest_email(uuid, boolean, timestamptz);
--   DROP FUNCTION IF EXISTS public.guardian_daily_digest_email_enabled(uuid);
--   DROP TABLE IF EXISTS public.accountability_state;
--   DELETE FROM public.notification_channel_preferences WHERE event_type = 'guardian_daily_digest';
--   -- restore notification_channel_preferences_scope / _source from 20261029020000 section 2
--   DELETE FROM public.notification_events WHERE event_type IN
--     ('study_plan_changed','missed_plan_alert','back_on_track','guardian_daily_digest');
--   -- restore notification_events_type_check from 20261029020000 section 1
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Event types (contract C1.1; list otherwise identical to 20261029020000)
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
                        'guardian_daily_digest'));

-- ---------------------------------------------------------------------------
-- 2. The guardian's digest switch (contract C2A.1 / C2A.2, amended)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_channel_preferences
  DROP CONSTRAINT IF EXISTS notification_channel_preferences_scope;
ALTER TABLE public.notification_channel_preferences
  ADD CONSTRAINT notification_channel_preferences_scope CHECK (
    (event_type = 'qotd_daily' AND channel = 'email')
    OR (event_type = 'guardian_daily_digest' AND channel = 'email')
  );
COMMENT ON TABLE public.notification_channel_preferences IS
  'Notification channel switches per profile, type and channel. Two pairs: (student, qotd_daily, email), missing row = OFF, written ONLY by set_qotd_daily_email; (guardian, guardian_daily_digest, email), missing row = ON (guardian_daily_digest_email_enabled), written ONLY by set_guardian_daily_digest_email. ON DELETE CASCADE from profiles.';

-- THE default, in one place: a guardian who never touched the switch gets the digest.
CREATE OR REPLACE FUNCTION public.guardian_daily_digest_email_enabled(p_guardian_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT c.enabled
      FROM public.notification_channel_preferences c
     WHERE c.profile_id = p_guardian_id
       AND c.event_type = 'guardian_daily_digest'
       AND c.channel = 'email'), true);
$fn$;

-- The one writer of the guardian pair. A student (or anyone not a guardian) is refused: the
-- brief's "students can't affect it" is held here as well as at the guardian-only route.
CREATE OR REPLACE FUNCTION public.set_guardian_daily_digest_email(
  p_guardian_id uuid,
  p_enabled     boolean,
  p_now         timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'set_guardian_daily_digest_email: p_enabled is required'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_guardian_id AND p.role = 'guardian' AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'set_guardian_daily_digest_email: % is not a guardian', p_guardian_id
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_channel_preferences
    (profile_id, event_type, channel, enabled, updated_source, updated_at)
  VALUES (p_guardian_id, 'guardian_daily_digest', 'email', p_enabled, 'settings', p_now)
  ON CONFLICT (profile_id, event_type, channel) DO UPDATE
     SET enabled = EXCLUDED.enabled, updated_source = 'settings', updated_at = p_now;
  RETURN jsonb_build_object('enabled', p_enabled);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Shared derivations
-- ---------------------------------------------------------------------------

-- The Chicago day of the digest that reports something that happened at p_at: before 18:00
-- Chicago it is that day's digest, at or after 18:00 the next day's. Wall-clock arithmetic on
-- the local timestamp, so it is exact in CST and CDT. 18 is GUARDIAN_DIGEST_SEND_HOUR_CHICAGO
-- (packages/shared/src/accountability-schema.ts); the PG suite holds the two equal.
CREATE OR REPLACE FUNCTION public.accountability_digest_date(p_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT ((p_at AT TIME ZONE 'America/Chicago') + interval '6 hours')::date;
$fn$;

-- The first word of the display name, as stored. Whether it is usable as a name is the
-- renderer's judgement (it falls back to "Your student"); an empty string means none.
CREATE OR REPLACE FUNCTION public.accountability_student_first_name(p_student_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT split_part(btrim(COALESCE(p.display_name, '')), ' ', 1)
      FROM public.profiles p WHERE p.id = p_student_id), '');
$fn$;

-- Every guardian who may see this student right now, as an emit recipient list (in_app).
-- THE visibility rule is guardian_view_decision's (active link AND entitlement active); this
-- only enumerates the candidate guardians from the active links and asks it.
CREATE OR REPLACE FUNCTION public.accountability_guardian_recipients(p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('profile_id', gl.guardian_profile_id,
                              'channels', jsonb_build_array('in_app'))
           ORDER BY gl.guardian_profile_id), '[]'::jsonb)
    FROM (SELECT DISTINCT l.guardian_profile_id
            FROM public.guardian_links l
           WHERE l.student_profile_id = p_student_id
             AND l.status = 'active') gl
    JOIN public.profiles g ON g.id = gl.guardian_profile_id AND g.deleted_at IS NULL
   WHERE public.guardian_view_decision(gl.guardian_profile_id, p_student_id) = 'allow';
$fn$;

-- The blocks the student's CURRENT plan holds on these dates, flat, in display order.
CREATE OR REPLACE FUNCTION public.accountability_plan_snapshot(p_student_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'date', cp.scheduled_date,
             'block_id', b.block_id,
             'block_type', b.block_type,
             'target_count', b.target_count,
             'derived_from_block_id', b.derived_from_block_id)
           ORDER BY cp.scheduled_date, cp.display_ordinal), '[]'::jsonb)
    FROM public.calendar_current_plan cp
    JOIN public.calendar_blocks b ON b.block_id = cp.block_id
   WHERE cp.student_id = p_student_id
     AND cp.scheduled_date = ANY (p_dates);
$fn$;

-- A day's planned minutes from a snapshot: the sum of the per-block "~N min" the student and the
-- guardian read on the cards (client lib/blocks.ts minutesFor: max(1, round(target × secs / 60))),
-- with the seconds-per-unit the version was planned against. A full-length block carries no
-- minute figure (it is recorded as its own change, below).
CREATE OR REPLACE FUNCTION public.accountability_day_minutes(p_rows jsonb, p_date date, p_engine_planning jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(greatest(1, round(
           (r ->> 'target_count')::numeric
           * (CASE r ->> 'block_type'
                WHEN 'review' THEN (p_engine_planning ->> 'review_seconds_per_unit')::numeric
                ELSE (p_engine_planning ->> 'practice_seconds_per_unit')::numeric END)
           / 60)))::integer, 0)
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
   WHERE (r ->> 'date')::date = p_date
     AND r ->> 'block_type' IN ('practice', 'review');
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Recording a student's plan reduction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accountability_record_plan_change(
  p_student_id      uuid,
  p_version_id      uuid,
  p_before          jsonb,
  p_after           jsonb,
  p_engine_planning jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_digest     date := public.accountability_digest_date(now());
  v_name       text := public.accountability_student_first_name(p_student_id);
  v_recipients jsonb := public.accountability_guardian_recipients(p_student_id);
  v_emitted    integer := 0;
  v_date       date;
  v_before     integer;
  v_after      integer;
  v_fl         record;
  v_to         date;
BEGIN
  -- (a) A day whose planned minutes went down: cleared, a block removed, a block moved off it.
  FOR v_date IN
    SELECT DISTINCT (r ->> 'date')::date FROM jsonb_array_elements(p_before) r ORDER BY 1
  LOOP
    v_before := public.accountability_day_minutes(p_before, v_date, p_engine_planning);
    v_after  := public.accountability_day_minutes(p_after,  v_date, p_engine_planning);
    IF v_after < v_before THEN
      PERFORM public.emit_notification_event(
        public.notification_event_id('study_plan_changed',
          p_version_id::text || ':' || v_date::text || ':day_reduced'),
        'study_plan_changed',
        p_student_id,
        v_recipients,
        jsonb_build_object(
          'kind', 'day_reduced',
          'student_first_name', v_name,
          'plan_date', v_date,
          'before_minutes', v_before,
          'after_minutes', v_after,
          'digest_date', v_digest));
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  -- (b) A full-length test that left its date: moved when this version created a copy of it
  --     elsewhere (derived_from_block_id, the §12.8 lineage), removed otherwise.
  FOR v_fl IN
    SELECT (b ->> 'block_id')::uuid AS block_id, (b ->> 'date')::date AS plan_date
      FROM jsonb_array_elements(p_before) b
     WHERE b ->> 'block_type' = 'full_length'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_after) a
                        WHERE a ->> 'block_id' = b ->> 'block_id')
       -- A full-length still on that date (re-stated as a created block rather than carried)
       -- is not a removal: the test did not leave the day.
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_after) a
                        WHERE a ->> 'block_type' = 'full_length'
                          AND a ->> 'date' = b ->> 'date')
     ORDER BY 2, 1
  LOOP
    SELECT (a ->> 'date')::date INTO v_to
      FROM jsonb_array_elements(p_after) a
     WHERE a ->> 'derived_from_block_id' = v_fl.block_id::text
     LIMIT 1;
    PERFORM public.emit_notification_event(
      public.notification_event_id('study_plan_changed',
        p_version_id::text || ':' || v_fl.block_id::text || ':full_length'),
      'study_plan_changed',
      p_student_id,
      v_recipients,
      CASE WHEN v_to IS NULL THEN
        jsonb_build_object('kind', 'full_length_removed', 'student_first_name', v_name,
                           'plan_date', v_fl.plan_date, 'digest_date', v_digest)
      ELSE
        jsonb_build_object('kind', 'full_length_moved', 'student_first_name', v_name,
                           'plan_date', v_fl.plan_date, 'to_date', v_to, 'digest_date', v_digest)
      END);
    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. calendar_write_version: the single writer, now recording a student's day edit.
--    Body restated from 20260917130000 section 23; the additions are marked ACCOUNTABILITY.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_write_version(
  p_student_id        uuid,
  p_trigger           text,
  p_initiated_by      text,
  p_generator         text,
  p_generator_version text,
  p_input             jsonb,
  p_output            jsonb,
  p_mode              text,
  p_fallback_reason   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_version_id uuid;
  v_version_no integer;
  v_res        jsonb;
  v_detail     jsonb;
  v_source     text;
  v_date       record;
  v_member     jsonb;
  v_block      jsonb;
  v_ord        integer;
  v_block_id   uuid;
  v_tz         text;
  v_records    boolean;
  v_dates      date[];
  v_before     jsonb;
BEGIN
  v_res := public.calendar_validate_plan(p_mode, p_input, p_output);
  v_detail := CASE WHEN p_fallback_reason IS NULL THEN v_res -> 'violations'
                   ELSE COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('fallback', p_fallback_reason) END;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version_no
  FROM public.calendar_plan_versions WHERE student_id = p_student_id;

  v_tz := p_input #>> '{profile,timezone}';

  INSERT INTO public.calendar_plan_versions
    (student_id, version_no, generator, generator_version, trigger, initiated_by,
     input_snapshot, input_snapshot_hash, constants_snapshot, validator_result, validator_detail)
  VALUES
    (p_student_id, v_version_no, p_generator, p_generator_version, p_trigger, p_initiated_by,
     p_input, encode(sha256(p_input::text::bytea), 'hex'), p_input -> 'constants',
     v_res ->> 'result', v_detail)
  RETURNING plan_version_id INTO v_version_id;

  IF v_res ->> 'result' <> 'accepted' THEN
    RETURN jsonb_build_object('plan_version_id', v_version_id, 'version_no', v_version_no,
                              'generator', p_generator, 'validator_result', 'rejected',
                              'violations', v_res -> 'violations');
  END IF;

  -- ACCOUNTABILITY (owner brief 2026-10-13, items 2 and 3): a STUDENT's day edit — which is
  -- also what a move writes (§12.8) — is recorded with its before and after. The dates this
  -- version is about to own are read from the current plan BEFORE they are inserted: until
  -- then the version owns nothing, so the view still shows the prior plan.
  v_records := p_initiated_by = 'student' AND p_trigger = 'day_edit';
  IF v_records THEN
    SELECT array_agg((d ->> 'scheduled_date')::date) INTO v_dates
    FROM jsonb_array_elements(p_output -> 'dates') d;
    v_before := public.accountability_plan_snapshot(p_student_id, v_dates);
  END IF;

  -- §12.1: what created a block is what the version was for.
  v_source := CASE p_trigger
                WHEN 'post_exam' THEN 'post_exam'
                WHEN 'day_edit' THEN 'student'
                WHEN 'do_it_now' THEN 'student'
                ELSE 'auto' END;

  FOR v_date IN
    SELECT (d ->> 'scheduled_date')::date AS sd,
           COALESCE((d ->> 'is_user_override')::boolean, false) AS ovr,
           d -> 'members' AS members
    FROM jsonb_array_elements(p_output -> 'dates') d
  LOOP
    INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone, is_user_override)
    VALUES (v_version_id, p_student_id, v_date.sd, v_tz, v_date.ovr);

    v_ord := 0;
    FOR v_member IN SELECT m FROM jsonb_array_elements(COALESCE(v_date.members, '[]'::jsonb)) m LOOP
      v_ord := v_ord + 1;
      IF v_member ->> 'kind' = 'carried' THEN
        -- Carried blocks keep their identity: no new row, only a membership on
        -- the new version (§12.2, §22.5).
        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES (v_version_id, p_student_id, v_date.sd, (v_member ->> 'block_id')::uuid, v_ord, 'carried');
      ELSE
        v_block := v_member -> 'block';
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope,
           target_count, source, derived_from_block_id, explanation_key)
        VALUES
          (p_student_id, v_version_id, v_date.sd, v_block ->> 'block_type', v_block ->> 'section',
           v_block -> 'scope', (v_block ->> 'target_count')::integer, v_source,
           (v_block ->> 'derived_from_block_id')::uuid, v_block ->> 'explanation_key')
        RETURNING block_id INTO v_block_id;

        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES (v_version_id, p_student_id, v_date.sd, v_block_id, v_ord, 'created');
      END IF;
    END LOOP;
  END LOOP;

  -- ACCOUNTABILITY: the same dates, now owned by this version. In this transaction (C2.2).
  IF v_records THEN
    PERFORM public.accountability_record_plan_change(
      p_student_id, v_version_id, v_before,
      public.accountability_plan_snapshot(p_student_id, v_dates),
      p_input -> 'engine_planning');
  END IF;

  RETURN jsonb_build_object('plan_version_id', v_version_id, 'version_no', v_version_no,
                            'generator', p_generator, 'validator_result', 'accepted');
END;
$$;

COMMENT ON FUNCTION public.calendar_write_version(uuid, text, text, text, text, jsonb, jsonb, text, jsonb) IS
  'Doc 05F §12.3. The single calendar writer: validate, allocate version_no under the caller''s FOR UPDATE, insert append-only. A rejected version is recorded and owns nothing, so the prior plan stands. A student''s day_edit version (calendar_edit_day, calendar_move_block) also records its plan reduction (accountability_record_plan_change, owner brief 2026-10-13).';

-- ---------------------------------------------------------------------------
-- 6. Missed planned days and back on track
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accountability_state (
  student_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  consecutive_missed   integer NOT NULL DEFAULT 0 CHECK (consecutive_missed >= 0),
  alert_open           boolean NOT NULL DEFAULT false,
  last_evaluated_date  date,
  completion_date      date,
  completion_planned   integer CHECK (completion_planned >= 0),
  completion_completed integer CHECK (completion_completed >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accountability_state_completion_le CHECK (completion_completed <= completion_planned)
);
COMMENT ON TABLE public.accountability_state IS
  'Owner brief 2026-10-13 (guardian accountability): the missed-planned-day run per student (consecutive_missed, alert_open, last_evaluated_date in the student''s calendar dates) and the digest day''s block completion. Written ONLY by accountability_record_day_outcomes. Service role only. ON DELETE CASCADE from profiles.';
ALTER TABLE public.accountability_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accountability_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.accountability_state TO service_role;

-- Who the evening job evaluates: a finished calendar setup, an active entitlement (the calendar
-- is a paid surface: an unentitled student cannot open the plan they would be told about), a
-- live account. Keyset-paged on student id.
CREATE OR REPLACE FUNCTION public.accountability_evaluation_candidates(
  p_limit integer DEFAULT 500,
  p_after uuid DEFAULT NULL
) RETURNS TABLE (student_id uuid, timezone text, last_evaluated_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT sp.student_id, sp.timezone, st.last_evaluated_date
    FROM public.student_study_profile sp
    JOIN public.profiles p ON p.id = sp.student_id
    LEFT JOIN public.accountability_state st ON st.student_id = sp.student_id
   WHERE sp.setup_completed_at IS NOT NULL
     AND p.role = 'student' AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                      WHERE d.profile_id = p.id AND d.status = 'pending')
     AND public.entitlement_active(sp.student_id)
     AND (p_after IS NULL OR sp.student_id > p_after)
   ORDER BY sp.student_id
   LIMIT p_limit;
$fn$;

-- THE rule. p_days: [{"date": "YYYY-MM-DD", "outcome": "did_work" | "missed"}], planned days
-- only (a rest day or a day with no blocks is not in the list), ascending. Days already
-- evaluated are skipped, so a rerun changes nothing. p_through is the last ENDED day the caller
-- looked at (yesterday in the student's zone); a did_work today may also be in the list (work
-- done is final), a missed today never is.
CREATE OR REPLACE FUNCTION public.accountability_record_day_outcomes(
  p_student_id           uuid,
  p_days                 jsonb,
  p_through              date,
  p_digest_date          date,
  p_completion_planned   integer,
  p_completion_completed integer,
  p_now                  timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_state      public.accountability_state;
  v_day        record;
  v_alerts     integer := 0;
  v_backs      integer := 0;
  v_last       date;
  v_name       text;
  v_guardians  jsonb;
  v_student    jsonb;
  v_expires    timestamptz := ((p_digest_date + 1)::timestamp AT TIME ZONE 'America/Chicago');
BEGIN
  -- The job sends the list serialised (the writers' convention, plan-service.ts p_members);
  -- through PostgREST that arrives as a jsonb STRING, so it is unwrapped once here.
  IF jsonb_typeof(p_days) = 'string' THEN
    p_days := (p_days #>> '{}')::jsonb;
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'accountability_record_day_outcomes: p_days must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.accountability_state (student_id) VALUES (p_student_id)
  ON CONFLICT (student_id) DO NOTHING;
  SELECT * INTO v_state FROM public.accountability_state
   WHERE student_id = p_student_id FOR UPDATE;

  v_name := public.accountability_student_first_name(p_student_id);
  v_guardians := public.accountability_guardian_recipients(p_student_id);
  -- The student: in-app always; email only 13+ (the notification system's 13+ predicate, the
  -- one qotd_daily uses; an unknown date of birth is not 13+).
  SELECT jsonb_build_object('profile_id', p.id, 'channels',
           CASE WHEN public.marketing_opt_in_age_eligible(p.date_of_birth)
                THEN jsonb_build_array('in_app', 'email')
                ELSE jsonb_build_array('in_app') END)
    INTO v_student
    FROM public.profiles p WHERE p.id = p_student_id;

  v_last := v_state.last_evaluated_date;

  FOR v_day IN
    SELECT (d ->> 'date')::date AS day, d ->> 'outcome' AS outcome
      FROM jsonb_array_elements(p_days) d
     ORDER BY 1
  LOOP
    IF v_day.outcome NOT IN ('did_work', 'missed') THEN
      RAISE EXCEPTION 'accountability_record_day_outcomes: unknown outcome %', v_day.outcome
        USING ERRCODE = '22023';
    END IF;
    CONTINUE WHEN v_state.last_evaluated_date IS NOT NULL
              AND v_day.day <= v_state.last_evaluated_date;

    IF v_day.outcome = 'did_work' THEN
      IF v_state.alert_open THEN
        PERFORM public.emit_notification_event(
          public.notification_event_id('back_on_track', p_student_id::text || ':' || v_day.day::text),
          'back_on_track',
          p_student_id,
          jsonb_build_array(v_student) || v_guardians,
          jsonb_build_object('student_first_name', v_name, 'back_on_date', v_day.day,
                             'digest_date', p_digest_date),
          v_expires);
        v_backs := v_backs + 1;
      END IF;
      v_state.consecutive_missed := 0;
      v_state.alert_open := false;
    ELSE
      v_state.consecutive_missed := v_state.consecutive_missed + 1;
      IF v_state.consecutive_missed >= 2 AND NOT v_state.alert_open THEN
        PERFORM public.emit_notification_event(
          public.notification_event_id('missed_plan_alert', p_student_id::text || ':' || v_day.day::text),
          'missed_plan_alert',
          p_student_id,
          jsonb_build_array(v_student) || v_guardians,
          jsonb_build_object('student_first_name', v_name,
                             'missed_days', v_state.consecutive_missed,
                             'last_missed_date', v_day.day,
                             'digest_date', p_digest_date),
          v_expires);
        v_state.alert_open := true;
        v_alerts := v_alerts + 1;
      END IF;
    END IF;
    v_last := greatest(COALESCE(v_last, v_day.day), v_day.day);
  END LOOP;

  IF p_through IS NOT NULL THEN
    v_last := greatest(COALESCE(v_last, p_through), p_through);
  END IF;

  UPDATE public.accountability_state
     SET consecutive_missed   = v_state.consecutive_missed,
         alert_open           = v_state.alert_open,
         last_evaluated_date  = v_last,
         completion_date      = p_digest_date,
         completion_planned   = greatest(COALESCE(p_completion_planned, 0), 0),
         completion_completed = least(greatest(COALESCE(p_completion_completed, 0), 0),
                                      greatest(COALESCE(p_completion_planned, 0), 0)),
         updated_at           = p_now
   WHERE student_id = p_student_id;

  RETURN jsonb_build_object('alerts', v_alerts, 'back_on_track', v_backs,
                            'last_evaluated_date', v_last);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. The guardian's evening digest (one per guardian per Chicago day)
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
-- 8. Privileges: service role only (contract §9)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.guardian_daily_digest_email_enabled(uuid),
  public.set_guardian_daily_digest_email(uuid, boolean, timestamptz),
  public.accountability_digest_date(timestamptz),
  public.accountability_student_first_name(uuid),
  public.accountability_guardian_recipients(uuid),
  public.accountability_plan_snapshot(uuid, date[]),
  public.accountability_day_minutes(jsonb, date, jsonb),
  public.accountability_record_plan_change(uuid, uuid, jsonb, jsonb, jsonb),
  public.accountability_evaluation_candidates(integer, uuid),
  public.accountability_record_day_outcomes(uuid, jsonb, date, date, integer, integer, timestamptz),
  public.guardian_daily_digest_notify(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.guardian_daily_digest_email_enabled(uuid),
  public.set_guardian_daily_digest_email(uuid, boolean, timestamptz),
  public.accountability_digest_date(timestamptz),
  public.accountability_student_first_name(uuid),
  public.accountability_guardian_recipients(uuid),
  public.accountability_plan_snapshot(uuid, date[]),
  public.accountability_day_minutes(jsonb, date, jsonb),
  public.accountability_record_plan_change(uuid, uuid, jsonb, jsonb, jsonb),
  public.accountability_evaluation_candidates(integer, uuid),
  public.accountability_record_day_outcomes(uuid, jsonb, date, date, integer, integer, timestamptz),
  public.guardian_daily_digest_notify(timestamptz, integer)
  TO service_role;

COMMIT;
