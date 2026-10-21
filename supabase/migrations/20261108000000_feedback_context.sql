-- ===========================================================================
-- Private feedback: a type, the page it was sent from, the app version and "May we reply by
-- email?".
--
-- @spec [owner brief "Trustpilot card on the homepage + 'Feedback' across the site" (final brief,
--       Karl 2026-10-20) §3 (the dialog: type Bug · Idea · Something else; the 2,000-character
--       message; "May we reply by email?" default off, hidden for under-13s and refused by the
--       server for them; the route pattern only — no real IDs, no query string — and the app
--       version from the deploy commit; no screenshots, no student work) and §4 (reuse the
--       existing store: server-only writes, the 2,000-character cap, 10 a day, deleted with the
--       account; add type, route_pattern, app_version, reply_ok; grants checked as service_role);
--       docs/plans/seo/seo-marketing-vertical.md R28 (private feedback, always available)]
--       | @implemented [2026-10-20]
--
-- plain English:
--  1. `product_feedback` gains four columns. Existing rows become type 'other', reply_ok false,
--     and no page or version (they were never recorded).
--  2. `route_pattern` is held to the SHAPE of a route pattern by a CHECK: lowercase path words and
--     `:name` placeholders only, so a real id (it has digits), a query string or a fragment can
--     never be stored, whatever a client sends. `app_version` is a 7-character commit or 'dev'.
--  3. `product_feedback_submit` takes the four new values. Its review-ask behaviour (feedback sent
--     from the ask ends the asks, 20261107000000) is carried over unchanged. It refuses
--     reply_ok = true for a student who is not known to be 13 or over (the marketing opt-in's age
--     rule, `marketing_opt_in_age_eligible`), so the server's refusal is held here as well. It
--     reads the profile through `product_feedback_reply_allowed`, SECURITY INVOKER: service_role
--     already reads profiles, so DEFINER would add privilege and nothing else; the grants test
--     calls it as a service_role probe role (the #1248 lesson).
--  4. Nothing else changes: RLS on, no policies, service_role only, the CHECK on the 2,000
--     characters, the per-profile `product_feedback` rate-limit bucket (10 a day), and
--     ON DELETE CASCADE from profiles (scripts/ci/fk-delete-action-guard.sql classifies it).
--
-- Mutations: the signature of product_feedback_submit changes (5 → 9 arguments), so the old one
-- is DROPPED and this file is its last definer. The RA15 plant in
-- scripts/ci/marketing-consent-reviews.mutations.sh is re-pointed here in the same change.
--
-- OWNER-RUN. Karl applies to prod, after 20261107000000_review_ask.sql. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text);
--   DROP FUNCTION IF EXISTS public.product_feedback_reply_allowed(uuid);
--   -- re-run product_feedback_submit and its grants from 20261107000000_review_ask.sql
--   ALTER TABLE public.product_feedback DROP COLUMN IF EXISTS type, DROP COLUMN IF EXISTS reply_ok,
--     DROP COLUMN IF EXISTS route_pattern, DROP COLUMN IF EXISTS app_version;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_feedback
  ADD COLUMN IF NOT EXISTS type          text    NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS reply_ok      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS route_pattern text    NULL,
  ADD COLUMN IF NOT EXISTS app_version   text    NULL;

ALTER TABLE public.product_feedback DROP CONSTRAINT IF EXISTS product_feedback_type_check;
ALTER TABLE public.product_feedback
  ADD CONSTRAINT product_feedback_type_check CHECK (type IN ('bug', 'idea', 'other'));
ALTER TABLE public.product_feedback DROP CONSTRAINT IF EXISTS product_feedback_route_pattern_check;
ALTER TABLE public.product_feedback
  ADD CONSTRAINT product_feedback_route_pattern_check CHECK (
    route_pattern IS NULL
    OR (char_length(route_pattern) <= 120
        AND route_pattern ~ '^(/|(/([a-z][a-z-]*|:[a-zA-Z]+))+)$'));
ALTER TABLE public.product_feedback DROP CONSTRAINT IF EXISTS product_feedback_app_version_check;
ALTER TABLE public.product_feedback
  ADD CONSTRAINT product_feedback_app_version_check CHECK (
    app_version IS NULL OR app_version ~ '^([0-9a-f]{7}|dev)$');

COMMENT ON TABLE public.product_feedback IS
  'Plan R28: private feedback (owner answer 8, 2026-10-05; amended 2026-10-20). Stored, and since 2026-10-20 each new row is also posted to Slack #social by the server: type, page, role, age band and reply-OK always; the text only for senders 18+, at most 300 characters (SCL-237). Never displayed in the product. type / route_pattern (a route pattern, never a real id or query) / app_version / reply_ok added 2026-10-20. Written only by product_feedback_submit. ON DELETE CASCADE from profiles.';

-- ---------------------------------------------------------------------------
-- 2. Who may ask for a reply: anyone but a student not known to be 13 or over
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_feedback_reply_allowed(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT p.role <> 'student' OR public.marketing_opt_in_age_eligible(p.date_of_birth)
      FROM public.profiles p
     WHERE p.id = p_profile_id), false);
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The one writer
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.product_feedback_submit(uuid, text, text, text, uuid);

-- Returns { outcome: 'created' | 'replayed' }. Feedback sent from the review ask (source 'prompt')
-- answers the ask (20261107000000, unchanged). reply_ok for a student under 13 (or of unknown age)
-- is refused (22023).
CREATE OR REPLACE FUNCTION public.product_feedback_submit(
  p_profile_id      uuid,
  p_audience        text,
  p_body            text,
  p_source          text,
  p_idempotency_key uuid,
  p_type            text    DEFAULT 'other',
  p_reply_ok        boolean DEFAULT false,
  p_route_pattern   text    DEFAULT NULL,
  p_app_version     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF p_reply_ok AND NOT public.product_feedback_reply_allowed(p_profile_id) THEN
    RAISE EXCEPTION 'product_feedback_submit: reply_ok is not allowed for this account'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_feedback
    (profile_id, audience, body, source, idempotency_key, type, reply_ok, route_pattern, app_version)
  VALUES
    (p_profile_id, p_audience, p_body, p_source, p_idempotency_key, p_type, p_reply_ok,
     p_route_pattern, p_app_version)
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

-- ---------------------------------------------------------------------------
-- 4. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.product_feedback_reply_allowed(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.product_feedback_reply_allowed(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text)
  TO service_role;

COMMIT;
