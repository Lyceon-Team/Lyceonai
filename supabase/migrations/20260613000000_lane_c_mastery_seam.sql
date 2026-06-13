-- ============================================================================
-- Lane C — Production mastery seam wiring (practice + review) — Doc 05A §4 / §6.2
-- ============================================================================
-- @spec [Doc-05A_V1 §4 (apply_mastery_event) / §6.2 (canonical_mastery_events)]
--   [Doc-05 Parent §6/§7.8] [seam contract §1/§2/§3/§5]
-- @implemented [2026-06-13]
-- plain English: the live event→mastery seam. canonical_mastery_events derives the uniform
--   event stream from WS-2's canonical answer tables (practice_session_items[answered] +
--   review_error_attempts), replacing the parity harness's fixture stand-in. apply_mastery_event
--   is the single SECURITY DEFINER RPC that, in the caller's transaction (answer row inserted
--   first), re-derives skill mastery via compute_mastery_for_entity, upserts student_skill_mastery,
--   writes the audit row, and is idempotent on (event_source_kind, event_id).
-- @adaptation A3/SP-22: Doc 05A §6.2 example reads the Wave-1 fossil practice_attempts_v0; the
--   canonical practice answer table is practice_session_items (Doc 02B §8 / frozen seam §2).
-- @adaptation A4: the §6.2 test/full-length UNION branch (test_session_answers) is the Doc 04 seam
--   (WS-4) — omitted by scope (those tables do not exist yet); added when WS-4 lands.
-- @adaptation AM-3/B7: Doc 05A §4.9 downstream refresh (refresh_domain_mastery 05B →
--   refresh_section_projection 05C) is DEFERRED (TODO(05B/05C)) — symmetric with the
--   Codex-accepted recompute_skill_mastery TODO(05B); skill tier + audit written live.
--
-- OWNER-RUN: tracked pipeline; genesis-extending; genesis-fresh-apply gate covers it.
-- ROLLBACK (INV-06): transactional. Revert = DROP FUNCTION apply_mastery_event, canonical_mastery_events.
--   No table changes; CREATE-only. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. canonical_mastery_events (Doc 05A §6.2) — production derivation over WS-2 tables.
--    practice (answered items) + review (every attempt). No test branch (WS-4 / A4).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_mastery_events(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Practice events: canonical table practice_session_items (Doc 02B §8 / seam §2; NOT the
  -- fossil practice_attempts_v0 — A3/SP-22). Mastery-bearing = answered items only; pending/
  -- served/skipped are not mastery events (their seam columns are unpopulated by design).
  SELECT
    pi.id                       AS event_id,
    'practice_attempt'::text    AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    pi.occurred_at              AS occurred_at,
    pi.question_id              AS question_id
  FROM public.practice_session_items pi
  WHERE pi.user_id = p_student_id
    AND pi.status  = 'answered'
    AND pi.question_section = p_section
    AND pi.question_domain  = p_domain
    AND (p_entity_type = 'domain' OR pi.question_skill = p_skill)
  -- NOTE (RB-05A-V1-17): no difficulty filter — invalid rows must reach compute_mastery_for_entity's
  -- validation block so it raises MASTERY_HISTORICAL_DATA_INVALID rather than silently excluding them.

  UNION ALL

  -- Review events: review_error_attempts. Every row is an attempt (fires on correct AND incorrect,
  -- H7). Seam columns are first-class; used_tutor is telemetry-only (never read here).
  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section    = p_section
    AND ra.domain     = p_domain
    AND (p_entity_type = 'domain' OR ra.skill = p_skill);
$$;

REVOKE ALL ON FUNCTION public.canonical_mastery_events(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_mastery_events(uuid, text, text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. apply_mastery_event (Doc 05A §4, VERBATIM-faithful) — the single mastery write entry point.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_mastery_event(
  p_student_id        uuid,
  p_section           text,
  p_domain            text,
  p_skill             text,
  p_difficulty        smallint,
  p_source_family     text,
  p_event_source_kind text,
  p_correct           boolean,
  p_occurred_at       timestamptz,
  p_event_id          uuid,
  p_question_id       text,        -- canonical SAT id (AM-2 / SP-21)
  p_section_state     text DEFAULT NULL
) RETURNS public.student_skill_mastery
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_constants jsonb; v_constants_hash text; v_active_version text;
  v_existing_audit uuid;
  v_before_score numeric; v_before_level smallint;
  v_total integer; v_acc_test numeric; v_acc_practice numeric; v_acc_review numeric;
  v_score numeric; v_pct numeric; v_level smallint;
  v_result_row public.student_skill_mastery;
  v_expected_family text;
BEGIN
  -- §4.2 Step 1: required fields
  IF p_student_id IS NULL OR p_section IS NULL OR p_domain IS NULL OR p_skill IS NULL
     OR p_difficulty IS NULL OR p_source_family IS NULL OR p_event_source_kind IS NULL
     OR p_correct IS NULL OR p_occurred_at IS NULL OR p_event_id IS NULL OR p_question_id IS NULL THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: required field is NULL';
  END IF;
  -- §4.2 Step 2: enums
  IF p_section NOT IN ('M','RW') THEN RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: section %', p_section; END IF;
  IF p_difficulty NOT IN (1,2,3) THEN RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: difficulty %', p_difficulty; END IF;
  IF p_source_family NOT IN ('practice','review','test') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: source_family %', p_source_family; END IF;
  IF p_event_source_kind NOT IN ('practice_attempt','diagnostic_attempt','review_error_attempt','full_length_answer') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: event_source_kind %', p_event_source_kind; END IF;
  -- §4.2 Step 2: (event_source_kind -> source_family) mapping
  v_expected_family := CASE p_event_source_kind
    WHEN 'practice_attempt'     THEN 'practice'
    WHEN 'diagnostic_attempt'   THEN 'practice'   -- §11.4: diagnostics are regular practice events
    WHEN 'review_error_attempt' THEN 'review'
    WHEN 'full_length_answer'   THEN 'test'
  END;
  IF v_expected_family IS DISTINCT FROM p_source_family THEN
    RAISE EXCEPTION 'MASTERY_SOURCE_KIND_FAMILY_MISMATCH: % maps to %, not %',
      p_event_source_kind, v_expected_family, p_source_family;
  END IF;
  -- §4.2 Step 3: cross-field consistency
  IF p_source_family = 'test' AND (p_section_state IS NULL OR p_section_state <> 'submitted') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: test event requires section_state=submitted';
  END IF;
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: occurred_at beyond 5-minute skew tolerance';
  END IF;
  -- §4.2 Step 4 (domain/skill canonicality): consultative, non-blocking in V1.0 — skipped.

  -- §4.3 Step 1: event-level advisory lock (serializes concurrent submissions of the SAME event)
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('mastery_event|' || p_event_source_kind || '|' || p_event_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: event-level lock (%, %)', p_event_source_kind, p_event_id;
  END;
  -- §4.3 Step 2: race-free audit lookup on (event_source_kind, event_id) — already processed -> return
  SELECT audit_row_id INTO v_existing_audit
  FROM public.mastery_event_audit_log
  WHERE event_source_kind = p_event_source_kind AND event_id = p_event_id
  LIMIT 1;
  IF v_existing_audit IS NOT NULL THEN
    SELECT * INTO v_result_row FROM public.student_skill_mastery
    WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;
    RETURN v_result_row;
  END IF;

  -- §4.4 student-skill advisory lock (serializes concurrent DIFFERENT events to the same entity)
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text||'|'||p_section||'|'||p_domain||'|'||p_skill));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: advisory lock (%, %, %, %)', p_student_id, p_section, p_domain, p_skill;
  END;

  -- §4.5 constants + snapshot hash (pgcrypto in extensions schema, genesis)
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex');
  v_active_version := v_constants->>'mastery_model_version';

  -- §4.6 compute (pure; re-derives from canonical_mastery_events visible at call time — insert-first law)
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total, v_acc_test, v_acc_practice, v_acc_review, v_score, v_pct, v_level
  FROM public.compute_mastery_for_entity(p_student_id, 'skill', p_section, p_domain, p_skill);

  -- §4.7 read before-state under the lock, then upsert
  SELECT mastery_score, mastery_level INTO v_before_score, v_before_level
  FROM public.student_skill_mastery
  WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;

  INSERT INTO public.student_skill_mastery
    (student_id, section, domain, skill, mastery_score, mastery_pct, mastery_level,
     acc_test, acc_practice, acc_review, event_count_total, mastery_model_version,
     constants_snapshot_hash, last_event_id, last_event_occurred_at, computed_at)
  VALUES
    (p_student_id, p_section, p_domain, p_skill, v_score, v_pct, v_level,
     v_acc_test, v_acc_practice, v_acc_review, v_total, v_active_version,
     v_constants_hash, p_event_id, p_occurred_at, now())
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
     mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
     acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
     event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
     constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, last_event_id=EXCLUDED.last_event_id,
     last_event_occurred_at=EXCLUDED.last_event_occurred_at, computed_at=EXCLUDED.computed_at
  RETURNING * INTO v_result_row;

  -- §4.8 audit insert; unique_violation -> race-completed idempotent re-entry (§4.11 / RB-05A-V1-01)
  BEGIN
    INSERT INTO public.mastery_event_audit_log
      (student_id, section, domain, skill, source_family, event_source_kind, event_id, question_id,
       difficulty, correct, occurred_at, mastery_score_before, mastery_score_after,
       mastery_level_before, mastery_level_after, event_count_after, constants_snapshot_hash, mastery_model_version)
    VALUES
      (p_student_id, p_section, p_domain, p_skill, p_source_family, p_event_source_kind, p_event_id, p_question_id,
       p_difficulty, p_correct, p_occurred_at, v_before_score, v_score,
       v_before_level, v_level, v_total, v_constants_hash, v_active_version);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_result_row FROM public.student_skill_mastery
    WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;
    RETURN v_result_row;
  END;

  -- §4.9 downstream refresh DEFERRED — TODO(05B/05C): refresh_domain_mastery -> refresh_section_projection.
  -- Symmetric with recompute_skill_mastery's accepted TODO(05B) (AM-3). Restored with the 05B/05C wave.

  -- §4.10 return
  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) TO service_role;

COMMIT;
