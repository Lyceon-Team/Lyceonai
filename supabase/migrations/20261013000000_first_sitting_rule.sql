-- ============================================================================
-- THE FIRST SITTING COMES BEFORE THE FIRST INTERVAL
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc 05F formula sheet §2 Step 2 (corrected 2026-09-29), §4 constants,
--        §8 change record; Doc 05F §8.1 R-08-27; validator V-02]
-- @implemented [2026-09-29]
--
-- plain English: a student's FIRST practice test is the first preferred weekday
-- after they set up, not a whole interval later. Expected outcome: a new
-- fortnightly student sees a test in their first fortnight instead of never
-- seeing one. Trade-offs and edge cases are in the function body, where the rule
-- is.
--
-- THE DEFECT, from production rather than from reasoning. Profile 59ce67c7:
-- `study_days_mask = 62` (Mon-Fri), `full_length_weekday = 6`,
-- `full_length_interval_weeks = 2`, set up 29 Sep, no target date. The Saturdays
-- in the horizon (3 Oct, 10 Oct) are owned plan dates, and ZERO full-length
-- blocks exist on them. The arithmetic the old rule ran:
--
--   29 Sep + (2 x 7) = 13 Oct  ->  next Saturday = 17 Oct
--   horizon = 29 Sep .. 12 Oct
--
-- The exam falls one Saturday past the end of the window, and for a fortnightly
-- student it always will: the first interval is spent before the first sitting,
-- so the first sitting can never land inside the first horizon. Monthly is
-- worse. Weekly was the only cadence that worked, which is why this survived.
--
-- WHAT CHANGES, and what deliberately does not. Only the anchor of the series:
-- the +7 override shift, the two-occurrences suppression, the unshifted final
-- rehearsal, the cap, and the cursor advancing on the INTENDED date are all
-- unchanged. `default_full_length_weekday` is added beside the interval default
-- so a new student's practice-test day opens on Saturday rather than on None —
-- a SURFACE default, read by setup and never by the generator, exactly like the
-- interval one it sits next to.
--
-- PORTED FROM THE ORACLE, docs/Spec/calendar_formula_reference.py exam_dates(),
-- which the owner corrected in c1161211. The parity gate compares this body's
-- output against that file across all 13 committed fixtures plus the seeded
-- suite, so a divergence here is caught as a divergence rather than as prose.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. calendar_place_full_lengths — the series anchor, and only that.
--
-- The whole body is re-emitted because that is what CREATE OR REPLACE takes;
-- the diff against 20261011000000 is the DECLARE of `v_first`, the block
-- computing it, and the loop's first-iteration branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_place_full_lengths(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  k_horizon_days integer;
  k_final_lead   integer;
  k_fl_max       integer;
  p_today        date;
  p_setup        date;
  p_target       date;
  p_wd           integer;
  p_iv           integer;
  x_last         date;
  h_start        date;
  h_end          date;
  v_over         date[];
  fl_date        date[] := '{}';
  fl_key         text[] := '{}';
  v_supp         date[] := '{}';
  v_cursor       date;
  v_first        date;
  v_d            date;
  v_nxt          date;
  v_probe        date;
  v_i            integer;
  v_placed       jsonb := '[]'::jsonb;
  v_suppressed   jsonb := '[]'::jsonb;
BEGIN
  k_horizon_days := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_final_lead   := public.calendar_require_int(p_input -> 'constants', 'final_exam_lead_days');
  k_fl_max       := public.calendar_require_int(p_input -> 'constants', 'max_full_length_per_horizon');

  p_today  := (p_input ->> 'today')::date;
  p_setup  := (p_input #>> '{profile,setup_date}')::date;
  p_target := (p_input #>> '{profile,target_exam_date}')::date;
  p_wd := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
               ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  p_iv := CASE WHEN (p_input #>> '{profile,full_length_interval_weeks}') IS NULL THEN NULL
               ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_interval_weeks') END;
  x_last := (p_input #>> '{exams,last_completed_local_date}')::date;

  -- Both or neither (`full_length_pair`, 20261010000000). Either half missing means
  -- no automatic exams, which is also what a snapshot with full_length disabled says.
  IF p_wd IS NULL OR p_iv IS NULL THEN
    RETURN jsonb_build_object('placed', v_placed, 'suppressed', v_suppressed);
  END IF;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_place_full_lengths: profile.setup_date is essential and was not supplied'
      USING ERRCODE = '22023';
  END IF;

  h_start := p_today;
  h_end   := p_today + (k_horizon_days - 1);

  -- Only dates the student actually overrode. See the header: the array carries every
  -- horizon date that has a plan row, most of them with is_user_override false.
  SELECT COALESCE(array_agg((o ->> 'scheduled_date')::date), '{}') INTO v_over
  FROM jsonb_array_elements(COALESCE(p_input -> 'current_overrides', '[]'::jsonb)) o
  WHERE (o ->> 'is_user_override')::boolean;

  ----------------------------------------------------------------------------
  -- (1) The final rehearsal — backwards from the target, and NEVER shifted.
  --
  -- It is the one fixed point in the schedule: it is anchored to the real test, not
  -- to a cadence, and a student who blocks that day has made their own call. Walking
  -- BACK is what keeps it inside the lead window rather than on top of it.
  ----------------------------------------------------------------------------
  IF p_target IS NOT NULL THEN
    v_probe := p_target - k_final_lead;
    WHILE EXTRACT(DOW FROM v_probe)::integer <> p_wd LOOP
      v_probe := v_probe - 1;
    END LOOP;
    IF v_probe >= h_start AND v_probe <= h_end THEN
      fl_date := fl_date || v_probe;
      fl_key  := fl_key  || 'final_rehearsal'::text;
    END IF;
  END IF;

  ----------------------------------------------------------------------------
  -- (2) The series.
  --
  -- THE FIRST SITTING IS THE FIRST PREFERRED WEEKDAY STRICTLY AFTER THE ANCHOR.
  -- No interval is applied before a student has sat one; after a completed
  -- sitting the interval runs from that sitting.
  --
  -- STRICTLY AFTER IS LOAD-BEARING IN BOTH DIRECTIONS, and the two failures it
  -- sits between are both real. Applying a full interval before the first
  -- sitting put a fortnightly student's first exam on day 14-20 of a 14-day
  -- horizon, so a new student never saw one at all: production profile
  -- 59ce67c7, Mon-Fri with Saturday tests, set up 29 Sep -> 29 Sep + 14 = 13 Oct
  -- -> next Saturday 17 Oct, against a horizon ending 12 Oct. Zero full-length
  -- blocks, and for a fortnightly student there always would be. Anchoring "on
  -- or after" the setup date instead puts the first exam on the day they signed
  -- up, which is the defect the anchor rule was replaced for. Strictly-after,
  -- then interval, is the only rule that avoids both.
  --
  -- A consequence worth naming because it looks like a bug: a student who sets
  -- up ON their preferred weekday does not get an exam that day. `p_setup + 1`
  -- is already past it, so the snap forward lands on the NEXT occurrence.
  --
  -- THE CURSOR ADVANCES ON THE INTENDED DATE, NOT THE SHIFTED ONE. That is what
  -- stops one blocked Saturday from dragging every later exam a week late: the
  -- rhythm belongs to the student's choice, not to the accident that moved one
  -- sitting.
  --
  -- Ported from the oracle, docs/Spec/calendar_formula_reference.py exam_dates()
  -- step (2). Later sittings are NOT re-snapped to the weekday, exactly as there:
  -- a weekday-aligned date plus a whole number of weeks is still weekday-aligned,
  -- so a snap would be a no-op that invited a reader to think otherwise.
  ----------------------------------------------------------------------------
  IF x_last IS NOT NULL THEN
    v_first := x_last + (p_iv * 7);
  ELSE
    v_first := p_setup + 1;
  END IF;
  WHILE EXTRACT(DOW FROM v_first)::integer <> p_wd LOOP
    v_first := v_first + 1;
  END LOOP;

  v_cursor := NULL;
  LOOP
    v_d := CASE WHEN v_cursor IS NULL THEN v_first ELSE v_cursor + (p_iv * 7) END;
    EXIT WHEN v_d > h_end;
    v_cursor := v_d;
    CONTINUE WHEN v_d < h_start OR v_d = ANY (fl_date);
    -- The cap counts the rehearsal, because a rehearsal IS a full-length and the cap
    -- is "how many full-lengths in fourteen days" (owner ruling). Where a rehearsal
    -- and a cadence exam compete for the last slot, the rehearsal has already taken
    -- it, which is right: it is the one anchored to the real test.
    EXIT WHEN COALESCE(array_length(fl_date, 1), 0) >= k_fl_max;

    IF v_d = ANY (v_over) THEN
      v_nxt := v_d + 7;
      IF v_nxt > h_end THEN
        -- NOT a suppression. That exam simply belongs to a later horizon and arrives
        -- as the window rolls forward; calling it a loss would cry wolf every fortnight.
        CONTINUE;
      END IF;
      IF v_nxt = ANY (v_over) OR v_nxt = ANY (fl_date)
         OR NOT (p_target IS NULL
                 OR (v_nxt < p_target AND (p_target - v_nxt) >= k_final_lead)) THEN
        -- Both occurrences are the student's own. Say so: silence is the defect this
        -- replaces, where an edited day swallowed the only exam in a horizon.
        v_supp := v_supp || v_d;
        CONTINUE;
      END IF;
      v_d := v_nxt;
    END IF;

    CONTINUE WHEN NOT (p_target IS NULL
                       OR (v_d < p_target AND (p_target - v_d) >= k_final_lead))
                  OR v_d = ANY (fl_date);
    fl_date := fl_date || v_d;
    fl_key  := fl_key  || 'exam_cadence'::text;
  END LOOP;

  FOR v_i IN 1 .. COALESCE(array_length(fl_date, 1), 0) LOOP
    v_placed := v_placed || jsonb_build_object('date', fl_date[v_i]::text,
                                               'explanation_key', fl_key[v_i]);
  END LOOP;
  FOR v_i IN 1 .. COALESCE(array_length(v_supp, 1), 0) LOOP
    v_suppressed := v_suppressed || to_jsonb(v_supp[v_i]::text);
  END LOOP;
  RETURN jsonb_build_object('placed', v_placed, 'suppressed', v_suppressed);
END;
$$;
COMMENT ON FUNCTION public.calendar_place_full_lengths(jsonb) IS
  'Doc 05F formula sheet §2 step 2 (first-sitting rule corrected 2026-09-29). Arithmetic on the student''s chosen frequency and weekday. The FIRST sitting is the first preferred weekday strictly after the setup date — no interval is applied before a student has sat one, because spending the first interval first put a fortnightly student''s first exam past the end of their first horizon. After a completed sitting the next is interval_weeks x 7 from it, snapped forward to that weekday; every later one is a full interval from its predecessor. An exam day need not be a study day. An overridden date shifts +7 and never to another weekday (V-02); both occurrences overridden records a suppression. The final rehearsal walks back from the target and is never shifted. Returns {placed, suppressed}. Shared by both generators (sheet §5A), so the rules have exactly one implementation.';

-- ---------------------------------------------------------------------------
-- 2. default_full_length_weekday — a SURFACE default, like its neighbour.
--
-- The setup form's practice-test-day row opened on None while the interval row
-- opened on the served default, so a student who pressed straight through got
-- no exams at all AND the two halves of one decision disagreed about whether
-- they had a default. Saturday because the real SAT is sat on a Saturday.
--
-- The generator must never read this key. It reads
-- student_study_profile.full_length_weekday, which is the student''s own choice;
-- an operator editing this row changes what a NEW student sees first and
-- changes nothing for a student who has already chosen. That is the same
-- distinction `default_full_length_interval_weeks` was seeded under, and it is
-- why neither is cross-checked against the oracle''s formula constants by the
-- parity gate — except that the oracle now carries this one in C, so it IS
-- cross-checked, and the value here must equal the oracle''s 6.
--
-- Bounds 0..6 are postgres DOW, matching student_study_profile.full_length_weekday''s
-- own CHECK. This key narrows nothing and may never widen it.
-- ---------------------------------------------------------------------------
INSERT INTO public.calendar_runtime_config
  (key, value, value_type, min_value, max_value, owner, description) VALUES

  ('default_full_length_weekday', '6', 'integer', '0', '6', 'product',
   'Doc 05F §8.1 / formula sheet §4: the weekday the setup form''s practice-test-day row OPENS on, before the student chooses — 0=Sunday .. 6=Saturday, and 6 because the real SAT is sat on a Saturday. A SURFACE default, never a schedule: the generator reads student_study_profile.full_length_weekday and never this key, so editing it cannot move an existing student''s tests. Bounds are postgres DOW and match the profile column''s own CHECK.');

-- ---------------------------------------------------------------------------
-- 3. generator_version
--
-- Bumped here because this file changes what the generator PRODUCES: the same
-- profile and the same horizon now yield a different placement. A stored plan
-- version records the version that made it, so the bump is what lets a row from
-- before this migration be told apart from one after it. C-09 requires a
-- 14-digit migration timestamp stored as a string.
-- ---------------------------------------------------------------------------
UPDATE public.calendar_runtime_config
   SET value = '"20261013000000"'
 WHERE key = 'generator_version';

COMMIT;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   BEGIN;
--   -- Re-apply the previous body verbatim from its own migration:
--   --   supabase/migrations/20261011000000_exam_placement_frequency.sql,
--   --   section 1 (CREATE OR REPLACE FUNCTION public.calendar_place_full_lengths).
--   -- It is a CREATE OR REPLACE, so re-running that section is the whole reversal
--   -- of this one; nothing else in that file needs to be re-run.
--   DELETE FROM public.calendar_runtime_config
--     WHERE key = 'default_full_length_weekday';
--   UPDATE public.calendar_runtime_config
--      SET value = '"20261011000000"' WHERE key = 'generator_version';
--   COMMIT;
--
-- WHAT A ROLLBACK COSTS. Nothing is stored by this migration, so nothing is
-- lost: placement is computed per generation, and the plan versions already
-- written keep their own `generator_version` and stay readable. The cost is the
-- defect coming back — every new fortnightly or monthly student stops seeing a
-- practice test in their first horizon — and the setup form's day row returning
-- to None while its interval row still shows a default.
--
-- ROLLING BACK THE CONFIG KEY IS NOT OPTIONAL if the function is rolled back
-- alone: the oracle carries `default_full_length_weekday` in C, and the parity
-- gate asserts calendar_runtime_config holds every key the oracle uses. Leaving
-- the row while reverting to an oracle that predates it is fine; DELETING the
-- row while the current oracle stands would redden parity. Both halves go
-- together, or neither does.
-- ============================================================================
