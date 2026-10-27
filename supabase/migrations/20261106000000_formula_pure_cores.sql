-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED
--
-- Pure cores for the two canonical formulas, so a restricted event set (the diagnostic
-- session's own answers, SCL-236) can be scored by the SAME implementation.
-- ============================================================================
-- @spec [Doc-05A_V1 §6 (compute_mastery_for_entity, INV-05A-11 single implementation);
--        Doc-05C_V1 §5.5-§5.8, §6.1-§6.5 (projection formula, authoritative reference);
--        SCL-236 changes 2 and 3 (owner ruling 2026-10-16, entry approved 2026-10-17)]
-- | @implemented [2026-10-17]
--
-- plain English:
--   1. compute_mastery_core(events, constants) holds the body of compute_mastery_for_entity
--      (20260610010000 :138-232) MOVED, not copied. Two lines differ: the constants arrive as a
--      parameter instead of being read (`v_constants := p_constants`), and the canonical_events
--      CTE unnests the events argument instead of calling canonical_mastery_events. Everything
--      from positions to rounding is byte-identical. compute_mastery_for_entity keeps its §6.1
--      signature, volatility, SECURITY DEFINER and ACL, and becomes a wrapper that reads exactly
--      what it read before (canonical_mastery_events + canonicalize_mastery_constants) and hands
--      both to the core. Every caller (apply_mastery_event, refresh_domain_mastery,
--      recompute_skill_mastery) is unchanged.
--   2. projection_core(...) holds the §5.5 gate and the §5.6-§5.8 maths of
--      compute_section_projection (20261022000000 :117-260) MOVED. The table reads become
--      arguments: the student's student_domain_mastery rows as parallel arrays (section, domain,
--      event_count_total, mastery_score), mastery_min_events(), the two full-length scores and
--      the section KPI count. The gate is the same required_domains anti-join, now against the
--      unnested arrays; the weighted SUM is the same SUM over the same rows. compute_section_
--      projection keeps its §5.1 signature, output, lock, hash, upsert and snapshot.
--   Neither core reads or writes a table; both are IMMUTABLE. The mastery_model_version does not
--   change (no maths change, Parent :449, :486-490); the parity gates (mastery-parity,
--   05b-domain-kpi-gates, lane-c-seam-gates, 05c-projection-gates,
--   projection-full-length-gates) are the proof and must stay byte-identical.
--
-- trade-offs: the wrapper now reads full_length_section_scores and student_section_kpi even when
--   the gate fails (it used to read them only in the gate-passed branch). The core ignores them
--   on the gate-failed branch exactly as before, so the stored row is unchanged; the cost is two
--   indexed point reads on a refresh that was already reading the domain table.
--
-- ROLLBACK: re-apply compute_mastery_for_entity from 20260610010000 and compute_section_projection
--   from 20261022000000; DROP FUNCTION compute_mastery_core(public.mastery_event[], jsonb),
--   projection_core(...); DROP TYPE public.mastery_event. No data is written by this migration.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The event row the mastery formula consumes: exactly canonical_mastery_events' RETURNS TABLE
--    shape (Doc 05A §6.2), column for column, so ROW(ce.*)::mastery_event is positional.
-- ----------------------------------------------------------------------------
CREATE TYPE public.mastery_event AS (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
);

-- ----------------------------------------------------------------------------
-- 2. compute_mastery_core — Doc 05A §6 body, moved (single implementation, INV-05A-11)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.compute_mastery_core(
  p_events public.mastery_event[], p_constants jsonb
) RETURNS TABLE (
  total_events integer, acc_test numeric, acc_practice numeric, acc_review numeric,
  mastery_score numeric, mastery_pct numeric, mastery_level smallint
) LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_constants jsonb; v_position_half_life numeric; v_min_events integer;
  v_w_test numeric; v_w_practice numeric; v_w_review numeric;
  v_d_easy numeric; v_d_medium numeric; v_d_hard numeric;
  v_mastery_min numeric; v_mastery_max numeric;
  v_round_score_dec integer; v_round_pct_dec integer; v_round_acc_dec integer;
  v_total integer; v_acc_test numeric; v_acc_practice numeric; v_acc_review numeric;
  v_bad_diff integer; v_bad_src integer; v_bad_section integer;
  v_bad_correct integer; v_bad_occurred_at integer; v_bad_event_id integer;
  v_mastery_raw numeric; v_mastery_score numeric; v_mastery_pct numeric; v_mastery_level smallint;
BEGIN
  -- Step 1: read constants (supplied by the caller: canonicalize_mastery_constants())
  v_constants := p_constants;
  v_position_half_life := (v_constants->>'POSITION_HALF_LIFE')::numeric;
  v_min_events         := (v_constants->>'MIN_EVENTS_FOR_MASTERY')::integer;
  v_w_test             := (v_constants->>'weight_source_test')::numeric;
  v_w_practice         := (v_constants->>'weight_source_practice')::numeric;
  v_w_review           := (v_constants->>'weight_source_review')::numeric;
  v_d_easy             := (v_constants->>'difficulty_weight_easy')::numeric;
  v_d_medium           := (v_constants->>'difficulty_weight_medium')::numeric;
  v_d_hard             := (v_constants->>'difficulty_weight_hard')::numeric;
  v_mastery_min        := (v_constants->>'mastery_min')::numeric;
  v_mastery_max        := (v_constants->>'mastery_max')::numeric;
  v_round_score_dec    := (v_constants->>'ROUND_MASTERY_SCORE_DECIMALS')::integer;
  v_round_pct_dec      := COALESCE((v_constants->>'ROUND_MASTERY_PCT_DECIMALS')::integer, 2);
  v_round_acc_dec      := (v_constants->>'ROUND_ACCURACY_DECIMALS')::integer;
  IF v_position_half_life IS NULL OR v_min_events IS NULL OR v_w_test IS NULL OR v_w_practice IS NULL
     OR v_w_review IS NULL OR v_d_easy IS NULL OR v_d_medium IS NULL OR v_d_hard IS NULL
     OR v_mastery_min IS NULL OR v_mastery_max IS NULL OR v_round_score_dec IS NULL OR v_round_acc_dec IS NULL THEN
    RAISE EXCEPTION 'MASTERY_CONSTANTS_MISSING: one or more required constants are absent from mastery_constants';
  END IF;

  -- Step 2: canonical events, positions, validation, per-source accuracy
  WITH canonical_events AS (
    SELECT * FROM unnest(p_events)
  ),
  positioned AS (
    SELECT ce.*, ROW_NUMBER() OVER (ORDER BY ce.occurred_at DESC, ce.event_id DESC) AS pos
    FROM canonical_events ce
  ),
  validation AS (
    SELECT
      COUNT(*) FILTER (WHERE difficulty IS NULL OR difficulty NOT IN (1,2,3))                          AS bad_diff,
      COUNT(*) FILTER (WHERE source_family IS NULL OR source_family NOT IN ('test','practice','review')) AS bad_src,
      COUNT(*) FILTER (WHERE section IS NULL OR section NOT IN ('M','RW'))                              AS bad_section,
      COUNT(*) FILTER (WHERE correct IS NULL)                                                          AS bad_correct,
      COUNT(*) FILTER (WHERE occurred_at IS NULL)                                                      AS bad_occurred_at,
      COUNT(*) FILTER (WHERE event_id IS NULL)                                                         AS bad_event_id
    FROM positioned
  ),
  weighted AS (
    SELECT p.source_family, p.correct::int AS correct_int,
      CASE p.difficulty WHEN 1 THEN v_d_easy WHEN 2 THEN v_d_medium WHEN 3 THEN v_d_hard ELSE NULL END AS d_w,
      POWER(0.5, (p.pos - 1)::numeric / v_position_half_life) AS pos_w
    FROM positioned p
  ),
  per_source AS (
    SELECT w.source_family,
      LEAST(1.0, SUM(w.d_w * w.pos_w * w.correct_int) / NULLIF(SUM(w.pos_w), 0)) AS acc_source
    FROM weighted w GROUP BY w.source_family
  )
  SELECT
    (SELECT COUNT(*) FROM weighted),
    (SELECT acc_source FROM per_source WHERE source_family = 'test'),
    (SELECT acc_source FROM per_source WHERE source_family = 'practice'),
    (SELECT acc_source FROM per_source WHERE source_family = 'review'),
    v.bad_diff, v.bad_src, v.bad_section, v.bad_correct, v.bad_occurred_at, v.bad_event_id
  INTO v_total, v_acc_test, v_acc_practice, v_acc_review,
       v_bad_diff, v_bad_src, v_bad_section, v_bad_correct, v_bad_occurred_at, v_bad_event_id
  FROM validation v;

  IF v_bad_diff > 0 OR v_bad_src > 0 OR v_bad_section > 0 OR v_bad_correct > 0
     OR v_bad_occurred_at > 0 OR v_bad_event_id > 0 THEN
    RAISE EXCEPTION 'MASTERY_HISTORICAL_DATA_INVALID: bad rows (diff=%, src=%, section=%, correct=%, occurred_at=%, event_id=%)',
      v_bad_diff, v_bad_src, v_bad_section, v_bad_correct, v_bad_occurred_at, v_bad_event_id;
  END IF;

  -- Step 3: threshold / NULL gate
  IF v_total IS NULL OR v_total < v_min_events THEN
    total_events := COALESCE(v_total, 0);
    acc_test := NULL; acc_practice := NULL; acc_review := NULL;
    mastery_score := NULL; mastery_pct := NULL; mastery_level := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Step 4: macro-average with renormalization over present sources
  v_mastery_raw :=
    ( COALESCE(v_w_test*v_acc_test,0) + COALESCE(v_w_practice*v_acc_practice,0) + COALESCE(v_w_review*v_acc_review,0) )
    / NULLIF(
        (CASE WHEN v_acc_test IS NOT NULL THEN v_w_test ELSE 0 END)
      + (CASE WHEN v_acc_practice IS NOT NULL THEN v_w_practice ELSE 0 END)
      + (CASE WHEN v_acc_review IS NOT NULL THEN v_w_review ELSE 0 END), 0);

  -- Step 5: clamp + round
  v_mastery_score := ROUND(GREATEST(v_mastery_min, LEAST(v_mastery_max, v_mastery_raw))::numeric, v_round_score_dec);
  v_mastery_pct   := ROUND(100.0 * v_mastery_score, v_round_pct_dec);
  v_mastery_level := public.lookup_mastery_level(v_mastery_score, v_constants);

  -- Step 6: round per-source accuracies
  v_acc_test := ROUND(v_acc_test, v_round_acc_dec);
  v_acc_practice := ROUND(v_acc_practice, v_round_acc_dec);
  v_acc_review := ROUND(v_acc_review, v_round_acc_dec);

  total_events := v_total; acc_test := v_acc_test; acc_practice := v_acc_practice; acc_review := v_acc_review;
  mastery_score := v_mastery_score; mastery_pct := v_mastery_pct; mastery_level := v_mastery_level;
  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. compute_mastery_for_entity — same signature, now the core's wrapper (Doc 05A §6.1)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_mastery_for_entity(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text DEFAULT NULL
) RETURNS TABLE (
  total_events integer, acc_test numeric, acc_practice numeric, acc_review numeric,
  mastery_score numeric, mastery_pct numeric, mastery_level smallint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT c.*
  FROM public.compute_mastery_core(
    ARRAY(
      SELECT ROW(ce.*)::public.mastery_event
      FROM public.canonical_mastery_events(p_student_id, p_entity_type, p_section, p_domain, p_skill) ce
    ),
    public.canonicalize_mastery_constants()
  ) c;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. projection_core — Doc 05C §5.5-§5.8 / §6.1-§6.5, moved
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.projection_core(
  p_student_id       uuid,     -- only for the PROJECTION_MASTERY_TERM_NULL message
  p_section          text,
  p_dm_section       text[],   -- the student's domain-mastery rows, as parallel arrays
  p_dm_domain        text[],
  p_dm_event_count   integer[],
  p_dm_score         numeric[],
  p_min_events       integer,  -- mastery_min_events()
  p_fl1_score        integer,  -- most recent completed full-length, this section (§5.7)
  p_fl2_score        integer,  -- second most recent completed full-length, this section
  p_relevant_qcount  integer,  -- §5.8 evidence count (NULL = no KPI row yet => 0)
  p_target_qcount    integer,  -- read_projection_constants()
  p_min_delta        numeric,
  p_max_delta        numeric,
  p_mid_round        integer,
  p_bound_round      integer,
  p_section_max      integer,
  p_section_min      integer,
  p_weights          jsonb
) RETURNS TABLE (
  mastery_term            numeric,
  fl1_score               integer,
  fl2_score               integer,
  fl_count_used           integer,
  blend_denominator       integer,
  relevant_question_count integer,
  projected_score_mid     integer,
  projected_score_low     integer,
  projected_score_high    integer,
  range_width             integer
) LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $func$
DECLARE
  v_min_delta         numeric := p_min_delta;
  v_max_delta         numeric := p_max_delta;
  v_target_qcount     integer := p_target_qcount;
  v_mid_round         integer := p_mid_round;
  v_bound_round       integer := p_bound_round;
  v_section_max       integer := p_section_max;
  v_section_min       integer := p_section_min;
  v_weights           jsonb   := p_weights;
  v_min_events        integer := p_min_events;
  v_gate_passed       boolean;
  v_weighted_mastery  numeric;
  v_mastery_term      numeric;
  v_fl1_score         integer;
  v_fl2_score         integer;
  v_fl_count_used     integer;
  v_blend_numerator   numeric;
  v_blend_denominator integer;
  v_blended_raw       numeric;
  v_relevant_qcount   integer;
  v_evidence_ratio    numeric;
  v_projection_delta  numeric;
  v_mid               integer;
  v_low               integer;
  v_high              integer;
  v_range_width       integer;
BEGIN
  -- §5.5 evaluate the Q4 evidence gate (INV-05C-14, RB-05C-V1-01). Anti-join the canonical 8-domain
  -- set against the student's domain-mastery rows: the gate passes iff NO required (section,domain)
  -- pair is absent or below mastery_min_events(). The required_domains VALUES set drives the gate,
  -- NOT a COUNT(*) — duplicate/extra/non-canonical rows cannot make it pass. The 8 strings are byte-
  -- identical to Parent §10.2 / PROJECTION_DOMAIN_WEIGHTS keys (RB-05C-V1-04).
  WITH required_domains(section, domain) AS (
      VALUES
          ('M','Algebra'),
          ('M','Advanced Math'),
          ('M','Problem Solving and Data Analysis'),
          ('M','Geometry and Trigonometry'),
          ('RW','Information and Ideas'),
          ('RW','Craft and Structure'),
          ('RW','Expression of Ideas'),
          ('RW','Standard English Conventions')
  )
  SELECT NOT EXISTS (
      SELECT 1
      FROM   required_domains rd
      LEFT JOIN unnest(p_dm_section, p_dm_domain, p_dm_event_count)
                  AS sdm(section, domain, event_count_total)
             ON sdm.section    = rd.section
            AND sdm.domain     = rd.domain
      WHERE COALESCE(sdm.event_count_total, 0) < v_min_events
  )
  INTO v_gate_passed;

  IF NOT v_gate_passed THEN
    -- Emit an explicit NULL projection row (UI shows "not enough evidence yet"), §5.5/§6.2.
    v_weighted_mastery := NULL;
    v_mastery_term     := NULL;
    v_blended_raw      := NULL;
    v_mid              := NULL;
    v_low              := NULL;
    v_high             := NULL;
    v_range_width      := NULL;
    v_relevant_qcount  := NULL;
    v_fl1_score        := NULL;
    v_fl2_score        := NULL;
    v_fl_count_used    := 0;
    v_blend_denominator := 1;
  ELSE
    -- §5.6 compute the mastery term (gate passed). Sum over exactly the 4 domains of THIS section,
    -- weighted by official CB domain weights, to get weighted_mastery ∈ [0,1]. mastery_score is the
    -- [0,1] decimal of each domain (05B's student_domain_mastery for the live projection).
    SELECT
        SUM(
            sdm.mastery_score
            * ((v_weights -> p_section ->> sdm.domain)::numeric)
        )
    INTO v_weighted_mastery
    FROM unnest(p_dm_section, p_dm_domain, p_dm_score) AS sdm(section, domain, mastery_score)
    WHERE sdm.section    = p_section
      AND sdm.mastery_score IS NOT NULL;

    -- Defensive: gate passed => all 4 section domains must have non-NULL mastery_score and a weight
    -- entry. A NULL here is a domain/weight key mismatch (data-integrity fault), not a low score
    -- (RB-05B-V1-02 discipline: surface, never silently COALESCE to 0).
    IF v_weighted_mastery IS NULL THEN
      RAISE EXCEPTION
        'PROJECTION_MASTERY_TERM_NULL: gate passed but weighted mastery is NULL for (%, %) — domain/weight key mismatch',
        p_student_id, p_section;
    END IF;

    -- RB-05C-V1-05: map weighted_mastery [0,1] onto the legal SAT section scale
    -- [SECTION_MIN_SCORE, SECTION_MAX_SCORE] so the mastery term is itself a legal section-scaled
    -- value (= 200 + weighted_mastery × 600), homogeneous with the full-length terms it blends with.
    v_mastery_term :=
        v_section_min + (v_weighted_mastery * (v_section_max - v_section_min));

    -- §5.7 the full-length terms (resolved by the caller: the two most recent COMPLETED
    -- full-lengths for this section, by completed_at, tiebreak id desc).
    v_fl1_score := p_fl1_score;
    v_fl2_score := p_fl2_score;

    -- The denominator adapts to how many full-lengths exist (States A/B/C). The mastery term is
    -- ALWAYS present (INV-05C-13): the projection is never the full-length alone, never a clamp.
    v_blend_numerator   := v_mastery_term;
    v_blend_denominator := 1;
    IF v_fl1_score IS NOT NULL THEN
      v_blend_numerator   := v_blend_numerator + v_fl1_score;
      v_blend_denominator := v_blend_denominator + 1;
    END IF;
    IF v_fl2_score IS NOT NULL THEN
      v_blend_numerator   := v_blend_numerator + v_fl2_score;
      v_blend_denominator := v_blend_denominator + 1;
    END IF;
    v_fl_count_used     := v_blend_denominator - 1;        -- 0, 1 or 2
    v_blended_raw       := v_blend_numerator / v_blend_denominator;

    -- §5.8 bounded range. relevant_question_count is the caller's evidence count.
    v_relevant_qcount := p_relevant_qcount;
    -- No KPI row yet (gate can pass on raw events before the KPI refresh commits) => 0 evidence.
    v_relevant_qcount := COALESCE(v_relevant_qcount, 0);

    -- evidence_ratio in [0,1]: 0 at no evidence, 1 at >= target.
    v_evidence_ratio := LEAST(
        GREATEST(v_relevant_qcount::numeric / v_target_qcount::numeric, 0),
        1
    );

    -- Shrinking delta: widest at ratio 0, tightest at ratio 1 (locked formula, §6.5).
    v_projection_delta :=
        v_max_delta - ((v_max_delta - v_min_delta) * v_evidence_ratio);

    -- Midpoint = rounded blended projection, clamped to legal SAT range.
    v_mid := public.round_to_step(
        LEAST(GREATEST(v_blended_raw, v_section_min), v_section_max),
        v_mid_round
    );

    -- Bounds: clamp to [section_min, section_max] (the range spec's lower clamp 0 is overridden to
    -- PROJECTION_SECTION_MIN_SCORE = 200 per §6.5), then round.
    v_low := public.round_to_step(
        LEAST(GREATEST(v_mid - v_projection_delta, v_section_min), v_section_max),
        v_bound_round
    );
    v_high := public.round_to_step(
        LEAST(GREATEST(v_mid + v_projection_delta, v_section_min), v_section_max),
        v_bound_round
    );

    v_range_width := v_high - v_low;
  END IF;

  mastery_term            := v_mastery_term;
  fl1_score               := v_fl1_score;
  fl2_score               := v_fl2_score;
  fl_count_used           := v_fl_count_used;
  blend_denominator       := v_blend_denominator;
  relevant_question_count := v_relevant_qcount;
  projected_score_mid     := v_mid;
  projected_score_low     := v_low;
  projected_score_high    := v_high;
  range_width             := v_range_width;
  RETURN NEXT;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 5. compute_section_projection — same signature/output; the maths is projection_core's
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_section_projection(
  p_student_id  uuid,
  p_section     text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_section_projections
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_min_delta         numeric;
  v_max_delta         numeric;
  v_target_qcount     integer;
  v_mid_round         integer;
  v_bound_round       integer;
  v_section_max       integer;
  v_section_min       integer;
  v_weights           jsonb;
  v_dm_section        text[];
  v_dm_domain         text[];
  v_dm_event_count    integer[];
  v_dm_score          numeric[];
  v_fl1_score         integer;
  v_fl2_score         integer;
  v_relevant_qcount   integer;
  v_core              record;
  v_constants_hash    text;
  v_result_row        public.student_section_projections;
BEGIN
  -- §5.2 input validation
  IF p_section NOT IN ('M', 'RW') THEN
    RAISE EXCEPTION 'PROJECTION_INVALID_SECTION: section must be M or RW, got %', p_section;
  END IF;
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'PROJECTION_INVALID_STUDENT: p_student_id is NULL';
  END IF;

  -- §5.3 acquire student-section advisory transaction lock (serializes concurrent refreshes).
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtext('projection|' || p_student_id::text || '|' || p_section)
    );
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'PROJECTION_LOCK_TIMEOUT: projection lock (%, %)', p_student_id, p_section;
  END;

  -- §5.4 read and validate projection constants (raises on missing/out-of-range/weights-not-1).
  SELECT target_qcount, min_delta, max_delta,
         mid_round, bound_round, section_max, section_min, weights
  INTO   v_target_qcount, v_min_delta, v_max_delta,
         v_mid_round, v_bound_round, v_section_max, v_section_min, v_weights
  FROM public.read_projection_constants();

  -- The student's 05B domain mastery (INV-05C-A1: read, never recomputed).
  SELECT array_agg(sdm.section), array_agg(sdm.domain),
         array_agg(sdm.event_count_total), array_agg(sdm.mastery_score)
  INTO   v_dm_section, v_dm_domain, v_dm_event_count, v_dm_score
  FROM   public.student_domain_mastery sdm
  WHERE  sdm.student_id = p_student_id;

  -- §5.7 the two most recent COMPLETED full-lengths for this section, by completed_at, tiebreak id
  -- desc — §5.7 verbatim, bound to the 04B surface SCL-157 named (full_length_section_scores;
  -- is_complete = the session completed, so a partial/abandoned test never contributes, P5). A third,
  -- older one is never read (P4). No staleness rule in V1.0 (Q1 State D).
  SELECT fl.section_scaled_score
  INTO   v_fl1_score
  FROM   public.full_length_section_scores fl
  WHERE  fl.student_id  = p_student_id
    AND  fl.section     = p_section
    AND  fl.is_complete = true
  ORDER BY fl.completed_at DESC, fl.id DESC
  LIMIT 1;

  SELECT fl.section_scaled_score
  INTO   v_fl2_score
  FROM   public.full_length_section_scores fl
  WHERE  fl.student_id  = p_student_id
    AND  fl.section     = p_section
    AND  fl.is_complete = true
  ORDER BY fl.completed_at DESC, fl.id DESC
  OFFSET 1 LIMIT 1;

  -- §5.8 relevant_question_count = 05B student_section_kpi.events_total (the same evidence
  -- population 05B aggregates; 05C reads it, never recomputes the union — INV-05C-A1/A2).
  SELECT ssk.events_total
  INTO   v_relevant_qcount
  FROM   public.student_section_kpi ssk
  WHERE  ssk.student_id = p_student_id
    AND  ssk.section    = p_section;

  -- §5.5-§5.8: gate, mastery term, blend, range (projection_core).
  SELECT * INTO v_core
  FROM public.projection_core(
      p_student_id, p_section,
      v_dm_section, v_dm_domain, v_dm_event_count, v_dm_score,
      public.mastery_min_events(),
      v_fl1_score, v_fl2_score, v_relevant_qcount,
      v_target_qcount, v_min_delta, v_max_delta,
      v_mid_round, v_bound_round, v_section_max, v_section_min, v_weights
  );

  -- §5.9 capture the operational projection-constants hash (NOT the formula hash; INV-05C-16). Hash
  -- the CANONICAL serialization (RB-05C-V1-06), not raw jsonb::text. pgcrypto digest lives in the
  -- extensions schema (genesis), same as 05A/05B.
  v_constants_hash := encode(
      extensions.digest(
          convert_to(
              public.canonicalize_projection_constants_serialized(),
              'UTF8'
          ),
          'sha256'
      ),
      'hex'
  );

  -- Upsert the canonical current row, then append an immutable snapshot — one transaction so the
  -- current row and its snapshot can never disagree.
  INSERT INTO public.student_section_projections (
      student_id, section,
      projected_score_mid, projected_score_low, projected_score_high,
      range_width, relevant_question_count,
      mastery_term, fl1_score, fl2_score, fl_count_used,
      blend_denominator,
      projection_constants_hash, mastery_model_version,
      computed_at, refreshed_at_t_now
  ) VALUES (
      p_student_id, p_section,
      v_core.projected_score_mid, v_core.projected_score_low, v_core.projected_score_high,
      v_core.range_width, v_core.relevant_question_count,
      v_core.mastery_term, v_core.fl1_score, v_core.fl2_score, v_core.fl_count_used,
      v_core.blend_denominator,
      v_constants_hash, public.mastery_model_version(),
      now(), p_t_now
  )
  ON CONFLICT (student_id, section) DO UPDATE SET
      projected_score_mid       = EXCLUDED.projected_score_mid,
      projected_score_low       = EXCLUDED.projected_score_low,
      projected_score_high      = EXCLUDED.projected_score_high,
      range_width               = EXCLUDED.range_width,
      relevant_question_count   = EXCLUDED.relevant_question_count,
      mastery_term              = EXCLUDED.mastery_term,
      fl1_score                 = EXCLUDED.fl1_score,
      fl2_score                 = EXCLUDED.fl2_score,
      fl_count_used             = EXCLUDED.fl_count_used,
      blend_denominator         = EXCLUDED.blend_denominator,
      projection_constants_hash = EXCLUDED.projection_constants_hash,
      mastery_model_version     = EXCLUDED.mastery_model_version,
      computed_at               = EXCLUDED.computed_at,
      refreshed_at_t_now        = EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  -- Append-only snapshot (Q6: this IS the projection audit trail). RB-05C-V1-02: v_result_row is a
  -- PL/pgSQL record variable, NOT a relation — insert via a VALUES list of its fields, never
  -- `FROM v_result_row`.
  INSERT INTO public.student_section_projection_snapshots (
      student_id, section,
      projected_score_mid, projected_score_low, projected_score_high,
      range_width, relevant_question_count,
      mastery_term, fl1_score, fl2_score, fl_count_used,
      blend_denominator,
      projection_constants_hash, mastery_model_version,
      snapshot_at, refreshed_at_t_now
  )
  VALUES (
      v_result_row.student_id,
      v_result_row.section,
      v_result_row.projected_score_mid,
      v_result_row.projected_score_low,
      v_result_row.projected_score_high,
      v_result_row.range_width,
      v_result_row.relevant_question_count,
      v_result_row.mastery_term,
      v_result_row.fl1_score,
      v_result_row.fl2_score,
      v_result_row.fl_count_used,
      v_result_row.blend_denominator,
      v_result_row.projection_constants_hash,
      v_result_row.mastery_model_version,
      now(),
      v_result_row.refreshed_at_t_now
  );

  RETURN v_result_row;
END;
$func$;

-- Cores: no table access, but keep the service_role-only surface of the functions they serve.
REVOKE ALL ON FUNCTION public.compute_mastery_core(public.mastery_event[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_mastery_core(public.mastery_event[], jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_mastery_core(public.mastery_event[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.projection_core(
  uuid, text, text[], text[], integer[], numeric[], integer, integer, integer, integer,
  integer, numeric, numeric, integer, integer, integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.projection_core(
  uuid, text, text[], text[], integer[], numeric[], integer, integer, integer, integer,
  integer, numeric, numeric, integer, integer, integer, integer, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projection_core(
  uuid, text, text[], text[], integer[], numeric[], integer, integer, integer, integer,
  integer, numeric, numeric, integer, integer, integer, integer, jsonb) TO service_role;

COMMIT;
