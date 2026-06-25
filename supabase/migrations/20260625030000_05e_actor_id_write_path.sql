-- ============================================================================
-- PR-5b: actor_id write-path stamping (Doc 05E §8 step 2)
-- ============================================================================
-- @spec [Doc-05E §8 step 2, INV-05E-03/06 | SCL-010/SCL-011]
-- @implemented [2026-06-25]
-- ADDITIVE-ONLY changes to apply_mastery_event and refresh_domain_mastery:
--   1. Declare v_actor_id uuid
--   2. SELECT profiles.actor_id INTO v_actor_id (after validation, before audit)
--   3. RAISE if NULL (MASTERY_EVENT_NO_ACTOR_ID)
--   4. Stamp actor_id in the audit INSERT
-- NO other logic changes. GUC stamping, deadlock fixes, seam guards, chain
-- behavior are UNTOUCHED. LYCEON-MIGRATION-REVIEWED

-- ============================================================================
-- apply_mastery_event — additive actor_id stamping
-- ============================================================================
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
  p_question_id       text,
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
  v_event_present integer;   -- self-enforcing seam guard (LC-D1-001); LYCEON-MIGRATION-REVIEWED
  v_actor_id uuid;           -- 05E §8 step 2: decoupled synthetic identifier for audit stamping
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

  -- 05E §8 step 2: look up the decoupled actor_id for audit stamping.
  -- RAISE if NULL — profile must have actor_id assigned at creation (PR-5a substrate).
  SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_student_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MASTERY_EVENT_NO_ACTOR_ID: profile % has no actor_id', p_student_id;
  END IF;

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

  -- SELF-ENFORCING SEAM (LC-D1-001): the triggering event MUST be durably derived in the
  -- production canonical_mastery_events for THIS entity before any mastery/audit write. This
  -- makes the RPC defend the insert-then-call ordering law (Doc 05A §4.1 / RB-05A-V1-08 /
  -- seam §3 HALT-2) at its OWN boundary — a caller that splits the transaction, never inserted
  -- the answer, or supplies a stale/foreign event_id is REFUSED here (no torn write), regardless
  -- of caller-transaction discipline. The spec's seam is caller-owned-insert + RPC-re-derive
  -- (NOT a single DB-owned insert+apply), so the durable-derivation assertion is the correct
  -- self-enforcement. exactly-once: event_id is the answer-row PK (unique per source table). LYCEON-MIGRATION-REVIEWED
  SELECT count(*) INTO v_event_present
  FROM public.canonical_mastery_events(p_student_id, 'skill', p_section, p_domain, p_skill) ce
  WHERE ce.event_id = p_event_id AND ce.event_source_kind = p_event_source_kind;
  IF v_event_present <> 1 THEN
    RAISE EXCEPTION 'MASTERY_EVENT_NOT_DERIVED: (%, %) not derivable exactly once in canonical_mastery_events for (%, %, %, %) [found %] — answer must be durably inserted before apply_mastery_event',
      p_event_source_kind, p_event_id, p_student_id, p_section, p_domain, p_skill, v_event_present;
  END IF;

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
    -- applied_at listed explicitly with now() per §4.8 verbatim (not relying on the DEFAULT). LYCEON-MIGRATION-REVIEWED
    INSERT INTO public.mastery_event_audit_log
      (student_id, section, domain, skill, source_family, event_source_kind, event_id, question_id,
       difficulty, correct, occurred_at, mastery_score_before, mastery_score_after,
       mastery_level_before, mastery_level_after, event_count_after, constants_snapshot_hash, mastery_model_version,
       actor_id, applied_at)
    VALUES
      (p_student_id, p_section, p_domain, p_skill, p_source_family, p_event_source_kind, p_event_id, p_question_id,
       p_difficulty, p_correct, p_occurred_at, v_before_score, v_score,
       v_before_level, v_level, v_total, v_constants_hash, v_active_version,
       v_actor_id, now());
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_result_row FROM public.student_skill_mastery
    WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;
    RETURN v_result_row;
  END;

  -- §4.9 downstream chain (AM-3 RETIRED — 05B/05C wave). In this SAME transaction: refresh domain
  -- mastery (which fans out to the 4 KPI refreshers, Doc 05B §4.9), then run the 05C-owned
  -- projection-refresh throttle (Doc 05C §8.4 — fires compute_section_projection on the every-Nth
  -- event, else just increments the counter). Any failure rolls back the WHOLE event (Parent §7.8):
  -- skill + domain + 4 KPI + (throttled) projection are one atomic unit, or none. LYCEON-MIGRATION-REVIEWED
  --
  -- Q2 FIX: set GUC provenance BEFORE refresh_domain_mastery so the audit row records
  -- triggered_by = 'event' (Doc 05D §4.2 constraint). Previously NULL (GUC was never set). LYCEON-MIGRATION-REVIEWED
  SET LOCAL app.mastery_refresh_trigger = 'event';
  PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);
  PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);

  -- §4.10 return
  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) TO service_role;

-- ============================================================================
-- refresh_domain_mastery — additive actor_id stamping
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_domain_mastery(
  p_student_id  uuid,
  p_section     text,
  p_domain      text
) RETURNS public.student_domain_mastery
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_constants              jsonb;
  v_constants_hash         text;
  v_active_version         text;
  v_before_score           numeric;
  v_before_level           smallint;
  v_total_events           integer;
  v_acc_test               numeric;
  v_acc_practice           numeric;
  v_acc_review             numeric;
  v_mastery_score          numeric;
  v_mastery_pct            numeric;
  v_mastery_level          smallint;
  v_last_event_id          uuid;          -- RB-05B-V1-08
  v_last_event_occurred_at timestamptz;   -- RB-05B-V1-08
  v_result_row             public.student_domain_mastery;
  v_actor_id               uuid;          -- 05E §8 step 2: decoupled synthetic identifier for audit stamping
BEGIN
  -- §4.2 Step 1: required fields
  IF p_student_id IS NULL OR p_section IS NULL OR p_domain IS NULL THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: required field is NULL (student=%, section=%, domain=%)', p_student_id, p_section, p_domain;
  END IF;
  -- §4.2 Step 2: section enum
  IF p_section NOT IN ('M','RW') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: section %', p_section;
  END IF;
  -- §4.2 Step 2 + Step 3: domain canonicality is BLOCKING in 05B; (section, domain) pair valid
  -- per Parent §10.2. Cross-section domain -> DOMAIN_SECTION_MISMATCH.
  IF p_section = 'M' AND p_domain NOT IN
       ('Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry') THEN
    RAISE EXCEPTION 'DOMAIN_SECTION_MISMATCH: domain % is not a canonical M domain', p_domain;
  END IF;
  IF p_section = 'RW' AND p_domain NOT IN
       ('Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions') THEN
    RAISE EXCEPTION 'DOMAIN_SECTION_MISMATCH: domain % is not a canonical RW domain', p_domain;
  END IF;

  -- 05E §8 step 2: look up the decoupled actor_id for audit stamping.
  SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_student_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MASTERY_EVENT_NO_ACTOR_ID: profile % has no actor_id', p_student_id;
  END IF;

  -- §4.3 student-domain advisory transaction lock (prefix 'mastery_domain|' — cannot collide
  -- with 05A's 'mastery_event|' or the student-skill lock).
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtext('mastery_domain|' || p_student_id::text || '|' || p_section || '|' || p_domain)
    );
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: could not acquire student-domain advisory lock for (%, %, %) within 5 seconds',
      p_student_id, p_section, p_domain;
  END;

  -- §4.4 constants + snapshot hash (pgcrypto in extensions schema, genesis; same as 05A §4.5).
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex');
  v_active_version := v_constants->>'mastery_model_version';

  -- §4.5 compute domain mastery via the SHARED formula function (INV-05B-13 / INV-05A-11): the
  -- ONLY mastery computation in 05B. entity_type='domain', p_skill=NULL — aggregates events over
  -- ALL skills in the domain. NOT a roll-up of student_skill_mastery.
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total_events, v_acc_test, v_acc_practice, v_acc_review, v_mastery_score, v_mastery_pct, v_mastery_level
  FROM public.compute_mastery_for_entity(
    p_student_id  => p_student_id,
    p_entity_type => 'domain',
    p_section     => p_section,
    p_domain      => p_domain,
    p_skill       => NULL
  );

  -- §4.6 capture before-state under the lock (NULL on first refresh — correct audit value).
  SELECT mastery_score, mastery_level INTO v_before_score, v_before_level
  FROM public.student_domain_mastery
  WHERE student_id = p_student_id AND section = p_section AND domain = p_domain;

  -- §4.7 RB-05B-V1-08: capture argmax(occurred_at) event in this domain (audit anchor; position 1
  -- of the formula). Purely derived — NULL on cold start. (occurred_at DESC, event_id DESC).
  SELECT cme.event_id, cme.occurred_at INTO v_last_event_id, v_last_event_occurred_at
  FROM public.canonical_mastery_events(p_student_id, 'domain', p_section, p_domain, NULL) cme
  ORDER BY cme.occurred_at DESC, cme.event_id DESC
  LIMIT 1;

  -- §4.7 upsert the domain mastery row
  INSERT INTO public.student_domain_mastery (
    student_id, section, domain,
    mastery_score, mastery_pct, mastery_level,
    acc_test, acc_practice, acc_review,
    event_count_total, mastery_model_version, constants_snapshot_hash, computed_at,
    last_event_id, last_event_occurred_at
  ) VALUES (
    p_student_id, p_section, p_domain,
    v_mastery_score, v_mastery_pct, v_mastery_level,
    v_acc_test, v_acc_practice, v_acc_review,
    v_total_events, v_active_version, v_constants_hash, now(),
    v_last_event_id, v_last_event_occurred_at
  )
  ON CONFLICT (student_id, section, domain) DO UPDATE SET
    mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
    acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
    event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
    constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, computed_at=EXCLUDED.computed_at,
    last_event_id=EXCLUDED.last_event_id, last_event_occurred_at=EXCLUDED.last_event_occurred_at
  RETURNING * INTO v_result_row;

  -- §4.8 audit row — one per domain refresh (mastery_domain_refresh_audit_log; see header note).
  INSERT INTO public.mastery_domain_refresh_audit_log (
    audit_row_id, student_id, section, domain,
    mastery_score_before, mastery_score_after, mastery_level_before, mastery_level_after,
    event_count_after, constants_snapshot_hash, mastery_model_version, triggered_by,
    actor_id, applied_at
  ) VALUES (
    gen_random_uuid(), p_student_id, p_section, p_domain,
    v_before_score, v_mastery_score, v_before_level, v_mastery_level,
    v_total_events, v_constants_hash, v_active_version,
    current_setting('app.mastery_refresh_trigger', true),
    v_actor_id, now()
  );

  -- §4.9 downstream KPI refreshes — all four, SAME transaction (§2.3 / §8.1). Any failure rolls
  -- back the whole chain.
  PERFORM public.refresh_section_kpi(p_student_id, p_section);
  PERFORM public.refresh_domain_kpi(p_student_id, p_section, p_domain);
  PERFORM public.refresh_skill_kpi(p_student_id, p_section, p_domain);
  PERFORM public.refresh_overall_kpi(p_student_id);

  -- §4.10 return
  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_domain_mastery(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_domain_mastery(uuid, text, text) TO service_role;
