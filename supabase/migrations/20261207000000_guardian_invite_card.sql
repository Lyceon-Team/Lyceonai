-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Card on file for a guardian invite: the guardian may save a card for a chosen plan while
-- they wait for their teen, and is charged when the teen joins.
--
-- @spec [owner rulings 2026-11-21 (counsel-approved) 3 (card on file, charged when the teen
--        claims; no seat; no charge without an active link; the guardian never holds an
--        entitlement), 9 (Billing Terms v4, Auto-Renewal Notice v3, Refund Policy v3);
--        SCL-286; builds on 20261206000000_guardian_invites.sql (SCL-282)]
--        | @implemented [2026-11-22]
--
-- plain English:
--   * guardian_invites gains the card and charge columns. charge_status walks:
--       none -> card_pending        the guardian opened a setup-mode Checkout for this invite
--            -> card_saved          the webhook recorded the payment method and plan
--            -> charging            the ONE claim that won the right to charge (exactly one)
--            -> charged             the subscription exists (entitlement: the existing webhook)
--             | payment_failed      declined, or the bank asked to confirm; the link stands
--             | already_funded      the teen was already covered; nothing charged
--             | not_charged         refused before any charge (billing country, or our view
--                                   of existing subscriptions was incomplete)
--     A charge that failed for an infrastructure reason goes back from charging to card_saved,
--     so the same Stripe idempotency key is retried and no second subscription can result.
--   * set_guardian_invite_setup_session_audited: records which setup session is the current
--     one for an open invite of the caller's, for a guardian with no active link.
--   * record_guardian_invite_card_audited: called by the webhook for a completed setup
--     session. Records the card only for the invite's CURRENT session, and only while the
--     invite is open; otherwise it records nothing and says why (the payment method stays on
--     the guardian's Stripe Customer, unused). Never raises for those outcomes.
--   * begin_guardian_invite_charge_audited: the guard. Moves card_saved -> charging only when
--     the invite is claimed by THIS student AND its link is ACTIVE between this guardian and
--     this student. Row-locked, so of two concurrent claims exactly one wins. Without an
--     active link no charge can start.
--   * finish_guardian_invite_charge_audited: records the outcome of the one charge.
--   * legal_acceptances gains consent_source 'guardian_invite_card': the guardian accepts the
--     Billing Terms (auto-renewal consent) before saving the card, in our own page, because the
--     first charge happens later, off-session.
--   * guardian_invite_charge_audit: the audit helper for these steps (actions
--     guardian_invite_card_session / _card_saved / _charge_started / _charge_finished). Kept
--     separate from guardian_invite_audit so that function's body, and the mutation plants
--     aimed at 20261206000000, stay where they are.
--
-- Security: SECURITY DEFINER, EXECUTE to service_role only. No new table.
--
-- Mutations: nothing in 20261206000000 is redefined here. The new plants live in
--   scripts/ci/guardian-invite-card.mutations.sh and target this file.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
--
-- rollback (only once no guardian_invites row has charge_status <> 'none' and no
-- legal_acceptances row carries 'guardian_invite_card'):
--   DROP FUNCTION IF EXISTS public.finish_guardian_invite_charge_audited(uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.begin_guardian_invite_charge_audited(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.record_guardian_invite_card_audited(uuid, uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.set_guardian_invite_setup_session_audited(uuid, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.guardian_invite_charge_audit(text, uuid, uuid, uuid, jsonb, text);
--   ALTER TABLE public.guardian_invites DROP CONSTRAINT guardian_invites_card_saved_has_card,
--     DROP CONSTRAINT guardian_invites_charged_has_subscription,
--     DROP CONSTRAINT guardian_invites_charge_status_check,
--     DROP CONSTRAINT guardian_invites_card_plan_check,
--     DROP COLUMN card_plan, DROP COLUMN card_setup_session_id, DROP COLUMN card_payment_method_id,
--     DROP COLUMN card_saved_at, DROP COLUMN charge_status, DROP COLUMN charge_failure_code,
--     DROP COLUMN stripe_subscription_id, DROP COLUMN charge_started_at, DROP COLUMN charged_at;
--   re-add legal_acceptances_consent_source_check with the list in 20261206000000.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The card and the charge, on the invite
-- ---------------------------------------------------------------------------
ALTER TABLE public.guardian_invites
  ADD COLUMN IF NOT EXISTS card_plan              text,
  -- The setup-mode Checkout Session the guardian most recently opened for this invite. Only a
  -- completed session with THIS id records a card: an older tab completing later does not.
  ADD COLUMN IF NOT EXISTS card_setup_session_id  text,
  ADD COLUMN IF NOT EXISTS card_payment_method_id text,
  ADD COLUMN IF NOT EXISTS card_saved_at          timestamptz,
  ADD COLUMN IF NOT EXISTS charge_status          text NOT NULL DEFAULT 'none',
  -- Stripe's error code for a failed charge, or our reason for not charging. Never a message.
  ADD COLUMN IF NOT EXISTS charge_failure_code    text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS charge_started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS charged_at             timestamptz;

ALTER TABLE public.guardian_invites
  DROP CONSTRAINT IF EXISTS guardian_invites_card_plan_check;
ALTER TABLE public.guardian_invites
  ADD CONSTRAINT guardian_invites_card_plan_check
  CHECK (card_plan IS NULL OR card_plan IN ('monthly', 'quarterly', 'yearly'));

ALTER TABLE public.guardian_invites
  DROP CONSTRAINT IF EXISTS guardian_invites_charge_status_check;
ALTER TABLE public.guardian_invites
  ADD CONSTRAINT guardian_invites_charge_status_check
  CHECK (charge_status IN ('none', 'card_pending', 'card_saved', 'charging', 'charged',
                           'payment_failed', 'already_funded', 'not_charged'));

-- From card_saved on, the card and the plan are known.
ALTER TABLE public.guardian_invites
  DROP CONSTRAINT IF EXISTS guardian_invites_card_saved_has_card;
ALTER TABLE public.guardian_invites
  ADD CONSTRAINT guardian_invites_card_saved_has_card
  CHECK (charge_status IN ('none', 'card_pending')
         OR (card_payment_method_id IS NOT NULL AND card_plan IS NOT NULL
             AND card_saved_at IS NOT NULL));

ALTER TABLE public.guardian_invites
  DROP CONSTRAINT IF EXISTS guardian_invites_charged_has_subscription;
ALTER TABLE public.guardian_invites
  ADD CONSTRAINT guardian_invites_charged_has_subscription
  CHECK ((charge_status = 'charged') = (stripe_subscription_id IS NOT NULL AND charged_at IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2. The audit helper for the card and the charge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardian_invite_charge_audit(
  p_action     text,
  p_actor      uuid,
  p_target     uuid,
  p_invite_id  uuid,
  p_changes    jsonb,
  p_request_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_action NOT IN ('guardian_invite_card_session', 'guardian_invite_card_saved',
                      'guardian_invite_charge_started', 'guardian_invite_charge_finished') THEN
    RAISE EXCEPTION 'unknown guardian invite charge audit action %', p_action USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor, p_target, p_action, p_changes,
    jsonb_build_object('request_id', p_request_id, 'invite_id', p_invite_id)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The guardian opens a setup session for one of their open invites
-- ---------------------------------------------------------------------------
-- Returns jsonb {outcome}: 'recorded', 'not_found' (not this guardian's open, unexpired invite),
-- 'has_active_link' (a guardian with a linked student pays through today's checkout), or
-- 'card_in_use' (the charge has already begun or finished).
CREATE OR REPLACE FUNCTION public.set_guardian_invite_setup_session_audited(
  p_guardian_id uuid,
  p_invite_id   uuid,
  p_session_id  text,
  p_plan        text,
  p_request_id  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'setup session id is not a Checkout Session id' USING ERRCODE = '22023';
  END IF;
  IF p_plan IS NULL OR p_plan NOT IN ('monthly', 'quarterly', 'yearly') THEN
    RAISE EXCEPTION 'unknown plan' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
     AND guardian_profile_id = p_guardian_id
   FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'open' OR v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF EXISTS (SELECT 1 FROM public.guardian_links
              WHERE guardian_profile_id = p_guardian_id AND status = 'active') THEN
    RETURN jsonb_build_object('outcome', 'has_active_link');
  END IF;

  IF v_row.charge_status NOT IN ('none', 'card_pending', 'card_saved') THEN
    RETURN jsonb_build_object('outcome', 'card_in_use');
  END IF;

  -- A saved card stays saved, with its own plan, until a newer session completes; only a card
  -- not yet saved shows the plan just chosen.
  UPDATE public.guardian_invites
     SET card_setup_session_id = p_session_id,
         card_plan = CASE WHEN charge_status IN ('none', 'card_pending') THEN p_plan ELSE card_plan END,
         charge_status = CASE WHEN charge_status = 'none' THEN 'card_pending' ELSE charge_status END,
         updated_at = now()
   WHERE id = p_invite_id;

  PERFORM public.guardian_invite_charge_audit(
    'guardian_invite_card_session', p_guardian_id, NULL, p_invite_id,
    jsonb_build_object('previous_charge_status', v_row.charge_status, 'plan', p_plan),
    p_request_id
  );
  RETURN jsonb_build_object('outcome', 'recorded');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The webhook records the card from a completed setup session
-- ---------------------------------------------------------------------------
-- Returns jsonb {outcome}: 'recorded', 'already_recorded' (the same session again: a webhook
-- replay), 'not_found', 'stale_session' (not the invite's current session), 'invite_closed'
-- (claimed, cancelled or expired before the card was saved: no charge will ever be made), or
-- 'card_in_use'. Never raises for any of these: they are decisions, and the event settles.
CREATE OR REPLACE FUNCTION public.record_guardian_invite_card_audited(
  p_invite_id         uuid,
  p_guardian_id       uuid,
  p_session_id        text,
  p_payment_method_id text,
  p_plan              text,
  p_request_id        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
BEGIN
  IF p_plan IS NULL OR p_plan NOT IN ('monthly', 'quarterly', 'yearly') THEN
    RAISE EXCEPTION 'unknown plan' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method_id IS NULL OR p_payment_method_id !~ '^pm_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'payment method id is not a PaymentMethod id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
     AND guardian_profile_id = p_guardian_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.card_setup_session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('outcome', 'stale_session');
  END IF;

  IF v_row.charge_status = 'card_saved'
     AND v_row.card_payment_method_id = p_payment_method_id THEN
    RETURN jsonb_build_object('outcome', 'already_recorded');
  END IF;

  IF v_row.status <> 'open' OR v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'invite_closed');
  END IF;

  IF v_row.charge_status NOT IN ('card_pending', 'card_saved') THEN
    RETURN jsonb_build_object('outcome', 'card_in_use');
  END IF;

  UPDATE public.guardian_invites
     SET card_plan = p_plan,
         card_payment_method_id = p_payment_method_id,
         card_saved_at = now(),
         charge_status = 'card_saved',
         updated_at = now()
   WHERE id = p_invite_id;

  PERFORM public.guardian_invite_charge_audit(
    'guardian_invite_card_saved', p_guardian_id, NULL, p_invite_id,
    jsonb_build_object('plan', p_plan),
    p_request_id
  );
  RETURN jsonb_build_object('outcome', 'recorded');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The guard: only a claimed invite with an ACTIVE link may start a charge, and only once
-- ---------------------------------------------------------------------------
-- Returns jsonb {outcome: 'begin', guardian_profile_id, plan, payment_method_id} for the one
-- caller that moved the invite from card_saved to charging, else {outcome} with 'no_card'
-- (nothing saved, or already begun/finished), 'not_claimed' (not claimed by this student), or
-- 'no_active_link'.
CREATE OR REPLACE FUNCTION public.begin_guardian_invite_charge_audited(
  p_invite_id  uuid,
  p_student_id uuid,
  p_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
BEGIN
  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
   FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'claimed'
     OR v_row.claimed_by_profile_id IS DISTINCT FROM p_student_id THEN
    RETURN jsonb_build_object('outcome', 'not_claimed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_links l
     WHERE l.id = v_row.link_id
       AND l.status = 'active'
       AND l.guardian_profile_id = v_row.guardian_profile_id
       AND l.student_profile_id = p_student_id
  ) THEN
    RETURN jsonb_build_object('outcome', 'no_active_link');
  END IF;

  IF v_row.charge_status <> 'card_saved' THEN
    RETURN jsonb_build_object('outcome', 'no_card');
  END IF;

  UPDATE public.guardian_invites
     SET charge_status = 'charging',
         charge_started_at = now(),
         updated_at = now()
   WHERE id = p_invite_id;

  PERFORM public.guardian_invite_charge_audit(
    'guardian_invite_charge_started', v_row.guardian_profile_id, p_student_id, p_invite_id,
    jsonb_build_object('plan', v_row.card_plan),
    p_request_id
  );
  RETURN jsonb_build_object(
    'outcome', 'begin',
    'guardian_profile_id', v_row.guardian_profile_id,
    'plan', v_row.card_plan,
    'payment_method_id', v_row.card_payment_method_id
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The outcome of the one charge
-- ---------------------------------------------------------------------------
-- p_outcome: 'charged' (with p_subscription_id), 'payment_failed', 'already_funded',
-- 'not_charged' (each with a code in p_failure_code where there is one), or 'release' (an
-- infrastructure failure: back to card_saved, so the next claim retry tries again under the
-- same Stripe idempotency key). Only an invite that is 'charging' moves; returns true if it did.
CREATE OR REPLACE FUNCTION public.finish_guardian_invite_charge_audited(
  p_invite_id       uuid,
  p_outcome         text,
  p_subscription_id text,
  p_failure_code    text,
  p_request_id      text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
  v_next text;
BEGIN
  IF p_outcome NOT IN ('charged', 'payment_failed', 'already_funded', 'not_charged', 'release') THEN
    RAISE EXCEPTION 'unknown charge outcome %', p_outcome USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'charged'
     AND (p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]+$') THEN
    RAISE EXCEPTION 'a charged invite needs its subscription id' USING ERRCODE = '22023';
  END IF;
  IF p_failure_code IS NOT NULL AND p_failure_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'failure code is not a code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
   FOR UPDATE;
  IF NOT FOUND OR v_row.charge_status <> 'charging' THEN
    RETURN false;
  END IF;

  v_next := CASE p_outcome WHEN 'release' THEN 'card_saved' ELSE p_outcome END;

  UPDATE public.guardian_invites
     SET charge_status = v_next,
         stripe_subscription_id = CASE WHEN p_outcome = 'charged' THEN p_subscription_id ELSE NULL END,
         charged_at = CASE WHEN p_outcome = 'charged' THEN now() ELSE NULL END,
         charge_failure_code = CASE WHEN p_outcome IN ('charged', 'release') THEN NULL ELSE p_failure_code END,
         charge_started_at = CASE WHEN p_outcome = 'release' THEN NULL ELSE charge_started_at END,
         updated_at = now()
   WHERE id = p_invite_id;

  PERFORM public.guardian_invite_charge_audit(
    'guardian_invite_charge_finished', v_row.guardian_profile_id, v_row.claimed_by_profile_id,
    p_invite_id,
    jsonb_build_object('outcome', p_outcome, 'code', p_failure_code),
    p_request_id
  );
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_invite_charge_audit(text, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_guardian_invite_setup_session_audited(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_guardian_invite_card_audited(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_guardian_invite_charge_audited(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_guardian_invite_charge_audited(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_invite_charge_audit(text, uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_guardian_invite_setup_session_audited(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_guardian_invite_card_audited(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_guardian_invite_charge_audited(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_guardian_invite_charge_audited(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Where a Billing Terms acceptance was collected: also when a card is saved on an invite
-- ---------------------------------------------------------------------------
-- The list is otherwise unchanged from 20261206000000_guardian_invites.sql.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_consent_source_check;
ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_consent_source_check
  CHECK (consent_source IN (
    'email_signup_form',
    'google_continue_pre_oauth',
    'google_continue_click',
    'guardian_link_redeem',
    'guardian_invite_issue',
    'guardian_invite_card',
    'stripe_checkout',
    'reconsent_prompt'
  ));

COMMIT;
