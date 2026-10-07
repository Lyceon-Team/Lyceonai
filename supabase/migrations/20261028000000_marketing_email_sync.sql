-- ===========================================================================
-- Marketing email lane: Lyceon → Resend contact sync and Resend → Lyceon opt-out back-sync.
--
-- @spec [docs/plans/seo/seo-marketing-vertical.md row D3 ("Marketing email lane: Resend
--       broadcasts by audience bucket, one-click unsubscribe, consent artifact live"), R26;
--       contracts/notifications.contract.md §0 (marketing lane, amended 2026-10-07) and §7;
--       Doc 10 §9.21 (logged, revocable consent); Privacy Policy v6 §9.2 ("You can opt out ...
--       by using the unsubscribe link in any marketing email. Users under 13 never receive
--       marketing emails."); owner brief "SEO vertical — email lane" + Step 0 decisions
--       2026-10-07 (Karl): daily reconcile only, delete the contact on opt-out, marketing stops
--       at the deletion REQUEST, a complaint turns the opt-in off, contract amended, no SCL]
--       | @implemented [2026-10-07]
--
-- plain English:
--  1. TWO NEW CONSENT SOURCES. `email_unsubscribe` (the unsubscribe link in a marketing email,
--     reported by Resend) and `email_complaint` (the recipient marked a Lyceon email as spam).
--     Both can only WITHDRAW: set_marketing_consent refuses a grant from either, so a provider
--     event can never turn marketing on.
--  2. WHO IS MARKETED TO is one function, `marketing_email_audience()`: opted in, a known date of
--     birth 13+ years ago, not deleted, no pending deletion request, role student or guardian.
--     The daily reconcile makes Resend's two marketing segments equal to exactly this set, so
--     there is no second definition to drift. (There is no school-provisioned account type in
--     the schema today, so there is nothing to exclude for it; when one exists, it is excluded
--     here.)
--  3. `marketing_email_contacts` maps a profile to the Resend contact Lyceon created for it.
--     It holds the provider's contact id and the segment, never the address. A row exists only
--     while a contact exists; opting out deletes the contact and the row (owner decision 2).
--  4. `apply_marketing_email_optout` is the back-sync: it records the provider event id and
--     applies the opt-out in ONE transaction (the contract's C7.5 shape), through
--     set_marketing_consent, so the consent log gets its row from the same trigger as every
--     other change. A replayed event id is a no-op ('duplicate'); a profile already opted out
--     writes no second log row ('unchanged').
--
-- set_marketing_consent is REPLACED here. The mutations in scripts/ci/marketing-consent-
-- reviews.mutations.sh that targeted it (R4, R6) are re-pointed at this file in the same change.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two new consent-log sources
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketing_consent_log
  DROP CONSTRAINT IF EXISTS marketing_consent_log_source_check;
ALTER TABLE public.marketing_consent_log
  ADD CONSTRAINT marketing_consent_log_source_check
  CHECK (source IN (
    'signup', 'settings', 'backfill', 'age_clear', 'system',
    'email_unsubscribe', 'email_complaint'
  ));

-- ---------------------------------------------------------------------------
-- 2. The one server writer, now also taking the two withdrawal-only sources.
--    Everything else is unchanged from 20261027000000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_marketing_consent(
  p_profile_id      uuid,
  p_granted         boolean,
  p_source          text,
  p_consent_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_dob date;
  v_was boolean;
BEGIN
  IF p_source NOT IN ('signup', 'settings', 'email_unsubscribe', 'email_complaint') THEN
    RAISE EXCEPTION 'set_marketing_consent: unknown source %', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- A provider event can only withdraw. Nothing Resend sends may turn marketing on.
  IF p_granted AND p_source IN ('email_unsubscribe', 'email_complaint') THEN
    RAISE EXCEPTION 'set_marketing_consent: source % can only withdraw', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT date_of_birth, marketing_opt_in INTO v_dob, v_was
    FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_missing');
  END IF;

  IF p_granted AND NOT public.marketing_opt_in_age_eligible(v_dob) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'age_ineligible');
  END IF;

  IF v_was = p_granted THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'granted', p_granted);
  END IF;

  PERFORM set_config('lyceon.marketing_consent_source', p_source, true);
  PERFORM set_config('lyceon.marketing_consent_version', COALESCE(p_consent_version, ''), true);
  UPDATE public.profiles
     SET marketing_opt_in = p_granted, updated_at = now()
   WHERE id = p_profile_id;
  PERFORM set_config('lyceon.marketing_consent_source', '', true);
  PERFORM set_config('lyceon.marketing_consent_version', '', true);

  RETURN jsonb_build_object('ok', true, 'changed', true, 'granted', p_granted);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Who is marketed to. The ONLY definition; the reconcile reads it and nothing else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_email_audience()
RETURNS TABLE (profile_id uuid, email text, segment text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p.id,
         lower(btrim(p.email)),
         CASE p.role WHEN 'student' THEN 'students' ELSE 'guardians' END
    FROM public.profiles p
   WHERE p.marketing_opt_in
     AND public.marketing_opt_in_age_eligible(p.date_of_birth)
     AND p.deleted_at IS NULL
     AND p.role IN ('student', 'guardian')
     AND p.email IS NOT NULL
     AND btrim(p.email) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.account_deletion_requests r
        WHERE r.profile_id = p.id AND r.status = 'pending'
     )
   ORDER BY p.id;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. profile → Resend contact. No address is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_email_contacts (
  profile_id        uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  resend_contact_id text        NOT NULL UNIQUE
                                CHECK (char_length(resend_contact_id) BETWEEN 1 AND 128),
  segment           text        NOT NULL CHECK (segment IN ('students', 'guardians')),
  synced_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketing_email_contacts IS
  'Marketing email lane: the Resend contact Lyceon created for an eligible, opted-in profile. Provider id and segment only, never the address. Written only by the daily reconcile. ON DELETE CASCADE from profiles.';

ALTER TABLE public.marketing_email_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_email_contacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketing_email_contacts TO service_role;

CREATE OR REPLACE FUNCTION public.marketing_email_contacts_list()
RETURNS TABLE (profile_id uuid, resend_contact_id text, segment text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT c.profile_id, c.resend_contact_id, c.segment
    FROM public.marketing_email_contacts c
   ORDER BY c.profile_id;
$fn$;

CREATE OR REPLACE FUNCTION public.marketing_email_contact_record(
  p_profile_id        uuid,
  p_resend_contact_id text,
  p_segment           text
)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.marketing_email_contacts (profile_id, resend_contact_id, segment, synced_at)
  VALUES (p_profile_id, p_resend_contact_id, p_segment, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET resend_contact_id = EXCLUDED.resend_contact_id,
        segment           = EXCLUDED.segment,
        synced_at         = now();
$fn$;

CREATE OR REPLACE FUNCTION public.marketing_email_contact_forget(p_resend_contact_id text)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  DELETE FROM public.marketing_email_contacts WHERE resend_contact_id = p_resend_contact_id;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The back-sync: provider event id + opt-out, one transaction.
-- ---------------------------------------------------------------------------
-- Every verified Resend event that withdrew (or tried to withdraw) marketing consent, exactly
-- once. No profile id and no address: the outcome is all an operator needs, and the consent
-- log already says whose choice changed and why.
CREATE TABLE IF NOT EXISTS public.marketing_email_webhook_events (
  provider_event_id text        PRIMARY KEY CHECK (char_length(provider_event_id) BETWEEN 1 AND 256),
  event_type        text        NOT NULL
                                CHECK (event_type IN ('contact.updated', 'email.complained', 'reconcile.unsubscribed')),
  outcome           text        NOT NULL CHECK (outcome IN ('applied', 'unchanged', 'unmatched')),
  received_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketing_email_webhook_events IS
  'Marketing email lane: dedupe ledger for Resend unsubscribe / complaint events (svix-id) and reconcile-detected unsubscribes. Purged after 30 days by the daily reconcile.';

ALTER TABLE public.marketing_email_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_email_webhook_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketing_email_webhook_events TO service_role;

-- Returns 'applied' | 'unchanged' | 'unmatched' | 'duplicate'.
-- The profile is found by the contact id Lyceon recorded, else by the address on the event
-- (compared, never stored). The address parameter exists for that comparison only.
CREATE OR REPLACE FUNCTION public.apply_marketing_email_optout(
  p_provider_event_id text,
  p_event_type        text,
  p_resend_contact_id text,
  p_email             text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_source  text;
  v_profile uuid;
  v_result  jsonb;
  v_outcome text;
BEGIN
  IF p_event_type = 'email.complained' THEN
    v_source := 'email_complaint';
  ELSIF p_event_type IN ('contact.updated', 'reconcile.unsubscribed') THEN
    v_source := 'email_unsubscribe';
  ELSE
    RAISE EXCEPTION 'apply_marketing_email_optout: unknown event type %', p_event_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.marketing_email_webhook_events (provider_event_id, event_type, outcome)
  VALUES (p_provider_event_id, p_event_type, 'unmatched')
  ON CONFLICT (provider_event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  IF p_resend_contact_id IS NOT NULL THEN
    SELECT c.profile_id INTO v_profile
      FROM public.marketing_email_contacts c
     WHERE c.resend_contact_id = p_resend_contact_id;
  END IF;
  IF v_profile IS NULL AND p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT p.id INTO v_profile
      FROM public.profiles p
     WHERE lower(p.email) = lower(btrim(p_email))
       AND p.deleted_at IS NULL;
  END IF;
  IF v_profile IS NULL THEN
    RETURN 'unmatched';
  END IF;

  v_result := public.set_marketing_consent(v_profile, false, v_source, NULL);
  v_outcome := CASE WHEN (v_result ->> 'changed')::boolean THEN 'applied' ELSE 'unchanged' END;
  UPDATE public.marketing_email_webhook_events
     SET outcome = v_outcome
   WHERE provider_event_id = p_provider_event_id;
  RETURN v_outcome;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.marketing_email_webhook_events_purge()
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  WITH gone AS (
    DELETE FROM public.marketing_email_webhook_events
     WHERE received_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Privileges: service role only. Every function is SECURITY INVOKER.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.set_marketing_consent(uuid, boolean, text, text),
  public.marketing_email_audience(),
  public.marketing_email_contacts_list(),
  public.marketing_email_contact_record(uuid, text, text),
  public.marketing_email_contact_forget(text),
  public.apply_marketing_email_optout(text, text, text, text),
  public.marketing_email_webhook_events_purge()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.set_marketing_consent(uuid, boolean, text, text),
  public.marketing_email_audience(),
  public.marketing_email_contacts_list(),
  public.marketing_email_contact_record(uuid, text, text),
  public.marketing_email_contact_forget(text),
  public.apply_marketing_email_optout(text, text, text, text),
  public.marketing_email_webhook_events_purge()
  TO service_role;

COMMIT;
