-- ============================================================================
-- E9 — exam seams: review queue, mastery, projection outbox, section scores
-- ============================================================================
-- @spec [Doc-04B_V4.3 §16.1, §5.16 (the scoring transaction commits exactly two
--        artifacts); Doc-04A_V2.2 §5.7, §13.3 (outbox, retry, dead letter)]
--       [Doc-05A §6.2 + Doc-05 Parent §6.5/§11.4 (full-length mastery events);
--        Doc-05C §5.7, §7.7, §8.3; Doc-05D §12.2, §12.3 (section-score surface,
--        projection outbox)]
--       [Doc-05F §9.4 exam-review seam (source_engine 'full_length');
--        review_queue_record (ruling 12, replay by source item)]
--       [SCL-154 seams event + 04B-over-05C ruling, SCL-155 projection outbox
--        session key, SCL-156 full-length mastery arm, SCL-157
--        full_length_section_scores, SCL-158 full-length review enqueue]
-- @implemented [2026-09-25]
--
-- plain English (owner rulings R1-R5, E9):
--   R1 Scoring stays exactly two artifacts. When exam_score_outbox_event scores
--      a completion event it enqueues ONE more outbox event for the session,
--      'test_session_scored'. That event is consumed by the same consumer in a
--      SEPARATE call (its own transaction), with the outbox's attempts / 5-strike
--      dead letter, and the sweep re-drives it. A seam failure never un-scores a
--      test and never disappears. The E5 hook emit_score_run_side_effects —
--      owned by lyceon_scoring_owner, which has no INSERT on the projection
--      outbox, so "same transaction" was never achievable — is removed.
--   R2 projection_refresh_outbox gains a nullable test_session_id with a partial
--      unique index: one row per completed session, whatever the replays. No
--      consumer (WS-4's).
--   R3 canonical_mastery_events gains one arm, over public.full_length_answer_events:
--      answered items of SUBMITTED sections, joined through test_form_items to
--      questions (domain, skill_codes[1], difficulty — the facts Doc 02 owns),
--      correctness by is_answer_correct() (the scorer's), event_id =
--      test_session_answers.last_submission_id (a uuid, unique per submission,
--      stable once the section submits), occurred_at = that submission's time.
--      Blanks are not events.
--   R4 Review enqueue: every item actually SERVED (test_session_items — the
--      routed module only) in a SUBMITTED module that is wrong ('incorrect') or
--      blank ('skipped'); source_item_id = md5('full_length:' || session || ':'
--      || section || ':' || physical module || ':' || ordinal)::uuid, so a
--      replay returns the existing row.
--   R5 full_length_section_scores (security_invoker): one row per scored
--      section of a score run; is_complete only for a completed session;
--      id = md5(score_run_id || ':' || section)::uuid (score runs are
--      insert-once, so the id never moves).
--
-- The anonymised student (E6b): a score can land with student_id NULL (a
--   session finalised after its student was anonymised). The seams re-read
--   test_sessions.student_id WHEN THEY RUN (never from the event payload) and
--   skip review, mastery and the projection row when it is NULL or the profile
--   is gone, recording outcome 'skipped_no_student' on the event's `result`.
--   The score still computes; full_length_section_scores excludes NULL rows.
--
-- OWNER-RUN: tracked pipeline. Sorts before 20261001000000.
-- ROLLBACK (INV-06): transactional; there is no data to migrate (production has
--   0 score runs). Reverting = re-apply 20260806000000's
--   canonical_mastery_events, 20260930070000's exam_score_outbox_event and
--   20260930080000's score_test_session_from_outbox; re-create
--   emit_score_run_side_effects from 20260930040000; DROP FUNCTION
--   exam_apply_scored_seams; DROP VIEW full_length_section_scores,
--   full_length_answer_events; DROP INDEX uq_projection_refresh_outbox_session;
--   ALTER TABLE projection_refresh_outbox DROP COLUMN test_session_id;
--   ALTER TABLE exam_runtime_outbox DROP COLUMN result and restore its
--   event_type CHECK; DROP INDEX uq_exam_runtime_outbox_scored.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The outbox carries the seams event (R1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.exam_runtime_outbox
  DROP CONSTRAINT exam_runtime_outbox_event_type_check,
  ADD CONSTRAINT exam_runtime_outbox_event_type_check CHECK (event_type IN (
    'test_session_completed',
    'test_session_partial_scored_abandoned',
    'test_session_scored'));

-- What a consumed event did (the seams write their outcome here, including
-- 'skipped_no_student'). NULL for scoring events, which record in score_runs.
ALTER TABLE public.exam_runtime_outbox ADD COLUMN result jsonb NULL;

-- One seams event per session, however many times scoring is replayed.
CREATE UNIQUE INDEX uq_exam_runtime_outbox_scored
  ON public.exam_runtime_outbox (aggregate_id)
  WHERE event_type = 'test_session_scored';

-- ---------------------------------------------------------------------------
-- 2. projection_refresh_outbox: one row per completed session (R2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.projection_refresh_outbox ADD COLUMN test_session_id uuid NULL;
COMMENT ON COLUMN public.projection_refresh_outbox.test_session_id IS
  'E9 / SCL-155: the completed full-length session this refresh was requested for. No FK: queue state, like exam_runtime_outbox.aggregate_id; the row leaves with the student (deletion cascade, student_id).';
CREATE UNIQUE INDEX uq_projection_refresh_outbox_session
  ON public.projection_refresh_outbox (test_session_id)
  WHERE test_session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. full_length_answer_events — the one definition of a full-length mastery
--    event (R3); canonical_mastery_events and the seams both read it
-- ---------------------------------------------------------------------------
CREATE VIEW public.full_length_answer_events
WITH (security_invoker = true) AS
SELECT
  s.student_id,
  a.test_session_id,
  a.last_submission_id                          AS event_id,
  'full_length_answer'::text                    AS event_source_kind,
  'test'::text                                  AS source_family,
  a.section,
  q.domain,
  q.skill_codes[1]                              AS skill,
  q.difficulty::smallint                        AS difficulty,
  public.is_answer_correct(a.answer, a.question_id) AS correct,
  sub.created_at                                AS occurred_at,
  a.question_id
FROM public.test_session_answers a
JOIN public.test_sessions s            ON s.id = a.test_session_id
JOIN public.test_session_sections sec  ON sec.test_session_id = a.test_session_id
                                      AND sec.section = a.section
JOIN public.test_form_items fi         ON fi.test_form_id = s.test_form_id
                                      AND fi.section = a.section
                                      AND fi.module = a.module
                                      AND fi.ordinal = a.ordinal
                                      AND fi.question_id = a.question_id
JOIN public.questions q                ON q.id = fi.question_id
JOIN public.test_answer_submissions sub ON sub.id = a.last_submission_id
WHERE sec.state = 'submitted'          -- the section is submitted: answers are final
  AND a.answer IS NOT NULL             -- a blank is not an observed event
  AND s.student_id IS NOT NULL;        -- no student, nothing to teach (E6b)
COMMENT ON VIEW public.full_length_answer_events IS
  'E9 / SCL-156: one row per answered item of a SUBMITTED exam section — the full-length mastery event (family test, kind full_length_answer). event_id = last_submission_id (stable once the section submits). Domain/skill/difficulty from questions via test_form_items (Doc 02 owns them; no denormalised copy). Blanks and unsubmitted sections produce no row.';
REVOKE ALL ON public.full_length_answer_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.full_length_answer_events TO service_role;

-- ---------------------------------------------------------------------------
-- 4. full_length_section_scores — the 05C §5.7 / 05D §12.2 surface (R5)
-- ---------------------------------------------------------------------------
CREATE VIEW public.full_length_section_scores
WITH (security_invoker = true) AS
SELECT
  s.student_id,
  x.section,
  x.scaled                               AS section_scaled_score,
  (s.state = 'completed')                AS is_complete,
  s.completed_at,
  md5(r.id::text || ':' || x.section)::uuid AS id
FROM public.score_runs r
JOIN public.test_sessions s ON s.id = r.test_session_id
CROSS JOIN LATERAL (VALUES ('RW', r.rw_scored,   r.rw_scaled),
                           ('M',  r.math_scored, r.math_scaled)) AS x(section, scored, scaled)
WHERE x.scored
  AND s.student_id IS NOT NULL;
COMMENT ON VIEW public.full_length_section_scores IS
  'E9 / SCL-157: one row per SCORED section of a score run (05D §12.2 columns, 05C §5.7 order). is_complete = the session completed (a partial session''s scored section is present with false and never read by 05C). completed_at = test_sessions.completed_at. id = md5(score_run_id || '':'' || section)::uuid — score runs are insert-once, so the id never moves. Rows of a student-less (anonymised) session are excluded.';
REVOKE ALL ON public.full_length_section_scores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.full_length_section_scores TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Scoring: the E5 hook is removed (R1), nothing else changes
--    (20260930080000's body, byte-identical except the hook call)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.score_test_session_from_outbox(
  p_outbox_event_id uuid
) RETURNS uuid
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at      timestamptz := clock_timestamp();
  v_event_type      text;
  v_test_session_id uuid;
  v_test_form_id    uuid;
  v_student_id      uuid;
  v_actor_id        uuid;   -- E6b: the session's grouping id, copied onto the run
  v_score_table_ver text;
  v_existing_run_id uuid;
  v_score_run_id    uuid;

  v_rw_present   boolean := false;
  v_math_present boolean := false;
  v_rw_row       record;
  v_math_row     record;
  v_total        int;
  v_partial_display int;
BEGIN
  -- IDEMPOTENCY CHECK (§5.17 — once, at the entrypoint)
  SELECT score_run_id INTO v_existing_run_id
  FROM score_run_event_ledger
  WHERE outbox_event_id = p_outbox_event_id;

  IF FOUND THEN
    RAISE LOG '%', jsonb_build_object(
      'event', 'scoring.session.scored',
      'score_run_id', v_existing_run_id,
      'source_outbox_event_id', p_outbox_event_id,
      'idempotent_return', true,
      'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000));
    RETURN v_existing_run_id;
  END IF;

  -- READ THE OUTBOX EVENT (04A wrote this; we consume it)
  SELECT event_type, aggregate_id
  INTO v_event_type, v_test_session_id
  FROM exam_runtime_outbox
  WHERE id = p_outbox_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox event not found: %', p_outbox_event_id;
  END IF;

  IF v_event_type NOT IN ('test_session_completed', 'test_session_partial_scored_abandoned') THEN
    RAISE EXCEPTION 'Outbox event type not handled by scoring: %', v_event_type;
  END IF;

  -- Read session metadata (D10: a missing session raises, §21.1)
  SELECT student_id, actor_id, test_form_id
  INTO v_student_id, v_actor_id, v_test_form_id
  FROM test_sessions
  WHERE id = v_test_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test session not found for outbox event %: session_id=%',
      p_outbox_event_id, v_test_session_id;
  END IF;

  SELECT score_table_version
  INTO v_score_table_ver
  FROM test_forms
  WHERE id = v_test_form_id;

  -- VERSION-VALIDATION GATE (§12.1, §19.6). Active and superseded score;
  -- candidate, missing or partially attested versions never do.
  PERFORM 1
  FROM scoring_model_versions
  WHERE version = v_score_table_ver
    AND status IN ('active', 'superseded')
    AND published_at IS NOT NULL
    AND constants_sha256 IS NOT NULL
    AND validation_packet_sha256 IS NOT NULL
    AND validation_packet_url IS NOT NULL;   -- D10: §19.6 lists the URL too

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Scoring blocked: scoring_model_version % is missing, candidate, or '
      'incompletely attested. score_runs MUST NOT be inserted for an '
      'unattested version. (Doc 04B V4.3 §12.1 + §19.6.)',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scoring_constants
    WHERE scoring_model_version = v_score_table_ver
  ) THEN
    RAISE EXCEPTION
      'Scoring blocked: no scoring_constants rows for version %',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- DETERMINE WHICH SECTIONS ARE SCOREABLE
  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'RW'
      AND state = 'submitted'
  ) INTO v_rw_present;

  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'M'
      AND state = 'submitted'
  ) INTO v_math_present;

  IF NOT v_rw_present AND NOT v_math_present THEN
    RAISE EXCEPTION 'No scoreable sections found for session %', v_test_session_id;
  END IF;

  -- COMPUTE PRESENT SECTIONS
  -- An absent section's record is still ASSIGNED, to a typed all-NULL row of
  -- compute_section_scaled_score's shape. PL/pgSQL fixes the INSERT below's plan
  -- on its first execution in a session; if that execution sees an unassigned
  -- `record` it raises "record … is not assigned yet" even inside a CASE branch
  -- that is not taken. Without this, the first partial (one-section) session a
  -- fresh connection scores fails. Found by the scoring-parity gate in CI
  -- (collation ordered a partial session first). The CASE guards stay; the NULL
  -- row only makes the structure determinate.
  IF v_rw_present THEN
    SELECT * INTO v_rw_row
    FROM compute_section_scaled_score(v_test_session_id, 'rw');
  ELSE
    SELECT NULL::int AS scaled, NULL::int AS module1_correct, NULL::int AS module2_correct,
           NULL::text AS module2_path, NULL::int AS m2_easy_wrong, NULL::int AS m2_medium_wrong,
           NULL::int AS m2_hard_wrong, NULL::numeric AS ceiling, NULL::numeric AS deduction,
           NULL::numeric AS raw_floor, NULL::numeric AS path_floor,
           NULL::numeric AS effective_floor, NULL::numeric AS s_raw
      INTO v_rw_row;
  END IF;

  IF v_math_present THEN
    SELECT * INTO v_math_row
    FROM compute_section_scaled_score(v_test_session_id, 'math');
  ELSE
    SELECT NULL::int AS scaled, NULL::int AS module1_correct, NULL::int AS module2_correct,
           NULL::text AS module2_path, NULL::int AS m2_easy_wrong, NULL::int AS m2_medium_wrong,
           NULL::int AS m2_hard_wrong, NULL::numeric AS ceiling, NULL::numeric AS deduction,
           NULL::numeric AS raw_floor, NULL::numeric AS path_floor,
           NULL::numeric AS effective_floor, NULL::numeric AS s_raw
      INTO v_math_row;
  END IF;

  -- TOTAL_SCALED / PARTIAL_DISPLAY_SCALED (§9.1, §15.2)
  IF v_rw_present AND v_math_present THEN
    v_total := v_rw_row.scaled + v_math_row.scaled;
    v_partial_display := NULL;
  ELSIF v_rw_present THEN
    v_total := NULL;
    v_partial_display := v_rw_row.scaled;
  ELSE
    v_total := NULL;
    v_partial_display := v_math_row.scaled;
  END IF;

  -- INSERT score_runs ROW (with ALL intermediate values)
  INSERT INTO score_runs (
    test_session_id, student_id, actor_id, test_form_id, scoring_model_version,
    source_outbox_event_id, source_event_type,
    rw_scored, rw_module1_correct, rw_module2_correct, rw_module2_path,
    rw_m2_easy_wrong, rw_m2_medium_wrong, rw_m2_hard_wrong,
    rw_ceiling, rw_deduction, rw_raw_floor, rw_path_floor, rw_effective_floor,
    rw_s_raw, rw_scaled,
    math_scored, math_module1_correct, math_module2_correct, math_module2_path,
    math_m2_easy_wrong, math_m2_medium_wrong, math_m2_hard_wrong,
    math_ceiling, math_deduction, math_raw_floor, math_path_floor, math_effective_floor,
    math_s_raw, math_scaled,
    total_scaled, partial_display_scaled, constants_snapshot
  ) VALUES (
    v_test_session_id, v_student_id, v_actor_id, v_test_form_id, v_score_table_ver,
    p_outbox_event_id, v_event_type,
    v_rw_present,
    CASE WHEN v_rw_present THEN v_rw_row.module1_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_path END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_easy_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_medium_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_hard_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.ceiling END,
    CASE WHEN v_rw_present THEN v_rw_row.deduction END,
    CASE WHEN v_rw_present THEN v_rw_row.raw_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.path_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.effective_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.s_raw END,
    CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    v_math_present,
    CASE WHEN v_math_present THEN v_math_row.module1_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_path END,
    CASE WHEN v_math_present THEN v_math_row.m2_easy_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_medium_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_hard_wrong END,
    CASE WHEN v_math_present THEN v_math_row.ceiling END,
    CASE WHEN v_math_present THEN v_math_row.deduction END,
    CASE WHEN v_math_present THEN v_math_row.raw_floor END,
    CASE WHEN v_math_present THEN v_math_row.path_floor END,
    CASE WHEN v_math_present THEN v_math_row.effective_floor END,
    CASE WHEN v_math_present THEN v_math_row.s_raw END,
    CASE WHEN v_math_present THEN v_math_row.scaled END,
    v_total, v_partial_display,
    scoring_constants_snapshot_jsonb(v_score_table_ver)
  ) RETURNING id INTO v_score_run_id;

  -- WRITE THE LEDGER ENTRY (idempotency anchor)
  INSERT INTO score_run_event_ledger (outbox_event_id, score_run_id, test_session_id)
  VALUES (p_outbox_event_id, v_score_run_id, v_test_session_id);

  -- E9 (SCL owner ruling R1): no side effect here. The scored-seams event is
  -- enqueued by the consumer (exam_score_outbox_event) after this returns, and
  -- applied in its own transaction (exam_apply_scored_seams). §16.1: exactly
  -- two artifacts.

  -- §20.1 structured log — UUIDs and scaled values only (§20.4)
  RAISE LOG '%', jsonb_build_object(
    'event', 'scoring.session.scored',
    'score_run_id', v_score_run_id,
    'test_session_id', v_test_session_id,
    'student_id', v_student_id,
    'test_form_id', v_test_form_id,
    'scoring_model_version', v_score_table_ver,
    'source_outbox_event_id', p_outbox_event_id,
    'source_event_type', v_event_type,
    'rw_scored', v_rw_present,
    'math_scored', v_math_present,
    'rw_scaled', CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    'math_scaled', CASE WHEN v_math_present THEN v_math_row.scaled END,
    'total_scaled', v_total,
    'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000),
    'idempotent_return', false);

  RETURN v_score_run_id;
END;
$$;

DROP FUNCTION public.emit_score_run_side_effects(uuid);

-- ---------------------------------------------------------------------------
-- 6. canonical_mastery_events + the full-length arm (R3). The function is
--    20260806000000's byte for byte plus one UNION ALL arm.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_mastery_events(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Practice + diagnostic events: canonical table practice_session_items (Doc 02B §8 / seam §2).
  -- Diagnostic items are stored identically to practice items (Doc 05A §11.4); the session's
  -- mode column discriminates the event_source_kind for the mastery seam guard.
  SELECT
    pi.id                       AS event_id,
    public.practice_session_mode_to_event_kind(ps.mode)
                                AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    pi.occurred_at              AS occurred_at,
    pi.question_id              AS question_id
  FROM public.practice_session_items pi
  JOIN public.practice_sessions ps ON ps.id = pi.session_id
  WHERE pi.user_id = p_student_id
    AND pi.status  = 'answered'
    AND pi.question_section = p_section
    AND pi.question_domain  = p_domain
    AND (p_entity_type = 'domain' OR pi.question_skill = p_skill)
  -- NOTE (RB-05A-V1-17): no difficulty filter — invalid rows must reach compute_mastery_for_entity's
  -- validation block so it raises MASTERY_HISTORICAL_DATA_INVALID rather than silently excluding them.

  UNION ALL

  -- Review events: review_error_attempts (unchanged).
  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section    = p_section
    AND ra.domain     = p_domain
    AND (p_entity_type = 'domain' OR ra.skill = p_skill)

  UNION ALL

  -- Full-length events (E9, SCL owner ruling R3): answered items of SUBMITTED
  -- sections only, from public.full_length_answer_events (exam answers joined
  -- through test_form_items to questions). An unsubmitted section yields no
  -- row, so apply_mastery_event raises MASTERY_EVENT_NOT_DERIVED for it
  -- whatever section_state the caller claims.
  SELECT
    fe.event_id, fe.event_source_kind, fe.source_family,
    fe.section, fe.domain, fe.skill, fe.difficulty,
    fe.correct, fe.occurred_at, fe.question_id
  FROM public.full_length_answer_events fe
  WHERE fe.student_id = p_student_id
    AND fe.section    = p_section
    AND fe.domain     = p_domain
    AND (p_entity_type = 'domain' OR fe.skill = p_skill);
$$;
-- ---------------------------------------------------------------------------
-- 7. The seams (R1-R4), for one 'test_session_scored' event
-- @spec [SCL-154, SCL-155, SCL-156, SCL-158; Doc-05 Parent §6.5]
-- plain English: re-reads the session's student NOW. None (anonymised or
--   deleted since scoring) -> nothing written, outcome 'skipped_no_student'.
--   Otherwise, in this order:
--     review   every served item of a submitted module that is wrong or blank
--              -> review_queue_record (replay returns the existing row);
--     mastery  every row of full_length_answer_events for the session
--              -> apply_mastery_event (idempotent on (kind, event_id));
--     project  a completed session -> one projection_refresh_outbox row.
--   Every step is idempotent, so the whole call is: a retry after a failure,
--   or a replay of a published event, writes nothing twice.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_apply_scored_seams(p_outbox_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_ev      exam_runtime_outbox%ROWTYPE;
  v_run     score_runs%ROWTYPE;
  v_s       test_sessions%ROWTYPE;
  v_at      timestamptz;
  v_review  int := 0;
  v_mastery int := 0;
  v_proj    int := 0;
  it        record;
BEGIN
  SELECT * INTO v_ev FROM exam_runtime_outbox
   WHERE id = p_outbox_event_id AND event_type = 'test_session_scored';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_SEAMS_EVENT_NOT_FOUND: %', p_outbox_event_id;
  END IF;

  SELECT * INTO v_run FROM score_runs WHERE id = (v_ev.payload ->> 'score_run_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_SEAMS_SCORE_RUN_NOT_FOUND: %', v_ev.payload ->> 'score_run_id';
  END IF;
  SELECT * INTO v_s FROM test_sessions WHERE id = v_run.test_session_id;

  -- E6b: identity is read when the seams run, never carried in the payload.
  IF v_s.student_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_s.student_id) THEN
    RETURN jsonb_build_object('outcome', 'skipped_no_student',
                              'review_enqueued', 0, 'mastery_applied', 0, 'projection_outbox', 0);
  END IF;

  v_at := COALESCE(v_s.completed_at, v_s.abandoned_at, v_run.computed_at);

  -- R4 — review: served items of submitted modules, wrong or blank.
  FOR it IN
    SELECT i.section, i.module, i.ordinal, i.question_id, a.answer
      FROM test_session_items i
      JOIN test_session_sections sec
        ON sec.test_session_id = i.test_session_id AND sec.section = i.section
      LEFT JOIN test_session_answers a
        ON a.test_session_id = i.test_session_id AND a.section = i.section
       AND a.module = i.module AND a.ordinal = i.ordinal
     WHERE i.test_session_id = v_s.id
       AND (   (i.module = '1' AND sec.state IN ('module1_submitted', 'module2_active', 'submitted'))
            OR (i.module <> '1' AND sec.state = 'submitted'))
       AND NOT is_answer_correct(a.answer, i.question_id)
     ORDER BY CASE i.section WHEN 'RW' THEN 1 ELSE 2 END, i.module, i.ordinal
  LOOP
    PERFORM review_queue_record(
      v_s.student_id, it.question_id, 'full_length', v_s.id,
      md5('full_length:' || v_s.id::text || ':' || it.section || ':' || it.module || ':' || it.ordinal::text)::uuid,
      CASE WHEN it.answer IS NULL OR btrim(it.answer) = '' THEN 'skipped' ELSE 'incorrect' END,
      v_at);
    v_review := v_review + 1;
  END LOOP;

  -- R3 — mastery: the answered items of submitted sections.
  FOR it IN
    SELECT * FROM full_length_answer_events fe
     WHERE fe.test_session_id = v_s.id
     ORDER BY fe.occurred_at, fe.event_id
  LOOP
    PERFORM apply_mastery_event(
      v_s.student_id, it.section, it.domain, it.skill, it.difficulty,
      it.source_family, it.event_source_kind, it.correct, it.occurred_at,
      it.event_id, it.question_id, 'submitted');
    v_mastery := v_mastery + 1;
  END LOOP;

  -- R2 — projection refresh request: a COMPLETED session only.
  IF v_s.state = 'completed' THEN
    INSERT INTO projection_refresh_outbox (student_id, reason, test_session_id)
    VALUES (v_s.student_id, 'full_length_completed', v_s.id)
    ON CONFLICT (test_session_id) WHERE test_session_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_proj = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('outcome', 'applied',
                            'review_enqueued', v_review,
                            'mastery_applied', v_mastery,
                            'projection_outbox', v_proj);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. The consumer: scoring events score, then enqueue the seams event; seams
--    events apply the seams. Same failure bookkeeping for both (§5.7).
-- @spec [Doc-04A_V2.2 §13.3, §5.7; E6 R5 / SCL-136; SCL-154]
-- plain English: 20260930070000's function plus a dispatch on event_type. A
--   scored completion enqueues exactly one 'test_session_scored' event for the
--   session (ON CONFLICT on uq_exam_runtime_outbox_scored) and returns its id
--   as `followup_outbox_id`; the API consumes it in a SEPARATE call, so the
--   seams never share a transaction with the scorer. A seams failure is
--   recorded on the seams event (attempts, failure_reason, 'failed' after 5)
--   — the score it follows is already committed and untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_score_outbox_event(p_outbox_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_type    text;
  v_run     uuid;
  v_session uuid;
  v_follow  uuid;
  v_res     jsonb;
  v_state   text;
  v_msg     text;
BEGIN
  SELECT event_type INTO v_type FROM exam_runtime_outbox WHERE id = p_outbox_event_id;

  BEGIN
    IF v_type = 'test_session_scored' THEN
      v_res := exam_apply_scored_seams(p_outbox_event_id);
    ELSE
      v_run := score_test_session_from_outbox(p_outbox_event_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    UPDATE exam_runtime_outbox
       SET attempts = attempts + 1,
           last_attempt_at = clock_timestamp(),
           failure_reason = left(v_state || ': ' || v_msg, 500),
           status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
     WHERE id = p_outbox_event_id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state);
  END;

  IF v_type = 'test_session_scored' THEN
    UPDATE exam_runtime_outbox
       SET status = 'published', published_at = clock_timestamp(), result = v_res,
           attempts = attempts + 1, last_attempt_at = clock_timestamp(), failure_reason = NULL
     WHERE id = p_outbox_event_id AND status = 'pending';
    RETURN jsonb_build_object('ok', true, 'seams', v_res);
  END IF;

  -- The score is committed with this transaction; the seams run in the next.
  SELECT test_session_id INTO v_session FROM score_runs WHERE id = v_run;
  INSERT INTO exam_runtime_outbox (event_type, aggregate_id, payload)
  VALUES ('test_session_scored', v_session,
          jsonb_build_object('score_run_id', v_run, 'source_outbox_event_id', p_outbox_event_id))
  ON CONFLICT (aggregate_id) WHERE event_type = 'test_session_scored' DO NOTHING;
  SELECT id INTO v_follow FROM exam_runtime_outbox
   WHERE aggregate_id = v_session AND event_type = 'test_session_scored';

  UPDATE exam_runtime_outbox
     SET status = 'published', published_at = clock_timestamp(),
         attempts = attempts + 1, last_attempt_at = clock_timestamp(), failure_reason = NULL
   WHERE id = p_outbox_event_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true, 'score_run_id', v_run, 'followup_outbox_id', v_follow);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants — service_role only, as every exam runtime function
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exam_apply_scored_seams(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_apply_scored_seams(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.exam_score_outbox_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_score_outbox_event(uuid) TO service_role;

COMMIT;
