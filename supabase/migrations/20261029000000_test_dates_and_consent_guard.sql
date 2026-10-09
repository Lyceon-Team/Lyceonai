-- ===========================================================================
-- Home QOTD brief, Part A (prerequisites): F-83 consent guard, multiple SAT test dates.
--
-- @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
--       (Karl, decisions 2026-10-08/09) Part A items 1 and 2; F-83 (docs/plans/student-ui/
--       student-ui-vertical.md, production error 2026-10-07 03:47, a grant with no version);
--       SCL-223 (test dates, against Doc 05F §7.1/§8.1 and OQ-20); Doc 10 §9.21]
--       | @implemented [2026-10-09]
--
-- plain English:
--  1. F-83. A marketing grant can now only be written by `set_marketing_consent` from a
--     user-action source (`signup`, `settings`) with a consent version. Two layers:
--       - the setter refuses a grant with no version before it writes anything;
--       - the profiles guard trigger refuses ANY change that turns the flag on unless the
--         transaction declared a user-action source and a version (what the setter does).
--     Before this, a direct UPDATE (an old build, a dashboard edit, a script) reached the log
--     trigger as source 'system' with no version and was refused only by the log's CHECK, as a
--     raw error. Withdrawals stay unrestricted: turning marketing OFF is always allowed.
--  2. SAT TEST DATES (SCL-223). `student_study_profile.target_exam_dates date[]` holds every
--     date the student picked. `target_exam_date` stays and becomes the EFFECTIVE date: the
--     closest date on or after today in America/Chicago, kept by a BEFORE trigger on every
--     write and rolled forward by `study_profile_roll_exam_dates()` (called hourly by the QOTD
--     email job) when a date passes. Every existing reader of `target_exam_date` — plan
--     generation, countdowns, the guardian view — therefore reads the effective date with no
--     change. EXPAND ONLY: the old column is kept; a build that still writes only
--     `target_exam_date` is folded into the array by the trigger, so the two never disagree
--     during the deploy window.
--  3. The post-exam score prompt (`exam_score_renewal_candidates`) needs the date that PASSED,
--     which the effective date no longer is once it rolls. It now reads
--     `study_profile_occasion_exam_date`, which chooses among the dates so that a single
--     stored date behaves exactly as the single column did.
--  4. Saving dates alone does not set up the calendar: `study_days_mask` and `daily_minutes`
--     are NULL until setup completes (CHECK study_profile_setup_answers_present).
--
-- Replaced bodies (mutations re-pointed in the same change): set_marketing_consent (was
-- 20261028000000), profiles_marketing_consent_guard (was 20261027000000),
-- exam_score_renewal_candidates (was 20261015000000).
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. F-83: the guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_marketing_consent_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_was     boolean := CASE WHEN TG_OP = 'UPDATE' THEN OLD.marketing_opt_in ELSE false END;
  v_source  text    := NULLIF(current_setting('lyceon.marketing_consent_source', true), '');
  v_version text    := NULLIF(current_setting('lyceon.marketing_consent_version', true), '');
BEGIN
  IF NEW.marketing_opt_in AND NOT public.marketing_opt_in_age_eligible(NEW.date_of_birth) THEN
    IF v_was THEN
      -- Already opted in, and the date of birth just became ineligible (deidentify_user nulls
      -- it during account deletion). Clear, never refuse.
      NEW.marketing_opt_in := false;
    ELSE
      RAISE EXCEPTION 'marketing_opt_in requires a known date of birth at least 13 years ago (plan R26)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- F-83: turning marketing ON is the person's own act, declared by set_marketing_consent.
  IF NEW.marketing_opt_in AND NOT v_was
     AND (v_source IS NULL OR v_source NOT IN ('signup', 'settings') OR v_version IS NULL) THEN
    RAISE EXCEPTION 'marketing_opt_in may only be granted by set_marketing_consent from a user action with a consent version (F-83)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. F-83: the setter refuses a versionless grant up front
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
  -- F-83: a grant names the wording it was given against, always. Refused here, before any
  -- write, rather than left to the log's CHECK after the flag has already changed.
  IF p_granted AND NULLIF(btrim(COALESCE(p_consent_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'set_marketing_consent: a grant requires a consent version (F-83)'
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

REVOKE ALL ON FUNCTION public.set_marketing_consent(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_marketing_consent(uuid, boolean, text, text) TO service_role;


-- ---------------------------------------------------------------------------
-- 3. SAT test dates (SCL-223)
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_study_profile
  ADD COLUMN IF NOT EXISTS target_exam_dates date[] NOT NULL DEFAULT '{}'::date[];

ALTER TABLE public.student_study_profile
  DROP CONSTRAINT IF EXISTS study_profile_exam_dates_bounded;
ALTER TABLE public.student_study_profile
  ADD CONSTRAINT study_profile_exam_dates_bounded
  CHECK (cardinality(target_exam_dates) <= 16 AND array_position(target_exam_dates, NULL) IS NULL);

COMMENT ON COLUMN public.student_study_profile.target_exam_dates IS
  'SCL-223: every SAT date the student picked, ascending, distinct. target_exam_date is derived from it (the closest date on or after today, America/Chicago).';
COMMENT ON COLUMN public.student_study_profile.target_exam_date IS
  'SCL-223: the EFFECTIVE test date, derived from target_exam_dates by trigger study_profile_exam_dates_sync and rolled forward hourly. NULL when no date is on or after today. Not written directly.';

/** Today in America/Chicago: the brief's one day boundary for test dates. */
CREATE OR REPLACE FUNCTION public.study_profile_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT (now() AT TIME ZONE 'America/Chicago')::date;
$fn$;

/** The closest date on or after p_today, or NULL. */
CREATE OR REPLACE FUNCTION public.study_profile_effective_exam_date(p_dates date[], p_today date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT min(d) FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d WHERE d >= p_today;
$fn$;

/**
 * The date the post-exam prompt is about. Chosen so ONE stored date behaves exactly as the old
 * single column did: the most recent past date if it is within p_max_age_days, else the
 * effective (next) date, else the most recent past date.
 */
CREATE OR REPLACE FUNCTION public.study_profile_occasion_exam_date(
  p_dates date[], p_today date, p_max_age_days integer
)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT max(d) FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d
      WHERE d < p_today AND d >= p_today - p_max_age_days),
    public.study_profile_effective_exam_date(p_dates, p_today),
    (SELECT max(d) FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d WHERE d < p_today)
  );
$fn$;

/** Sorted, distinct, no NULLs. */
CREATE OR REPLACE FUNCTION public.study_profile_normalise_exam_dates(p_dates date[])
RETURNS date[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), '{}'::date[])
    FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d
   WHERE d IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.study_profile_exam_dates_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today date := public.study_profile_today();
BEGIN
  -- A write of the single column means "my NEXT SAT is this date" (the calendar's own date
  -- field, the post-exam renewal, and any build from before this change). It becomes the
  -- effective date: future dates before it are dropped, later ones are kept (a student who
  -- picked several keeps the rest), past dates stay for the post-exam prompt. NULL means "no
  -- date": every future date is cleared.
  IF TG_OP = 'UPDATE'
     AND NEW.target_exam_date IS DISTINCT FROM OLD.target_exam_date
     AND NEW.target_exam_dates IS NOT DISTINCT FROM OLD.target_exam_dates THEN
    NEW.target_exam_dates := ARRAY(
      SELECT d FROM unnest(OLD.target_exam_dates) AS d
       WHERE d < v_today
          OR (NEW.target_exam_date IS NOT NULL AND d > NEW.target_exam_date)
    ) || CASE WHEN NEW.target_exam_date IS NULL THEN '{}'::date[]
              ELSE ARRAY[NEW.target_exam_date] END;
  ELSIF TG_OP = 'INSERT'
     AND cardinality(COALESCE(NEW.target_exam_dates, '{}'::date[])) = 0
     AND NEW.target_exam_date IS NOT NULL THEN
    NEW.target_exam_dates := ARRAY[NEW.target_exam_date];
  END IF;
  NEW.target_exam_dates := public.study_profile_normalise_exam_dates(NEW.target_exam_dates);
  NEW.target_exam_date := public.study_profile_effective_exam_date(NEW.target_exam_dates, v_today);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS study_profile_exam_dates_sync ON public.student_study_profile;
CREATE TRIGGER study_profile_exam_dates_sync
  BEFORE INSERT OR UPDATE ON public.student_study_profile
  FOR EACH ROW EXECUTE FUNCTION public.study_profile_exam_dates_sync();

-- Backfill: every stored date becomes the student's one picked date. The trigger keeps the
-- effective column as it was (a stored date is on or after today, or already passed).
UPDATE public.student_study_profile
   SET target_exam_dates = ARRAY[target_exam_date]
 WHERE target_exam_date IS NOT NULL
   AND cardinality(target_exam_dates) = 0;

/**
 * Rolls the effective date forward for every student whose date has passed. Idempotent; the
 * hourly QOTD email job calls it, so a passed date is replaced within an hour of Chicago
 * midnight. Returns the number of rows moved.
 */
CREATE OR REPLACE FUNCTION public.study_profile_roll_exam_dates()
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  WITH moved AS (
    UPDATE public.student_study_profile
       SET target_exam_dates = target_exam_dates
     WHERE target_exam_date IS NOT NULL
       AND target_exam_date < public.study_profile_today()
    RETURNING 1
  )
  SELECT count(*)::integer FROM moved;
$fn$;

-- SAVING DATES ALONE DOES NOT SET UP THE CALENDAR (brief A2). Onboarding and Settings may
-- create the row with only the SAT dates; the schedule (study days, minutes) is asked by the
-- calendar's setup and nothing invents it (R-08-03). So the two schedule columns are NULL until
-- setup completes, and a completed setup must carry both. Expand-safe: relaxing NOT NULL breaks
-- no writer, every existing row has both (they were NOT NULL), and `setup_completed_at` was
-- stamped by every first write until now, so VALIDATE passes on existing data. Every planner
-- (calendar_weekly_candidates, generate-on-first-open, profile_change regeneration) already
-- reads only rows with setup_completed_at set.
ALTER TABLE public.student_study_profile
  ALTER COLUMN study_days_mask DROP NOT NULL,
  ALTER COLUMN daily_minutes DROP NOT NULL;
ALTER TABLE public.student_study_profile
  DROP CONSTRAINT IF EXISTS study_profile_setup_answers_present;
ALTER TABLE public.student_study_profile
  ADD CONSTRAINT study_profile_setup_answers_present
  CHECK (setup_completed_at IS NULL OR (study_days_mask IS NOT NULL AND daily_minutes IS NOT NULL))
  NOT VALID;
ALTER TABLE public.student_study_profile
  VALIDATE CONSTRAINT study_profile_setup_answers_present;

-- ---------------------------------------------------------------------------
-- 4. The post-exam prompt reads the occasion date, not the effective one
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_score_renewal_candidates(
  p_offset_days        integer,
  p_max_exam_age_days  integer,
  p_lead_days          integer,
  p_limit              integer     DEFAULT 500,
  p_now                timestamptz DEFAULT now()
) RETURNS TABLE (
  student_id        uuid,
  payer_profile_id  uuid,
  timezone          text,
  anchor            text,
  occasion_key      date,
  outcome           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH resolved AS (
    SELECT e.profile_id                          AS student_id,
           e.payer_profile_id,
           e.cancel_at_period_end,
           e.current_period_end,
           COALESCE(sp.timezone, 'UTC')          AS timezone,
           -- SCL-223: the occasion among the student's dates, chosen so that one stored date
           -- behaves exactly as the single column did (see study_profile_occasion_exam_date).
           public.study_profile_occasion_exam_date(
             COALESCE(sp.target_exam_dates, '{}'::date[]),
             (p_now AT TIME ZONE COALESCE(sp.timezone, 'UTC'))::date,
             p_max_exam_age_days
           )                                     AS target_exam_date,
           (p_now AT TIME ZONE COALESCE(sp.timezone, 'UTC'))::date AS today_local
      FROM public.entitlements e
      LEFT JOIN public.student_study_profile sp ON sp.student_id = e.profile_id
  ),
  due AS (
    SELECT r.student_id, r.payer_profile_id, r.timezone, r.cancel_at_period_end,
           'exam_date'::text  AS anchor,
           r.target_exam_date AS occasion_key
      FROM resolved r
     WHERE r.target_exam_date IS NOT NULL
       AND r.target_exam_date <= r.today_local - p_offset_days
       AND r.target_exam_date >= r.today_local - p_max_exam_age_days
    UNION ALL
    SELECT r.student_id, r.payer_profile_id, r.timezone, r.cancel_at_period_end,
           'billing_cycle'::text,
           (r.current_period_end AT TIME ZONE r.timezone)::date
      FROM resolved r
     WHERE r.current_period_end IS NOT NULL
       AND (r.target_exam_date IS NULL
            OR r.target_exam_date < r.today_local - p_max_exam_age_days)
       AND (r.current_period_end AT TIME ZONE r.timezone)::date >  r.today_local
       AND (r.current_period_end AT TIME ZONE r.timezone)::date - p_lead_days <= r.today_local
  )
  SELECT d.student_id, d.payer_profile_id, d.timezone, d.anchor, d.occasion_key,
         CASE
           WHEN NOT public.entitlement_active(d.student_id) THEN 'skipped_no_entitlement'
           -- Edge case 8: the subscription is already ending. Asking somebody to decide
           -- something they have already decided is worse than saying nothing.
           WHEN d.cancel_at_period_end IS TRUE             THEN 'skipped_cancel_pending'
           -- Edge case 6, at the prompt as well as at the sweep: a student who answered is not
           -- asked again.
           WHEN EXISTS (SELECT 1 FROM public.exam_renewal_decisions x
                         WHERE x.student_id   = d.student_id
                           AND x.occasion_key = d.occasion_key) THEN 'skipped_answered'
           ELSE NULL
         END AS outcome
    FROM due d
   ORDER BY d.student_id, d.anchor, d.occasion_key
   LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.exam_score_renewal_candidates(integer, integer, integer, integer, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.study_profile_today(),
  public.study_profile_effective_exam_date(date[], date),
  public.study_profile_occasion_exam_date(date[], date, integer),
  public.study_profile_normalise_exam_dates(date[]),
  public.study_profile_roll_exam_dates()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.study_profile_today(),
  public.study_profile_effective_exam_date(date[], date),
  public.study_profile_occasion_exam_date(date[], date, integer),
  public.study_profile_normalise_exam_dates(date[]),
  public.study_profile_roll_exam_dates()
  TO service_role;
REVOKE ALL ON FUNCTION public.study_profile_exam_dates_sync() FROM PUBLIC, anon, authenticated;

COMMIT;
