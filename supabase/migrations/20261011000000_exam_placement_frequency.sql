-- ============================================================================
-- EXAM PLACEMENT IS ARITHMETIC ON WHAT THE STUDENT CHOSE
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc 05F formula sheet §2 Step 2 (rewritten 2026-09-27), §4 constants,
--        §5A (placement identical in both generators), §8 change record;
--        Doc 05F §8.1 R-08-27 as amended; validator V-02]
-- @implemented [2026-09-27]
--
-- plain English: placement was a precedence ladder — a cadence anchor, every-Nth-
--   weekday-occurrence counting, and a minimum gap. It is now: start from the last
--   completed full-length (or the setup date), add `interval_weeks × 7`, take the
--   next preferred weekday on or after that, repeat through the horizon.
--
--   Expected outcome: the two production defects become unreachable. The anchor was
--   the first preferred weekday ON OR AFTER setup, so the first exam could land on
--   the day the student set up; the interval is now at least one full period after
--   setup, so it cannot. And an overridden date used to be dropped by the narrowing
--   step with no trace, which on one profile meant NO exam could ever be placed; it
--   now shifts, and when it cannot, it is recorded.
--
-- WHY +7 AND NEVER +1..6 (owner ruling, 2026-09-27). Two reasons, either decisive:
--   V-02 — live at 20260917140000_calendar_route_constants.sql:250-255 and pinned in
--   scripts/ci/genesis-schema.expected.sql — requires every created `full_length` in
--   mode `generated` OR `day_regenerate` to sit on `full_length_weekday`. A shift of
--   1..6 days from a weekday can never land on that weekday again, so every such
--   exam would be a violation, and since #903 a violation fails the WHOLE plan. The
--   brief's original rule would have turned "the exam quietly disappears" into "the
--   plan is rejected", in exactly the case it was meant to fix. And the product
--   reason, which stands alone: the student picked Saturday. The next Saturday
--   respects that; a Wednesday quietly overrides it.
--
-- THE SUPERSEDED-BODY MAP. Every CREATE OR REPLACE below is built from the body of
--   the LAST migration that defines that function, not from 20260917130000:
--     calendar_place_full_lengths   20260917130000_calendar_v1.sql        (rewritten)
--     calendar_compute_plan         20261004000000_calendar_full_length_seam.sql
--     calendar_compute_plan_fallback 20261004000000_calendar_full_length_seam.sql
--     calendar_build_plan_input     20261004000000_calendar_full_length_seam.sql
--     calendar_persist_version      20260926000000_calendar_drop_unowned_dates.sql
--   The four inherited bodies were extracted from those files and patched at named
--   anchors, so every line this change does not mean to touch is byte-identical to
--   the body that is live today. Rebuilding any of them from v1 would have silently
--   reverted the seam — the class 20261008000000 exists to undo.
--
-- ORPHANED MUTATIONS — re-checked in this change, as the working rules require.
--   No mutation in any scripts/ci/*.mutations.sh anchors inside any of the five
--   functions above; the only 20260917130000 matches are in
--   deletion-evidence-gate.mutations.sh, which names a DIFFERENT migration that
--   happens to share the timestamp prefix (…_declarative_fk_delete_actions.sql) and
--   targets execute_account_deletion_cascade. Nothing to re-point.
--
-- `current_overrides` WAS ALREADY IN THE SNAPSHOT (seam :526) and therefore already
--   reached the generator — the same object the validator reads. What changes is that
--   placement now reads it. Its shape is `{scheduled_date, is_user_override}` and it
--   lists EVERY horizon date with a plan row, so the `is_user_override` filter is not
--   decoration: without it every already-planned date would look overridden and
--   placement would shift or suppress on almost every date. The predicate is the same
--   one V-14 uses, deliberately.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
-- Apply order: after 20261010000000_full_length_interval_weeks.sql, which adds the
--   column this reads. Applying this first would leave placement reading a column
--   that does not exist.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. calendar_place_full_lengths — formula sheet §2 Step 2
--
-- RETURNS `{"placed": [{"date","explanation_key"}, ...], "suppressed": ["date", ...]}`.
-- The signature changed because the suppression is the point: an exam the student's
-- own day edit displaced twice is a fact a surface must be able to state, and the
-- old array had nowhere to put it.
--
-- `placed` keeps the documented order — the final rehearsal first, then cadence
-- exams in date order — because that is what the previous COMMENT promised and
-- nothing gains from changing it. Consumers look up by date.
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
  -- (2) The series — one interval after the last exam, or after setup.
  --
  -- THE CURSOR ADVANCES ON THE INTENDED DATE, NOT THE SHIFTED ONE. That is what
  -- stops one blocked Saturday from dragging every later exam a week late: the
  -- rhythm belongs to the student's choice, not to the accident that moved one
  -- sitting. (Oracle line 78.)
  ----------------------------------------------------------------------------
  v_cursor := COALESCE(x_last, p_setup);
  LOOP
    v_d := v_cursor + (p_iv * 7);
    WHILE EXTRACT(DOW FROM v_d)::integer <> p_wd LOOP
      v_d := v_d + 1;
    END LOOP;
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
  'Doc 05F formula sheet §2 step 2 (rewritten 2026-09-27). Arithmetic on the student''s chosen frequency and weekday: from the last completed exam or the setup date, + interval_weeks x 7, then the next preferred weekday on or after. An overridden date shifts +7 and never to another weekday (V-02); both occurrences overridden records a suppression. The final rehearsal walks back from the target and is never shifted. Returns {placed, suppressed}. Shared by both generators (sheet §5A), so the rules have exactly one implementation.';

-- ---------------------------------------------------------------------------
-- 2. calendar_compute_plan — deterministic_v1, from the SEAM body (20261004000000).
--    Two hunks: the placement lookup now reads `-> 'placed'`, and the return carries
--    `exam_suppressions`. Everything else is the live body, unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_compute_plan(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  -- constants (sheet §4)
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_null_weight       integer;
  k_post_days         integer;
  k_post_mult         integer;
  k_weak_max          integer;
  k_min_domain_q      integer;
  k_max_domains       integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  v_constants         jsonb;
  v_weight_by_level   jsonb;
  v_order             jsonb;

  -- engine planning (snapshotted from the owning configs)
  e_practice_secs     integer;
  e_review_secs       integer;

  -- profile
  p_today             date;
  p_setup             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  p_fl_weekday        integer;

  -- exams
  x_last_date         date;
  x_days_since        integer;
  x_missed            integer;
  x_reviewed          boolean;
  x_weak              text[];
  x_session           text;

  -- domain arrays, all aligned on canonical order
  d_dom               text[] := '{}';
  d_sec               text[] := '{}';
  d_lvl               integer[] := '{}';
  d_w                 integer[] := '{}';
  d_why               text[] := '{}';
  d_alloc             integer[] := '{}';
  v_cold_start        boolean;

  -- exam placement (shared derivation)
  v_fl                jsonb;

  -- running state
  v_allocated_total   integer := 0;
  v_planned_total     integer := 0;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;

  -- per-day
  v_d                 date;
  v_i                 integer;
  v_j                 integer;
  v_k                 integer;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_sec_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_tot               integer;
  v_sec_tot           integer;
  v_units             integer;
  v_cum               integer;
  v_best              integer;
  v_best_def          integer;
  v_def               integer;
  v_sec_w             integer[];
  v_sec_units         integer[];
  v_planned_sec       integer[];
  v_s                 integer;
  v_secname           text;
  v_mix_dom           integer[];
  v_mix_cnt           integer[];
  v_mix_json          jsonb;
  v_pool_ok           boolean;
  v_key               text;
BEGIN
  ----------------------------------------------------------------------------
  -- Snapshot unpacking. Every essential field is required, never defaulted.
  ----------------------------------------------------------------------------
  v_constants := p_input -> 'constants';
  IF v_constants IS NULL OR jsonb_typeof(v_constants) <> 'object' THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no constants object' USING ERRCODE = '22023';
  END IF;

  k_horizon_days     := public.calendar_require_int(v_constants, 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(v_constants, 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(v_constants, 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(v_constants, 'exam_review_default_count');
  k_null_weight      := public.calendar_require_int(v_constants, 'null_level_weight');
  k_post_days        := public.calendar_require_int(v_constants, 'post_exam_emphasis_days');
  k_post_mult        := public.calendar_require_int(v_constants, 'post_exam_multiplier');
  -- E9b: the one definition of "weak" for planning (sheet §6 L0-L1), read from
  -- config so the builder's weak_domains and this explanation step cannot disagree.
  k_weak_max         := public.calendar_require_int(v_constants, 'weak_level_max');
  k_min_domain_q     := public.calendar_require_int(v_constants, 'min_domain_questions');
  k_max_domains      := public.calendar_require_int(v_constants, 'max_domains_per_block');
  k_granularity      := public.calendar_require_int(v_constants, 'granularity');
  k_taper_days       := public.calendar_require_int(v_constants, 'taper_days');
  k_taper_bp         := public.calendar_require_int(v_constants, 'taper_ratio_bp');

  v_weight_by_level := v_constants -> 'weight_by_level';
  v_order           := v_constants -> 'canonical_domain_order';
  IF v_weight_by_level IS NULL OR jsonb_typeof(v_weight_by_level) <> 'object'
     OR v_order IS NULL OR jsonb_typeof(v_order) <> 'array'
     OR jsonb_array_length(v_order) <> 8 THEN
    RAISE EXCEPTION 'calendar_compute_plan: constants must carry weight_by_level and an eight-entry canonical_domain_order'
      USING ERRCODE = '22023';
  END IF;

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan: engine_planning seconds-per-unit must be positive' USING ERRCODE = '22023';
  END IF;

  IF (p_input -> 'profile') IS NULL OR (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no profile or no today' USING ERRCODE = '22023';
  END IF;
  p_today      := (p_input ->> 'today')::date;
  p_setup      := (p_input #>> '{profile,setup_date}')::date;
  p_mask       := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes    := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target     := (p_input #>> '{profile,target_exam_date}')::date;
  p_fl_weekday := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: profile.setup_date is essential and was not supplied' USING ERRCODE = '22023';
  END IF;

  x_last_date  := (p_input #>> '{exams,last_completed_local_date}')::date;
  x_days_since := CASE WHEN (p_input #>> '{exams,days_since_exam}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'days_since_exam') END;
  x_missed     := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;
  -- jsonb null cannot be cast to boolean, it RAISES — and a snapshot whose
  -- exam facts are unreadable carries exactly that. An absent flag means "not
  -- known to be reviewed", which the ladder below already treats correctly.
  x_reviewed   := CASE WHEN jsonb_typeof(p_input #> '{exams,reviewed}') = 'boolean'
                      THEN (p_input #> '{exams,reviewed}')::boolean ELSE NULL END;
  SELECT COALESCE(array_agg(t), '{}') INTO x_weak
  FROM jsonb_array_elements_text(COALESCE(p_input #> '{exams,weak_domains}', '[]'::jsonb)) t;
  x_session    := p_input #>> '{exams,source_session_id}';

  ----------------------------------------------------------------------------
  -- Domain arrays, in canonical order. `mastery` carries the section for each
  -- domain, so the M/RW split is read from the snapshot rather than restated
  -- here, and canonical_domain_order supplies only the order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. 7 LOOP
    d_dom := d_dom || (v_order ->> v_i);
    SELECT m ->> 'section',
           CASE WHEN m ->> 'mastery_level' IS NULL THEN NULL ELSE (m ->> 'mastery_level')::integer END
      INTO v_secname, v_s
    FROM jsonb_array_elements(COALESCE(p_input -> 'mastery', '[]'::jsonb)) m
    WHERE m ->> 'domain' = (v_order ->> v_i);
    IF v_secname IS NULL THEN
      RAISE EXCEPTION 'calendar_compute_plan: snapshot mastery has no row for domain ''%''', v_order ->> v_i
        USING ERRCODE = '22023';
    END IF;
    d_sec := d_sec || v_secname;
    d_lvl := d_lvl || v_s;
    d_alloc := d_alloc || 0;
  END LOOP;

  -- recent_planned_by_domain seeds the deficit state (sheet §2 step 5: the
  -- deficit is measured against the last recent_planned_window_days plus today).
  FOR v_i IN 1 .. 8 LOOP
    SELECT COALESCE((SELECT public.calendar_require_int(r, 'count')
                     FROM jsonb_array_elements(COALESCE(p_input -> 'recent_planned_by_domain', '[]'::jsonb)) r
                     WHERE r ->> 'domain' = d_dom[v_i]), 0)
      INTO v_s;
    d_alloc[v_i] := v_s;
    v_allocated_total := v_allocated_total + v_s;
  END LOOP;
  v_planned_total := v_allocated_total;

  ----------------------------------------------------------------------------
  -- Step 3 — need weights. All eight unmeasured is cold start: Step 5 splits
  -- Math and R&W evenly and no weight is consulted.
  ----------------------------------------------------------------------------
  v_cold_start := true;
  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NOT NULL THEN v_cold_start := false; END IF;
  END LOOP;

  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NULL THEN
      d_w := d_w || k_null_weight;
      d_why := d_why || 'exploring'::text;
    ELSE
      d_w := d_w || public.calendar_require_int(v_weight_by_level, d_lvl[v_i]::text);
      d_why := d_why || (CASE WHEN d_lvl[v_i] <= k_weak_max THEN 'weak'
                              WHEN d_lvl[v_i] >= 3 THEN 'strength'
                              ELSE 'balanced' END)::text;
    END IF;
    IF x_days_since IS NOT NULL AND x_days_since <= k_post_days AND d_dom[v_i] = ANY (x_weak) THEN
      d_w[v_i] := d_w[v_i] * k_post_mult;
      d_why[v_i] := 'post_exam';
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- Step 2 — full-length placement, shared with fallback_v1 so the precedence
  -- rules have exactly one implementation (sheet §5A).
  ----------------------------------------------------------------------------
  v_fl := public.calendar_place_full_lengths(p_input);

  ----------------------------------------------------------------------------
  -- An exam completed and not yet reviewed owes an exam-review block on the
  -- next study day. A missed count of zero leaves the debt standing rather than
  -- discharging it silently -- the reference does the same, and inventing a
  -- size here would be exactly the kind of guess §6 forbids.
  ----------------------------------------------------------------------------
  IF x_last_date IS NOT NULL AND x_missed IS NOT NULL AND x_reviewed IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := x_missed;
    v_pending_key    := 'exam_review';
  END IF;

  ----------------------------------------------------------------------------
  -- The six steps, per date in horizon order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT v_due + COALESCE((SELECT public.calendar_require_int(r, 'due_count')
                             FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r
                             WHERE (r ->> 'date')::date = v_d), 0)
      INTO v_due;

    -- An exam day holds nothing else, and sets up the review that follows it.
    SELECT f ->> 'explanation_key' INTO v_key
    FROM jsonb_array_elements(v_fl -> 'placed') f WHERE (f ->> 'date')::date = v_d;

    IF v_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL, 'exam_mode', 'strict'),
                           'target_count', 1, 'explanation_key', v_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    -- Step 1 — budget. Nothing is planned on or after the test until the
    -- student sets a new date.
    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    -- Step 4 — review. Exam review takes the whole budget if it needs it,
    -- otherwise ordinary review is capped by its share of the day.
    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        -- E9b: a real exam review is a SESSION review of that exam (05F §9.4), so
        -- completing it is what sets exams.reviewed. The placeholder stays queue:
        -- no session exists yet. One helper serves both generators.
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', public.calendar_exam_review_scope(v_pending_key, x_session),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Step 5 — practice.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      IF v_cold_start THEN
        -- Math and R&W halves, the leading section alternating by study-day index.
        v_half := (v_day_q / k_granularity / 2) * k_granularity;
        IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
        ELSE v_lead := 'RW'; v_other := 'M'; END IF;
        v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'cold_start' END;
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                      'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_day_q - v_half, 'explanation_key', v_key);
        IF v_half <> 0 THEN
          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                        'scope', jsonb_build_object('level','section','count', v_half,
                                                    'explanation_key', v_key),
                        'target_count', v_half, 'explanation_key', v_key);
        END IF;
      ELSE
        v_tot := 0;
        FOR v_j IN 1 .. 8 LOOP v_tot := v_tot + d_w[v_j]; END LOOP;

        v_sec_w := ARRAY[0, 0];         -- [1] = M, [2] = RW
        v_planned_sec := ARRAY[0, 0];
        FOR v_j IN 1 .. 8 LOOP
          v_s := CASE WHEN d_sec[v_j] = 'M' THEN 1 ELSE 2 END;
          v_sec_w[v_s] := v_sec_w[v_s] + d_w[v_j];
          v_planned_sec[v_s] := v_planned_sec[v_s] + d_alloc[v_j];
        END LOOP;
        v_sec_tot := v_sec_w[1] + v_sec_w[2];
        v_units := v_day_q / k_granularity;

        -- Level 1 — each granule goes to the section furthest behind its share.
        -- Ties go to Math.
        v_sec_units := ARRAY[0, 0];
        FOR v_j IN 1 .. v_units LOOP
          v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2] + 1) * k_granularity;
          v_best := 1;
          v_best_def := v_cum * v_sec_w[1] - (v_planned_sec[1] + v_sec_units[1] * k_granularity) * v_sec_tot;
          v_def := v_cum * v_sec_w[2] - (v_planned_sec[2] + v_sec_units[2] * k_granularity) * v_sec_tot;
          IF v_def > v_best_def THEN v_best := 2; v_best_def := v_def; END IF;
          v_sec_units[v_best] := v_sec_units[v_best] + 1;
        END LOOP;

        -- Product rule: when the day has two or more granules, both sections appear.
        IF v_units >= 2 THEN
          IF v_sec_units[1] = 0 THEN v_sec_units[1] := 1; v_sec_units[2] := v_sec_units[2] - 1; END IF;
          IF v_sec_units[2] = 0 THEN v_sec_units[2] := 1; v_sec_units[1] := v_sec_units[1] - 1; END IF;
        END IF;

        -- Level 2 — within each section, each granule goes to the domain
        -- furthest behind its share. Once the block holds max_domains_per_block
        -- distinct domains, later granules stay inside them. Math first, so the
        -- R&W deficits already see Math’s allocations for the day.
        FOR v_s IN 1 .. 2 LOOP
          v_secname := CASE WHEN v_s = 1 THEN 'M' ELSE 'RW' END;
          v_sec_q := v_sec_units[v_s] * k_granularity;
          CONTINUE WHEN v_sec_q < k_min_domain_q;

          v_mix_dom := '{}';
          v_mix_cnt := '{}';
          FOR v_j IN 1 .. v_sec_q / k_granularity LOOP
            v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
            v_best := NULL;
            v_pool_ok := COALESCE(array_length(v_mix_dom, 1), 0) >= k_max_domains;
            FOR v_k IN 1 .. 8 LOOP       -- canonical order; ties keep the earlier index
              CONTINUE WHEN d_sec[v_k] <> v_secname;
              CONTINUE WHEN v_pool_ok AND NOT (v_k = ANY (v_mix_dom));
              v_def := v_cum * d_w[v_k]
                     - (d_alloc[v_k] + COALESCE(
                         (SELECT v_mix_cnt[ix] FROM generate_subscripts(v_mix_dom, 1) ix
                          WHERE v_mix_dom[ix] = v_k), 0)) * v_tot;
              IF v_best IS NULL OR v_def > v_best_def THEN
                v_best := v_k; v_best_def := v_def;
              END IF;
            END LOOP;
            IF v_best = ANY (v_mix_dom) THEN
              v_mix_cnt := (SELECT array_agg(CASE WHEN v_mix_dom[ix] = v_best
                                                  THEN v_mix_cnt[ix] + k_granularity
                                                  ELSE v_mix_cnt[ix] END ORDER BY ix)
                            FROM generate_subscripts(v_mix_dom, 1) ix);
            ELSE
              v_mix_dom := v_mix_dom || v_best;       -- first touch fixes display order
              v_mix_cnt := v_mix_cnt || k_granularity;
            END IF;
          END LOOP;

          v_mix_json := '[]'::jsonb;
          FOR v_j IN 1 .. array_length(v_mix_dom, 1) LOOP
            v_mix_json := v_mix_json || jsonb_build_object(
              'domain', d_dom[v_mix_dom[v_j]],
              'count',  v_mix_cnt[v_j],
              'explanation_key', d_why[v_mix_dom[v_j]]);
            d_alloc[v_mix_dom[v_j]] := d_alloc[v_mix_dom[v_j]] + v_mix_cnt[v_j];
          END LOOP;

          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_secname,
                        'scope', jsonb_build_object('level','domain','mix', v_mix_json),
                        'target_count', v_sec_q,
                        'explanation_key', CASE WHEN v_tapered THEN 'taper' ELSE 'weighted' END);
        END LOOP;

        v_planned_total := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  -- Brief 14: suppressions ride OUT on the plan. They are computed here, downstream of
  -- the builder that owns `degraded[]`, so the generator cannot write them into the
  -- snapshot itself. calendar_persist_version merges them in before it stores the
  -- snapshot, which keeps placement's rules in ONE implementation and this function pure.
  RETURN jsonb_build_object('generator', 'deterministic_v1', 'days', v_days,
                            'exam_suppressions', COALESCE(v_fl -> 'suppressed', '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. calendar_compute_plan_fallback — fallback_v1, from the SEAM body. Sheet §5A
--    makes placement identical in both generators, so it gets the identical two hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_min_domain_q      integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  e_practice_secs     integer;
  e_review_secs       integer;
  p_today             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  x_last              date;
  x_reviewed          boolean;
  x_missed            integer;
  x_session           text;
  fl                  jsonb;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;
  v_i                 integer;
  v_d                 date;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_key               text;
  v_fl_key            text;
BEGIN
  k_horizon_days     := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(p_input -> 'constants', 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(p_input -> 'constants', 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(p_input -> 'constants', 'exam_review_default_count');
  k_min_domain_q     := public.calendar_require_int(p_input -> 'constants', 'min_domain_questions');
  k_granularity      := public.calendar_require_int(p_input -> 'constants', 'granularity');
  k_taper_days       := public.calendar_require_int(p_input -> 'constants', 'taper_days');
  k_taper_bp         := public.calendar_require_int(p_input -> 'constants', 'taper_ratio_bp');

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: engine_planning seconds-per-unit must be positive'
      USING ERRCODE = '22023';
  END IF;

  IF (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: snapshot has no today' USING ERRCODE = '22023';
  END IF;
  p_today   := (p_input ->> 'today')::date;
  p_mask    := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target  := (p_input #>> '{profile,target_exam_date}')::date;

  x_last     := (p_input #>> '{exams,last_completed_local_date}')::date;
  -- jsonb null cannot be cast to boolean, it RAISES — and a snapshot whose
  -- exam facts are unreadable carries exactly that. An absent flag means "not
  -- known to be reviewed", which the ladder below already treats correctly.
  x_reviewed := CASE WHEN jsonb_typeof(p_input #> '{exams,reviewed}') = 'boolean'
                      THEN (p_input #> '{exams,reviewed}')::boolean ELSE NULL END;
  x_missed   := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                     ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;

  x_session  := p_input #>> '{exams,source_session_id}';

  fl := public.calendar_place_full_lengths(p_input);

  -- A single total is enough here: the fallback runs precisely when the
  -- per-date review queue may be unreadable.
  SELECT COALESCE(sum(public.calendar_require_int(r, 'due_count')), 0) INTO v_due
  FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r;

  -- Unlike deterministic_v1, a missing OR ZERO missed count falls back to the
  -- placeholder size rather than leaving the debt standing. The fallback’s whole
  -- job is to produce a usable day from partial inputs, and deterministic_v1 has the
  -- real number or it waits. Both behaviours are the reference’s.
  IF x_last IS NOT NULL AND COALESCE(x_reviewed, true) IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := CASE WHEN COALESCE(x_missed, 0) = 0 THEN k_exam_review_dflt ELSE x_missed END;
    v_pending_key    := 'exam_review';
  END IF;

  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT f ->> 'explanation_key' INTO v_fl_key
    FROM jsonb_array_elements(fl -> 'placed') f WHERE (f ->> 'date')::date = v_d;

    IF v_fl_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL, 'exam_mode', 'strict'),
                           'target_count', 1, 'explanation_key', v_fl_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        -- E9b: a real exam review is a SESSION review of that exam (05F §9.4), so
        -- completing it is what sets exams.reviewed. The placeholder stays queue:
        -- no session exists yet. One helper serves both generators.
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', public.calendar_exam_review_scope(v_pending_key, x_session),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Two practice blocks, Math and R&W halves, the leading section alternating
    -- by study-day index so no state has to be stored to keep them balanced.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      v_half := (v_day_q / k_granularity / 2) * k_granularity;
      IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
      ELSE v_lead := 'RW'; v_other := 'M'; END IF;
      v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'fallback' END;
      v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                    'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                'explanation_key', v_key),
                    'target_count', v_day_q - v_half, 'explanation_key', v_key);
      IF v_half <> 0 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                      'scope', jsonb_build_object('level','section','count', v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_half, 'explanation_key', v_key);
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  -- Sheet §5A: placement is IDENTICAL in both generators, so the suppressions travel the
  -- same way. A fallback run that suppressed an exam says so exactly as the primary does.
  RETURN jsonb_build_object('generator', 'fallback_v1', 'days', v_days,
                            'exam_suppressions', COALESCE(fl -> 'suppressed', '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. calendar_build_plan_input — from the SEAM body. One hunk: the snapshot gains
--    `profile.full_length_interval_weeks`, gated on the same enabled-engines flag as
--    the weekday so the pair cannot be split in the snapshot either.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile   record;
  v_constants jsonb;
  v_today     date;
  v_window    integer;
  v_practice  integer;
  v_review    integer;
  v_horizon_lo date;
  v_horizon_hi date;
  v_degraded  jsonb := '[]'::jsonb;
  v_mastery   jsonb;
  -- Which engines the product has actually turned on. Read once, used twice below.
  v_review_on      boolean;
  v_full_length_on boolean;
  -- E9b: the exam facts (05F §10.1 exams{}), all NULL unless full_length is on
  -- AND the student has a completed exam.
  v_weak_max       integer;
  v_exam_id        uuid;
  v_exam_date      date;
  v_seams_applied  boolean := false;
  v_missed         integer;
  v_reviewed       boolean;
  v_weak           jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.student_study_profile WHERE student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_build_plan_input: student % has no study profile', p_student_id
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_object_agg(key, value) INTO v_constants FROM public.calendar_runtime_config;
  IF v_constants IS NULL THEN
    RAISE EXCEPTION 'calendar_runtime_config: no rows; the calendar cannot generate without constants'
      USING ERRCODE = '22023';
  END IF;

  -- The snapshot must describe the world the OUTPUT will be filtered against.
  -- calendar_plan_to_output drops every member whose block_type is not in
  -- enabled_block_types (20260917130000 line 1586), but the generator allocates
  -- budget from these inputs without consulting that list. So a disabled engine
  -- spends the day's seconds on a block that is then thrown away, and the day
  -- comes up short with nothing to explain it. Reading the list HERE is what
  -- makes the two agree.
  SELECT
    COALESCE(bool_or(t = 'review'), false),
    COALESCE(bool_or(t = 'full_length'), false)
    INTO v_review_on, v_full_length_on
  FROM jsonb_array_elements_text(COALESCE(v_constants -> 'enabled_block_types', '[]'::jsonb)) t;

  -- §8.2 local dates: every date in a plan is the student’s local date, and the
  -- profile’s timezone is what makes "today" mean anything.
  v_today  := (now() AT TIME ZONE v_profile.timezone)::date;
  v_window := public.calendar_require_int(v_constants, 'recent_planned_window_days');
  v_review := public.calendar_require_int(v_constants, 'review_estimated_seconds_per_item');

  -- Doc 02B §41 owns practice timing. It is referenced, never restated (§20 audit rule).
  SELECT public.calendar_require_int(jsonb_build_object('target_seconds_per_question', value),
                                     'target_seconds_per_question')
    INTO v_practice
  FROM public.practice_runtime_config WHERE key = 'target_seconds_per_question';
  IF v_practice IS NULL THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key ''target_seconds_per_question'''
      USING ERRCODE = '22023';
  END IF;

  v_horizon_lo := COALESCE((SELECT min(d) FROM unnest(p_dates) d), v_today);
  v_horizon_hi := COALESCE((SELECT max(d) FROM unnest(p_dates) d), v_today);

  -- Mastery, in canonical order, one row per domain. A student with no rows is
  -- COLD START, not degraded: all eight unknown is a state the formula has a
  -- branch for (sheet §2 step 3), and calling it degraded would push every new
  -- student onto fallback_v1 for being new.
  SELECT jsonb_agg(jsonb_build_object(
           'section', CASE WHEN d.domain IN ('Algebra','Advanced Math',
                                             'Problem Solving and Data Analysis',
                                             'Geometry and Trigonometry') THEN 'M' ELSE 'RW' END,
           'domain', d.domain,
           'mastery_level', m.mastery_level) ORDER BY d.ord)
    INTO v_mastery
  FROM jsonb_array_elements_text(v_constants -> 'canonical_domain_order')
       WITH ORDINALITY AS d(domain, ord)
  LEFT JOIN public.student_domain_mastery m
    ON m.student_id = p_student_id AND m.domain = d.domain;

  -- E9b (G-08-02): the exams seam is real now. Every fact below is read from its
  -- owner, never computed here, and all of them stay NULL while full_length is not
  -- in enabled_block_types (the same "tell the generator the truth" rule as the
  -- weekday above). "exams" is no longer pushed into degraded[]: the read either
  -- finds an exam or finds none, and "none" is a fact, not a degradation.
  --
  --   last exam          the student's newest test_sessions row in state
  --                      'completed' (Doc 04A terminal state), dated by
  --                      completed_at in the profile's timezone (§8.2).
  --   missed_count       its review-queue rows (source_engine 'full_length',
  --                      source_session_id = the exam) that are still ACTIVE and
  --                      SERVABLE -- the H5 rule: never plan against rows the review
  --                      engine will refuse to serve. NULL until E9's seams event
  --                      has applied, because before that the queue rows do not
  --                      exist yet and "unknown" is not "zero".
  --   reviewed           a COMPLETED session-mode review sourced from that exam
  --                      (review_sessions.mode = 'session', filters naming it), OR
  --                      the seams have applied and nothing from it is left
  --                      outstanding. The second arm is load-bearing: the generator
  --                      holds an exam-review debt open while missed_count = 0 and
  --                      reviewed is not true, and while it is open it places no
  --                      ordinary review at all -- so a perfect exam, or one whose
  --                      misses were cleared in queue review, would otherwise
  --                      suppress review for the whole horizon, forever.
  --   weak_domains       Doc 05B's own student_domain_mastery levels (already in
  --                      v_mastery above), filtered at weak_level_max -- the one
  --                      definition calendar_compute_plan's explanation step reads
  --                      too. A NULL level (below MIN_EVENTS_FOR_MASTERY) is
  --                      unmeasured, never weak.
  --   source_session_id  the exam's id, so the generator can name it in the
  --                      exam-review block's session scope (05F §9.4).
  --
  -- ANONYMISED STUDENT: a de-identified exam carries student_id NULL, so it never
  -- matches p_student_id here; the path terminates at this WHERE.
  IF v_full_length_on THEN
    v_weak_max := public.calendar_require_int(v_constants, 'weak_level_max');

    SELECT s.id, (s.completed_at AT TIME ZONE v_profile.timezone)::date
      INTO v_exam_id, v_exam_date
    FROM public.test_sessions s
    WHERE s.student_id = p_student_id
      AND s.state = 'completed'
    ORDER BY s.completed_at DESC, s.id DESC
    LIMIT 1;

    IF v_exam_id IS NOT NULL THEN
      v_seams_applied := EXISTS (
        SELECT 1 FROM public.exam_runtime_outbox o
        WHERE o.aggregate_id = v_exam_id
          AND o.event_type = 'test_session_scored'
          AND o.result ->> 'outcome' = 'applied');

      IF v_seams_applied THEN
        SELECT count(*)::integer INTO v_missed
        FROM public.review_schedule r
        JOIN public.servable_questions sq ON sq.id = r.question_id
        WHERE r.student_id = p_student_id
          AND r.source_engine = 'full_length'
          AND r.source_session_id = v_exam_id
          AND r.status = 'active';
      END IF;

      v_reviewed := EXISTS (
          SELECT 1 FROM public.review_sessions rs
          WHERE rs.student_id = p_student_id
            AND rs.mode = 'session'
            AND rs.status = 'completed'
            AND rs.filters ->> 'source_engine' = 'full_length'
            AND rs.filters ->> 'source_session_id' = v_exam_id::text)
        OR (v_seams_applied AND v_missed = 0);

      SELECT COALESCE(jsonb_agg(t.m ->> 'domain' ORDER BY t.o), '[]'::jsonb) INTO v_weak
      FROM jsonb_array_elements(COALESCE(v_mastery, '[]'::jsonb)) WITH ORDINALITY AS t(m, o)
      WHERE jsonb_typeof(t.m -> 'mastery_level') = 'number'
        AND (t.m ->> 'mastery_level')::integer <= v_weak_max;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'today', v_today::text,
    'generated_for', jsonb_build_object(
      'dates', COALESCE((SELECT jsonb_agg(d::text ORDER BY d) FROM unnest(p_dates) d), '[]'::jsonb)),

    'profile', jsonb_build_object(
      'timezone', v_profile.timezone,
      'target_exam_date', v_profile.target_exam_date::text,
      'target_score', v_profile.target_score,
      'study_days_mask', v_profile.study_days_mask,
      'daily_minutes', v_profile.daily_minutes,
      -- The single field that places an exam. calendar_compute_plan derives its
      -- full-length dates from this weekday (20260917130000 line 966); with it NULL
      -- there are no exam dates, so the "an exam day holds nothing else" CONTINUE
      -- never fires and the day keeps its budget for practice. The same branch is
      -- what reserves the exam_review_placeholder, so nulling this withholds the
      -- reservation too -- both symptoms, one field.
      --
      -- The PROFILE still stores the student's chosen test day. This is the
      -- SNAPSHOT: what the generator is told, not what the student asked for. When
      -- full_length is enabled the stored value flows through untouched.
      'full_length_weekday', CASE WHEN v_full_length_on
                                  THEN v_profile.full_length_weekday ELSE NULL END,
      -- The cadence, gated on the SAME flag as the weekday above and for the same reason.
      -- They are one decision in the table (`full_length_pair`, 20261010000000) and they
      -- must stay one decision in the snapshot: placement needs BOTH non-null to place
      -- anything, so nulling only one would leave a snapshot that says "Saturdays, at no
      -- frequency" -- a state no student can have chosen and the DB would refuse.
      'full_length_interval_weeks', CASE WHEN v_full_length_on
                                         THEN v_profile.full_length_interval_weeks ELSE NULL END,
      'planner_mode', v_profile.planner_mode,
      'setup_date', COALESCE(
        (v_profile.setup_completed_at AT TIME ZONE v_profile.timezone)::date,
        (v_profile.created_at AT TIME ZONE v_profile.timezone)::date)::text),

    'mastery', COALESCE(v_mastery, '[]'::jsonb),

    -- Anything already overdue folds onto today rather than being lost: the
    -- generator walks the horizon forward and never looks behind its first date.
    -- Same rule as full_length_weekday above: with review disabled the generator
    -- must not see work it is about to have filtered away. An empty list is the
    -- honest snapshot of "no review is planned", which is true when the engine
    -- cannot be reached. The queue itself is untouched -- the entries stay active
    -- and are planned the moment review is enabled.
    'review_due_by_date', CASE WHEN NOT v_review_on THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', q.d::text, 'due_count', q.n) ORDER BY q.d)
      FROM (
        SELECT greatest((r.queued_at AT TIME ZONE v_profile.timezone)::date, v_today) AS d,
               count(*)::integer AS n
        FROM public.review_schedule r
        -- H5: the ONLY change from the 20260921000000 body. A queue entry whose question
        -- has been retired or issue-flagged since it was queued is not servable, so it must
        -- not be PLANNED either -- the queue stores no question metadata (ruling 19), and
        -- review's own prefill joins this same view at serve time. Without the join the
        -- generator sizes a review block against rows the engine will then refuse to serve,
        -- and the student gets a block that runs short with nothing to explain it.
        -- INNER join, deliberately: a missing row means not servable, which is the same
        -- answer as a retired one.
        JOIN public.servable_questions sq ON sq.id = r.question_id
        WHERE r.student_id = p_student_id
          AND r.status = 'active'
          AND (r.queued_at AT TIME ZONE v_profile.timezone)::date <= v_horizon_hi
        GROUP BY 1
      ) q), '[]'::jsonb) END,

    -- E9b: the facts gathered above. With full_length off, or no completed exam,
    -- every field is NULL and weak_domains is [] -- exactly the shape the oracle
    -- gives a student who has never sat one.
    'exams', jsonb_build_object(
      'last_completed_local_date', v_exam_date::text,
      'days_since_exam', CASE WHEN v_exam_date IS NULL THEN NULL ELSE v_today - v_exam_date END,
      'missed_count', v_missed,
      'reviewed', CASE WHEN v_exam_id IS NULL THEN NULL ELSE v_reviewed END,
      'weak_domains', v_weak,
      'source_session_id', v_exam_id::text),

    -- The deficit rule measures a domain against what it has had over the
    -- window plus today (sheet §2 step 5). Only domain-level practice blocks
    -- can be attributed. A cold-start section block names no domain, and
    -- guessing how to split it would be inventing history.
    'recent_planned_by_domain', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('domain', q.domain, 'count', q.n) ORDER BY q.domain)
      FROM (
        SELECT e ->> 'domain' AS domain, sum((e ->> 'count')::integer)::integer AS n
        FROM public.calendar_current_plan cp
        JOIN public.calendar_blocks b ON b.block_id = cp.block_id
        CROSS JOIN LATERAL jsonb_array_elements(b.scope -> 'mix') e
        WHERE cp.student_id = p_student_id
          AND b.block_type = 'practice'
          AND b.scope ->> 'level' = 'domain'
          AND cp.scheduled_date >= v_today - v_window
          AND cp.scheduled_date < v_today
        GROUP BY 1
      ) q), '[]'::jsonb),

    -- §12.2 protected state, and the inputs V-12/V-13/V-14 are checked against.
    'started_blocks_by_date', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
        AND EXISTS (SELECT 1 FROM public.calendar_block_launches l WHERE l.block_id = b.block_id)
      ), '[]'::jsonb),

    'existing_blocks_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'current_overrides', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', cp.scheduled_date::text, 'is_user_override', cp.is_user_override))
      FROM public.calendar_current_plan cp
      WHERE cp.student_id = p_student_id
        AND cp.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'enabled_block_types', v_constants -> 'enabled_block_types',

    'engine_planning', jsonb_build_object(
      'practice_seconds_per_unit', v_practice,
      'review_seconds_per_unit', v_review),

    'constants', v_constants,
    'degraded', v_degraded);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. calendar_persist_version — from 20260926000000. Three hunks: the degraded
--    reader is widened to skip structured entries, the fallback trigger is pinned to
--    exactly mastery/review_queue in a comment that says why, and the suppressions
--    are merged into the STORED snapshot just before the version is written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_persist_version(
  p_student_id        uuid,
  p_trigger           text,
  p_initiated_by      text,
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
  v_dates      date[];
  v_horizon    integer;
  v_tz         text;
  v_enabled    text[];
  v_degraded   text[];
BEGIN
  -- INV-08-17. A concurrent regeneration for the same student waits here
  -- rather than racing to the same version_no.
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey — the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_persist_version: student % has no study profile; nothing is generated and the prior plan stands', p_student_id
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_stored;   -- a replayed key returns the stored response and writes nothing
    END IF;
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT public.calendar_require_int(jsonb_object_agg(key, value), 'horizon_days')
    INTO v_horizon FROM public.calendar_runtime_config;

  -- §12.1 / §12.2: which dates this trigger may own. Past dates are never
  -- owned, and a date the student has overridden is never taken by a
  -- non-student version — filtering here is what keeps V-14 a backstop rather
  -- than a guaranteed rejection.
  SELECT array_agg(d ORDER BY d) INTO v_dates
  FROM generate_series(v_today, v_today + (v_horizon - 1), interval '1 day') g(d)
  WHERE p_trigger IN ('setup','rollback')
     OR NOT EXISTS (SELECT 1 FROM public.calendar_current_plan cp
                    WHERE cp.student_id = p_student_id
                      AND cp.scheduled_date = g.d::date
                      AND cp.is_user_override);

  v_input := public.calendar_build_plan_input(p_student_id, v_dates);

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(v_input -> 'enabled_block_types') t;
  -- THE READER IS WIDENED (Brief 14). `degraded[]` used to hold only marker STRINGS, and
  -- this read was `jsonb_array_elements_text` over all of them. It now also carries
  -- STRUCTURED suppression entries ({kind, date}), because a suppression's whole point is
  -- the date and a marker string with the dates parked elsewhere is two places to keep in
  -- step. Objects are skipped rather than stringified: this array feeds the fallback
  -- decision below, which compares against marker names, and an object rendered as JSON
  -- text would be a value that matches nothing while looking like it might.
  SELECT COALESCE(array_agg(e #>> '{}'), '{}') INTO v_degraded
  FROM jsonb_array_elements(COALESCE(v_input -> 'degraded', '[]'::jsonb)) e
  WHERE jsonb_typeof(e) = 'string';

  -- §5A: a degraded mastery read or review queue means the primary generator
  -- would be working from something it cannot trust.
  -- THE FALLBACK TRIGGER IS EXACTLY THESE TWO, AND A SUPPRESSION IS NEVER ONE (owner
  -- ruling, Brief 14). Two things hold it: this list is closed, and the suppression merge
  -- happens BELOW, after this branch has already been decided -- so a suppressed exam
  -- cannot reach this test even in principle. A student whose blocked day cost them one
  -- practice test still gets the mastery-weighted plan they would otherwise have had;
  -- degrading the whole generation over it would be a second, larger failure.
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
      v_output := public.calendar_drop_unowned_dates(
                    public.calendar_drop_today_for_system(
                      public.calendar_carry_started(v_input,
                        public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                      p_trigger, v_today),
                    v_input);
      v_res := public.calendar_validate_plan('generated', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    -- The fallback needs the same narrowing as the primary. Without it a student with an
    -- overridden date whose primary plan was rejected would have the fallback rejected for
    -- the identical reason, and the ladder would have no rung left.
    v_output := public.calendar_drop_unowned_dates(
                  public.calendar_drop_today_for_system(
                    public.calendar_carry_started(v_input,
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                    p_trigger, v_today),
                  v_input);
  END IF;

  ----------------------------------------------------------------------------
  -- Brief 14 -- the suppression reaches the STORED snapshot here, and only here.
  --
  -- Placement runs inside the generator, downstream of calendar_build_plan_input which
  -- owns `degraded[]`, so the fact has to travel out on the plan and be merged back in.
  -- The alternative -- having the builder place exams too, so it could record its own
  -- suppressions -- would give the precedence rules a SECOND implementation, which is the
  -- one thing calendar_place_full_lengths' own header says it exists to prevent.
  --
  -- Structured, not a marker string: the date is the entire content of the entry, and it is
  -- what lets a surface say "we couldn't fit your practice test on the 26th" rather than
  -- "something was degraded". Both generators emit it (sheet §5A), so this runs for a
  -- fallback version too.
  ----------------------------------------------------------------------------
  IF jsonb_array_length(COALESCE(v_plan -> 'exam_suppressions', '[]'::jsonb)) > 0 THEN
    v_input := jsonb_set(v_input, '{degraded}',
      COALESCE(v_input -> 'degraded', '[]'::jsonb) || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('kind', 'full_length_suppressed',
                                            'date', s #>> '{}')
                         ORDER BY s #>> '{}')
        FROM jsonb_array_elements(v_plan -> 'exam_suppressions') s), '[]'::jsonb));
  END IF;

  v_result := public.calendar_write_version(p_student_id, p_trigger, p_initiated_by,
                v_generator, p_generator_version, v_input, v_output, 'generated', v_reason);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_persist_version',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Config — the retired keys go, and the formula names its new revision
--
-- THEY GO HERE AND NOT IN 20261010000000, which is the whole reason that file is
-- additive: `calendar_require_int` RAISES 22023 on a missing key rather than
-- defaulting, and until the statements above landed, both generators still read
-- these two. Deleting them any earlier would have stopped plan generation for every
-- student in the window between the two applies. They are removed in the same
-- transaction as the bodies that stop reading them, so there is no such window.
--
-- `default_full_length_interval_weeks` is NOT inserted here: 20261010000000 already
-- seeded it as the setup surface's prefill. The generator never reads it.
--
-- `generator_version` is bumped in this file because this file changes
-- calendar_compute_plan, calendar_compute_plan_fallback and
-- calendar_place_full_lengths — which its own seeded description requires
-- ("Any later migration that changes ... MUST update this row in the same file",
-- 20260917140000_calendar_route_constants.sql:91-92). Without it, a stored plan
-- version would name a migration whose bodies did not produce it.
-- ---------------------------------------------------------------------------
DELETE FROM public.calendar_runtime_config
 WHERE key IN ('full_length_every_n_occurrences', 'full_length_min_gap_days');

UPDATE public.calendar_runtime_config
   SET value = '"20261011000000"'
 WHERE key = 'generator_version';


COMMIT;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   BEGIN;
--   -- 1. Restore the four inherited bodies from their previous definers, verbatim:
--   --      calendar_compute_plan, calendar_compute_plan_fallback,
--   --      calendar_build_plan_input  <- 20261004000000_calendar_full_length_seam.sql
--   --      calendar_persist_version   <- 20260926000000_calendar_drop_unowned_dates.sql
--   --    (Replay those two files' function definitions; nothing else in them changed.)
--   -- 2. Restore calendar_place_full_lengths from 20260917130000_calendar_v1.sql
--   --    lines 1262-1351 verbatim — the anchor/occurrence/min-gap body.
--   -- 3. Re-seed the two retired keys and restore generator_version:
--   --    INSERT INTO public.calendar_runtime_config
--   --      (key, value, value_type, min_value, max_value, owner, description) VALUES
--   --      ('full_length_every_n_occurrences', '2', 'integer', '1', '6', 'product', '...'),
--   --      ('full_length_min_gap_days', '7', 'integer', '1', '21', 'product', '...');
--   --    UPDATE public.calendar_runtime_config
--   --       SET value = '"20260917140000"' WHERE key = 'generator_version';
--   COMMIT;
--
-- ORDER MATTERS ON THE WAY BACK, and in the opposite direction to the way in. The
-- keys must be re-seeded BEFORE the old placement body is live, because that body
-- reads them through calendar_require_int, which RAISES 22023 on a missing key
-- rather than defaulting — so a rollback that restored the function first would
-- stop plan generation for every student in the window between the two statements.
-- Doing both inside one transaction, as above, closes that window entirely.
--
-- WHAT A ROLLBACK COSTS. Plans already generated are untouched: a stored version is
-- an immutable row, and `generator_version` on it still names the migration that
-- made it, which is the whole reason that row exists. Students whose profile carries
-- a cadence keep it — `full_length_interval_weeks` belongs to 20261010000000 and is
-- not dropped here — but the old body ignores it and re-spaces everyone by
-- `full_length_every_n_occurrences` again, bringing back both production defects.
-- Any `degraded[]` suppression entries already written stay in their stored
-- snapshots; they are inert, and the widened reader that skips non-string entries
-- is part of persist_version, so restoring its old body makes the old reader read
-- them as text. That is harmless — it compares against marker names and matches
-- nothing — but it is the one asymmetry worth knowing about.
