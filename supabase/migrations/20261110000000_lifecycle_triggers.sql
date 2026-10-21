-- ===========================================================================
-- Lifecycle emails: three behaviour triggers, one cap, one priority order.
--
-- @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
--       2026-10-21) PR 2; owner answers the same day: "Pro since" = entitlements.created_at; the
--       diagnostic's answers count toward the 10 (QOTD excluded); only situations that arise
--       after launch; a 14-day window per trigger; contracts/notifications.contract.md §14A
--       (C14A.4 generalised, C14A.5 new); SCL-240] | @implemented [2026-10-21]
--
-- plain English:
--  1. Three ledger types join `lifecycle_reminder_due` (20261109000000): one row per student per
--     trigger, ever, emitted with no recipients (Resend sends the email, never the dispatcher):
--       lifecycle_diagnostic_unfinished  started "Find your blind spots" 48 h ago, not completed
--       lifecycle_pro_no_plan            entitled 48 h ago (entitlements.created_at), no plan
--       lifecycle_practising_free        not entitled, 10+ answered items (QOTD excluded)
--  2. Each trigger's row carries its state in `payload.state`: 'pending' (due, waiting for the
--     cap or a higher-priority email), 'sent' (`payload.sent_at`), or 'resolved' (the student did
--     it, or the window closed, before it was sent). The PR 1 reminder rows (payload `{}`) read
--     as sent at their created_at.
--  3. `lifecycle_due(type, student, p_now)` is each condition, in one place, re-checked at send
--     time: the shared exclusions (a student; not deleted; no pending deletion; 13+), the
--     trigger's own condition, its window (due from its threshold to 14 days after the event
--     that started it) and the cutover (`lifecycle_triggers_since()`; the reminder keeps
--     `lifecycle_reminder_since()`).
--  4. `lifecycle_claim(p_now, p_limit)` runs every morning (the 14:00 UTC sweep) and, per
--     student, under a row lock:
--       records a newly due trigger as pending; resolves a pending one that is no longer due;
--       then, when no lifecycle email went to this student in the last 3 days (the cap; the QOTD
--       email is not a lifecycle email), sends the first pending one in priority order —
--       reminder, diagnostic, Pro, practising — and returns (student, type). The rest wait and
--       are re-checked the next morning.
--  5. `lifecycle_release(student, type)` puts a refused send back to pending, so the next
--     morning tries again (and the cap is not spent).
--  6. The 14-day windows keep every row far inside the 90-day notification retention (the sweep
--     deletes by created_at): a swept row can never re-open a trigger.
--  7. Replaces `lifecycle_reminder_claim` / `lifecycle_reminder_release` (20261109000000): the
--     reminder now goes through the same claim so the cap and the priority cover it. Its
--     condition and cutover are unchanged.
--
-- OWNER-RUN. Karl applies to prod after 20261109000000_lifecycle_reminder_due.sql. DO NOT
-- auto-apply. The cutover below is the morning PR 2's Resend Automations go live; if it ships
-- later, move it to that morning before applying.
-- LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.lifecycle_release(uuid, text);
--   DROP FUNCTION IF EXISTS public.lifecycle_claim(timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.lifecycle_due(text, uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.lifecycle_triggers_since();
--   DELETE FROM public.notification_events WHERE event_type IN
--     ('lifecycle_diagnostic_unfinished', 'lifecycle_pro_no_plan', 'lifecycle_practising_free');
--   -- re-run sections 1, 3, 4 and 5 of 20261109000000_lifecycle_reminder_due.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Event types (contract C1.1; list otherwise identical to 20261109000000)
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
                        'lifecycle_practising_free'));

-- ---------------------------------------------------------------------------
-- 2. The triggers' cutover: a fixed instant (the schema is the same on every apply)
-- ---------------------------------------------------------------------------
-- 2026-10-27 14:00 UTC (09:00 Chicago): the morning the three Resend Automations go live. Only a
-- situation that arises after it (a diagnostic started, an entitlement created, the 10th item
-- answered) can trigger an email; nobody already in one at launch gets a burst on day one.
CREATE OR REPLACE FUNCTION public.lifecycle_triggers_since()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT timestamptz '2026-10-27 14:00:00+00' $fn$;
COMMENT ON FUNCTION public.lifecycle_triggers_since() IS
  'The behaviour triggers'' cutover (2026-10-27 14:00 UTC): a diagnostic started, an entitlement created, or a 10th item answered before it never triggers a lifecycle email.';

-- ---------------------------------------------------------------------------
-- 3. Each condition, in one place
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_due(
  p_event_type text,
  p_profile_id uuid,
  p_now        timestamptz
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  -- Shared exclusions (C14A.2's database half; the denylist is applied by the server).
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = p_profile_id
          AND p.role = 'student'
          AND p.deleted_at IS NULL
          AND public.marketing_opt_in_age_eligible(p.date_of_birth))
     OR EXISTS (SELECT 1 FROM public.account_deletion_requests d
                 WHERE d.profile_id = p_profile_id AND d.status = 'pending') THEN
    RETURN false;
  END IF;

  IF p_event_type = 'lifecycle_reminder_due' THEN
    -- PR 1's condition, unchanged: onboarded 3 to 14 days ago, after its cutover, not entitled.
    SELECT p.profile_completed_at INTO v_at FROM public.profiles p WHERE p.id = p_profile_id;
    RETURN v_at IS NOT NULL
       AND v_at >= public.lifecycle_reminder_since()
       AND v_at <= p_now - interval '3 days'
       AND v_at >  p_now - interval '14 days'
       AND NOT public.entitlement_active(p_profile_id);

  ELSIF p_event_type = 'lifecycle_diagnostic_unfinished' THEN
    -- The diagnostic in flight (at most one), started 48 h to 14 days ago, none completed.
    SELECT ps.created_at INTO v_at
      FROM public.practice_sessions ps
     WHERE ps.user_id = p_profile_id
       AND ps.mode = 'diagnostic'
       AND ps.status IN ('created', 'active');
    RETURN v_at IS NOT NULL
       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state(p_profile_id) = 'in_progress';

  ELSIF p_event_type = 'lifecycle_pro_no_plan' THEN
    -- Entitled, the entitlement row created 48 h to 14 days ago (owner answer: created_at), and
    -- no study plan.
    SELECT e.created_at INTO v_at FROM public.entitlements e WHERE e.profile_id = p_profile_id;
    RETURN v_at IS NOT NULL
       AND public.entitlement_active(p_profile_id)
       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM public.calendar_current_plan c
                        WHERE c.student_id = p_profile_id);

  ELSIF p_event_type = 'lifecycle_practising_free' THEN
    -- Not entitled; the 10th answered item (QOTD excluded; the diagnostic counts, owner answer)
    -- answered within the last 14 days and after the cutover.
    SELECT COALESCE(i.answered_at, i.occurred_at) INTO v_at
      FROM public.practice_session_items i
      JOIN public.practice_sessions ps ON ps.id = i.session_id
     WHERE i.user_id = p_profile_id
       AND i.status = 'answered'
       AND ps.mode <> 'qotd'
     ORDER BY COALESCE(i.answered_at, i.occurred_at), i.id
    OFFSET 9 LIMIT 1;
    RETURN v_at IS NOT NULL
       AND NOT public.entitlement_active(p_profile_id)
       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now
       AND v_at >  p_now - interval '14 days';
  END IF;

  RAISE EXCEPTION 'lifecycle_due: unknown event type %', p_event_type USING ERRCODE = '22023';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Record, resolve, and send at most one per student per 3 days, in priority order
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lifecycle_reminder_claim(timestamptz, integer);
DROP FUNCTION IF EXISTS public.lifecycle_reminder_release(uuid);

CREATE OR REPLACE FUNCTION public.lifecycle_claim(
  p_now   timestamptz DEFAULT now(),
  p_limit integer     DEFAULT 500
) RETURNS TABLE (profile_id uuid, event_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- The priority order (owner brief): the founding reminder, then 1, 2, 3.
  c_types CONSTANT text[] := ARRAY['lifecycle_reminder_due',
                                   'lifecycle_diagnostic_unfinished',
                                   'lifecycle_pro_no_plan',
                                   'lifecycle_practising_free'];
  v_student uuid;
  v_type    text;
  v_id      uuid;
  v_state   text;
  v_due     boolean;
  v_sent    integer := 0;
BEGIN
  FOR v_student IN
    SELECT p.id
      FROM public.profiles p
     WHERE p.role = 'student'
       AND p.deleted_at IS NULL
       AND (   p.profile_completed_at > p_now - interval '14 days'
            OR EXISTS (SELECT 1 FROM public.practice_sessions ps
                        WHERE ps.user_id = p.id AND ps.mode = 'diagnostic'
                          AND ps.status IN ('created', 'active')
                          AND ps.created_at > p_now - interval '14 days')
            OR EXISTS (SELECT 1 FROM public.entitlements e
                        WHERE e.profile_id = p.id AND e.created_at > p_now - interval '14 days')
            OR EXISTS (SELECT 1 FROM public.practice_session_items i
                        WHERE i.user_id = p.id AND i.status = 'answered'
                          AND COALESCE(i.answered_at, i.occurred_at) > p_now - interval '14 days')
            OR EXISTS (SELECT 1 FROM public.notification_events e
                        WHERE e.subject_profile_id = p.id
                          AND e.event_type = ANY (c_types)
                          AND e.payload ->> 'state' = 'pending'))
     ORDER BY p.id
     -- NO KEY UPDATE: claimers still exclude each other, but the FK checks of a student's own
     -- writes (a new session, an answer) take KEY SHARE and are never blocked by the sweep.
     FOR NO KEY UPDATE OF p SKIP LOCKED
  LOOP
    -- (a) Record newly due triggers; resolve pending ones that are no longer due. Each re-check
    --     reads committed state under the row lock, so overlapping runs agree.
    FOREACH v_type IN ARRAY c_types LOOP
      v_id := public.notification_event_id(v_type, v_student::text);
      -- A PR 1 reminder row (payload '{}') has no state: re-emitting it is a no-op (insert-once
      -- id) and only a 'pending' row is ever sent, so it is never sent again.
      SELECT e.payload ->> 'state'
        INTO v_state
        FROM public.notification_events e WHERE e.event_id = v_id;
      v_due := public.lifecycle_due(v_type, v_student, p_now);
      IF v_state IS NULL AND v_due THEN
        PERFORM public.emit_notification_event(
          v_id, v_type, v_student, '[]'::jsonb, jsonb_build_object('state', 'pending'));
      ELSIF v_state = 'pending' AND NOT v_due THEN
        UPDATE public.notification_events
           SET payload = jsonb_build_object('state', 'resolved', 'resolved_at', p_now)
         WHERE event_id = v_id;
      END IF;
    END LOOP;

    -- (b) The cap: no lifecycle email to this student in the last 3 days. A PR 1 reminder row
    --     (payload '{}') was sent when it was written, so its created_at is its sent_at.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notification_events e
       WHERE e.subject_profile_id = v_student
         AND e.event_type = ANY (c_types)
         AND (   (e.payload = '{}'::jsonb AND e.created_at > p_now - interval '3 days')
              OR (e.payload ->> 'state' = 'sent'
                  AND (e.payload ->> 'sent_at')::timestamptz > p_now - interval '3 days')));

    -- (c) Send the first pending one, in priority order.
    FOREACH v_type IN ARRAY c_types LOOP
      v_id := public.notification_event_id(v_type, v_student::text);
      UPDATE public.notification_events e
         SET payload = jsonb_build_object('state', 'sent', 'sent_at', p_now)
       WHERE e.event_id = v_id AND e.payload ->> 'state' = 'pending';
      IF FOUND THEN
        profile_id := v_student;
        event_type := v_type;
        RETURN NEXT;
        v_sent := v_sent + 1;
        EXIT;
      END IF;
    END LOOP;

    EXIT WHEN v_sent >= p_limit;
  END LOOP;
  RETURN;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Undo one send (Resend refused the event): pending again, the cap not spent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_release(p_profile_id uuid, p_event_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.notification_events e
     SET payload = jsonb_build_object('state', 'pending')
   WHERE e.event_id = public.notification_event_id(p_event_type, p_profile_id::text)
     AND e.event_type = p_event_type
     AND e.event_type LIKE 'lifecycle\_%'
     AND e.payload ->> 'state' = 'sent';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.lifecycle_triggers_since(),
  public.lifecycle_due(text, uuid, timestamptz),
  public.lifecycle_claim(timestamptz, integer),
  public.lifecycle_release(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.lifecycle_triggers_since(),
  public.lifecycle_due(text, uuid, timestamptz),
  public.lifecycle_claim(timestamptz, integer),
  public.lifecycle_release(uuid, text)
  TO service_role;

COMMIT;
