-- ============================================================================
-- Doc 05F — Study Calendar: route constants, day regeneration, launch lock
-- ============================================================================
-- @spec [Doc-05F_V1.0 §8.1 (setup bounds), §12.1/§12.5 (triggers, weekly job),
--        §15 (API surface), §10.3 (validator modes)]
--       [Doc_05F_formula_sheet.md §4 — the generator constants. The five keys
--        seeded here are NOT generator constants: they belong to the routes and
--        the weekly job, which is why 20260917130000_calendar_v1.sql
--        deliberately left them out and reported them as still to land]
-- @implemented [2026-09-17]
--
-- plain English. Two things the server layer cannot work without.
--
-- 1. Five configuration rows. Doc 05F §8.1 bounds the study profile and §12.5
--    paces the weekly job, and neither had a row to read. The route would
--    otherwise have to inline a literal, which §17 forbids.
--
-- 2. calendar_regenerate_day. Doc 05F §12.1 lists day_regenerate and day_reset
--    as triggers and §15 gives each a route, but the applied migration named no
--    writer for either — the two strings appear only in the trigger CHECK. This
--    is that writer, and it is one function for both routes because the only
--    difference between them is the trigger recorded on the version.
--
-- WHY A NEW VALIDATOR MODE. Both routes exist to hand a date the student has
-- overridden back to the generator. V-14 refuses exactly that for mode
-- generated, so validating these versions as generated would reject them
-- precisely when they are correct. V-14 guards against a NON-STUDENT version
-- stomping a student edit (Doc 05F §10.3), and these versions are
-- student-initiated by §12.1, so the rule is not aimed at them. Mode
-- day_regenerate is therefore mode generated minus V-14, and nothing else: the
-- five generated-only rules V-02, V-05 and V-09 all still apply, because the
-- day being written is an auto-generated day and must satisfy them.
--
-- 3. calendar_link_launch takes a lock. It allocated launch_sequence as
--    COALESCE(max, 0) + 1 with nothing held, so two concurrent launches of one
--    block computed the same sequence and one lost to a raw 23505 on the
--    primary key. See section 5.
--
-- Migration authored only. The owner applies it and updates genesis.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Route and scheduling constants (Doc 05F §8.1, §12.5)
--
-- Column shape and bounds follow calendar_runtime_config as
-- 20260917130000_calendar_v1.sql created it. min_value/max_value are the doc’s
-- own bounds, so an operator editing a value out of range is refused by the
-- same discipline every other calendar key gets.
--
-- daily_minutes_min/_max sit INSIDE the student_study_profile column CHECK of
-- 5..600: config narrows the column, it never widens it.
--
-- One deviation from Doc 05F §21, recorded in the PR: it bounds
-- weekly_job_interval_minutes at 15..360 and launches it at 60, which assumed a
-- sub-daily sweep. The job is a daily Vercel cron, so the launch value is 1440
-- and the ceiling is raised to match. A bound the launch value already violates
-- is a bound nobody is enforcing.
-- ----------------------------------------------------------------------------
INSERT INTO public.calendar_runtime_config
  (key, value, value_type, min_value, max_value, owner, description) VALUES

  ('daily_minutes_min', '15', 'integer', '5', '60', 'product',
   'Doc 05F §8.1: least daily study time the settings sheet may offer, in minutes. Narrows the student_study_profile.daily_minutes CHECK of 5..600 — it never widens it.'),

  ('daily_minutes_max', '180', 'integer', '60', '600', 'product',
   'Doc 05F §8.1: most daily study time the settings sheet may offer, in minutes. Narrows the student_study_profile.daily_minutes CHECK of 5..600 — it never widens it.'),

  ('daily_minutes_presets', '[15,30,45,60,90,120]', 'array', NULL, NULL, 'product',
   'Doc 05F §8.1: the chips the settings sheet offers for time per day. Every member must lie within daily_minutes_min..daily_minutes_max — the route parses against both.'),

  ('target_exam_date_max_days', '540', 'integer', '30', '730', 'product',
   'Doc 05F §8.1: how far ahead of the student’s local today a target exam date may be set, in days. The floor is local today — a past exam date is not a plan.'),

  ('weekly_job_interval_minutes', '1440', 'integer', '15', '1440', 'product',
   'Doc 05F §12.5: how often the weekly job WAKES, in minutes. It is not how often it generates — generation is once per student local ISO week, Monday-anchored (R-08-30), and a wake that finds a fresh version writes skipped_fresh. Launch value is 1440, one daily Vercel cron. DEVIATION from Doc 05F §21, which bounds this 15..360 and launches at 60: that ceiling assumed a sub-daily sweep, and a daily wake does not fit under it. The ceiling is raised to 1440 so the launch value is inside its own bounds rather than the bounds being decorative.');


-- ----------------------------------------------------------------------------
-- 2. calendar_validate_plan — add mode day_regenerate (Doc 05F §10.3)
--
-- Replaced, not rewritten. This body is the applied 20260917130000 body with
-- exactly seven lines changed, and nothing else touched:
--   * CREATE          -> CREATE OR REPLACE
--   * the mode whitelist gains day_regenerate
--   * the five `p_mode = generated` gates become
--     `p_mode IN (generated, day_regenerate)`
-- V-14’s own gate, `IN (generated, do_it_now)`, is deliberately NOT one of
-- them. Leaving day_regenerate out of that list is the entire behavioural
-- change: everything else the generated mode checks, day_regenerate checks too.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  c_block_keys  CONSTANT text[] := ARRAY[
    'review_due','exam_review','exam_review_placeholder','final_rehearsal',
    'exam_cadence','taper','cold_start','weighted','fallback'];
  c_domain_keys CONSTANT text[] := ARRAY['weak','exploring','balanced','strength','post_exam'];

  k_granularity   integer;
  k_min_domain_q  integer;
  k_max_domains   integer;
  k_review_max    integer;
  k_fl_max        integer;
  e_practice_secs integer;
  e_review_secs   integer;

  p_today      date;
  p_mask       integer;
  p_minutes    integer;
  p_wd         integer;
  v_enabled    text[];
  v_gen_dates  date[];

  v_viol       jsonb := '[]'::jsonb;
  v_date       date;
  v_rec        record;
  v_m          jsonb;
  v_b          jsonb;
  v_sec_seen   text[];
  v_secs       integer;
  v_created_fl integer := 0;
  v_fl_total   integer := 0;
  v_review_planned integer := 0;
  v_due_through integer;
  v_has_created_fl boolean;
  v_count      integer;
  v_sum        integer;
  v_txt        text;
BEGIN
  IF p_mode NOT IN ('generated','day_regenerate','student_edit','do_it_now','rollback') THEN
    RAISE EXCEPTION 'calendar_validate_plan: unknown mode ''%''', p_mode USING ERRCODE = '22023';
  END IF;

  k_granularity   := public.calendar_require_int(p_input -> 'constants', 'granularity');
  k_min_domain_q  := public.calendar_require_int(p_input -> 'constants', 'min_domain_questions');
  k_max_domains   := public.calendar_require_int(p_input -> 'constants', 'max_domains_per_block');
  k_review_max    := public.calendar_require_int(p_input -> 'constants', 'review_block_max');
  k_fl_max        := public.calendar_require_int(p_input -> 'constants', 'max_full_length_per_horizon');
  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');

  p_today   := (p_input ->> 'today')::date;
  p_mask    := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_wd      := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                    ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(COALESCE(p_input -> 'enabled_block_types', '[]'::jsonb)) t;

  -- generated_for.dates is the horizon the builder froze. When it is absent the
  -- generator’s own days are the horizon, which is the case for a plain
  -- generate-and-validate round trip.
  SELECT COALESCE(array_agg(t::date), '{}') INTO v_gen_dates
  FROM jsonb_array_elements_text(COALESCE(p_input #> '{generated_for,dates}', '[]'::jsonb)) t;

  FOR v_rec IN
    SELECT (d ->> 'scheduled_date')::date AS sd,
           COALESCE((d ->> 'is_user_override')::boolean, false) AS ovr,
           d -> 'members' AS members,
           ord
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) WITH ORDINALITY AS t(d, ord)
  LOOP
    v_date := v_rec.sd;

    ------------------------------------------------------------------ V-01
    IF COALESCE(array_length(v_gen_dates, 1), 0) > 0 AND NOT (v_date = ANY (v_gen_dates)) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-01','date',v_date::text,
                  'detail','date is outside generated_for.dates');
    END IF;
    IF v_date < p_today THEN
      v_viol := v_viol || jsonb_build_object('rule','V-01','date',v_date::text,
                  'detail','date is before the student-local today');
    END IF;

    ------------------------------------------------------------------ V-14
    IF p_mode IN ('generated','do_it_now')
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                     COALESCE(p_input -> 'current_overrides', '[]'::jsonb)) o
                   WHERE (o ->> 'scheduled_date')::date = v_date
                     AND (o ->> 'is_user_override')::boolean) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-14','date',v_date::text,
                  'detail', p_mode || ' may not take over a date the student has overridden');
    END IF;

    v_sec_seen := '{}';
    v_secs := 0;
    v_has_created_fl := false;
    v_count := 0;

    FOR v_m IN SELECT m FROM jsonb_array_elements(COALESCE(v_rec.members, '[]'::jsonb)) m LOOP
      v_count := v_count + 1;

      ---------------------------------------------------------------- V-13
      IF v_m ->> 'kind' = 'carried' THEN
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                         COALESCE(p_input -> 'existing_blocks_by_date', '[]'::jsonb)) x
                       WHERE x ->> 'block_id' = v_m ->> 'block_id'
                         AND (x ->> 'scheduled_date')::date = v_date) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-13','date',v_date::text,
                      'detail','carried block ' || COALESCE(v_m ->> 'block_id','<null>')
                            || ' is not an existing block of this student on this date');
        END IF;
        CONTINUE;
      END IF;

      v_b := v_m -> 'block';
      IF v_b IS NULL THEN
        v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                    'detail','created member carries no block');
        CONTINUE;
      END IF;

      ---------------------------------------------------------------- V-03
      IF NOT (v_b ->> 'block_type' = ANY (v_enabled)) THEN
        v_viol := v_viol || jsonb_build_object('rule','V-03','date',v_date::text,
                    'detail','block_type ' || COALESCE(v_b ->> 'block_type','<null>')
                          || ' is not in enabled_block_types');
      END IF;

      ---------------------------------------------------------------- V-06 (and the shape)
      IF NOT public.calendar_scope_is_valid(v_b ->> 'block_type', v_b ->> 'section', v_b -> 'scope') THEN
        v_viol := v_viol || jsonb_build_object('rule','V-06','date',v_date::text,
                    'detail','scope is not valid for this block_type and section');
      END IF;

      IF v_b ->> 'block_type' = 'full_length' THEN
        v_has_created_fl := true;
        v_created_fl := v_created_fl + 1;
        v_fl_total := v_fl_total + 1;
        -------------------------------------------------------------- V-02
        IF p_mode IN ('generated','day_regenerate')
           AND (p_wd IS NULL OR EXTRACT(DOW FROM v_date)::integer <> p_wd) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a full_length was created off the student''s full-length weekday');
        END IF;
        -------------------------------------------------------------- V-04
        IF public.calendar_require_int(v_b, 'target_count') <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','full_length target_count must be 1');
        END IF;

      ELSIF v_b ->> 'block_type' = 'review' THEN
        -------------------------------------------------------------- V-02
        IF p_mode IN ('generated','day_regenerate') AND ((p_mask >> (EXTRACT(DOW FROM v_date)::integer)) & 1) <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a review block was created on a non-study day');
        END IF;
        -------------------------------------------------------------- V-04
        -- review_block_max bounds ORDINARY review. An exam-review block is
        -- sized by the exam and may take the whole budget (sheet §2 step 4).
        -- Sheet §8 item 6 puts its sizing under V-10, and V-05 still caps it
        -- at the day.
        IF public.calendar_require_int(v_b, 'target_count') < 1
           OR (v_b ->> 'explanation_key' = 'review_due'
               AND public.calendar_require_int(v_b, 'target_count') > k_review_max) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','review target_count is outside 1..review_block_max');
        END IF;
        v_secs := v_secs + public.calendar_require_int(v_b, 'target_count') * e_review_secs;
        -------------------------------------------------------------- V-10
        -- Ordinary review may not outrun what is actually due through this
        -- date. An exam-review block is sized by the exam, not the queue, so
        -- the queue cap does not apply to it (sheet §2 step 4).
        IF v_b ->> 'explanation_key' = 'review_due' THEN
          -- deterministic_v1 works a per-date queue, so availability is what is
          -- due THROUGH this date. fallback_v1 deliberately works a single
          -- total (sheet §5A) precisely because the per-date queue may be
          -- unreadable when it runs, so its availability is the horizon total.
          -- Holding it to the through-date cap would reject every fallback plan
          -- for doing exactly what §5A tells it to do.
          SELECT COALESCE(sum(public.calendar_require_int(r, 'due_count')), 0) INTO v_due_through
          FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r
          WHERE p_output ->> 'generator' = 'fallback_v1' OR (r ->> 'date')::date <= v_date;
          IF v_review_planned + public.calendar_require_int(v_b, 'target_count') > v_due_through THEN
            v_viol := v_viol || jsonb_build_object('rule','V-10','date',v_date::text,
                        'detail','review target exceeds what is due through this date net of review already planned');
          END IF;
          v_review_planned := v_review_planned + public.calendar_require_int(v_b, 'target_count');
        END IF;

      ELSIF v_b ->> 'block_type' = 'practice' THEN
        -------------------------------------------------------------- V-02
        IF p_mode IN ('generated','day_regenerate') AND ((p_mask >> (EXTRACT(DOW FROM v_date)::integer)) & 1) <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a practice block was created on a non-study day');
        END IF;
        -------------------------------------------------------------- V-04
        IF (v_b ->> 'section') = ANY (v_sec_seen) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','more than one practice block in section ' || (v_b ->> 'section'));
        END IF;
        v_sec_seen := v_sec_seen || (v_b ->> 'section');

        IF v_b #>> '{scope,level}' = 'domain' THEN
          IF jsonb_array_length(v_b #> '{scope,mix}') > k_max_domains THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','more than max_domains_per_block domains in one block');
          END IF;
          SELECT COALESCE(sum(public.calendar_require_int(e, 'count')), 0),
                 COALESCE(string_agg(e ->> 'count', ',') FILTER (
                   WHERE public.calendar_require_int(e, 'count') % k_granularity <> 0
                      OR public.calendar_require_int(e, 'count') < k_min_domain_q), '')
            INTO v_sum, v_txt
          FROM jsonb_array_elements(v_b #> '{scope,mix}') e;
          IF v_txt <> '' THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','domain count(s) ' || v_txt || ' are not multiples of granularity at or above min_domain_questions');
          END IF;
          IF v_sum <> public.calendar_require_int(v_b, 'target_count') THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','the mix sums to ' || v_sum || ' but target_count is ' || (v_b ->> 'target_count'));
          END IF;
        ELSE
          IF public.calendar_require_int(v_b -> 'scope', 'count') <> public.calendar_require_int(v_b, 'target_count') THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','section-level scope count disagrees with target_count');
          END IF;
          IF public.calendar_require_int(v_b, 'target_count') % k_granularity <> 0
             OR public.calendar_require_int(v_b, 'target_count') < k_min_domain_q THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','section-level practice count is not a multiple of granularity at or above min_domain_questions');
          END IF;
        END IF;
        v_secs := v_secs + public.calendar_require_int(v_b, 'target_count') * e_practice_secs;
      END IF;

      ---------------------------------------------------------------- V-09
      IF p_mode IN ('generated','day_regenerate') THEN
        IF NOT (v_b ->> 'explanation_key' = ANY (c_block_keys)) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-09','date',v_date::text,
                      'detail','block explanation_key ' || COALESCE(v_b ->> 'explanation_key','<null>')
                            || ' is not in the formula sheet §6 block set');
        END IF;
        IF v_b #>> '{scope,level}' = 'domain' THEN
          SELECT string_agg(DISTINCT e ->> 'explanation_key', ',') INTO v_txt
          FROM jsonb_array_elements(v_b #> '{scope,mix}') e
          WHERE NOT (e ->> 'explanation_key' = ANY (c_domain_keys));
          IF v_txt IS NOT NULL THEN
            v_viol := v_viol || jsonb_build_object('rule','V-09','date',v_date::text,
                        'detail','domain explanation_key(s) ' || v_txt || ' are not in the formula sheet §6 domain set');
          END IF;
        END IF;
      END IF;
    END LOOP;

    ------------------------------------------------------------------ V-05
    IF p_mode IN ('generated','day_regenerate') THEN
      IF v_has_created_fl AND v_count > 1 THEN
        v_viol := v_viol || jsonb_build_object('rule','V-05','date',v_date::text,
                    'detail','an exam date carries other created blocks');
      END IF;
      IF v_secs > p_minutes * 60 THEN
        v_viol := v_viol || jsonb_build_object('rule','V-05','date',v_date::text,
                    'detail','planned seconds ' || v_secs || ' exceed the day budget ' || (p_minutes * 60));
      END IF;
    END IF;

    ------------------------------------------------------------------ V-12
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_input -> 'started_blocks_by_date', '[]'::jsonb)) s
      WHERE (s ->> 'scheduled_date')::date = v_date
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_rec.members, '[]'::jsonb)) m
          WHERE m ->> 'kind' = 'carried' AND m ->> 'block_id' = s ->> 'block_id')
    ) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-12','date',v_date::text,
                  'detail','a block the student has already started was not carried');
    END IF;
  END LOOP;

  -------------------------------------------------------------------- V-08
  -- Display order IS the member array order (§10.2), so contiguity from 1 is
  -- automatic within one date. What is not automatic is a date appearing twice
  -- in `dates`: the two member lists would both start at ordinal 1 and collide
  -- on calendar_plan_block_memberships’ UNIQUE (plan_version_id,
  -- scheduled_date, display_ordinal). Catching it here turns an opaque 23505
  -- inside the writer into a named rejection.
  FOR v_rec IN
    SELECT d ->> 'scheduled_date' AS sd, count(*) AS n
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) d
    GROUP BY 1 HAVING count(*) > 1
  LOOP
    v_viol := v_viol || jsonb_build_object('rule','V-08','date', v_rec.sd,
                'detail','the date appears ' || v_rec.n || ' times in the output; display ordinals would collide');
  END LOOP;

  -- A block id may not be carried onto two different dates in one plan: a
  -- block never moves (INV-08-22), and the composite FK would refuse it.
  FOR v_rec IN
    SELECT m ->> 'block_id' AS sd, count(DISTINCT d ->> 'scheduled_date') AS n
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) d,
         jsonb_array_elements(COALESCE(d -> 'members', '[]'::jsonb)) m
    WHERE m ->> 'kind' = 'carried'
    GROUP BY 1 HAVING count(DISTINCT d ->> 'scheduled_date') > 1
  LOOP
    v_viol := v_viol || jsonb_build_object('rule','V-08','date', NULL,
                'detail','carried block ' || v_rec.sd || ' appears on ' || v_rec.n || ' different dates');
  END LOOP;

  -------------------------------------------------------------------- V-11
  IF v_created_fl > k_fl_max THEN
    v_viol := v_viol || jsonb_build_object('rule','V-11','date', NULL,
                'detail','the horizon creates ' || v_created_fl
                      || ' full-lengths, above max_full_length_per_horizon ' || k_fl_max);
  END IF;

  IF jsonb_array_length(v_viol) = 0 THEN
    RETURN jsonb_build_object('result','accepted');
  END IF;
  RETURN jsonb_build_object('result','rejected','violations', v_viol);
END;
$$;

COMMENT ON FUNCTION public.calendar_validate_plan(text, jsonb, jsonb) IS
  'Doc 05F §10.3 as amended by formula sheet §8 item 6 and by the day_regenerate mode (2026-09-17). Pure. Returns a rejection as data rather than raising. Mode day_regenerate is mode generated minus V-14: the day-scoped student triggers exist to clear the student’s own override, which is the one thing V-14 forbids a generated version from doing. V-07 is retired: sheet §8 item 3 removed skill_codes.';

-- ----------------------------------------------------------------------------
-- 3a. calendar_regenerate_day_only — narrow a horizon plan to one date
--
-- Pure and IMMUTABLE, like every other output-shaping calendar function. It
-- keeps the one date the caller asked for and drops the rest, so a day-scoped
-- version owns exactly one date while the generator still reasons over the whole
-- horizon. A date the generator did not emit yields an empty dates array, which
-- calendar_regenerate_day refuses before it gets here.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_regenerate_day_only(p_output jsonb, p_date date)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_set(p_output, '{dates}', COALESCE((
    SELECT jsonb_agg(d)
    FROM jsonb_array_elements(p_output -> 'dates') d
    WHERE (d ->> 'scheduled_date')::date = p_date
  ), '[]'::jsonb));
$$;

COMMENT ON FUNCTION public.calendar_regenerate_day_only(jsonb, date) IS
  'Doc 05F §12.1: keeps one date of a horizon plan so a day-scoped version owns exactly that date. calendar_compute_plan always emits the full horizon and ignores generated_for.dates, so narrowing happens on the output, after generation, never by shrinking the snapshot.';

-- ----------------------------------------------------------------------------
-- 3. calendar_regenerate_day — Doc 05F §12.1, §15 (day_regenerate / day_reset)
--
-- Shaped like calendar_edit_day, with one difference that is the whole point:
-- edit_day takes the members the client asked for and marks the date overridden,
-- while this derives the day from the generator and leaves it NOT overridden.
-- calendar_plan_to_output writes is_user_override false, so the flag clears as a
-- consequence of regenerating rather than as a separate write.
--
-- WHY IT PLANS THE HORIZON AND KEEPS ONE DAY. calendar_compute_plan loops
-- `0 .. horizon_days - 1` from the snapshot’s today and ignores
-- generated_for.dates, so it cannot plan a single date — handing it a one-date
-- snapshot yields a fourteen-day plan that V-01 then rejects thirteen times over.
-- That is also the right answer rather than a workaround: what belongs on a
-- Tuesday depends on where the exams sit, what review is due across the week and
-- what the other days already took, so the day is cut from a full-horizon plan
-- rather than guessed in isolation. The snapshot records the horizon it reasoned
-- over, the output carries one date, and V-01 is satisfied because the output
-- dates are a subset of generated_for.dates.
--
-- ORDER MATTERS, and it is the same order every other calendar writer uses. The
-- profile lock is taken BEFORE the ledger is read, so the check-then-insert is
-- atomic per student. Reading first lets concurrent callers sharing a key all
-- miss the ledger, serialise on the lock, and then collide on
-- calendar_mutation_ledger_pkey — the replay returns a 23505 instead of the
-- stored response. That was a real defect in the first cut of the DB layer,
-- caught by scripts/ci/calendar-concurrency-gate.sh C-2, and a new writer is
-- exactly where it would come back.
--
-- One function, two routes. day_regenerate and day_reset differ only in the
-- trigger recorded on the version, so there is one implementation and the route
-- names which it is. No other trigger is accepted: a horizon-scoped trigger
-- reaching this function would silently plan one date instead of fourteen.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_regenerate_day(
  p_student_id        uuid,
  p_date              date,
  p_trigger           text,
  p_generator_version text,
  p_idempotency_key   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stored     jsonb;
  v_input      jsonb;
  v_plan       jsonb;
  v_output     jsonb;
  v_generator  text := 'deterministic_v1';
  v_reason     jsonb;
  v_res        jsonb;
  v_result     jsonb;
  v_today      date;
  v_tz         text;
  v_enabled    text[];
  v_degraded   text[];
  v_horizon    integer;
  v_dates      date[];
BEGIN
  IF p_trigger NOT IN ('day_regenerate', 'day_reset') THEN
    RAISE EXCEPTION 'calendar_regenerate_day: trigger ''%'' is not a day-scoped trigger', p_trigger
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_regenerate_day: student % has no study profile; nothing is generated and the prior plan stands', p_student_id
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- §12.2: a past date is never owned and never regenerated.
  IF p_date < v_today THEN
    RAISE EXCEPTION 'calendar_regenerate_day: % is in the past and cannot be regenerated', p_date
      USING ERRCODE = '23514';
  END IF;

  SELECT public.calendar_require_int(jsonb_object_agg(key, value), 'horizon_days')
    INTO v_horizon FROM public.calendar_runtime_config;

  -- Outside the horizon the generator never emits the date at all, so the
  -- version would own nothing and the route would report a success that changed
  -- no plan. Refuse instead of writing an empty version.
  IF p_date > v_today + (v_horizon - 1) THEN
    RAISE EXCEPTION 'calendar_regenerate_day: % is beyond the % day horizon and is not planned yet', p_date, v_horizon
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(d ORDER BY d) INTO v_dates
  FROM generate_series(v_today, v_today + (v_horizon - 1), interval '1 day') g(d);

  v_input := public.calendar_build_plan_input(p_student_id, v_dates);

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(v_input -> 'enabled_block_types') t;
  SELECT COALESCE(array_agg(t), '{}') INTO v_degraded
  FROM jsonb_array_elements_text(COALESCE(v_input -> 'degraded', '[]'::jsonb)) t;

  -- Sheet §5A, the same ladder calendar_persist_version runs. A day the student
  -- asked for is never left blank: a degraded read, a raise or a rejection all
  -- fall through to fallback_v1 on the same snapshot, with the reason recorded.
  IF 'mastery' = ANY (v_degraded) OR 'review_queue' = ANY (v_degraded) THEN
    v_generator := 'fallback_v1';
    v_reason := jsonb_build_object('reason','degraded_input','degraded', v_input -> 'degraded');
  ELSE
    BEGIN
      v_plan := public.calendar_compute_plan(v_input);
    EXCEPTION WHEN OTHERS THEN
      v_generator := 'fallback_v1';
      v_reason := jsonb_build_object('reason','primary_raised','sqlstate', SQLSTATE, 'message', SQLERRM);
    END;

    IF v_generator = 'deterministic_v1' THEN
      v_output := public.calendar_carry_started(v_input,
                    public.calendar_regenerate_day_only(
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled),
                      p_date));
      v_res := public.calendar_validate_plan('day_regenerate', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    v_output := public.calendar_carry_started(v_input,
                  public.calendar_regenerate_day_only(
                    public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled),
                    p_date));
  END IF;

  v_result := public.calendar_write_version(p_student_id, p_trigger, 'student',
                v_generator, p_generator_version, v_input, v_output, 'day_regenerate', v_reason);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_regenerate_day',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.calendar_regenerate_day(uuid, date, text, text, uuid) IS
  'Doc 05F §12.1 / §15: the writer behind POST /api/calendar/days/:date/regenerate and /reset. Owns exactly one date, derives it from the generator and leaves is_user_override false, which is how the student’s override clears. Validates in mode day_regenerate — generated minus V-14, because clearing that override is the operation. FOR UPDATE on the profile before the ledger read, as every calendar writer does.';

-- ----------------------------------------------------------------------------
-- 4. Grants (Doc 05F §7.12)
--
-- Same posture as the five writers 20260917130000 granted: the server role and
-- nobody else. A student reaches this through an authenticated API route, never
-- by calling the function.
--
-- The narrowing helper is revoked too and granted to no one. It is reachable
-- only from inside the SECURITY DEFINER writer, which runs as its owner — the
-- same posture calendar_plan_to_output and calendar_carry_started have. Writer
-- gate Z-19 sweeps every function named calendar_% and caught this one the first
-- time it was left out.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.calendar_regenerate_day(uuid, date, text, text, uuid),
  public.calendar_regenerate_day_only(jsonb, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.calendar_regenerate_day(uuid, date, text, text, uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 5. calendar_link_launch — serialise sequence allocation (Doc 05F §7.7, §15.1)
--
-- Replaced from the applied 20260917130000 body with ONE line changed: the block
-- lookup gains FOR UPDATE. Everything else — the ownership check, the engine
-- check, the replay on (engine, engine_session_id), the INSERT — is byte-identical.
--
-- WHY. launch_sequence is COALESCE(max(launch_sequence), 0) + 1 over
-- calendar_block_launches, and the applied version held nothing while computing
-- it. Two launches of the same block with different engine_session_ids both read
-- max = 0, both computed 1, and the second hit
-- calendar_block_launches_pkey (block_id, launch_sequence) with a raw 23505 —
-- an unhandled 500 on a student pressing Start twice. calendar_persist_version
-- already takes the profile FOR UPDATE for exactly this reason (INV-08-17) and
-- this writer was the one that did not.
--
-- The lock is on the BLOCK row, not the profile. Launch contention is per block:
-- locking the profile would serialise every launch a student makes across every
-- block, and the block row is the narrowest thing that makes max + 1 correct.
-- calendar_blocks is append-only and nothing UPDATEs it, so the lock contends
-- only with other launches of the same block, which is the whole point.
--
-- This does NOT replace the engine idempotency key. Two concurrent launches still
-- reach the engine with the same calendar:block:<id>:<seq> key and get ONE
-- session back (INV-08-18) -- the lock is what stops the two link rows colliding
-- after that.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_link_launch(
  p_student_id        uuid,
  p_block_id          uuid,
  p_engine            text,
  p_engine_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_seq   smallint;
  v_type  text;
BEGIN
  -- FOR UPDATE: the one line that differs from the applied body. Every caller
  -- allocating a sequence for this block queues here, so max + 1 is read under
  -- exclusive access rather than raced.
  SELECT block_type INTO v_type
  FROM public.calendar_blocks WHERE block_id = p_block_id AND student_id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_link_launch: block % does not belong to student %', p_block_id, p_student_id
      USING ERRCODE = '42501';
  END IF;
  IF v_type <> p_engine THEN
    RAISE EXCEPTION 'calendar_link_launch: block % is a % block and cannot be launched into the % engine',
      p_block_id, v_type, p_engine USING ERRCODE = '22023';
  END IF;

  SELECT launch_sequence INTO v_seq FROM public.calendar_block_launches
  WHERE engine = p_engine AND engine_session_id = p_engine_session_id;
  IF FOUND THEN
    RETURN jsonb_build_object('block_id', p_block_id, 'launch_sequence', v_seq, 'replayed', true);
  END IF;

  SELECT COALESCE(max(launch_sequence), 0) + 1 INTO v_seq
  FROM public.calendar_block_launches WHERE block_id = p_block_id;

  INSERT INTO public.calendar_block_launches
    (block_id, student_id, launch_sequence, engine, engine_session_id)
  VALUES (p_block_id, p_student_id, v_seq, p_engine, p_engine_session_id);

  RETURN jsonb_build_object('block_id', p_block_id, 'launch_sequence', v_seq, 'replayed', false);
END;
$$;

COMMENT ON FUNCTION public.calendar_link_launch(uuid, uuid, text, uuid) IS
  'Doc 05F §7.7, §15.1 (INV-08-18). Append-only, idempotent on (engine, engine_session_id). Takes FOR UPDATE on the block row before allocating launch_sequence: the applied 20260917130000 body held nothing, so two concurrent launches of one block both computed max + 1 and the second died on the primary key with a raw 23505.';


COMMIT;
