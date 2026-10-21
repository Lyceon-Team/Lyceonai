-- ===========================================================================
-- Lifecycle email: the founding reminder, sent when Lyceon decides, not 72 h after signup.
--
-- @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
--       2026-10-21) PR 1; owner answers the same day: the record is the notification ledger, the
--       window is the morning Chicago sweep, only students onboarded after this change, branch
--       seo; contracts/notifications.contract.md §14A (C14A.1 amended: a third fact; C14A.3
--       amended: the reminder is recorded, once, in the ledger) and §6.6 (quiet hours); SCL-239]
--       | @implemented [2026-10-21]
--
-- plain English:
--  1. `lifecycle_reminder_due` joins the ledger's event types. One event per student, ever
--     (event id = notification_event_id('lifecycle_reminder_due', <profile id>)). It is emitted
--     with NO recipients, so it creates no notification_messages row and the dispatcher never sees
--     it: Resend sends the email (an Automation on the Resend event `lyceon.reminder_due`); the
--     ledger row is only the record that Lyceon told Resend, once.
--  2. `lifecycle_reminder_since()` is the cutover: 2026-10-23 14:00 UTC, when the Resend Automation
--     is split. Students who completed onboarding before it are still on the old Automation
--     (welcome + 72 h reminder on `lyceon.onboarded`) and must not get a second reminder. A
--     fixed instant, not the apply time, so the schema is the same on every apply (genesis gate).
--  3. `lifecycle_reminder_claim(p_now, p_limit)` records the reminder for every student due at
--     p_now and returns their ids, in one transaction:
--       onboarding completed at least 3 days before p_now and not before the cutover; a student;
--       not deleted, no pending deletion request; known to be 13 or over
--       (marketing_opt_in_age_eligible); not entitled (entitlement_active); not already recorded.
--     Rows are locked FOR UPDATE SKIP LOCKED, so two overlapping runs cannot both claim a
--     student; the ledger's insert-once event id makes a repeat claim impossible after commit.
--     The caller (server/lib/lifecycle-email.ts) applies the address checks Postgres cannot see
--     (the LIFECYCLE_EMAIL_DENYLIST env var, a `test` address) and sends `lyceon.reminder_due`.
--  4. `lifecycle_reminder_release(p_profile_id)` undoes one claim when Resend refused the event,
--     so the next morning's sweep tries again; it deletes only a recipient-less reminder row.
--  5. Service role only; SECURITY DEFINER like the other notify functions (they read across
--     student tables), exercised in CI as a service_role probe role (the #1248 lesson).
--
-- OWNER-RUN. Karl applies to prod after 20261108000000_feedback_context.sql. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.lifecycle_reminder_release(uuid);
--   DROP FUNCTION IF EXISTS public.lifecycle_reminder_claim(timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.lifecycle_reminder_since();
--   DELETE FROM public.notification_events WHERE event_type = 'lifecycle_reminder_due';
--   -- re-add notification_events_type_check from 20261107000000_review_ask.sql section 2
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Event type (contract C1.1; list otherwise identical to 20261107000000)
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
                        'lifecycle_reminder_due'));

-- ---------------------------------------------------------------------------
-- 2. The cutover: a fixed instant, so every apply of this file yields the same schema
-- ---------------------------------------------------------------------------
-- 2026-10-23 14:00 UTC (09:00 Chicago): the morning the Resend Automation is split (the welcome
-- stays on lyceon.onboarded; the reminder moves to lyceon.reminder_due). If PR 1 is not live by
-- then, move this instant to the split before applying.
CREATE OR REPLACE FUNCTION public.lifecycle_reminder_since()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT timestamptz '2026-10-23 14:00:00+00' $fn$;
COMMENT ON FUNCTION public.lifecycle_reminder_since() IS
  'The cutover (2026-10-23 14:00 UTC, the Resend Automation split). Students who completed onboarding earlier stay on the old Automation (its own 72 h reminder) and never get lyceon.reminder_due.';

-- ---------------------------------------------------------------------------
-- 3. Claim every due reminder, once
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_reminder_claim(
  p_now   timestamptz DEFAULT now(),
  p_limit integer     DEFAULT 500
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT p.id
      FROM public.profiles p
     WHERE p.role = 'student'
       AND p.profile_completed_at IS NOT NULL
       AND p.profile_completed_at >= public.lifecycle_reminder_since()
       AND p.profile_completed_at <= p_now - interval '3 days'
       AND p.deleted_at IS NULL
       AND public.marketing_opt_in_age_eligible(p.date_of_birth)
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                        WHERE d.profile_id = p.id AND d.status = 'pending')
       AND NOT public.entitlement_active(p.id)
       AND NOT EXISTS (SELECT 1 FROM public.notification_events e
                        WHERE e.event_id = public.notification_event_id(
                                             'lifecycle_reminder_due', p.id::text))
     ORDER BY p.profile_completed_at, p.id
     LIMIT p_limit
     FOR UPDATE OF p SKIP LOCKED
  LOOP
    -- No recipients: no notification_messages row; Resend sends the email.
    PERFORM public.emit_notification_event(
      public.notification_event_id('lifecycle_reminder_due', v_id::text),
      'lifecycle_reminder_due',
      v_id,
      '[]'::jsonb,
      '{}'::jsonb);
    RETURN NEXT v_id;
  END LOOP;
  RETURN;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Undo one claim (Resend refused the event): tomorrow's sweep tries again
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_reminder_release(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  DELETE FROM public.notification_events e
   WHERE e.event_id = public.notification_event_id('lifecycle_reminder_due', p_profile_id::text)
     AND e.event_type = 'lifecycle_reminder_due'
     AND NOT EXISTS (SELECT 1 FROM public.notification_messages m WHERE m.event_id = e.event_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.lifecycle_reminder_since(),
  public.lifecycle_reminder_claim(timestamptz, integer),
  public.lifecycle_reminder_release(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.lifecycle_reminder_since(),
  public.lifecycle_reminder_claim(timestamptz, integer),
  public.lifecycle_reminder_release(uuid)
  TO service_role;

COMMIT;
