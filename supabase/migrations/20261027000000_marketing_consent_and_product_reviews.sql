-- ===========================================================================
-- Marketing opt-in (plan Q5) and in-app reviews + private feedback (plan Q6).
--
-- @spec [docs/plans/seo/seo-marketing-vertical.md R26 (marketing opt-in: own checkbox, Settings
--       toggle, reset bug fixed; guardians + students 13+; never under-13), R28 (one neutral
--       prompt; in-app anonymous review 13+, bucketed student/guardian; Trustpilot guardians +
--       18+; private feedback always available), R30 (cadence: success moments only, max once
--       per 120 days, stop after a review or 2 dismissals, always dismissible), rows Q5 / Q6;
--       Doc 10 §9.21 ("Marketing consent must be separate from broader ToS acceptance + must be
--       revocable ... a UX with logged consent"); owner Step 0 answers 2026-10-05 (Karl)]
--       | @implemented [2026-10-05]
--
-- plain English:
--  1. MARKETING OPT-IN, UNDER-13 NEVER. A trigger on profiles refuses any change that turns
--     `marketing_opt_in` on unless the date of birth is known and is 13 or more years ago. Age
--     comes from `date_of_birth`, not `is_under_13`, which is computed only when the row is
--     written and so goes stale. If a row that is already opted in has its date of birth
--     changed to an ineligible one — in practice only `deidentify_user`, which nulls it during
--     account deletion — the flag is CLEARED rather than the update refused: raising there
--     would break account deletion, and clearing fails toward not marketing.
--  2. PROOF OF CONSENT. `marketing_consent_log` gets one row for every change of the flag,
--     written by an AFTER trigger, so no writer can change the flag without leaving a row.
--     `set_marketing_consent` is the one writer the server uses; it names the source
--     (`signup` / `settings`) and the wording version through transaction-local settings the
--     trigger reads. A grant written by any other path has no version and is refused by the
--     table's CHECK, so every grant is attributable.
--  3. EXISTING DATA. Opt-ins whose date of birth is missing or under 13 are cleared (logged
--     `age_clear`). The opt-ins that remain get one `backfill` row stamped with the profile's
--     completion time and NO wording version: the checkbox predates the log, and its wording
--     changed in July, so neither the exact moment nor the exact text is knowable.
--  4. REVIEWS / FEEDBACK / PROMPT STATE. Three tables, written only by the server through the
--     functions below. One review per profile (dedupe), anonymous by construction (`profile_id`
--     exists for dedupe and deletion only). Feedback is idempotent per (profile, key). Prompt
--     state holds the cadence facts; the cadence DECISION is a pure function in
--     packages/shared (review-prompt.ts), and `product_review_prompt_claim` only makes the
--     "shown" stamp compare-and-set, so two tabs cannot both show the prompt.
--  5. DELETION. Every new table keys on profiles(id) ON DELETE CASCADE (owner-approved for
--     reviews 2026-10-05), so account deletion removes the rows; scripts/ci/
--     fk-delete-action-guard.sql classifies them from the catalog with no list to edit.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Before/after checks: docs/compliance/q5-q6-migration-checks.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The consent log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_consent_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted         boolean     NOT NULL,
  source          text        NOT NULL
                  CHECK (source IN ('signup', 'settings', 'backfill', 'age_clear', 'system')),
  consent_version text        NULL CHECK (consent_version IS NULL OR consent_version ~ '^\d+\.\d+\.\d+$'),
  captured_at     timestamptz NOT NULL DEFAULT now(),
  -- A grant must name the wording it was given against — except a backfill, whose wording is
  -- not knowable (see the header, item 3).
  CONSTRAINT marketing_consent_log_grant_versioned
    CHECK (granted = false OR source = 'backfill' OR consent_version IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS marketing_consent_log_profile
  ON public.marketing_consent_log (profile_id, captured_at);

COMMENT ON TABLE public.marketing_consent_log IS
  'Doc 10 §9.21 / plan R26: one row per change of profiles.marketing_opt_in (when, where, which wording). Written only by the profiles_marketing_consent_log trigger. ON DELETE CASCADE from profiles.';

ALTER TABLE public.marketing_consent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_consent_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.marketing_consent_log TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Eligibility: a known date of birth, 13 or more years ago. One definition, used by the
--    guard, the setter and the data clean-up below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_opt_in_age_eligible(p_date_of_birth date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_date_of_birth IS NOT NULL
     AND p_date_of_birth <= (current_date - interval '13 years')::date;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The guard (BEFORE) and the log writer (AFTER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_marketing_consent_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_was boolean := CASE WHEN TG_OP = 'UPDATE' THEN OLD.marketing_opt_in ELSE false END;
BEGIN
  IF NEW.marketing_opt_in AND NOT public.marketing_opt_in_age_eligible(NEW.date_of_birth) THEN
    IF v_was THEN
      -- Already opted in, and the date of birth just became ineligible (deidentify_user nulls
      -- it during account deletion). Clear, never refuse: see the header, item 1.
      NEW.marketing_opt_in := false;
    ELSE
      RAISE EXCEPTION 'marketing_opt_in requires a known date of birth at least 13 years ago (plan R26)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.profiles_marketing_consent_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_was     boolean := CASE WHEN TG_OP = 'UPDATE' THEN OLD.marketing_opt_in ELSE false END;
  v_source  text    := NULLIF(current_setting('lyceon.marketing_consent_source', true), '');
  v_version text    := NULLIF(current_setting('lyceon.marketing_consent_version', true), '');
BEGIN
  IF NEW.marketing_opt_in IS DISTINCT FROM v_was THEN
    INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version)
    VALUES (
      NEW.id,
      NEW.marketing_opt_in,
      COALESCE(v_source, 'system'),
      CASE WHEN NEW.marketing_opt_in THEN v_version ELSE NULL END
    );
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.profiles_marketing_consent_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_marketing_consent_log()   FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_marketing_consent_guard ON public.profiles;
CREATE TRIGGER profiles_marketing_consent_guard
  BEFORE INSERT OR UPDATE OF marketing_opt_in, date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_marketing_consent_guard();

DROP TRIGGER IF EXISTS profiles_marketing_consent_log ON public.profiles;
CREATE TRIGGER profiles_marketing_consent_log
  AFTER INSERT OR UPDATE OF marketing_opt_in, date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_marketing_consent_log();

-- ---------------------------------------------------------------------------
-- 4. The one server writer
-- ---------------------------------------------------------------------------
-- Returns { ok: true, changed } or { ok: false, reason: 'age_ineligible' | 'profile_missing' }.
-- Writing the value the profile already holds changes nothing and logs nothing.
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
  IF p_source NOT IN ('signup', 'settings') THEN
    RAISE EXCEPTION 'set_marketing_consent: unknown source %', p_source
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
-- 5. Existing data (the triggers above are live, so the clear is logged as it happens)
-- ---------------------------------------------------------------------------
SELECT set_config('lyceon.marketing_consent_source', 'age_clear', true);
UPDATE public.profiles
   SET marketing_opt_in = false
 WHERE marketing_opt_in
   AND NOT public.marketing_opt_in_age_eligible(date_of_birth);
SELECT set_config('lyceon.marketing_consent_source', '', true);

INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version, captured_at)
SELECT p.id, true, 'backfill', NULL, COALESCE(p.profile_completed_at, p.updated_at, now())
  FROM public.profiles p
 WHERE p.marketing_opt_in
   AND NOT EXISTS (SELECT 1 FROM public.marketing_consent_log l WHERE l.profile_id = p.id);

-- ---------------------------------------------------------------------------
-- 6. Reviews, feedback, prompt state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id       uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  audience         text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  rating           smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body             text        NULL CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  quote_permission boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.product_reviews IS
  'Plan R28/R29: in-app review, one per profile. Anonymous by construction: profile_id is for dedupe and deletion only and is never served. quote_permission is the unticked-by-default "Lyceon may quote this anonymously". Written only by product_review_submit. ON DELETE CASCADE from profiles (owner ruling 2026-10-05).';

CREATE TABLE IF NOT EXISTS public.product_feedback (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  audience        text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  source          text        NOT NULL CHECK (source IN ('prompt', 'settings', 'help', 'menu')),
  idempotency_key uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, idempotency_key)
);
COMMENT ON TABLE public.product_feedback IS
  'Plan R28: private feedback, stored only (owner answer 8, 2026-10-05). Never displayed, never forwarded. Written only by product_feedback_submit. ON DELETE CASCADE from profiles.';

CREATE TABLE IF NOT EXISTS public.product_review_prompt_state (
  profile_id        uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_shown_at     timestamptz NULL,
  last_dismissed_at timestamptz NULL,
  dismiss_count     smallint    NOT NULL DEFAULT 0 CHECK (dismiss_count >= 0),
  reviewed_at       timestamptz NULL,
  reviewed_via      text        NULL CHECK (reviewed_via IN ('in_app', 'trustpilot')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviewed_at IS NULL) = (reviewed_via IS NULL))
);
COMMENT ON TABLE public.product_review_prompt_state IS
  'Plan R30: the review prompt''s cadence facts per profile. The decision is packages/shared/src/review-prompt.ts; these functions only record. ON DELETE CASCADE from profiles.';

ALTER TABLE public.product_reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_feedback            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_review_prompt_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_reviews, public.product_feedback, public.product_review_prompt_state
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_reviews, public.product_feedback, public.product_review_prompt_state
  TO service_role;

-- The stored cadence facts, or NULL when the prompt was never shown to this profile.
CREATE OR REPLACE FUNCTION public.product_review_prompt_state_for(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
           'last_shown_at', s.last_shown_at,
           'dismiss_count', s.dismiss_count,
           'reviewed_at',   s.reviewed_at)
    FROM public.product_review_prompt_state s
   WHERE s.profile_id = p_profile_id;
$fn$;

-- Compare-and-set "shown". The server decided, from the state it read, that the prompt is due;
-- this records it only if nobody else did in between (p_expected = the last_shown_at it read).
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
  INSERT INTO public.product_review_prompt_state (profile_id, last_shown_at)
  VALUES (p_profile_id, now())
  ON CONFLICT (profile_id) DO UPDATE
     SET last_shown_at = now(), updated_at = now()
   WHERE product_review_prompt_state.last_shown_at IS NOT DISTINCT FROM p_expected
     AND product_review_prompt_state.reviewed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- One dismissal per showing: a double click, a retry or a second tab counts once.
CREATE OR REPLACE FUNCTION public.product_review_prompt_dismiss(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.product_review_prompt_state
     SET dismiss_count = dismiss_count + 1, last_dismissed_at = now(), updated_at = now()
   WHERE profile_id = p_profile_id
     AND last_shown_at IS NOT NULL
     AND reviewed_at IS NULL
     AND (last_dismissed_at IS NULL OR last_dismissed_at < last_shown_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- Returns { outcome: 'created' | 'replayed' | 'conflict' }. A retry of the same review is a
-- replay; a different second review is a conflict (one per profile).
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

  INSERT INTO public.product_review_prompt_state (profile_id, reviewed_at, reviewed_via)
  VALUES (p_profile_id, now(), 'in_app')
  ON CONFLICT (profile_id) DO UPDATE
     SET reviewed_at  = COALESCE(product_review_prompt_state.reviewed_at, now()),
         reviewed_via = COALESCE(product_review_prompt_state.reviewed_via, 'in_app'),
         updated_at   = now();
  RETURN jsonb_build_object('outcome', 'created');
END;
$fn$;

-- The Trustpilot button was used: counts as reviewed (owner answer 6). We cannot know whether a
-- review was actually left there, so this only stops the prompt.
CREATE OR REPLACE FUNCTION public.product_review_mark_external(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.product_review_prompt_state (profile_id, reviewed_at, reviewed_via)
  VALUES (p_profile_id, now(), 'trustpilot')
  ON CONFLICT (profile_id) DO UPDATE
     SET reviewed_at  = COALESCE(product_review_prompt_state.reviewed_at, now()),
         reviewed_via = COALESCE(product_review_prompt_state.reviewed_via, 'trustpilot'),
         updated_at   = now();
$fn$;

-- Returns { outcome: 'created' | 'replayed' }.
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
  RETURN jsonb_build_object('outcome', CASE WHEN v_rows = 1 THEN 'created' ELSE 'replayed' END);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: service role only. Every function is SECURITY INVOKER.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.marketing_opt_in_age_eligible(date),
  public.set_marketing_consent(uuid, boolean, text, text),
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz),
  public.product_review_prompt_dismiss(uuid),
  public.product_review_submit(uuid, text, smallint, text, boolean),
  public.product_review_mark_external(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.marketing_opt_in_age_eligible(date),
  public.set_marketing_consent(uuid, boolean, text, text),
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz),
  public.product_review_prompt_dismiss(uuid),
  public.product_review_submit(uuid, text, smallint, text, boolean),
  public.product_review_mark_external(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid)
  TO service_role;

-- The functions are SECURITY INVOKER, so service_role writes through its own table rights.
GRANT INSERT ON TABLE public.marketing_consent_log TO service_role;
GRANT INSERT ON TABLE public.product_reviews, public.product_feedback TO service_role;
GRANT INSERT, UPDATE ON TABLE public.product_review_prompt_state TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The feedback rate-limit bucket (per profile, Doc 01A ledger)
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'product_feedback', jsonb_build_object('limit', 10, 'window_seconds', 86400)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $pf$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
    WHERE key = 'bucket_definitions' AND value ? 'product_feedback'
  ) THEN
    RAISE EXCEPTION 'product feedback migration: the bucket_definitions row is missing, so product_feedback was not seeded and every feedback write would be refused';
  END IF;
END
$pf$;

COMMIT;
