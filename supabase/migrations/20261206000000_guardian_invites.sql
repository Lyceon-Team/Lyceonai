-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian invites: a guardian invites their teen, and the teen claims the invite at
-- /join/<token>. Claiming creates the guardian link.
--
-- @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 4, 5, 6; SCL-281 (guardian-initiated
--        linking by invite, amending SCL-080); Doc 01 V8 §36.1 (the guardian-initiated path,
--        both parties notified); SCL-187 (under-13 only with an active link)]
--        | @implemented [2026-11-22]
--
-- plain English:
--   * public.guardian_invites: one row per invite a guardian has started. Only the SHA-256
--     (hex) of the token is stored, never the token. An optional SHA-256 of the address the
--     invite was emailed to is kept for nothing but the per-address rate limit; the address
--     itself is never stored. status is 'open' until the teen claims it ('claimed') or the
--     guardian cancels it ('cancelled'). An open invite expires 14 days after its CURRENT token
--     was issued: a token is the link, and every new link (resend, copy) lasts 14 days.
--   * create_active_guardian_link_audited gains two DEFAULTED parameters, p_initiated_by and
--     p_via. The defaults ('student', 'student_link_code') are today's behaviour exactly, so
--     link-code redemption is unchanged; an invite claim passes ('guardian', 'guardian_invite').
--     Still one link writer (ruling 1: extend it, no sibling function).
--   * issue_guardian_invite_audited: start an invite (at most 3 open, unexpired invites per
--     guardian), or replace the token of one of the guardian's own open invites (resend, copy
--     link). The old token stops working the moment the new one is written.
--   * cancel_guardian_invite_audited: the guardian cancels an open invite; its token stops
--     working, and the next send starts a new invite with a new token.
--   * guardian_invite_lookup: what /join may say about a token: open (with the guardian's
--     first name and the expiry), claimed, cancelled, expired, or not_found. Nothing about any
--     account.
--   * claim_guardian_invite_audited: ONE transaction. Locks the invite, refuses a token that is
--     not open and unexpired, creates the link through the one link writer (or reuses an
--     active link the pair already has), and marks the invite claimed. The same student
--     retrying a successful claim gets the same answer and nothing changes.
--   * Every invite write locks its row and writes an audit_logs row through
--     guardian_invite_audit (actions guardian_invite_issued / _reissued / _cancelled /
--     _claimed). These are kept out of guardian_link_audit on purpose: the audit purge's
--     exemption (20261027000000) names exactly the three actions guardian_link_audit writes
--     as consent evidence, and an invite's own bookkeeping is not that evidence. The link the
--     claim creates IS, and it is written by guardian_link_audit as before ('via'
--     'guardian_invite').
--   * legal_acceptances gains consent_source 'guardian_invite_issue': the guardian accepts the
--     Parent / Guardian Terms when they start an invite, before any link exists.
--   * Rate-limit buckets: guardian_invite_daily (10 a day per guardian), guardian_invite_email
--     (3 a day per guardian + address, rolled back with the daily bucket), and
--     guardian_invite_lookup_ip (anonymous, HMAC of the caller's IP, 60 an hour).
--
-- Security: every function is SECURITY DEFINER with EXECUTE granted to service_role only. The
--   table has RLS on, no policies, and grants to service_role only.
--
-- guardian_view_decision is untouched, and nothing here reads entitlement_active: guardian
--   visibility is still derived in exactly one function (scripts/ci/guardian-view-decision-gate.sql
--   GATE 10).
--
-- Mutations: create_active_guardian_link_audited's body moves here from
--   20261014000000_guardian_link_party_roles.sql. No scripts/ci/*.mutations.sh entry targets
--   it (grep, 2026-11-22). The new plants live in scripts/ci/guardian-invites.mutations.sh and
--   target this file, after checking it is the last definition of each function.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
--
-- rollback (in this order, and only once no guardian_links row carries initiated_by 'guardian'
-- from an invite and no legal_acceptances row carries 'guardian_invite_issue'):
--   DROP FUNCTION IF EXISTS public.claim_guardian_invite_audited(text, uuid, text);
--   DROP FUNCTION IF EXISTS public.guardian_invite_lookup(text);
--   DROP FUNCTION IF EXISTS public.cancel_guardian_invite_audited(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.issue_guardian_invite_audited(uuid, text, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.guardian_invite_audit(text, uuid, uuid, uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.create_active_guardian_link_audited(uuid, uuid, text, text, text);
--   re-run the CREATE OR REPLACE FUNCTION block and grants of
--     20261014000000_guardian_link_party_roles.sql;
--   DROP TABLE IF EXISTS public.guardian_invites;
--   UPDATE public.rate_limit_runtime_config SET value = value - 'guardian_invite_daily'
--     - 'guardian_invite_email' - 'guardian_invite_lookup_ip' WHERE key = 'bucket_definitions';
--   re-add legal_acceptances_consent_source_check with the list in 20260916000000.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The invite
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guardian_invites (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: an invite is the guardian's own bookkeeping and means nothing once the guardian's
  -- account is hard-deleted. The link it produced is its own row, with its own audit trail.
  guardian_profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'claimed', 'cancelled')),
  -- The current token's SHA-256, lowercase hex. The token itself is never stored.
  token_hash             text NOT NULL,
  token_issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  -- SHA-256 (hex) of the normalised address the invite was last emailed to, for the
  -- per-address rate limit only. NULL for a copied link. The address is never stored.
  email_hash             text,
  -- SET NULL: a claimed invite survives the student's deletion as a record of the claim.
  claimed_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at             timestamptz,
  link_id                uuid REFERENCES public.guardian_links(id) ON DELETE SET NULL,
  cancelled_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardian_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT guardian_invites_token_is_sha256_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT guardian_invites_email_is_sha256_hex
    CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  -- claimed_at, not claimed_by: the claimant id goes NULL if that student is later deleted,
  -- and the row must survive that.
  CONSTRAINT guardian_invites_claimed_has_time
    CHECK ((status = 'claimed') = (claimed_at IS NOT NULL)),
  CONSTRAINT guardian_invites_only_claimed_has_claimant
    CHECK (status = 'claimed' OR claimed_by_profile_id IS NULL),
  CONSTRAINT guardian_invites_cancelled_has_time
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_guardian_invites_guardian
  ON public.guardian_invites (guardian_profile_id, status);

ALTER TABLE public.guardian_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guardian_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guardian_invites TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The one link writer, extended with who initiated the link and how
-- ---------------------------------------------------------------------------
-- The signature changes (two new defaulted parameters), so the old one is dropped first;
-- CREATE OR REPLACE with a new argument list would leave both overloads behind.
DROP FUNCTION IF EXISTS public.create_active_guardian_link_audited(uuid, uuid, text);

CREATE FUNCTION public.create_active_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text DEFAULT NULL,
  p_initiated_by text DEFAULT 'student',
  p_via          text DEFAULT 'student_link_code'
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row          public.guardian_links;
  v_student_name text;
BEGIN
  -- The two mechanisms that exist, and the initiator each one implies. Anything else is a
  -- programming error, refused before anything is read or written.
  IF NOT ((p_initiated_by = 'student'  AND p_via = 'student_link_code')
       OR (p_initiated_by = 'guardian' AND p_via = 'guardian_invite')) THEN
    RAISE EXCEPTION 'unknown link mechanism % / %', p_initiated_by, p_via
      USING ERRCODE = '22023';
  END IF;

  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- G2-01: both parties' roles, read here rather than trusted from the caller. The grantee
  -- must be a guardian and the subject a student; anything else (an admin, a second student,
  -- a guardian as subject, an id with no profile) is refused BEFORE anything is written.
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_guardian_id AND role = 'guardian') THEN
    RAISE EXCEPTION 'grantee is not a guardian' USING ERRCODE = 'LY006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'subject is not a student' USING ERRCODE = 'LY006';
  END IF;

  -- Edge case 2: already linked is a 409, not a duplicate row. Only 'active' is
  -- checked because SCL-080 leaves no reachable pending status.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  -- accepted_by is the student on both paths: the student shared their code, or the student
  -- claimed the guardian's invite. Either way the student's own act is the consent.
  -- initiated_by names who started it: the student (code) or the guardian (invite).
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

  -- Doc 01 §36.1 step 6 — both parties notified, in THIS transaction (contract §2.2).
  -- Student: in_app. Guardian: in_app + email. Payload: link_id and the student's display
  -- name only (contract §8.1; Doc 01 §38.1/§38.2 — nothing beyond identity to a guardian).
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

REVOKE ALL ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The invite's audit row
-- ---------------------------------------------------------------------------
-- p_changes never carries an address, a token or a hash: ids, flags and timestamps only.
CREATE OR REPLACE FUNCTION public.guardian_invite_audit(
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
  IF p_action NOT IN ('guardian_invite_issued', 'guardian_invite_reissued',
                      'guardian_invite_cancelled', 'guardian_invite_claimed') THEN
    RAISE EXCEPTION 'unknown guardian invite audit action %', p_action USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor, p_target, p_action, p_changes,
    jsonb_build_object('request_id', p_request_id, 'invite_id', p_invite_id)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Issue, re-issue and cancel
-- ---------------------------------------------------------------------------
-- p_invite_id NULL starts a new invite. Otherwise the token of the guardian's own OPEN invite
-- is replaced (resend, copy link): the old token stops working here, and the expiry restarts.
-- p_email_hash NULL keeps the hash already on the row (Copy link sends nothing).
-- Raises LY010 when starting (or reviving an expired) invite would leave the guardian more
-- than 3 open, unexpired invites. Returns NULL when p_invite_id is not this guardian's open
-- invite.
CREATE OR REPLACE FUNCTION public.issue_guardian_invite_audited(
  p_guardian_id uuid,
  p_token_hash  text,
  p_email_hash  text,
  p_invite_id   uuid,
  p_request_id  text DEFAULT NULL
) RETURNS public.guardian_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row       public.guardian_invites;
  v_open      integer;
  v_was_live  boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_guardian_id AND role = 'guardian') THEN
    RAISE EXCEPTION 'inviter is not a guardian' USING ERRCODE = 'LY006';
  END IF;

  -- Serialise this guardian's invite writes, so two concurrent sends cannot both pass the
  -- open-invite count below.
  PERFORM 1 FROM public.profiles WHERE id = p_guardian_id FOR UPDATE;

  SELECT count(*) INTO v_open
    FROM public.guardian_invites
   WHERE guardian_profile_id = p_guardian_id
     AND status = 'open'
     AND expires_at > now();

  IF p_invite_id IS NULL THEN
    IF v_open >= 3 THEN
      RAISE EXCEPTION 'open invite limit reached' USING ERRCODE = 'LY010';
    END IF;
    INSERT INTO public.guardian_invites
      (guardian_profile_id, token_hash, token_issued_at, expires_at, email_hash)
    VALUES (p_guardian_id, p_token_hash, now(), now() + interval '14 days', p_email_hash)
    RETURNING * INTO v_row;
    PERFORM public.guardian_invite_audit(
      'guardian_invite_issued', p_guardian_id, NULL, v_row.id,
      jsonb_build_object('emailed', p_email_hash IS NOT NULL, 'expires_at', v_row.expires_at),
      p_request_id);
    RETURN v_row;
  END IF;

  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
     AND guardian_profile_id = p_guardian_id
     AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Reviving an expired invite counts as opening one.
  v_was_live := v_row.expires_at > now();
  IF NOT v_was_live AND v_open >= 3 THEN
    RAISE EXCEPTION 'open invite limit reached' USING ERRCODE = 'LY010';
  END IF;

  UPDATE public.guardian_invites
     SET token_hash = p_token_hash,
         token_issued_at = now(),
         expires_at = now() + interval '14 days',
         email_hash = coalesce(p_email_hash, email_hash),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM public.guardian_invite_audit(
    'guardian_invite_reissued', p_guardian_id, NULL, v_row.id,
    jsonb_build_object('emailed', p_email_hash IS NOT NULL, 'expires_at', v_row.expires_at),
    p_request_id);
  RETURN v_row;
END;
$fn$;

-- Cancel an open invite: its token stops working. NULL when it is not this guardian's open
-- invite.
CREATE OR REPLACE FUNCTION public.cancel_guardian_invite_audited(
  p_guardian_id uuid,
  p_invite_id   uuid,
  p_request_id  text DEFAULT NULL
) RETURNS public.guardian_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
BEGIN
  SELECT * INTO v_row FROM public.guardian_invites
   WHERE id = p_invite_id
     AND guardian_profile_id = p_guardian_id
     AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.guardian_invites
     SET status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM public.guardian_invite_audit(
    'guardian_invite_cancelled', p_guardian_id, NULL, v_row.id,
    '{}'::jsonb, p_request_id);
  RETURN v_row;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. What /join may say about a token
-- ---------------------------------------------------------------------------
-- {state: open, guardian_profile_id, guardian_first_name, expires_at}
-- {state: claimed | cancelled | expired}
-- {state: not_found}
-- guardian_profile_id is for the server (the claim re-checks the guardian's age); the route
-- never returns it. The first name is the guardian's display name up to the first space, by
-- the same helper the guardian emails use.
CREATE OR REPLACE FUNCTION public.guardian_invite_lookup(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_invites;
BEGIN
  SELECT * INTO v_row FROM public.guardian_invites WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  IF v_row.status = 'claimed' THEN
    RETURN jsonb_build_object('state', 'claimed');
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN jsonb_build_object('state', 'cancelled');
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('state', 'expired');
  END IF;
  RETURN jsonb_build_object(
    'state', 'open',
    'guardian_profile_id', v_row.guardian_profile_id,
    'guardian_first_name', public.accountability_student_first_name(v_row.guardian_profile_id),
    'expires_at', v_row.expires_at);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The claim — one transaction
-- ---------------------------------------------------------------------------
-- Outcomes (jsonb):
--   {outcome: claimed, invite_id, link_id, guardian_profile_id, created_link}
--                                   created_link false: the pair was already linked, or this is
--                                   the same student's retry of a claim that already succeeded
--   {outcome: claimed_by_other}     another student claimed it
--   {outcome: cancelled | expired | not_found}
CREATE OR REPLACE FUNCTION public.claim_guardian_invite_audited(
  p_token_hash text,
  p_student_id uuid,
  p_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row     public.guardian_invites;
  v_link_id uuid;
  v_created boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'claimant is not a student' USING ERRCODE = 'LY006';
  END IF;

  SELECT * INTO v_row FROM public.guardian_invites
   WHERE token_hash = p_token_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.status = 'claimed' THEN
    IF v_row.claimed_by_profile_id = p_student_id THEN
      -- The same student retrying: the same answer, and nothing changes.
      RETURN jsonb_build_object(
        'outcome', 'claimed',
        'invite_id', v_row.id,
        'link_id', v_row.link_id,
        'guardian_profile_id', v_row.guardian_profile_id,
        'created_link', false);
    END IF;
    RETURN jsonb_build_object('outcome', 'claimed_by_other');
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN jsonb_build_object('outcome', 'cancelled');
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  -- The link, through the one link writer, unless this pair is already linked (the guardian
  -- also redeemed a code): the invite is still claimed, against that link.
  SELECT id INTO v_link_id FROM public.guardian_links
   WHERE guardian_profile_id = v_row.guardian_profile_id
     AND student_profile_id  = p_student_id
     AND status = 'active';
  IF v_link_id IS NULL THEN
    SELECT (public.create_active_guardian_link_audited(
              v_row.guardian_profile_id, p_student_id, p_request_id,
              'guardian', 'guardian_invite')).id
      INTO v_link_id;
    v_created := true;
  END IF;

  UPDATE public.guardian_invites
     SET status = 'claimed',
         claimed_by_profile_id = p_student_id,
         claimed_at = now(),
         link_id = v_link_id,
         updated_at = now()
   WHERE id = v_row.id;

  PERFORM public.guardian_invite_audit(
    'guardian_invite_claimed', p_student_id, v_row.guardian_profile_id, v_row.id,
    jsonb_build_object('link_id', v_link_id, 'created_link', v_created),
    p_request_id);

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'invite_id', v_row.id,
    'link_id', v_link_id,
    'guardian_profile_id', v_row.guardian_profile_id,
    'created_link', v_created);
END;
$fn$;

DO $grants$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.guardian_invite_audit(text, uuid, uuid, uuid, jsonb, text)',
    'public.issue_guardian_invite_audited(uuid, text, text, uuid, text)',
    'public.cancel_guardian_invite_audited(uuid, uuid, text)',
    'public.guardian_invite_lookup(text)',
    'public.claim_guardian_invite_audited(text, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END
$grants$;

-- ---------------------------------------------------------------------------
-- 7. Where a Parent / Guardian Terms acceptance was collected: also when an invite starts
-- ---------------------------------------------------------------------------
-- The list is otherwise unchanged from 20260916000000_consent_sources_and_reference.sql.
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
    'stripe_checkout',
    'reconsent_prompt'
  ));

-- ---------------------------------------------------------------------------
-- 8. Rate limits
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'guardian_invite_daily',     jsonb_build_object('limit', 10, 'window_seconds', 86400),
      'guardian_invite_email',     jsonb_build_object('limit', 3,  'window_seconds', 86400),
      'guardian_invite_lookup_ip', jsonb_build_object('limit', 60, 'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
     WHERE key = 'bucket_definitions'
       AND value ? 'guardian_invite_daily'
       AND value ? 'guardian_invite_email'
       AND value ? 'guardian_invite_lookup_ip'
  ) THEN
    RAISE EXCEPTION 'guardian invites migration: bucket_definitions row missing; invite buckets were not seeded';
  END IF;
END
$rl$;

COMMIT;
