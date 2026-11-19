-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian paid seats: a guardian buys one seat before any student is linked, invites a
-- teen to it, and the teen claims it.
--
-- @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl,
--        2026-11-19) §1-§2; the two SCL entries this change logs (a guardian paying for an
--        unassigned seat that attaches on claim, amending Doc 01 V8 §20 and SCL-045; the
--        seat invite as a second sanctioned linking mechanism for paid seats, alongside
--        SCL-080); Doc 00 §6 / Coding Standards §6.3 (payment ≠ permissions: entitlements
--        are student-scoped); Doc 01 V8 §36.1 (both parties notified)]
--        | @implemented [2026-11-19]
--
-- plain English:
--   * public.guardian_seats — one row per seat subscription. status is 'unassigned' until a
--     teen claims it ('claimed'), and 'cancelled' once the subscription ends. Nothing else.
--     A seat is never an entitlement: no entitlements row exists for it until a student
--     claims it, so an unassigned seat grants nothing to anyone (payment ≠ permissions).
--     The invite lives on the seat: only the SHA-256 of the token is stored, valid 7 days,
--     one live token per seat. Issuing a new token (send, resend, copy link) replaces the
--     old one; cancelling clears it.
--   * guardian_link_create_core — the body of create_active_guardian_link_audited, unchanged
--     except that who initiated the link and how it was made are parameters. The existing
--     function keeps its signature and calls the core with ('student', 'student_link_code'),
--     so link-code redemption behaves exactly as before; a seat claim calls it with
--     ('guardian', 'guardian_seat_invite'). One canonical link writer, two callers.
--   * guardian_seat_claim — ONE transaction: find the seat by token hash, refuse an
--     invalid one (unknown, expired, cancelled, already used by someone else) with one
--     outcome, refuse a student who already has an active entitlement (the seat stays
--     unassigned and the guardian's card shows it), otherwise create the link and mark the
--     seat claimed. A retry by the same student after a successful claim returns 'claimed'
--     again (idempotent), so the server can finish the Stripe step on a retry.
--   * guardian_seat_record / guardian_seat_mark_cancelled — the webhook's writes: record a
--     seat once per subscription; mark it cancelled when the subscription ends.
--   * Two rate-limit buckets for invite emails, keyed on the guardian: 10 a day, and 3 a day
--     per (guardian, address).
--
-- Security: every function is SECURITY DEFINER with EXECUTE granted to service_role only
--   (the core to nobody: only the two definer wrappers call it). The table has RLS on, no
--   policies, and grants to service_role only.
--
-- Mutations: create_active_guardian_link_audited's body moves from
--   20261014000000_guardian_link_party_roles.sql to here. No scripts/ci/*.mutations.sh
--   entry targets it (grep, 2026-11-19); the new plants live in
--   scripts/ci/guardian-seats.mutations.sh and target this file.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
--
-- rollback (in this order):
--   re-run the CREATE OR REPLACE FUNCTION block of 20261014000000_guardian_link_party_roles.sql;
--   DROP FUNCTION IF EXISTS public.guardian_seat_claim(text, uuid, text);
--   DROP FUNCTION IF EXISTS public.guardian_seat_invite_valid(text);
--   DROP FUNCTION IF EXISTS public.guardian_seat_cancel_invite(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.guardian_seat_issue_invite(uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.guardian_seat_mark_cancelled(text);
--   DROP FUNCTION IF EXISTS public.guardian_seat_record(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.guardian_link_create_core(uuid, uuid, text, text, text);
--   DROP TABLE IF EXISTS public.guardian_seats;
--   UPDATE public.rate_limit_runtime_config SET value = value - 'guardian_seat_invite_daily'
--     - 'guardian_seat_invite_email' WHERE key = 'bucket_definitions';
--   (consent source) only once no legal_acceptances row carries 'guardian_seat_checkout':
--   re-add legal_acceptances_consent_source_check with the list in 20260916000000.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The seat
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guardian_seats (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: the seat is the guardian's own purchase bookkeeping and has no standalone value
  -- once the guardian's account is hard-deleted (the deletion flow ends the subscription).
  guardian_profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_subscription_id      text NOT NULL,
  stripe_subscription_item_id text,
  status                      text NOT NULL DEFAULT 'unassigned'
                              CHECK (status IN ('unassigned', 'claimed', 'cancelled')),
  -- SET NULL: a claimed seat survives the student's deletion as a record of the purchase.
  student_profile_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The invite. Only the SHA-256 (hex) of the token is stored; the token itself never is.
  invite_token_hash           text,
  invite_expires_at           timestamptz,
  -- The address the last invite was emailed to, so Resend can send again. Cleared when the
  -- invite is cancelled or the seat is claimed or cancelled.
  invite_email                text,
  -- Set when a student who already had an active entitlement tried to claim: the guardian's
  -- seat card says the seat was not used. Cleared when a new invite is issued.
  claim_refused_at            timestamptz,
  claimed_at                  timestamptz,
  cancelled_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardian_seats_subscription_key UNIQUE (stripe_subscription_id),
  CONSTRAINT guardian_seats_invite_token_key UNIQUE (invite_token_hash),
  CONSTRAINT guardian_seats_unassigned_has_no_student
    CHECK (status <> 'unassigned' OR student_profile_id IS NULL),
  CONSTRAINT guardian_seats_token_has_expiry
    CHECK ((invite_token_hash IS NULL) = (invite_expires_at IS NULL)),
  CONSTRAINT guardian_seats_token_is_sha256_hex
    CHECK (invite_token_hash IS NULL OR invite_token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_guardian_seats_guardian
  ON public.guardian_seats (guardian_profile_id);
CREATE INDEX IF NOT EXISTS idx_guardian_seats_student
  ON public.guardian_seats (student_profile_id) WHERE student_profile_id IS NOT NULL;

ALTER TABLE public.guardian_seats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guardian_seats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guardian_seats TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The one link writer, with who-initiated and how as parameters
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardian_link_create_core(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text,
  p_initiated_by text,
  p_via          text
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row          public.guardian_links;
  v_student_name text;
BEGIN
  IF p_initiated_by NOT IN ('student', 'guardian') THEN
    RAISE EXCEPTION 'unknown link initiator %', p_initiated_by USING ERRCODE = '22023';
  END IF;
  IF p_via NOT IN ('student_link_code', 'guardian_seat_invite') THEN
    RAISE EXCEPTION 'unknown link mechanism %', p_via USING ERRCODE = '22023';
  END IF;

  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- G2-01: both parties' roles, read here rather than trusted from the caller.
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_guardian_id AND role = 'guardian') THEN
    RAISE EXCEPTION 'grantee is not a guardian' USING ERRCODE = 'LY006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'subject is not a student' USING ERRCODE = 'LY006';
  END IF;

  -- Already linked is a 409, not a duplicate row.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  -- accepted_by is the student on both paths: the student shared the code, or the student
  -- claimed the seat. initiated_by names who started it: the student (code) or the guardian
  -- (seat invite).
  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
     accepted_at, accepted_by_profile_id)
  VALUES (p_guardian_id, p_student_id, 'active', p_initiated_by, now(), now(), p_student_id)
  RETURNING * INTO v_row;

  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', p_via),
    v_row.id, p_request_id
  );

  -- Doc 01 §36.1 step 6 — both parties notified, in THIS transaction.
  SELECT display_name INTO v_student_name FROM public.profiles WHERE id = p_student_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_linked', v_row.id::text),
    'guardian_linked',
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id,  'channels', jsonb_build_array('in_app')),
      jsonb_build_object('profile_id', p_guardian_id, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object('link_id', v_row.id, 'student_display_name', coalesce(v_student_name, ''))
  );

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_link_create_core(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Link-code redemption: same signature, same behaviour, now through the core.
CREATE OR REPLACE FUNCTION public.create_active_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- initiated_by='student': the student issued and shared the code, so the student is both
  -- the initiator and the consenting party.
  RETURN public.guardian_link_create_core(
    p_guardian_id, p_student_id, p_request_id, 'student', 'student_link_code');
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The webhook's writes
-- ---------------------------------------------------------------------------
-- Record a seat once per subscription. A replayed or repeated event finds the row and
-- changes nothing.
CREATE OR REPLACE FUNCTION public.guardian_seat_record(
  p_guardian_id     uuid,
  p_subscription_id text,
  p_item_id         text
) RETURNS public.guardian_seats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_seats;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_guardian_id AND role = 'guardian') THEN
    RAISE EXCEPTION 'seat payer is not a guardian' USING ERRCODE = 'LY006';
  END IF;

  INSERT INTO public.guardian_seats (guardian_profile_id, stripe_subscription_id,
                                     stripe_subscription_item_id)
  VALUES (p_guardian_id, p_subscription_id, p_item_id)
  ON CONFLICT ON CONSTRAINT guardian_seats_subscription_key DO NOTHING;

  SELECT * INTO v_row FROM public.guardian_seats
   WHERE stripe_subscription_id = p_subscription_id;
  IF v_row.guardian_profile_id <> p_guardian_id THEN
    RAISE EXCEPTION 'seat belongs to another guardian' USING ERRCODE = 'LY006';
  END IF;
  RETURN v_row;
END;
$fn$;

-- The subscription ended: the seat is cancelled whatever its state, and its invite dies.
CREATE OR REPLACE FUNCTION public.guardian_seat_mark_cancelled(p_subscription_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.guardian_seats
     SET status = 'cancelled',
         cancelled_at = now(),
         invite_token_hash = NULL,
         invite_expires_at = NULL,
         invite_email = NULL,
         updated_at = now()
   WHERE stripe_subscription_id = p_subscription_id
     AND status <> 'cancelled';
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The invite
-- ---------------------------------------------------------------------------
-- Issue a new token for an unassigned seat the guardian owns, replacing any earlier one.
-- p_email NULL keeps the address already on the seat (Copy link); a value replaces it.
-- Returns NULL when the seat is not this guardian's unassigned seat.
CREATE OR REPLACE FUNCTION public.guardian_seat_issue_invite(
  p_guardian_id uuid,
  p_seat_id     uuid,
  p_token_hash  text,
  p_email       text
) RETURNS public.guardian_seats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_seats;
BEGIN
  UPDATE public.guardian_seats
     SET invite_token_hash = p_token_hash,
         invite_expires_at = now() + interval '7 days',
         invite_email = coalesce(lower(btrim(p_email)), invite_email),
         claim_refused_at = NULL,
         updated_at = now()
   WHERE id = p_seat_id
     AND guardian_profile_id = p_guardian_id
     AND status = 'unassigned'
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

-- Cancel the live invite: the token stops working, and the address is forgotten.
CREATE OR REPLACE FUNCTION public.guardian_seat_cancel_invite(
  p_guardian_id uuid,
  p_seat_id     uuid
) RETURNS public.guardian_seats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_seats;
BEGIN
  UPDATE public.guardian_seats
     SET invite_token_hash = NULL,
         invite_expires_at = NULL,
         invite_email = NULL,
         updated_at = now()
   WHERE id = p_seat_id
     AND guardian_profile_id = p_guardian_id
     AND status = 'unassigned'
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

-- Is this token a live invite? One boolean, the same for unknown, expired, used and
-- cancelled tokens, and it says nothing about any account.
CREATE OR REPLACE FUNCTION public.guardian_seat_invite_valid(p_token_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_seats
     WHERE invite_token_hash = p_token_hash
       AND status = 'unassigned'
       AND invite_expires_at > now()
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The claim — one transaction
-- ---------------------------------------------------------------------------
-- Outcomes (jsonb):
--   {"outcome":"claimed", link_id, seat_id, guardian_profile_id, stripe_subscription_id,
--    stripe_subscription_item_id}
--   {"outcome":"invalid"}       unknown, expired, cancelled, or used by another student
--   {"outcome":"already_paid"}  the student has an active entitlement: nothing claimed,
--                               the seat stays unassigned and records the refusal
CREATE OR REPLACE FUNCTION public.guardian_seat_claim(
  p_token_hash text,
  p_student_id uuid,
  p_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_seat    public.guardian_seats;
  v_link_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'claimant is not a student' USING ERRCODE = 'LY006';
  END IF;

  SELECT * INTO v_seat FROM public.guardian_seats
   WHERE invite_token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  -- The same student retrying after a successful claim: report it again, change nothing.
  IF v_seat.status = 'claimed' AND v_seat.student_profile_id = p_student_id THEN
    SELECT id INTO v_link_id FROM public.guardian_links
     WHERE guardian_profile_id = v_seat.guardian_profile_id
       AND student_profile_id  = p_student_id
       AND status = 'active';
    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'link_id', v_link_id,
      'seat_id', v_seat.id,
      'guardian_profile_id', v_seat.guardian_profile_id,
      'stripe_subscription_id', v_seat.stripe_subscription_id,
      'stripe_subscription_item_id', v_seat.stripe_subscription_item_id);
  END IF;

  IF v_seat.status <> 'unassigned' OR v_seat.invite_expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  -- Already paid: do not claim. The seat stays unassigned with its token, and the guardian's
  -- card shows that it was not used.
  IF public.entitlement_active(p_student_id) THEN
    UPDATE public.guardian_seats
       SET claim_refused_at = now(), updated_at = now()
     WHERE id = v_seat.id;
    RETURN jsonb_build_object('outcome', 'already_paid');
  END IF;

  -- The link, through the one link writer, unless this pair is already linked (a guardian
  -- who also redeemed a code): the seat still attaches to that student.
  SELECT id INTO v_link_id FROM public.guardian_links
   WHERE guardian_profile_id = v_seat.guardian_profile_id
     AND student_profile_id  = p_student_id
     AND status = 'active';
  IF v_link_id IS NULL THEN
    SELECT (public.guardian_link_create_core(
              v_seat.guardian_profile_id, p_student_id, p_request_id,
              'guardian', 'guardian_seat_invite')).id
      INTO v_link_id;
  END IF;

  UPDATE public.guardian_seats
     SET status = 'claimed',
         student_profile_id = p_student_id,
         claimed_at = now(),
         -- The token hash stays, so the same student's retry finds the seat (above); for
         -- anyone else a claimed seat is 'invalid'.
         invite_email = NULL,
         claim_refused_at = NULL,
         updated_at = now()
   WHERE id = v_seat.id;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'link_id', v_link_id,
    'seat_id', v_seat.id,
    'guardian_profile_id', v_seat.guardian_profile_id,
    'stripe_subscription_id', v_seat.stripe_subscription_id,
    'stripe_subscription_item_id', v_seat.stripe_subscription_item_id);
END;
$fn$;

DO $grants$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.guardian_seat_record(uuid, text, text)',
    'public.guardian_seat_mark_cancelled(text)',
    'public.guardian_seat_issue_invite(uuid, uuid, text, text)',
    'public.guardian_seat_cancel_invite(uuid, uuid)',
    'public.guardian_seat_invite_valid(text)',
    'public.guardian_seat_claim(text, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END
$grants$;

-- ---------------------------------------------------------------------------
-- 6. Where a Parent/Guardian Terms acceptance was collected: also at seat checkout
-- ---------------------------------------------------------------------------
-- The seat checkout records the guardian's acceptance before any student is linked, so it
-- needs its own source rather than borrowing guardian_link_redeem's. The list is otherwise
-- unchanged from 20260916000000_consent_sources_and_reference.sql.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_consent_source_check;
ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_consent_source_check
  CHECK (consent_source IN (
    'email_signup_form',
    'google_continue_pre_oauth',
    'google_continue_click',
    'guardian_link_redeem',
    'guardian_seat_checkout',
    'stripe_checkout',
    'reconsent_prompt'
  ));

-- ---------------------------------------------------------------------------
-- 7. Invite email rate limits, keyed on the guardian
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'guardian_seat_invite_daily', jsonb_build_object('limit', 10, 'window_seconds', 86400),
      'guardian_seat_invite_email', jsonb_build_object('limit', 3,  'window_seconds', 86400)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
     WHERE key = 'bucket_definitions'
       AND value ? 'guardian_seat_invite_daily'
       AND value ? 'guardian_seat_invite_email'
  ) THEN
    RAISE EXCEPTION 'guardian seats migration: bucket_definitions row missing; seat invite buckets were not seeded';
  END IF;
END
$rl$;

COMMIT;
