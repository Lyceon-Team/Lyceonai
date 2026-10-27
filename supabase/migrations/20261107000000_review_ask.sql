-- ===========================================================================
-- Review ask: the in-app review prompt on a usage trigger, at most two asks, a 30-day snooze,
-- and one follow-up email to adults.
--
-- @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
--       2026-10-20) rules (no review gating, no incentives, platform age rules) and Behaviour
--       1–5; Karl's Step 0 decisions (2026-10-20): 1 (no public review site for 13–17s), 2 (the
--       in-app star review stays for everyone), 3 (trigger: 7+ days since signup AND 3+ completed
--       sessions, QOTD excluded; the "full week completed" moment is retired), 4 (at most 2
--       in-app asks ever, a 30-day snooze, one email 3 days after an unanswered first ask), 5
--       (the email to adults only — 18+ students and guardians — with the signed one-click
--       "Stop review requests" link); docs/plans/seo/seo-marketing-vertical.md R28–R30 (as
--       amended 2026-10-20); Public Disclosure Doctrine rules 7 and 8; contracts/
--       notifications.contract.md C1.1, §2.3, §8.1 (amended in the same change)]
--       | @implemented [2026-10-20]
--
-- plain English:
--  1. `product_review_prompt_state` gains the ask cadence: `ask_count` (in-app asks so far),
--     `snoozed_until` ("Not now" and the close button both snooze 30 days), `last_response`
--     (what the person did with the latest ask: reviewed | feedback | snoozed | dismissed |
--     stopped) and `email_queued_at` (the one follow-up email, once). No review content is
--     stored here: the review itself stays in product_reviews, the feedback in product_feedback.
--     Existing rows are backfilled so nobody already asked is asked as if for the first time.
--  2. The DECISION to ask stays the pure function in packages/shared (`decideReviewPrompt`);
--     the hard limits are ALSO held here, where every writer passes: the claim refuses a third
--     ask, an answered person and a live snooze, whatever the server decided.
--  3. `product_review_prompt_respond` replaces `product_review_prompt_dismiss`: it records the
--     ONE response to the current showing (snoozed / dismissed set the 30-day snooze). A review
--     (in-app), a Trustpilot click or private feedback sent from the prompt ends the asks for
--     good; so does "Stop review requests" (`product_review_prompt_stop`).
--  4. `review_ask_usage_met` is the trigger, in one place: a student 7+ days after signup with
--     3+ completed sessions (practice of any mode but `qotd`, review, full-length); a guardian
--     with an active link 7+ days old to a student they may see (`guardian_view_decision` =
--     'allow') who has 3+ completed sessions. It returns a boolean only; no session data
--     leaves it.
--  5. `review_ask` joins the notification types. `review_ask_email_notify` (called by the daily
--     dispatch sweep) emits ONE `review_ask` email per person, ever (event id from the profile
--     id, insert-once), to a student or guardian aged 18+ whose FIRST ask is 3 to 14 days old
--     and unanswered (no response of any kind). Quiet hours are the dispatcher's; the sweep runs
--     after they end. The email carries no review content and no rating, only the first name.
--
-- No gating, by construction: nothing here reads a rating, a review, feedback or any signal of
-- how the person feels. The trigger is usage only, and every eligible person gets the same ask.
--
-- Mutations: this file becomes the last definer of product_review_prompt_state_for, _claim,
-- product_review_submit, product_review_mark_external and product_feedback_submit, and drops
-- product_review_prompt_dismiss. scripts/ci/marketing-consent-reviews.mutations.sh is
-- re-pointed here in the same change (CLAUDE.md, "A migration that replaces a function body
-- orphans its mutations").
--
-- Deletion: no new table. product_review_prompt_state keeps ON DELETE CASCADE from profiles,
-- classified by scripts/ci/fk-delete-action-guard.sql from the catalog.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.review_ask_email_notify(timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.review_ask_usage_met(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.product_review_prompt_stop(uuid);
--   DROP FUNCTION IF EXISTS public.product_review_prompt_respond(uuid, text);
--   -- re-run section 6's functions and section 7 of 20261027000000_marketing_consent_and_product_reviews.sql
--   DELETE FROM public.notification_events WHERE event_type = 'review_ask';
--   -- restore notification_events_type_check from 20261101000000 section 1
--   ALTER TABLE public.product_review_prompt_state
--     DROP COLUMN IF EXISTS ask_count, DROP COLUMN IF EXISTS snoozed_until,
--     DROP COLUMN IF EXISTS last_response, DROP COLUMN IF EXISTS email_queued_at;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The cadence columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_review_prompt_state
  ADD COLUMN IF NOT EXISTS ask_count       smallint    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snoozed_until   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_response   text        NULL,
  ADD COLUMN IF NOT EXISTS email_queued_at timestamptz NULL;

ALTER TABLE public.product_review_prompt_state
  DROP CONSTRAINT IF EXISTS product_review_prompt_state_ask_count_check;
ALTER TABLE public.product_review_prompt_state
  ADD CONSTRAINT product_review_prompt_state_ask_count_check CHECK (ask_count BETWEEN 0 AND 2);
ALTER TABLE public.product_review_prompt_state
  DROP CONSTRAINT IF EXISTS product_review_prompt_state_last_response_check;
ALTER TABLE public.product_review_prompt_state
  ADD CONSTRAINT product_review_prompt_state_last_response_check
  CHECK (last_response IN ('reviewed', 'feedback', 'snoozed', 'dismissed', 'stopped'));

-- Backfill. Every showing before today was one ask (the old prompt showed at most once per 120
-- days, so a row holds one showing, or two when it was dismissed twice). A review left means
-- answered; a dismissal of the latest showing becomes a dismissal with its 30-day snooze.
UPDATE public.product_review_prompt_state s
   SET ask_count = LEAST(2, GREATEST(s.dismiss_count,
                                     CASE WHEN s.last_shown_at IS NULL THEN 0 ELSE 1 END)),
       last_response = CASE
         WHEN s.reviewed_at IS NOT NULL THEN 'reviewed'
         WHEN s.last_dismissed_at IS NOT NULL
              AND s.last_dismissed_at >= s.last_shown_at THEN 'dismissed'
         ELSE NULL END,
       snoozed_until = CASE
         WHEN s.reviewed_at IS NULL AND s.last_dismissed_at IS NOT NULL
              AND s.last_dismissed_at >= s.last_shown_at
         THEN s.last_dismissed_at + interval '30 days'
         ELSE NULL END
 WHERE s.ask_count = 0 AND s.last_response IS NULL;

COMMENT ON TABLE public.product_review_prompt_state IS
  'Plan R30 (amended 2026-10-20, review ask): the review prompt''s cadence facts per profile — asks so far (max 2), the 30-day snooze, the response to the latest ask, and when the one follow-up email was queued. No review content. The decision is decideReviewPrompt (packages/shared/src/product-feedback-schema.ts); these functions record and hold the hard limits. ON DELETE CASCADE from profiles.';
COMMENT ON COLUMN public.product_review_prompt_state.dismiss_count IS
  'Legacy (before 2026-10-20): dismissals under the 120-day cadence. Backfilled into ask_count / last_response; no longer written.';

-- ---------------------------------------------------------------------------
-- 2. Event type (contract C1.1; list otherwise identical to 20261101000000)
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
                        'review_ask'));

-- ---------------------------------------------------------------------------
-- 3. The prompt's functions (replacing 20261027000000 section 6)
-- ---------------------------------------------------------------------------
-- The stored cadence facts, or NULL when this profile was never asked. last_shown_at is
-- returned as stored: the claim compares it for equality (microseconds), so it round-trips.
CREATE OR REPLACE FUNCTION public.product_review_prompt_state_for(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
           'last_shown_at',   s.last_shown_at,
           'ask_count',       s.ask_count,
           'snoozed_until',   s.snoozed_until,
           'last_response',   s.last_response,
           'reviewed_at',     s.reviewed_at,
           'email_queued_at', s.email_queued_at)
    FROM public.product_review_prompt_state s
   WHERE s.profile_id = p_profile_id;
$fn$;

-- Compare-and-set "asked". The server decided, from the state it read, that an ask is due; this
-- records it only if nobody else did in between (p_expected = the last_shown_at it read) AND the
-- hard limits still hold: fewer than 2 asks so far, not answered or stopped, no live snooze.
CREATE OR REPLACE FUNCTION public.product_review_prompt_claim(
  p_profile_id uuid,
  p_expected   timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO public.product_review_prompt_state (profile_id, last_shown_at, ask_count)
  VALUES (p_profile_id, now(), 1)
  ON CONFLICT (profile_id) DO UPDATE
     SET last_shown_at = now(),
         ask_count     = product_review_prompt_state.ask_count + 1,
         last_response = NULL,
         updated_at    = now()
   WHERE product_review_prompt_state.last_shown_at IS NOT DISTINCT FROM p_expected
     AND product_review_prompt_state.reviewed_at IS NULL
     AND product_review_prompt_state.ask_count < 2
     AND (product_review_prompt_state.last_response IS NULL
          OR product_review_prompt_state.last_response IN ('snoozed', 'dismissed'))
     AND (product_review_prompt_state.snoozed_until IS NULL
          OR product_review_prompt_state.snoozed_until <= now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- The one response to the current ask: 'snoozed' ("Not now") or 'dismissed' (the close
-- button), both a 30-day snooze. Once per ask: a double click, a retry or a second tab counts
-- once, and an answered ask cannot be turned into a snooze.
CREATE OR REPLACE FUNCTION public.product_review_prompt_respond(
  p_profile_id uuid,
  p_response   text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('snoozed', 'dismissed') THEN
    RAISE EXCEPTION 'product_review_prompt_respond: p_response must be snoozed or dismissed'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_review_prompt_state
     SET last_response     = p_response,
         snoozed_until     = now() + interval '30 days',
         last_dismissed_at = now(),
         updated_at        = now()
   WHERE profile_id = p_profile_id
     AND last_shown_at IS NOT NULL
     AND reviewed_at IS NULL
     AND last_response IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- "Stop review requests" (the email's signed link): no more asks, in-app or by email. Idempotent;
-- a person who already reviewed keeps 'reviewed'.
CREATE OR REPLACE FUNCTION public.product_review_prompt_stop(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.product_review_prompt_state (profile_id, last_response)
  VALUES (p_profile_id, 'stopped')
  ON CONFLICT (profile_id) DO UPDATE
     SET last_response = CASE WHEN product_review_prompt_state.reviewed_at IS NULL
                              THEN 'stopped' ELSE product_review_prompt_state.last_response END,
         updated_at    = now();
$fn$;

-- Returns { outcome: 'created' | 'replayed' | 'conflict' }. A retry of the same review is a
-- replay; a different second review is a conflict (one per profile). A created review ends the
-- asks ('reviewed').
CREATE OR REPLACE FUNCTION public.product_review_submit(
  p_profile_id       uuid,
  p_audience         text,
  p_rating           smallint,
  p_body             text,
  p_quote_permission boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing public.product_reviews%ROWTYPE;
  v_rows     integer;
BEGIN
  INSERT INTO public.product_reviews (profile_id, audience, rating, body, quote_permission)
  VALUES (p_profile_id, p_audience, p_rating, p_body, p_quote_permission)
  ON CONFLICT (profile_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT * INTO v_existing FROM public.product_reviews WHERE profile_id = p_profile_id;
    IF v_existing.rating = p_rating
       AND v_existing.body IS NOT DISTINCT FROM p_body
       AND v_existing.quote_permission = p_quote_permission THEN
      RETURN jsonb_build_object('outcome', 'replayed');
    END IF;
    RETURN jsonb_build_object('outcome', 'conflict');
  END IF;

  INSERT INTO public.product_review_prompt_state (profile_id, reviewed_at, reviewed_via, last_response)
  VALUES (p_profile_id, now(), 'in_app', 'reviewed')
  ON CONFLICT (profile_id) DO UPDATE
     SET reviewed_at   = COALESCE(product_review_prompt_state.reviewed_at, now()),
         reviewed_via  = COALESCE(product_review_prompt_state.reviewed_via, 'in_app'),
         last_response = 'reviewed',
         updated_at    = now();
  RETURN jsonb_build_object('outcome', 'created');
END;
$fn$;

-- The Trustpilot button was used: counts as reviewed (owner answer 6, 2026-10-05). We cannot know
-- whether a review was actually left there, so this only ends the asks.
CREATE OR REPLACE FUNCTION public.product_review_mark_external(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.product_review_prompt_state (profile_id, reviewed_at, reviewed_via, last_response)
  VALUES (p_profile_id, now(), 'trustpilot', 'reviewed')
  ON CONFLICT (profile_id) DO UPDATE
     SET reviewed_at   = COALESCE(product_review_prompt_state.reviewed_at, now()),
         reviewed_via  = COALESCE(product_review_prompt_state.reviewed_via, 'trustpilot'),
         last_response = 'reviewed',
         updated_at    = now();
$fn$;

-- Returns { outcome: 'created' | 'replayed' }. Feedback sent from the prompt (source 'prompt')
-- answers the ask: no more asks (Karl, 2026-10-20: "a review, prompt feedback or a Trustpilot
-- click stops everything"). Feedback from Settings, Help or the menu changes nothing here.
CREATE OR REPLACE FUNCTION public.product_feedback_submit(
  p_profile_id      uuid,
  p_audience        text,
  p_body            text,
  p_source          text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO public.product_feedback (profile_id, audience, body, source, idempotency_key)
  VALUES (p_profile_id, p_audience, p_body, p_source, p_idempotency_key)
  ON CONFLICT (profile_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 1 AND p_source = 'prompt' THEN
    INSERT INTO public.product_review_prompt_state (profile_id, last_response)
    VALUES (p_profile_id, 'feedback')
    ON CONFLICT (profile_id) DO UPDATE
       SET last_response = 'feedback', updated_at = now()
     WHERE product_review_prompt_state.reviewed_at IS NULL
       AND product_review_prompt_state.last_response IS DISTINCT FROM 'stopped';
  END IF;
  RETURN jsonb_build_object('outcome', CASE WHEN v_rows = 1 THEN 'created' ELSE 'replayed' END);
END;
$fn$;

DROP FUNCTION IF EXISTS public.product_review_prompt_dismiss(uuid);

-- ---------------------------------------------------------------------------
-- 4. The usage trigger (Karl's decision 3, 2026-10-20)
-- ---------------------------------------------------------------------------
-- Completed sessions that count: practice of any mode but the daily question, review, and
-- full-length tests. "Find your blind spots" is a practice session (mode 'diagnostic').
CREATE OR REPLACE FUNCTION public.review_ask_completed_sessions(p_student_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT ((SELECT count(*) FROM public.practice_sessions ps
            WHERE ps.user_id = p_student_id AND ps.status = 'completed' AND ps.mode <> 'qotd')
        + (SELECT count(*) FROM public.review_sessions rs
            WHERE rs.student_id = p_student_id AND rs.status = 'completed')
        + (SELECT count(*) FROM public.test_sessions ts
            WHERE ts.student_id = p_student_id AND ts.state = 'completed'))::integer;
$fn$;

CREATE OR REPLACE FUNCTION public.review_ask_usage_met(
  p_profile_id uuid,
  p_now        timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT CASE p.role
      WHEN 'student' THEN
        p.created_at <= p_now - interval '7 days'
        AND public.review_ask_completed_sessions(p.id) >= 3
      WHEN 'guardian' THEN EXISTS (
        SELECT 1 FROM public.guardian_links l
         WHERE l.guardian_profile_id = p.id
           AND l.status = 'active'
           AND COALESCE(l.accepted_at, l.created_at) <= p_now - interval '7 days'
           AND public.guardian_view_decision(p.id, l.student_profile_id) = 'allow'
           AND public.review_ask_completed_sessions(l.student_profile_id) >= 3)
      ELSE false END
      FROM public.profiles p
     WHERE p.id = p_profile_id AND p.deleted_at IS NULL), false);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The one follow-up email (Karl's decisions 4 and 5, 2026-10-20)
-- ---------------------------------------------------------------------------
-- One `review_ask` email per person, ever: 18+ (whole years from the date of birth, UTC day, the
-- same rule as packages/shared ageInYears), a student or guardian, not deleted or being deleted,
-- first asked 3 to 14 days ago, and no response at all to that ask. Called by the daily dispatch
-- sweep (14:00 UTC, after quiet hours). Returns the count only.
CREATE OR REPLACE FUNCTION public.review_ask_email_notify(
  p_now   timestamptz DEFAULT now(),
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row     record;
  v_emitted integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.id, p.role,
           split_part(btrim(COALESCE(p.display_name, '')), ' ', 1) AS first_name
      FROM public.product_review_prompt_state s
      JOIN public.profiles p ON p.id = s.profile_id
     WHERE s.ask_count = 1
       AND s.last_response IS NULL
       AND s.reviewed_at IS NULL
       AND s.email_queued_at IS NULL
       AND s.last_shown_at <= p_now - interval '3 days'
       AND s.last_shown_at >  p_now - interval '14 days'
       AND p.role IN ('student', 'guardian')
       AND p.deleted_at IS NULL
       AND p.date_of_birth IS NOT NULL
       AND p.date_of_birth <= ((p_now AT TIME ZONE 'UTC')::date - interval '18 years')::date
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                        WHERE d.profile_id = p.id AND d.status = 'pending')
     ORDER BY s.last_shown_at, p.id
     LIMIT p_limit
     FOR UPDATE OF s SKIP LOCKED
  LOOP
    PERFORM public.emit_notification_event(
      public.notification_event_id('review_ask', v_row.id::text),
      'review_ask',
      v_row.id,
      jsonb_build_array(jsonb_build_object('profile_id', v_row.id,
                                           'channels', jsonb_build_array('email'))),
      jsonb_build_object('first_name', v_row.first_name, 'audience', v_row.role),
      p_now + interval '7 days');
    UPDATE public.product_review_prompt_state
       SET email_queued_at = p_now, updated_at = now()
     WHERE profile_id = v_row.id;
    v_emitted := v_emitted + 1;
  END LOOP;
  RETURN jsonb_build_object('emitted', v_emitted);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Privileges: service role only. The prompt functions are SECURITY INVOKER and write through
--    service_role's own table rights (20261027000000 section 7 grants INSERT, UPDATE on the
--    state table); the trigger and the emitter are SECURITY DEFINER, like the other notify
--    functions, because they read across student tables.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz),
  public.product_review_prompt_respond(uuid, text),
  public.product_review_prompt_stop(uuid),
  public.product_review_submit(uuid, text, smallint, text, boolean),
  public.product_review_mark_external(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid),
  public.review_ask_completed_sessions(uuid),
  public.review_ask_usage_met(uuid, timestamptz),
  public.review_ask_email_notify(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz),
  public.product_review_prompt_respond(uuid, text),
  public.product_review_prompt_stop(uuid),
  public.product_review_submit(uuid, text, smallint, text, boolean),
  public.product_review_mark_external(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid),
  public.review_ask_completed_sessions(uuid),
  public.review_ask_usage_met(uuid, timestamptz),
  public.review_ask_email_notify(timestamptz, integer)
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.product_review_prompt_state TO service_role;

COMMIT;
