-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED
--
-- 05C — the full-length blend goes live: the two most recent completed full-lengths enter the
-- score projection, and a completed full-length refreshes it immediately.
-- ============================================================================
-- @spec [Doc-05C_V1 §1, §2.1, §5.7 (States A/B/C, verbatim SQL), §6.3, §6.7 Example 1,
--        §7.7, §8.2 item 3, §8.3 (outbox consumer contract), §13.1 P1-P5, INV-05C-13;
--        SCL-157 (04B surface named: full_length_section_scores; owner ruling R2 — 05C closes
--        its own WS-4 forward-ref); SCL-154/155 (the outbox row is written by the seams event,
--        one per completed session); SCL-206 (this change)]
-- | @implemented [2026-10-03]
--
-- plain English:
--   1. compute_section_projection — the §5.7 named forward-ref is replaced by §5.7's own SQL.
--      The midpoint is the mean of the mastery term and up to the two most recent COMPLETED
--      full-length section scores (denominator 1, 2 or 3). Everything else in the body — the
--      Q4 gate, mastery term, range, hash, upsert + snapshot — is byte-identical to
--      20260613020000. Below the Q4 gate the projection stays NULL whatever exams exist
--      (INV-05C-14, Example 3); a partial/abandoned exam never counts (is_complete = false, P5);
--      a third, older exam is never read (P4).
--   2. projection_refresh_outbox_process(outbox_id) — §8.3 step 2 for ONE row: refresh both
--      sections, reset the student's throttle counter, stamp processed_at. An already-processed
--      row is a no-op (false), so at-least-once delivery is safe.
--   3. projection_refresh_outbox_drain(limit) — the backstop worker: oldest unprocessed rows
--      first, SKIP LOCKED, each row in its own subtransaction. A row whose refresh raises is
--      left unprocessed, counted in `failed`, and reported by WARNING with its SQLSTATE; the
--      rest still drain. Scheduled by pg_cron (scripts/ops/projection-refresh-outbox-cron.sql,
--      owner-run — pg_cron is platform-managed and cannot be bound in a migration).
--   4. projection_refresh_after_exam(seams_event_id) — §8.3 step 3's allowed read-through: the
--      API calls it right after the session's seams event committed, so the projection is fresh
--      before the student reaches the report. It refreshes only that session's row.
--   All three are SECURITY INVOKER and service_role-only; compute_section_projection keeps its
--   own SECURITY DEFINER and grants (CREATE OR REPLACE preserves the ACL).
--
-- trade-offs: a row that fails forever is retried on every drain (the 05C §7.7 table has no
--   attempts column and this change does not add one); at launch volume that is a WARNING per
--   run, not a backlog. Ordering ties on completed_at break on id DESC (§5.7 verbatim) — md5 ids,
--   deterministic but not chronological; two exams completed in the same instant is not a case
--   a student can produce.
--
-- ROLLBACK: re-apply compute_section_projection from 20260613020000 (State A); DROP FUNCTION
--   projection_refresh_after_exam(uuid), projection_refresh_outbox_drain(integer),
--   projection_refresh_outbox_process(bigint); unschedule the cron job. No data is written by
--   this migration.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. compute_section_projection — States A/B/C (§5.7)
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
  v_min_events        integer;
  v_gate_passed       boolean;
  v_weighted_mastery  numeric;
  v_mastery_term      numeric;
  v_fl1_score         integer;     -- most recent completed full-length, this section (§5.7)
  v_fl2_score         integer;     -- second most recent completed full-length, this section
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

  -- §5.5 evaluate the Q4 evidence gate (INV-05C-14, RB-05C-V1-01). Anti-join the canonical 8-domain
  -- set against student_domain_mastery: the gate passes iff NO required (section,domain) pair is
  -- absent or below mastery_min_events(). The required_domains VALUES set drives the gate, NOT a
  -- COUNT(*) — duplicate/extra/non-canonical rows cannot make it pass. The 8 strings are byte-
  -- identical to Parent §10.2 / PROJECTION_DOMAIN_WEIGHTS keys (RB-05C-V1-04).
  v_min_events := public.mastery_min_events();
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
      LEFT JOIN public.student_domain_mastery sdm
             ON sdm.student_id = p_student_id
            AND sdm.section    = rd.section
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
    -- [0,1] decimal from 05B's student_domain_mastery (NEVER recomputed here — INV-05C-A1).
    SELECT
        SUM(
            sdm.mastery_score
            * ((v_weights -> p_section ->> sdm.domain)::numeric)
        )
    INTO v_weighted_mastery
    FROM public.student_domain_mastery sdm
    WHERE sdm.student_id = p_student_id
      AND sdm.section    = p_section
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

    -- §5.7 resolve the full-length terms and compute the blend (INV-05C-13). The two most recent
    -- COMPLETED full-lengths for this section, by completed_at, tiebreak id desc — §5.7 verbatim,
    -- bound to the 04B surface SCL-157 named (full_length_section_scores; is_complete = the session
    -- completed, so a partial/abandoned test never contributes, P5). A third, older one is never
    -- read (P4). No staleness rule in V1.0 (Q1 State D).
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

    -- §5.8 bounded range. relevant_question_count = 05B student_section_kpi.events_total (the same
    -- evidence population 05B aggregates; 05C reads it, never recomputes the union — INV-05C-A1/A2).
    SELECT COALESCE(ssk.events_total, 0)
    INTO   v_relevant_qcount
    FROM   public.student_section_kpi ssk
    WHERE  ssk.student_id = p_student_id
      AND  ssk.section    = p_section;
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
      v_mid, v_low, v_high,
      v_range_width, v_relevant_qcount,
      v_mastery_term, v_fl1_score, v_fl2_score, v_fl_count_used,
      v_blend_denominator,
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

-- ----------------------------------------------------------------------------
-- 2. One outbox row (§8.3 step 2)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.projection_refresh_outbox_process(p_outbox_id bigint)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $func$
DECLARE
  v_row public.projection_refresh_outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.projection_refresh_outbox
   WHERE outbox_id = p_outbox_id
   FOR UPDATE;
  IF NOT FOUND OR v_row.processed_at IS NOT NULL THEN
    RETURN false;   -- unknown or already processed: a replay writes nothing
  END IF;

  PERFORM public.compute_section_projection(v_row.student_id, 'M',  now());
  PERFORM public.compute_section_projection(v_row.student_id, 'RW', now());

  -- The refresh just happened, so the throttle counter restarts (§8.3 step 2, §8.4).
  INSERT INTO public.student_projection_refresh_state (student_id, events_since_refresh, last_refresh_at)
  VALUES (v_row.student_id, 0, now())
  ON CONFLICT (student_id) DO UPDATE
     SET events_since_refresh = 0,
         last_refresh_at      = now();

  UPDATE public.projection_refresh_outbox
     SET processed_at = now()
   WHERE outbox_id = p_outbox_id;
  RETURN true;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 3. The backstop worker (§8.3 step 2; schedule owner-run via pg_cron)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.projection_refresh_outbox_drain(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $func$
DECLARE
  r        record;
  v_done   integer := 0;
  v_failed integer := 0;
  v_state  text;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'PROJECTION_DRAIN_INVALID_LIMIT: %', p_limit;
  END IF;

  FOR r IN
    SELECT o.outbox_id
      FROM public.projection_refresh_outbox o
     WHERE o.processed_at IS NULL
     ORDER BY o.requested_at, o.outbox_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF public.projection_refresh_outbox_process(r.outbox_id) THEN
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- The row stays unprocessed for the next run; the others still drain. SQLSTATE only:
      -- projection messages carry the student id.
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      RAISE WARNING 'PROJECTION_REFRESH_FAILED: outbox_id % sqlstate %', r.outbox_id, v_state;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_done, 'failed', v_failed);
END;
$func$;

-- ----------------------------------------------------------------------------
-- 4. The API's read-through for the session it just finished (§8.3 step 3)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.projection_refresh_after_exam(p_seams_outbox_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $func$
DECLARE
  v_session uuid;
  v_id      bigint;
BEGIN
  SELECT aggregate_id INTO v_session FROM public.exam_runtime_outbox
   WHERE id = p_seams_outbox_event_id
     AND event_type = 'test_session_scored'
     AND status = 'published';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'seams_not_published');
  END IF;

  SELECT outbox_id INTO v_id FROM public.projection_refresh_outbox
   WHERE test_session_id = v_session
     AND processed_at IS NULL
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    -- a partial session (no row), an anonymised student (no row), or already refreshed
    RETURN jsonb_build_object('outcome', 'nothing_pending');
  END IF;

  PERFORM public.projection_refresh_outbox_process(v_id);
  RETURN jsonb_build_object('outcome', 'refreshed');
END;
$func$;

REVOKE ALL ON FUNCTION public.projection_refresh_outbox_process(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projection_refresh_outbox_process(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.projection_refresh_outbox_drain(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projection_refresh_outbox_drain(integer) TO service_role;
REVOKE ALL ON FUNCTION public.projection_refresh_after_exam(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projection_refresh_after_exam(uuid) TO service_role;

COMMIT;
