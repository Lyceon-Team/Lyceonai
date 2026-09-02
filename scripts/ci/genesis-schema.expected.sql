--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: profile_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.profile_role AS ENUM (
    'student',
    'guardian',
    'admin',
    'tutor',
    'teacher'
);


--
-- Name: _rl_has_active_entitlement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._rl_has_active_entitlement(p_student_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'entitlement_active'
  )
  THEN
    RETURN COALESCE(public.entitlement_active(p_student_user_id), false);
  END IF;
  RETURN false;
END;
$$;


--
-- Name: _rl_resolve_student_account(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._rl_resolve_student_account(p_student_user_id uuid, p_account_id uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_account_id uuid := NULL;
BEGIN
  IF to_regclass('public.lyceon_account_members') IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT lam.account_id
    INTO v_account_id
    FROM public.lyceon_account_members lam
    WHERE lam.user_id = p_student_user_id
      AND lam.account_id = p_account_id
    LIMIT 1;
  END IF;

  IF v_account_id IS NULL THEN
    SELECT lam.account_id
    INTO v_account_id
    FROM public.lyceon_account_members lam
    WHERE lam.user_id = p_student_user_id
    ORDER BY lam.account_id ASC
    LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: student_skill_mastery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_skill_mastery (
    student_id uuid NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    skill text NOT NULL,
    mastery_score numeric(5,4),
    mastery_pct numeric(5,2),
    mastery_level smallint,
    acc_test numeric(7,6),
    acc_practice numeric(7,6),
    acc_review numeric(7,6),
    event_count_total integer DEFAULT 0 NOT NULL,
    mastery_model_version text DEFAULT 'v1.0'::text NOT NULL,
    constants_snapshot_hash text NOT NULL,
    last_event_id uuid,
    last_event_occurred_at timestamp with time zone,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_skill_mastery_event_count_total_check CHECK ((event_count_total >= 0)),
    CONSTRAINT student_skill_mastery_mastery_level_check CHECK (((mastery_level IS NULL) OR ((mastery_level >= 0) AND (mastery_level <= 4)))),
    CONSTRAINT student_skill_mastery_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamp with time zone, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_mastery_event(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamp with time zone, p_event_id uuid, p_question_id text, p_section_state text DEFAULT NULL::text) RETURNS public.student_skill_mastery
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: backfill_recompute_student(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_recompute_student(p_student_id uuid, p_t_now timestamp with time zone DEFAULT now()) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sec   text;
  v_dom   text;
  v_skl   text;
BEGIN
  -- Student-level advisory lock: serializes backfill against concurrent live events for
  -- the same student (Doc 05D §7.2). lock_timeout is generous (10s) because the backfill
  -- touches every entity for the student.
  -- @reconciliation RB-05D-PR2-01: §7.2 spec body shows lock BEFORE lock_timeout; this
  --   migration sets lock_timeout BEFORE the lock call (operationally correct — the timeout
  --   must govern the subsequent lock attempt). Matches the established pattern in
  --   apply_mastery_event §4.3/§4.4 and recompute_skill_mastery. The EXCEPTION handler is
  --   also not in the spec body but matches the same established pattern. Spec body is an
  --   editorial ordering error; the implementation is correct. LYCEON-MIGRATION-REVIEWED
  SET LOCAL lock_timeout = '10s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('backfill|' || p_student_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: backfill_recompute_student (%)', p_student_id;
  END;

  -- GUC provenance: all downstream audit rows record 'backfill_recompute' (Doc 05D §4.2).
  -- SET LOCAL scopes to this transaction — does not leak to concurrent sessions.
  SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute';

  -- STRICT DEPENDENCY ORDER (INV-05D-17): skill → domain → KPI → projection.
  -- Each step calls a sibling-owned RPC (INV-05D-A1 — 05D never reimplements a formula).

  -- 1. Skill mastery: call 05A's locked recompute_skill_mastery (RB-05D-V1-A)
  --    with p_chain_downstream := false — the backfill handles domain/KPI/projection
  --    itself in steps 2–4 with lock-order monotonicity. NOT EXISTS selection: only
  --    skills with events but no student_skill_mastery row.
  FOR v_sec, v_dom, v_skl IN
    SELECT DISTINCT e.section, e.domain, e.skill
    FROM   public.canonical_mastery_events_for_student(p_student_id) e
    WHERE  NOT EXISTS (
               SELECT 1 FROM public.student_skill_mastery sm
               WHERE  sm.student_id = p_student_id
                 AND  sm.section = e.section
                 AND  sm.domain  = e.domain
                 AND  sm.skill   = e.skill)
  LOOP
    PERFORM public.recompute_skill_mastery(
      p_student_id, v_sec, v_dom, v_skl,
      false  -- p_chain_downstream := false (deadlock prevention)
    );
  END LOOP;

  -- 2. Domain mastery: 05B's refresh_domain_mastery for every (section,domain) with
  --    events but no student_domain_mastery row. refresh_domain_mastery internally
  --    chains the 4 KPI refreshers (05B §4.9), so step 3 is partially satisfied
  --    by step 2 for the domains it touches. NOT EXISTS selection: never-computed only.
  --    SINGLE-FIRE PROOF: with p_chain_downstream=false in step 1, no domain refresh
  --    has fired yet — step 2's NOT EXISTS correctly selects all domains that need it.
  FOR v_sec, v_dom IN
    SELECT DISTINCT e.section, e.domain
    FROM   public.canonical_mastery_events_for_student(p_student_id) e
    WHERE  NOT EXISTS (
               SELECT 1 FROM public.student_domain_mastery dm
               WHERE  dm.student_id = p_student_id
                 AND  dm.section = e.section
                 AND  dm.domain  = e.domain)
  LOOP
    PERFORM public.refresh_domain_mastery(p_student_id, v_sec, v_dom);
  END LOOP;

  -- 3. KPI rollups (TERMINAL SURFACE — refreshed unconditionally, RB-05D-V1-04).
  --    refresh_domain_mastery (step 2) already chained the section/domain/skill/overall
  --    KPI refreshers per 05B §4.9 for domains it touched; this terminal refresh
  --    guarantees the four KPI surfaces reflect final derived state even when domain
  --    rows pre-existed (partial-legacy student). Deterministic upsert, not a
  --    reimplementation. p_t_now flows through for §8 determinism verification.
  PERFORM public.refresh_section_kpi(p_student_id, 'M',  p_t_now);
  PERFORM public.refresh_section_kpi(p_student_id, 'RW', p_t_now);
  PERFORM public.refresh_overall_kpi(p_student_id, p_t_now);

  -- 4. Projection (TERMINAL SURFACE — refreshed unconditionally, RB-05D-V1-04).
  --    The Q4 gate inside compute_section_projection self-protects (emits NULL
  --    projection if the 8-domain gate is not met), so calling it unconditionally
  --    is correct and deterministic. p_t_now flows through for §8 determinism.
  PERFORM public.compute_section_projection(p_student_id, 'M',  p_t_now);
  PERFORM public.compute_section_projection(p_student_id, 'RW', p_t_now);
END;
$$;


--
-- Name: bump_projection_refresh_counter(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_projection_refresh_counter(p_student_id uuid, p_section text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cnt       integer;
  v_threshold integer;
BEGIN
  -- Upsert-and-increment atomically; the row may not exist yet.
  INSERT INTO public.student_projection_refresh_state (student_id, events_since_refresh)
  VALUES (p_student_id, 1)
  ON CONFLICT (student_id) DO UPDATE
      SET events_since_refresh = student_projection_refresh_state.events_since_refresh + 1
  RETURNING events_since_refresh INTO v_cnt;

  SELECT (value #>> '{}')::integer
  INTO   v_threshold
  FROM   public.mastery_constants
  WHERE  key = 'PROJECTION_REFRESH_EVENT_THRESHOLD';

  IF v_threshold IS NULL THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_MISSING: PROJECTION_REFRESH_EVENT_THRESHOLD';
  END IF;

  IF v_cnt >= v_threshold THEN
    -- Refresh BOTH sections (the gate/range are per-section but activity may have touched either
    -- since the last refresh). p_section is intentionally not used to scope the refresh in V1.0.
    PERFORM public.compute_section_projection(p_student_id, 'M',  now());
    PERFORM public.compute_section_projection(p_student_id, 'RW', now());

    UPDATE public.student_projection_refresh_state
       SET events_since_refresh = 0,
           last_refresh_at      = now()
     WHERE student_id = p_student_id;
  END IF;
END;
$$;


--
-- Name: cancel_account_deletion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_account_deletion(p_profile_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_request_id uuid;
BEGIN
  SELECT adr.id INTO v_request_id
    FROM public.account_deletion_requests adr
   WHERE adr.profile_id = p_profile_id
     AND adr.status = 'pending'
   LIMIT 1;

  IF v_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lift the soft-delete lock first; a 23505 here aborts the whole function (both writes roll back).
  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = p_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE id = v_request_id;

  RETURN p_profile_id;
END;
$$;


--
-- Name: canonical_mastery_events(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_mastery_events(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) RETURNS TABLE(event_id uuid, event_source_kind text, source_family text, section text, domain text, skill text, difficulty smallint, correct boolean, occurred_at timestamp with time zone, question_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
    AND (p_entity_type = 'domain' OR ra.skill = p_skill);
$$;


--
-- Name: canonical_mastery_events_for_student(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_mastery_events_for_student(p_student_id uuid) RETURNS TABLE(event_id uuid, event_source_kind text, source_family text, section text, domain text, skill text, difficulty smallint, correct boolean, occurred_at timestamp with time zone, question_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
    AND pi.question_section IN ('M','RW')

  UNION ALL

  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section IN ('M','RW');
$$;


--
-- Name: canonicalize_active_mastery_constants_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_active_mastery_constants_state() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT COALESCE(string_agg(
        mc.key || '=' || public.canonicalize_jsonb_value(mc.value),
        E'\n' ORDER BY mc.key), '')
    FROM public.mastery_constants mc;
$$;


--
-- Name: canonicalize_jsonb_value(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_jsonb_value(p_val jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    CASE jsonb_typeof(p_val)
        WHEN 'object' THEN
            RETURN '{' || COALESCE((
                SELECT string_agg(
                    e.key || '=' || public.canonicalize_jsonb_value(e.value),
                    ',' ORDER BY e.key)
                FROM jsonb_each(p_val) e
            ), '') || '}';
        WHEN 'array' THEN
            RETURN '[' || COALESCE((
                SELECT string_agg(
                    public.canonicalize_jsonb_value(elem.value),
                    ',' ORDER BY elem.ordinality)
                FROM jsonb_array_elements(p_val) WITH ORDINALITY AS elem(value, ordinality)
            ), '') || ']';
        WHEN 'number' THEN
            RETURN to_char((p_val #>> '{}')::numeric, 'FM9990.000000');
        ELSE
            RETURN (p_val #>> '{}');
    END CASE;
END;
$$;


--
-- Name: canonicalize_mastery_constants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_mastery_constants() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT jsonb_object_agg(key, value ORDER BY key)
  FROM public.mastery_constants
  WHERE key IN ('POSITION_HALF_LIFE','MIN_EVENTS_FOR_MASTERY','weight_source_test',
    'weight_source_practice','weight_source_review','difficulty_weight_easy','difficulty_weight_medium',
    'difficulty_weight_hard','mastery_min','mastery_max','mastery_level_0_max','mastery_level_1_min',
    'mastery_level_1_max','mastery_level_2_min','mastery_level_2_max','mastery_level_3_min',
    'mastery_level_3_max','mastery_level_4_min','ROUND_MASTERY_SCORE_DECIMALS','ROUND_MASTERY_PCT_DECIMALS',
    'ROUND_ACCURACY_DECIMALS','ROUND_EVIDENCE_DECIMALS','ROUNDING_MODE','mastery_model_version');
$$;


--
-- Name: canonicalize_mastery_constants_serialized(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_mastery_constants_serialized() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT string_agg(key || '=' || value::text, E'\n' ORDER BY key)
  FROM public.mastery_constants
  WHERE key IN ('POSITION_HALF_LIFE','MIN_EVENTS_FOR_MASTERY','weight_source_test',
    'weight_source_practice','weight_source_review','difficulty_weight_easy','difficulty_weight_medium',
    'difficulty_weight_hard','mastery_min','mastery_max','mastery_level_0_max','mastery_level_1_min',
    'mastery_level_1_max','mastery_level_2_min','mastery_level_2_max','mastery_level_3_min',
    'mastery_level_3_max','mastery_level_4_min','ROUND_MASTERY_SCORE_DECIMALS','ROUND_MASTERY_PCT_DECIMALS',
    'ROUND_ACCURACY_DECIMALS','ROUND_EVIDENCE_DECIMALS','ROUNDING_MODE','mastery_model_version');
$$;


--
-- Name: canonicalize_projection_constants_serialized(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonicalize_projection_constants_serialized() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_target_qcount integer;
  v_min_delta     numeric;
  v_max_delta     numeric;
  v_mid_round     integer;
  v_bound_round   integer;
  v_section_max   integer;
  v_section_min   integer;
  v_weights       jsonb;
  v_weights_canon text;
BEGIN
  SELECT target_qcount, min_delta, max_delta, mid_round,
         bound_round, section_max, section_min, weights
  INTO   v_target_qcount, v_min_delta, v_max_delta, v_mid_round,
         v_bound_round, v_section_max, v_section_min, v_weights
  FROM   public.read_projection_constants();

  -- Canonical weights serialization: sections in fixed order (M, RW), domains sorted by key within
  -- each section, weights to a fixed 6-decimal scale. Deterministic regardless of jsonb internals.
  SELECT string_agg(
             sec || ':' || dom_csv,
             '|' ORDER BY sec
         )
  INTO   v_weights_canon
  FROM (
      SELECT s.sec,
             string_agg(
                 w.key || '=' || to_char((w.value #>> '{}')::numeric, 'FM9990.000000'),
                 ',' ORDER BY w.key
             ) AS dom_csv
      FROM   (VALUES ('M'), ('RW')) AS s(sec)
      CROSS JOIN LATERAL jsonb_each(v_weights -> s.sec) AS w
      GROUP BY s.sec
  ) per_section;

  RETURN
      'target_qcount=' || v_target_qcount::text
   || ';min_delta='    || to_char(v_min_delta,   'FM9990.000000')
   || ';max_delta='    || to_char(v_max_delta,   'FM9990.000000')
   || ';mid_round='    || v_mid_round::text
   || ';bound_round='  || v_bound_round::text
   || ';section_min='  || v_section_min::text
   || ';section_max='  || v_section_max::text
   || ';weights='      || COALESCE(v_weights_canon, '');
END;
$$;


--
-- Name: capture_mastery_constant_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_mastery_constant_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_key          text;
    v_old          jsonb;
    v_new          jsonb;
    v_affects      boolean;
    v_state_hash   text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_key := NEW.key;  v_old := NULL;        v_new := NEW.value;
    ELSIF TG_OP = 'UPDATE' THEN
        v_key := NEW.key;  v_old := OLD.value;   v_new := NEW.value;
    ELSE
        v_key := OLD.key;  v_old := OLD.value;   v_new := NULL;
    END IF;

    v_affects := public.constant_affects_formula_hash(v_key);

    v_state_hash := encode(
        extensions.digest(
            convert_to(
                public.canonicalize_active_mastery_constants_state(),
                'UTF8'),
            'sha256'),
        'hex');

    INSERT INTO public.mastery_constants_change_log (
        key, op, old_value, new_value,
        affects_formula_hash,
        actor_role, actor_session_user, txid,
        resulting_state_hash, changed_at
    ) VALUES (
        v_key, TG_OP, v_old, v_new,
        v_affects,
        current_user, session_user, txid_current(),
        v_state_hash, now()
    );

    RETURN NULL;
END;
$$;


--
-- Name: check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_and_reserve_practice_quota(p_student_user_id uuid, p_account_id uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid, p_session_item_id uuid DEFAULT NULL::uuid, p_dry_run boolean DEFAULT false, p_request_id text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
  v_daily_limit integer;
  v_session_limit integer;
  v_used integer := 0;
  v_session_used integer := 0;
  v_reset_at timestamptz;
  v_account uuid := NULL;
  v_entitled boolean := false;
  v_counts_toward_limit boolean := true;
  v_dedupe_key text := NULL;
  v_existing_id uuid := NULL;
  v_inserted_id uuid := NULL;
  v_config_val text;
BEGIN
  -- Identity guard: caller must match the student (service_role bypasses via REVOKE/GRANT)
  IF auth.uid() IS NOT NULL AND p_student_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_student_user_id does not match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('practice_quota:' || p_student_user_id::text));

  -- Read daily limit from config (required — no hardcoded fallback)
  SELECT value INTO v_config_val
  FROM public.practice_runtime_config
  WHERE key = 'daily_quota_free';
  IF v_config_val IS NULL OR NOT (v_config_val ~ '^\d+$') THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key daily_quota_free'
      USING ERRCODE = 'P0002';
  END IF;
  v_daily_limit := v_config_val::integer;

  -- Read session limit from config (required — no hardcoded fallback)
  SELECT value INTO v_config_val
  FROM public.practice_runtime_config
  WHERE key = 'max_session_count_premium';
  IF v_config_val IS NULL OR NOT (v_config_val ~ '^\d+$') THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key max_session_count_premium'
      USING ERRCODE = 'P0002';
  END IF;
  v_session_limit := v_config_val::integer;

  -- UTC-day boundaries
  v_today_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_tomorrow_start := v_today_start + interval '1 day';
  v_reset_at := v_tomorrow_start;

  -- Resolve account + entitlement
  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);
  v_entitled := public._rl_has_active_entitlement(p_student_user_id);
  v_counts_toward_limit := NOT v_entitled;

  -- Count today's consumed units (UTC-day window)
  SELECT COALESCE(SUM(units), 0)::integer
  INTO v_used
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'practice'
    AND l.student_user_id = p_student_user_id
    AND l.reservation_state IN ('consumed', 'finalized')
    AND COALESCE((l.metadata->>'counts_toward_limit')::boolean, true)
    AND l.created_at >= v_today_start
    AND l.created_at < v_tomorrow_start;

  -- Daily cap check (unpaid only)
  IF v_counts_toward_limit AND v_used >= v_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'PRACTICE_FREE_DAILY_QUOTA_EXCEEDED',
      'message', format('Practice free-tier limit reached (%s questions per day).', v_daily_limit),
      'current', v_used,
      'limit', v_daily_limit,
      'remaining', 0,
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  -- Per-session cap (paid users)
  IF p_session_id IS NOT NULL AND v_entitled THEN
    SELECT COALESCE(SUM(units), 0)::integer
    INTO v_session_used
    FROM public.usage_rate_limit_ledger l
    WHERE l.scope = 'practice'
      AND l.student_user_id = p_student_user_id
      AND l.session_id = p_session_id
      AND l.reservation_state IN ('consumed', 'finalized');

    IF v_session_used >= v_session_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'code', 'PRACTICE_SESSION_LIMIT_REACHED',
        'message', format('Session question limit reached (%s questions per session).', v_session_limit),
        'current', v_session_used,
        'limit', v_session_limit,
        'remaining', 0,
        'reset_at', NULL,
        'cooldown_until', NULL,
        'reservation_id', NULL,
        'duplicate', false
      );
    END IF;
  END IF;

  -- Dry-run: return quota state without writing
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', CASE WHEN v_counts_toward_limit THEN 'PRACTICE_OK' ELSE 'PRACTICE_BYPASS_ENTITLED' END,
      'message', CASE WHEN v_counts_toward_limit THEN 'Practice quota available.' ELSE 'Active entitlement bypasses free-tier practice cap.' END,
      'current', CASE WHEN v_counts_toward_limit THEN v_used ELSE v_session_used END,
      'limit', CASE WHEN v_counts_toward_limit THEN v_daily_limit ELSE v_session_limit END,
      'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_daily_limit - v_used, 0) ELSE GREATEST(v_session_limit - v_session_used, 0) END,
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  -- Idempotency: dedupe on session_item_id
  IF p_session_item_id IS NOT NULL THEN
    v_dedupe_key := 'practice:served:' || p_session_item_id::text;
    SELECT l.id
    INTO v_existing_id
    FROM public.usage_rate_limit_ledger l
    WHERE l.dedupe_key = v_dedupe_key
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', 'PRACTICE_ALREADY_RESERVED',
      'message', 'Practice session item already counted.',
      'current', v_used,
      'limit', CASE WHEN v_counts_toward_limit THEN v_daily_limit ELSE v_session_limit END,
      'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_daily_limit - v_used, 0) ELSE GREATEST(v_session_limit - v_session_used, 0) END,
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', v_existing_id,
      'duplicate', true
    );
  END IF;

  -- Insert ledger entry
  INSERT INTO public.usage_rate_limit_ledger (
    scope, event_key, student_user_id, account_id,
    session_id, session_item_id, dedupe_key,
    units, reservation_state, metadata, created_at, updated_at
  )
  VALUES (
    'practice', 'practice_question_served', p_student_user_id, v_account,
    p_session_id, p_session_item_id, v_dedupe_key,
    1, 'consumed',
    jsonb_build_object(
      'counts_toward_limit', v_counts_toward_limit,
      'request_id', p_request_id
    ),
    v_now, v_now
  )
  RETURNING id INTO v_inserted_id;

  IF v_counts_toward_limit THEN
    v_used := v_used + 1;
  ELSE
    v_session_used := v_session_used + 1;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', CASE WHEN v_counts_toward_limit THEN 'PRACTICE_RESERVED' ELSE 'PRACTICE_BYPASS_ENTITLED' END,
    'message', CASE WHEN v_counts_toward_limit THEN 'Practice quota reserved.' ELSE 'Active entitlement bypasses free-tier practice cap.' END,
    'current', CASE WHEN v_counts_toward_limit THEN v_used ELSE v_session_used END,
    'limit', CASE WHEN v_counts_toward_limit THEN v_daily_limit ELSE v_session_limit END,
    'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_daily_limit - v_used, 0) ELSE GREATEST(v_session_limit - v_session_used, 0) END,
    'reset_at', v_reset_at,
    'cooldown_until', NULL,
    'reservation_id', v_inserted_id,
    'duplicate', false
  );
END;
$_$;


--
-- Name: complete_and_anonymize_account(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_and_anonymize_account(p_request_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cascade_result jsonb;
  v_rows           int;
BEGIN
  UPDATE public.account_deletion_requests
     SET status        = 'completed',
         completion_at = now()
   WHERE id     = p_request_id
     AND status = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'request not pending');
  END IF;

  SELECT public.execute_account_deletion_cascade(p_profile_id, 'anonymize')
    INTO v_cascade_result;

  RETURN v_cascade_result;
END;
$$;


--
-- Name: compute_longest_streak_days(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_longest_streak_days(p_student_id uuid, p_t_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_longest integer := 0;
BEGIN
  WITH active_days AS (
    SELECT DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date AS d
    FROM (
      SELECT pi.occurred_at
      FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.occurred_at
      FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
    ) e
    WHERE e.occurred_at IS NOT NULL
  ),
  islands AS (
    -- gaps-and-islands: consecutive days share (d - row_number()) as the island key.
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp
    FROM active_days
  )
  SELECT COALESCE(MAX(run_len), 0) INTO v_longest
  FROM (SELECT COUNT(*) AS run_len FROM islands GROUP BY grp) r;

  RETURN v_longest;
END;
$$;


--
-- Name: compute_mastery_for_entity(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_mastery_for_entity(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text DEFAULT NULL::text) RETURNS TABLE(total_events integer, acc_test numeric, acc_practice numeric, acc_review numeric, mastery_score numeric, mastery_pct numeric, mastery_level smallint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  -- Step 1: read constants
  v_constants := public.canonicalize_mastery_constants();
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
    SELECT * FROM public.canonical_mastery_events(p_student_id, p_entity_type, p_section, p_domain, p_skill)
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


--
-- Name: student_section_projections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_section_projections (
    student_id uuid NOT NULL,
    section text NOT NULL,
    projected_score_mid integer,
    projected_score_low integer,
    projected_score_high integer,
    range_width integer,
    relevant_question_count integer,
    mastery_term numeric(8,4),
    fl1_score integer,
    fl2_score integer,
    fl_count_used smallint DEFAULT 0 NOT NULL,
    blend_denominator smallint DEFAULT 1 NOT NULL,
    projection_constants_hash text,
    mastery_model_version text DEFAULT 'v1.0'::text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projection_blend_denominator_coherent CHECK ((blend_denominator = (fl_count_used + 1))),
    CONSTRAINT projection_range_coherent CHECK ((((projected_score_mid IS NULL) AND (projected_score_low IS NULL) AND (projected_score_high IS NULL) AND (range_width IS NULL)) OR ((projected_score_mid IS NOT NULL) AND (projected_score_low IS NOT NULL) AND (projected_score_high IS NOT NULL) AND (range_width IS NOT NULL) AND (projected_score_low <= projected_score_mid) AND (projected_score_mid <= projected_score_high) AND (range_width = (projected_score_high - projected_score_low))))),
    CONSTRAINT student_section_projections_blend_denominator_check CHECK (((blend_denominator >= 1) AND (blend_denominator <= 3))),
    CONSTRAINT student_section_projections_fl1_score_check CHECK (((fl1_score IS NULL) OR ((fl1_score >= 200) AND (fl1_score <= 800)))),
    CONSTRAINT student_section_projections_fl2_score_check CHECK (((fl2_score IS NULL) OR ((fl2_score >= 200) AND (fl2_score <= 800)))),
    CONSTRAINT student_section_projections_fl_count_used_check CHECK (((fl_count_used >= 0) AND (fl_count_used <= 2))),
    CONSTRAINT student_section_projections_projected_score_high_check CHECK (((projected_score_high IS NULL) OR ((projected_score_high >= 200) AND (projected_score_high <= 800)))),
    CONSTRAINT student_section_projections_projected_score_low_check CHECK (((projected_score_low IS NULL) OR ((projected_score_low >= 200) AND (projected_score_low <= 800)))),
    CONSTRAINT student_section_projections_projected_score_mid_check CHECK (((projected_score_mid IS NULL) OR ((projected_score_mid >= 200) AND (projected_score_mid <= 800)))),
    CONSTRAINT student_section_projections_range_width_check CHECK (((range_width IS NULL) OR (range_width >= 0))),
    CONSTRAINT student_section_projections_relevant_question_count_check CHECK (((relevant_question_count IS NULL) OR (relevant_question_count >= 0))),
    CONSTRAINT student_section_projections_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: compute_section_projection(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_section_projection(p_student_id uuid, p_section text, p_t_now timestamp with time zone DEFAULT now()) RETURNS public.student_section_projections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  v_fl1_score         integer;     -- State A: always NULL (no full-lengths pre-WS-4)
  v_fl2_score         integer;     -- State A: always NULL (no full-lengths pre-WS-4)
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

    -- §5.7 resolve the full-length terms and compute the blend (INV-05C-13).
    -- ┌─ NAMED FORWARD-REF (WS-4, BLOCKING_UPSTREAM_GAP — 04B object unnamed) ────────────────────┐
    -- │ States B/C read the 04B completed-full-length section-score surface (the two most recent  │
    -- │ completed full-lengths by completed_at, tiebreak id desc), adding fl1/fl2 to the numerator │
    -- │ and 1/2 to the denominator. Doc 05C §5.7 / §11.C mark that object BLOCKING_UPSTREAM_GAP    │
    -- │ until Doc 04B names it (columns student_id, section, section_scaled_score, is_complete,    │
    -- │ completed_at, id; "completed = both modules submitted and scored"). State A has NO 04B     │
    -- │ dependency, so NO full_length_section_scores read appears here — it is added in WS-4. The  │
    -- │ blend numerator ALWAYS seeds with v_mastery_term (INV-05C-13), so the WS-4 addition is     │
    -- │ purely additive (denominator 1 -> 2 -> 3) with no body restructure.                        │
    -- └───────────────────────────────────────────────────────────────────────────────────────────┘
    v_fl1_score         := NULL;   -- State A
    v_fl2_score         := NULL;   -- State A
    v_blend_numerator   := v_mastery_term;                 -- mastery term always present (INV-05C-13)
    v_blend_denominator := 1;                              -- State A (no full-lengths pre-WS-4)
    v_fl_count_used     := v_blend_denominator - 1;        -- 0 in State A
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
$$;


--
-- Name: compute_streak_days(uuid, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_streak_days(p_student_id uuid, p_section text DEFAULT NULL::text, p_domain text DEFAULT NULL::text, p_skill text DEFAULT NULL::text, p_t_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_streak integer := 0;
  v_today  date := (p_t_now AT TIME ZONE 'UTC')::date;
  v_check_date date;
  v_has_event boolean;
BEGIN
  v_check_date := v_today;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT (e.occurred_at AT TIME ZONE 'UTC')::date AS event_date, e.section, e.domain, e.skill
        FROM (
          SELECT pi.occurred_at, pi.question_section AS section, pi.question_domain AS domain, pi.question_skill AS skill
          FROM public.practice_session_items pi
          WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          UNION ALL
          SELECT ra.occurred_at, ra.section, ra.domain, ra.skill
          FROM public.review_error_attempts ra
          WHERE ra.student_id = p_student_id
        ) e
      ) ev
      WHERE ev.event_date = v_check_date
        AND (p_section IS NULL OR ev.section = p_section)
        AND (p_domain  IS NULL OR ev.domain  = p_domain)
        AND (p_skill   IS NULL OR ev.skill   = p_skill)
    ) INTO v_has_event;

    IF v_has_event THEN
      v_streak := v_streak + 1;
      v_check_date := v_check_date - 1;
    ELSE
      EXIT;
    END IF;

    IF v_streak >= 730 THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;


--
-- Name: constant_affects_formula_hash(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.constant_affects_formula_hash(p_key text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    v_formula text[] := ARRAY[
        'difficulty_weight_easy','difficulty_weight_hard','difficulty_weight_medium',
        'mastery_level_0_max','mastery_level_1_max','mastery_level_1_min',
        'mastery_level_2_max','mastery_level_2_min','mastery_level_3_max',
        'mastery_level_3_min','mastery_level_4_min',
        'mastery_max','mastery_min','mastery_model_version',
        'MIN_EVENTS_FOR_MASTERY','POSITION_HALF_LIFE',
        'ROUND_ACCURACY_DECIMALS','ROUND_EVIDENCE_DECIMALS',
        'ROUND_MASTERY_PCT_DECIMALS','ROUND_MASTERY_SCORE_DECIMALS',
        'ROUNDING_MODE',
        'weight_source_practice','weight_source_review','weight_source_test'
    ];
    v_operational text[] := ARRAY[
        'DIAGNOSTIC_TOTAL_QUESTIONS',
        'KPI_RECENCY_WINDOW_LONG_DAYS','KPI_RECENCY_WINDOW_SHORT_DAYS',
        'PROJECTION_BOUND_ROUND_TO','PROJECTION_DOMAIN_WEIGHTS',
        'PROJECTION_MAX_DELTA','PROJECTION_MIDPOINT_ROUND_TO',
        'PROJECTION_MIN_DELTA','PROJECTION_REFRESH_EVENT_THRESHOLD',
        'PROJECTION_REFRESH_TIME_THRESHOLD_HOURS',
        'PROJECTION_SECTION_MAX_SCORE','PROJECTION_SECTION_MIN_SCORE',
        'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION'
    ];
BEGIN
    IF p_key = ANY(v_formula) THEN RETURN true; END IF;
    IF p_key = ANY(v_operational) THEN RETURN false; END IF;
    RAISE EXCEPTION 'CONSTANT_KEY_UNKNOWN: "%" is not in the formula (24) or operational (13) registry', p_key;
END;
$$;


--
-- Name: guardian_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardian_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guardian_profile_id uuid NOT NULL,
    student_profile_id uuid NOT NULL,
    status text NOT NULL,
    initiated_by text NOT NULL,
    initiated_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_profile_id uuid,
    revoked_at timestamp with time zone,
    revoked_by_profile_id uuid,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardian_links_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['guardian'::text, 'student'::text, 'admin'::text]))),
    CONSTRAINT guardian_links_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT guardian_not_self CHECK ((guardian_profile_id <> student_profile_id))
);


--
-- Name: create_active_guardian_link_audited(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_active_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_request_id text DEFAULT NULL::text) RETURNS public.guardian_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row public.guardian_links;
BEGIN
  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- Edge case 2: already linked is a 409, not a duplicate row. Only 'active' is
  -- checked because SCL-080 leaves no reachable pending status.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
     accepted_at, accepted_by_profile_id)
  VALUES (p_guardian_id, p_student_id, 'active', 'student', now(), now(), p_student_id)
  RETURNING * INTO v_row;

  -- initiated_by='student' and accepted_by=the student: the student issued and shared the
  -- code, so the student is both the initiator and the consenting party. Recording the
  -- guardian as initiator would misattribute the consent.
  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', 'student_link_code'),
    v_row.id, p_request_id
  );

  RETURN v_row;
END;
$$;


--
-- Name: crisis_review_cases_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crisis_review_cases_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: deidentify_user(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deidentify_user(target_user_id uuid, deleted_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.profiles
     SET email              = deleted_email,
         full_name          = NULL,
         display_name        = 'Deleted User',
         stripe_customer_id  = NULL,
         guardian_email      = NULL,
         date_of_birth       = NULL,
         updated_at          = now()
   WHERE id = target_user_id;
  -- DEFERRED cascade (GAP-HY-15, Doc 03A V2 retention sign-off required): hard-delete feature-level
  -- rows where retention is not required; retain anonymized analytics per
  -- account_deletion_runtime_config.anonymization_retention_days. Not added until the delete list
  -- is traced to Doc 03A — leaving it out keeps this RPC non-destructive beyond the PII row.
END;
$$;


--
-- Name: entitlement_active(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entitlement_active(p_profile_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.profile_id = p_profile_id AND e.status IN ('active','past_due','trialing')
  );
$$;


--
-- Name: execute_account_deletion_cascade(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_account_deletion_cascade(p_profile_id uuid, p_privacy_mode text DEFAULT 'hard_delete'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_result    jsonb := '{}'::jsonb;
  v_count     bigint;
  v_op_ref   record;
  v_actor_id  uuid;
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  IF p_privacy_mode NOT IN ('hard_delete', 'anonymize') THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete, anonymize', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- CAPTURE actor_id (anonymize mode: needed for sentinel + ledger;
  -- must be read BEFORE profile deletion destroys the mapping — §3 Rule 4)
  -- ========================================================================
  IF p_privacy_mode = 'anonymize' THEN
    SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_profile_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION '05E-5d: profiles.actor_id IS NULL for profile % — cannot anonymize without grouping identifier (INV-05E-06)',
        p_profile_id;
    END IF;
  END IF;

  -- ========================================================================
  -- OPERATOR-FK PREFLIGHT GUARD (fail-closed, before ANY destructive step)
  -- ========================================================================
  -- 36 operator-identity FK edges (updated_by_profile_id / changed_by_profile_id
  -- across 18 *_config + 18 *_config_history governance tables). Operator
  -- attribution is governance data — must BLOCK deletion until consciously
  -- reassigned. The guard refuses cascade with a clear error BEFORE any rows
  -- are deleted. LYCEON-MIGRATION-REVIEWED
  FOR v_op_ref IN
    SELECT * FROM (VALUES
      ('abuse_score_runtime_config'::text,              'updated_by_profile_id'::text),
      ('abuse_score_runtime_config_history',            'changed_by_profile_id'),
      ('account_deletion_runtime_config',               'updated_by_profile_id'),
      ('account_deletion_runtime_config_history',       'changed_by_profile_id'),
      ('auth_mfa_config',                               'updated_by_profile_id'),
      ('auth_mfa_config_history',                       'changed_by_profile_id'),
      ('auth_runtime_config',                           'updated_by_profile_id'),
      ('auth_runtime_config_history',                   'changed_by_profile_id'),
      ('caching_runtime_config',                        'updated_by_profile_id'),
      ('caching_runtime_config_history',                'changed_by_profile_id'),
      ('consent_runtime_config',                        'updated_by_profile_id'),
      ('consent_runtime_config_history',                'changed_by_profile_id'),
      ('entitlement_runtime_config',                    'updated_by_profile_id'),
      ('entitlement_runtime_config_history',            'changed_by_profile_id'),
      ('exam_runtime_config',                           'updated_by_profile_id'),
      ('exam_runtime_config_history',                   'changed_by_profile_id'),
      ('full_length_adaptive_config',                   'updated_by_profile_id'),
      ('full_length_adaptive_config_history',           'changed_by_profile_id'),
      ('idempotency_runtime_config',                    'updated_by_profile_id'),
      ('idempotency_runtime_config_history',            'changed_by_profile_id'),
      ('internal_service_auth_config',                  'updated_by_profile_id'),
      ('internal_service_auth_config_history',          'changed_by_profile_id'),
      ('mastery_constants',                             'updated_by_profile_id'),
      ('mastery_constants_history',                     'changed_by_profile_id'),
      ('mobile_auth_config',                            'updated_by_profile_id'),
      ('mobile_auth_config_history',                    'changed_by_profile_id'),
      ('observability_runtime_config',                  'updated_by_profile_id'),
      ('observability_runtime_config_history',          'changed_by_profile_id'),
      ('practice_runtime_config',                       'updated_by_profile_id'),
      ('practice_runtime_config_history',               'changed_by_profile_id'),
      ('rate_limit_runtime_config',                     'updated_by_profile_id'),
      ('rate_limit_runtime_config_history',             'changed_by_profile_id'),
      ('review_runtime_config',                         'updated_by_profile_id'),
      ('review_runtime_config_history',                 'changed_by_profile_id'),
      ('tutor_context_runtime_config',                  'updated_by_profile_id'),
      ('tutor_context_runtime_config_history',          'changed_by_profile_id')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I = $1',
      v_op_ref.tbl, v_op_ref.col
    ) INTO v_count USING p_profile_id;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES: '
        'profile % is referenced as an operator in %.% '
        '— reassign config attributions before deletion',
        p_profile_id, v_op_ref.tbl, v_op_ref.col;
    END IF;
  END LOOP;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

  -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
  UPDATE public.guardian_links SET accepted_by_profile_id = NULL
   WHERE accepted_by_profile_id = p_profile_id;
  UPDATE public.guardian_links SET revoked_by_profile_id = NULL
   WHERE revoked_by_profile_id = p_profile_id;
  DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
  DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

  -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
  UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
   WHERE guardian_profile_id = p_profile_id;
  DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

  -- PS-4. account_deletion_requests — actor_profile_id edge case
  UPDATE public.account_deletion_requests
     SET actor_profile_id = profile_id
   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: DELETE derived state (SHARED — both modes; INV-05E-09 proven safe)
  -- ========================================================================
  -- All derived state: mastery, KPI, projections, scheduling. Recomputable from
  -- retained activity if ever needed (§5). No FK to profiles (convention only).
  -- Zero triggers on any L1 table. Zero FKs from L1 to L2.

  -- L1-01. student_section_projection_snapshots (05C)
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projection_snapshots', v_count);

  -- L1-02. student_section_projections (05C)
  DELETE FROM public.student_section_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projections', v_count);

  -- L1-03. student_projection_refresh_state (05C)
  DELETE FROM public.student_projection_refresh_state WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_projection_refresh_state', v_count);

  -- L1-04. projection_refresh_outbox (05C)
  DELETE FROM public.projection_refresh_outbox WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('projection_refresh_outbox', v_count);

  -- L1-05. student_section_kpi (05B)
  DELETE FROM public.student_section_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_kpi', v_count);

  -- L1-06. student_domain_kpi (05B)
  DELETE FROM public.student_domain_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_kpi', v_count);

  -- L1-07. student_skill_kpi (05B)
  DELETE FROM public.student_skill_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_kpi', v_count);

  -- L1-08. student_overall_kpi (05B)
  DELETE FROM public.student_overall_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_overall_kpi', v_count);

  -- L1-09. student_domain_mastery (05B)
  DELETE FROM public.student_domain_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_mastery', v_count);

  -- L1-10. student_skill_mastery (05A)
  DELETE FROM public.student_skill_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_mastery', v_count);

  -- L1-11. review_schedule (Q3 ruling: L1 — identity-linked SM-2 state, not event data)
  DELETE FROM public.review_schedule WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('review_schedule', v_count);

  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

  -- ========================================================================
  -- MODE BRANCH: hard_delete vs anonymize diverge at L2
  -- ========================================================================

  IF p_privacy_mode = 'hard_delete' THEN
    -- ====================================================================
    -- LAYER 2 (hard_delete): Hard-delete event/audit sources
    -- ====================================================================
    -- Children-before-parent FK-safe order. All event + session + audit rows removed.

    -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
    DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions
    DELETE FROM public.practice_sessions WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (child of review_session_items via ON DELETE CASCADE)
    DELETE FROM public.review_error_attempts WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (child of review_sessions via ON DELETE CASCADE)
    DELETE FROM public.review_session_items WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions
    DELETE FROM public.review_sessions WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- L2-06. mastery_event_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_event_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L2-07. mastery_domain_refresh_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    DECLARE
      v_sentinel_tbl text;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
    BEGIN
      FOR v_sentinel_tbl, v_sentinel_col IN VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id')
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM public.%I WHERE %I = $1 AND actor_id IS NULL',
          v_sentinel_tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id;
        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% have identity present but actor_id IS NULL — refusing to sever identity from ungrouped row',
            v_sentinel_cnt, v_sentinel_tbl;
        END IF;
      END LOOP;
    END;

    -- ====================================================================
    -- LAYER 2 (anonymize): Sever identity + remove fingerprints on
    -- activity tables — rows RETAINED for world-model training (§5)
    -- ====================================================================
    -- §5.1: "Removed: the identity link and any client/device/session
    --   fingerprint that could enable re-identification."
    -- §5.1: "Retained: the learning interaction — item answered, response
    --   chosen, correctness, difficulty/domain/skill/section, ordering,
    --   timing, and shared question-bank content."
    -- actor_id (NOT NULL, PR-5c) is the surviving synthetic grouping id.
    -- Children before parents (convention match with hard-delete ordering).
    --
    -- Partial unique indexes (uq_practice_items_idem, uq_review_attempts_idem)
    -- are on (identity, client_attempt_id) WHERE client_attempt_id IS NOT NULL.
    -- Setting client_attempt_id = NULL removes rows from the partial index;
    -- no uniqueness violation. Live write path unaffected (non-anonymized
    -- users retain non-NULL identity and client_attempt_id).

    -- L2-01. practice_session_items (identity + fingerprint)
    UPDATE public.practice_session_items
       SET user_id = NULL, client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET user_id = NULL, client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET student_id = NULL, client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (identity only — no fingerprint columns)
    UPDATE public.review_session_items
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET student_id = NULL, client_instance_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- ====================================================================
    -- LAYER 3 (anonymize): Sever identity on audit tables
    -- ====================================================================
    -- §5: "Audit layer: one-way anonymized per Doc 05D §10, idempotency
    --   guarantees untouched."
    -- mastery_event_audit_log_dedup_uq is UNIQUE on (event_source_kind,
    -- event_id) — does NOT include student_id. SET NULL is safe; the
    -- idempotency anchor (INV-05A-10) is preserved.
    -- No FK to profiles (denormalized, convention only).

    -- L3-01. mastery_event_audit_log
    UPDATE public.mastery_event_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L3-02. mastery_domain_refresh_audit_log
    UPDATE public.mastery_domain_refresh_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- ANONYMIZED_ACTORS LEDGER (§3.1): record that this actor_id is
    -- anonymized, BEFORE profile deletion destroys the mapping
    -- ====================================================================
    INSERT INTO public.anonymized_actors (actor_id, anonymized_at)
    VALUES (v_actor_id, now())
    ON CONFLICT (actor_id) DO NOTHING;
    v_result := v_result || jsonb_build_object('anonymized_actors', 1);

  END IF;

  -- ========================================================================
  -- PROFILE + AUTH DELETE (shared — both modes destroy the profile row)
  -- ========================================================================
  -- §3 Rule 4: "Linkage destroyed at anonymization." The profile row
  -- contains profiles.actor_id — the ONLY surface linking identity to the
  -- synthetic identifier. Deleting the row makes the link irreversible.
  -- auto-CASCADE FKs fire: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_outbox, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- Operator-FK edges (36 config/history) were preflight-guarded above.
  -- In anonymize mode, L2/L3 identity columns are already NULL — no FK
  -- from those tables blocks this DELETE (FKs are NO ACTION, nullable).

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  DELETE FROM auth.users WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('auth_users', v_count);

  RETURN jsonb_build_object(
    'status', 'completed',
    'profile_id', p_profile_id,
    'privacy_mode', p_privacy_mode,
    'rows_affected', v_result
  );
END;
$_$;


--
-- Name: guardian_can_view_student(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_can_view_student(p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.guardian_can_view_student_as(auth.uid(), p_student_id);
$$;


--
-- Name: FUNCTION guardian_can_view_student(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guardian_can_view_student(p_student_id uuid) IS 'RLS entry point for guardian visibility. Delegates to guardian_can_view_student_as with auth.uid() as the principal, so a caller may only ask about themselves as guardian. Body moved to guardian_view_decision 2026-08-27 so the application gate and the six RLS policies share ONE derivation.';


--
-- Name: guardian_can_view_student_as(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.guardian_view_decision(p_guardian_id, p_student_id) = 'allow';
$$;


--
-- Name: FUNCTION guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid) IS 'Boolean form of guardian_view_decision with the principal passed explicitly, for application callers on the service-role connection where auth.uid() is NULL. Service-role only, for the same reason as guardian_view_decision.';


--
-- Name: guardian_link_audit(text, uuid, uuid, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_link_audit(p_action text, p_actor uuid, p_target uuid, p_changes jsonb, p_link_id uuid, p_request_id text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor, p_target, p_action, p_changes,
    jsonb_build_object('request_id', p_request_id, 'link_id', p_link_id)
  );
$$;


--
-- Name: guardian_view_decision(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardian_view_decision(p_guardian_id uuid, p_student_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = p_guardian_id
        AND gl.student_profile_id  = p_student_id
        AND gl.status              = 'active'
    ) THEN 'not_linked'
    WHEN NOT public.entitlement_active(p_student_id) THEN 'student_unentitled'
    ELSE 'allow'
  END;
$$;


--
-- Name: FUNCTION guardian_view_decision(p_guardian_id uuid, p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guardian_view_decision(p_guardian_id uuid, p_student_id uuid) IS 'THE guardian-visibility derivation (Doc 01 V8 §35 + §38.1, Doc 05B §10.1/§10.3). Returns allow | not_linked | student_unentitled. Service-role only: the guardian id is an argument, so direct callers could otherwise probe arbitrary link pairs. guardian_can_view_student_as and guardian_can_view_student both delegate here.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',  -- Google OAuth sets full_name / name, not display_name
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    CASE WHEN NEW.raw_user_meta_data->>'role' = 'guardian' THEN 'guardian' ELSE 'student' END::public.profile_role
  )
  ON CONFLICT DO NOTHING;  -- catch-all: tolerates id PK AND lower(email) arbiters; never aborts the auth insert
  RETURN NEW;
END;
$$;


--
-- Name: lookup_mastery_level(numeric, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lookup_mastery_level(p_score numeric, p_constants jsonb) RETURNS smallint
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL::smallint
    WHEN p_score < (p_constants->>'mastery_level_1_min')::numeric THEN 0::smallint
    WHEN p_score < (p_constants->>'mastery_level_2_min')::numeric THEN 1::smallint
    WHEN p_score < (p_constants->>'mastery_level_3_min')::numeric THEN 2::smallint
    WHEN p_score < (p_constants->>'mastery_level_4_min')::numeric THEN 3::smallint
    ELSE 4::smallint
  END;
$$;


--
-- Name: mastery_min_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mastery_min_events() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT (value #>> '{}')::integer
  FROM public.mastery_constants
  WHERE key = 'MIN_EVENTS_FOR_MASTERY';
$$;


--
-- Name: mastery_model_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mastery_model_version() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT (value #>> '{}')::text
  FROM public.mastery_constants
  WHERE key = 'mastery_model_version';
$$;


--
-- Name: notify_config_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_config_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify(
    'config_invalidate',
    json_build_object('table', TG_TABLE_NAME, 'key', NEW.key, 'environment', NEW.environment)::text
  );
  RETURN NEW;
END;
$$;


--
-- Name: pg_notify_memory_summary(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pg_notify_memory_summary(p_student_id uuid, p_summary_type text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM pg_notify(
    'memory_summary_updated',
    json_build_object(
      'student_id', p_student_id,
      'summary_type', p_summary_type
    )::text
  );
END;
$$;


--
-- Name: practice_session_mode_to_event_kind(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.practice_session_mode_to_event_kind(p_mode text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Explicit mapping: every recognized mode → its event_source_kind.
  -- flow/structured/balanced/timed are practice modes (Doc-02B §14).
  -- diagnostic is the 40-question initial diagnostic (Doc-05A §11).
  CASE p_mode
    WHEN 'flow'       THEN RETURN 'practice_attempt';
    WHEN 'structured' THEN RETURN 'practice_attempt';
    WHEN 'balanced'   THEN RETURN 'practice_attempt';
    WHEN 'timed'      THEN RETURN 'practice_attempt';
    WHEN 'diagnostic' THEN RETURN 'diagnostic_attempt';
    ELSE RAISE EXCEPTION 'MASTERY_UNRECOGNIZED_SESSION_MODE: practice_sessions.mode=''%'' has no event_source_kind mapping — add it to practice_session_mode_to_event_kind()', p_mode;
  END CASE;
END;
$$;


--
-- Name: prevent_update_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_update_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE are not permitted', TG_TABLE_NAME;
END;
$$;


--
-- Name: rate_limit_check_and_increment(uuid, text, integer, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rate_limit_check_and_increment(p_profile_id uuid, p_bucket_key text, p_cost integer, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_limit integer) RETURNS TABLE(allowed boolean, remaining integer, used integer)
    LANGUAGE plpgsql
    AS $$
DECLARE v_used INTEGER;
BEGIN
  INSERT INTO public.rate_limit_ledger AS l
    (profile_id, bucket_key, window_start, window_end, used_count, limit_count)
  VALUES (p_profile_id, p_bucket_key, p_window_start, p_window_end, p_cost, p_limit)
  ON CONFLICT (profile_id, bucket_key, window_start) DO UPDATE
    SET used_count = l.used_count + p_cost, updated_at = now()
    WHERE l.used_count + p_cost <= p_limit
  RETURNING l.used_count INTO v_used;

  IF FOUND THEN
    allowed := TRUE; used := v_used; remaining := p_limit - v_used; RETURN NEXT; RETURN;
  END IF;

  -- denied: the window row exists and adding p_cost would exceed the limit.
  SELECT l.used_count INTO v_used FROM public.rate_limit_ledger AS l
   WHERE l.profile_id = p_profile_id AND l.bucket_key = p_bucket_key AND l.window_start = p_window_start;
  allowed := FALSE; used := COALESCE(v_used, 0); remaining := GREATEST(p_limit - COALESCE(v_used, 0), 0);
  RETURN NEXT;
END;
$$;


--
-- Name: read_kpi_recency_constants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_kpi_recency_constants(OUT short_days integer, OUT long_days integer) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_short jsonb;
  v_long  jsonb;
BEGIN
  SELECT value INTO v_short FROM public.mastery_constants
   WHERE key = 'KPI_RECENCY_WINDOW_SHORT_DAYS';
  SELECT value INTO v_long  FROM public.mastery_constants
   WHERE key = 'KPI_RECENCY_WINDOW_LONG_DAYS';

  IF v_short IS NULL OR v_long IS NULL THEN
    RAISE EXCEPTION 'KPI_CONSTANTS_MISSING: KPI_RECENCY_WINDOW_SHORT_DAYS or KPI_RECENCY_WINDOW_LONG_DAYS missing from mastery_constants';
  END IF;

  short_days := (v_short #>> '{}')::integer;
  long_days  := (v_long  #>> '{}')::integer;

  IF short_days <= 0 OR long_days <= 0 OR short_days > 365 OR long_days > 365 THEN
    RAISE EXCEPTION 'KPI_CONSTANTS_OUT_OF_RANGE: short_days=% long_days=% (expected 1..365)', short_days, long_days;
  END IF;
END;
$$;


--
-- Name: read_projection_constants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_projection_constants(OUT target_qcount integer, OUT min_delta numeric, OUT max_delta numeric, OUT mid_round integer, OUT bound_round integer, OUT section_max integer, OUT section_min integer, OUT weights jsonb) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_raw    jsonb;
  v_m_sum  numeric;
  v_rw_sum numeric;
BEGIN
  SELECT jsonb_object_agg(key, value)
  INTO   v_raw
  FROM   public.mastery_constants
  WHERE  key IN (
      'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION',
      'PROJECTION_MIN_DELTA',
      'PROJECTION_MAX_DELTA',
      'PROJECTION_MIDPOINT_ROUND_TO',
      'PROJECTION_BOUND_ROUND_TO',
      'PROJECTION_SECTION_MAX_SCORE',
      'PROJECTION_SECTION_MIN_SCORE',
      'PROJECTION_DOMAIN_WEIGHTS'
  );

  IF v_raw IS NULL
     OR NOT (v_raw ? 'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION')
     OR NOT (v_raw ? 'PROJECTION_MIN_DELTA')
     OR NOT (v_raw ? 'PROJECTION_MAX_DELTA')
     OR NOT (v_raw ? 'PROJECTION_MIDPOINT_ROUND_TO')
     OR NOT (v_raw ? 'PROJECTION_BOUND_ROUND_TO')
     OR NOT (v_raw ? 'PROJECTION_SECTION_MAX_SCORE')
     OR NOT (v_raw ? 'PROJECTION_SECTION_MIN_SCORE')
     OR NOT (v_raw ? 'PROJECTION_DOMAIN_WEIGHTS')
  THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_MISSING: one or more projection constant keys missing/inactive in mastery_constants';
  END IF;

  target_qcount := (v_raw -> 'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION' #>> '{}')::integer;
  min_delta     := (v_raw -> 'PROJECTION_MIN_DELTA'                         #>> '{}')::numeric;
  max_delta     := (v_raw -> 'PROJECTION_MAX_DELTA'                         #>> '{}')::numeric;
  mid_round     := (v_raw -> 'PROJECTION_MIDPOINT_ROUND_TO'                 #>> '{}')::integer;
  bound_round   := (v_raw -> 'PROJECTION_BOUND_ROUND_TO'                    #>> '{}')::integer;
  section_max   := (v_raw -> 'PROJECTION_SECTION_MAX_SCORE'                 #>> '{}')::integer;
  section_min   := (v_raw -> 'PROJECTION_SECTION_MIN_SCORE'                 #>> '{}')::integer;
  weights       := (v_raw -> 'PROJECTION_DOMAIN_WEIGHTS');

  -- Bounds checks (structural validation guards; not tunable formula constants).
  IF target_qcount <= 0 OR target_qcount > 100000 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: target_qcount=%', target_qcount;
  END IF;
  IF min_delta < 0 OR max_delta < 0 OR min_delta > max_delta THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: min_delta=% max_delta=%', min_delta, max_delta;
  END IF;
  IF mid_round <= 0 OR bound_round <= 0 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: mid_round=% bound_round=%', mid_round, bound_round;
  END IF;
  IF section_min < 0 OR section_max <= section_min OR section_max > 800 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: section_min=% section_max=%', section_min, section_max;
  END IF;

  -- Domain-weights structural + per-section sum check (|Σ−1| ≤ 1e-6, §4.2).
  IF NOT (weights ? 'M') OR NOT (weights ? 'RW') THEN
    RAISE EXCEPTION 'PROJECTION_DOMAIN_WEIGHTS_INVALID: missing M or RW key';
  END IF;

  SELECT COALESCE(SUM((v.value #>> '{}')::numeric), 0)
  INTO   v_m_sum
  FROM   jsonb_each(weights -> 'M') v;

  SELECT COALESCE(SUM((v.value #>> '{}')::numeric), 0)
  INTO   v_rw_sum
  FROM   jsonb_each(weights -> 'RW') v;

  IF ABS(v_m_sum - 1.0) > 0.000001 OR ABS(v_rw_sum - 1.0) > 0.000001 THEN
    RAISE EXCEPTION 'PROJECTION_DOMAIN_WEIGHTS_INVALID: M sum=%, RW sum=% (must each equal 1.000000)', v_m_sum, v_rw_sum;
  END IF;
END;
$$;


--
-- Name: recompute_skill_mastery(uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_skill_mastery(p_student_id uuid, p_section text, p_domain text, p_skill text, p_chain_downstream boolean DEFAULT true) RETURNS public.student_skill_mastery
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_constants jsonb; v_constants_hash text; v_active_version text;
  v_total integer; v_acc_test numeric; v_acc_practice numeric; v_acc_review numeric;
  v_score numeric; v_pct numeric; v_level smallint; v_row public.student_skill_mastery;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text||'|'||p_section||'|'||p_domain||'|'||p_skill));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: recompute (%, %, %, %)', p_student_id, p_section, p_domain, p_skill;
  END;
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex'); -- pgcrypto lives in extensions schema (genesis); LYCEON-MIGRATION-REVIEWED
  v_active_version := v_constants->>'mastery_model_version';
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total, v_acc_test, v_acc_practice, v_acc_review, v_score, v_pct, v_level
  FROM public.compute_mastery_for_entity(p_student_id, 'skill', p_section, p_domain, p_skill);
  INSERT INTO public.student_skill_mastery
    (student_id, section, domain, skill, mastery_score, mastery_pct, mastery_level,
     acc_test, acc_practice, acc_review, event_count_total, mastery_model_version,
     constants_snapshot_hash, last_event_id, last_event_occurred_at, computed_at)
  SELECT p_student_id, p_section, p_domain, p_skill, v_score, v_pct, v_level,
     v_acc_test, v_acc_practice, v_acc_review, v_total, v_active_version, v_constants_hash,
     ce.event_id, ce.occurred_at, now()
  FROM public.canonical_mastery_events(p_student_id, 'skill', p_section, p_domain, p_skill) ce
  ORDER BY ce.occurred_at DESC, ce.event_id DESC LIMIT 1
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
     mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
     acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
     event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
     constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, last_event_id=EXCLUDED.last_event_id,
     last_event_occurred_at=EXCLUDED.last_event_occurred_at, computed_at=EXCLUDED.computed_at
  RETURNING * INTO v_row;
  IF v_row.student_id IS NULL THEN
    UPDATE public.student_skill_mastery SET mastery_score=NULL, mastery_pct=NULL, mastery_level=NULL,
      acc_test=NULL, acc_practice=NULL, acc_review=NULL, event_count_total=0,
      mastery_model_version=v_active_version, constants_snapshot_hash=v_constants_hash, computed_at=now()
    WHERE student_id=p_student_id AND section=p_section AND domain=p_domain AND skill=p_skill
    RETURNING * INTO v_row;
  END IF;

  -- Q4 CLOSURE (Doc 05A §5.1): conditional downstream fan-out. When p_chain_downstream
  -- is true (the default — event-time path via apply_mastery_event or standalone recompute),
  -- fire refresh_domain_mastery + bump_projection_refresh_counter in this transaction.
  -- When false (backfill path), the caller handles domain/KPI/projection in strict
  -- skill→domain→KPI→projection order with lock-order monotonicity (Doc 05D §7.2).
  -- Provenance GUC: COALESCE(NULLIF(...,''),'backfill_recompute') inherits an already-set
  -- GUC (apply_mastery_event sets 'event') or defaults to 'backfill_recompute' for
  -- standalone recompute calls. LYCEON-MIGRATION-REVIEWED
  -- set_config(name, value, is_local) with is_local=true = SET LOCAL semantics.
  -- SET LOCAL cannot evaluate expressions, so set_config is required here. LYCEON-MIGRATION-REVIEWED
  IF p_chain_downstream THEN
    PERFORM set_config('app.mastery_refresh_trigger',
      COALESCE(NULLIF(current_setting('app.mastery_refresh_trigger', true), ''), 'backfill_recompute'),
      true);
    PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);
    PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);
  END IF;

  RETURN v_row;
END;
$$;


--
-- Name: mastery_derivation_gap_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_derivation_gap_ledger (
    observation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    total_gap_count integer NOT NULL,
    students_affected integer NOT NULL,
    oldest_gap_at timestamp with time zone,
    detector_version text DEFAULT 'v1.0'::text NOT NULL,
    CONSTRAINT mastery_derivation_gap_ledger_students_nonneg CHECK ((students_affected >= 0)),
    CONSTRAINT mastery_derivation_gap_ledger_total_nonneg CHECK ((total_gap_count >= 0))
);


--
-- Name: TABLE mastery_derivation_gap_ledger; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mastery_derivation_gap_ledger IS 'Time series of mastery derivation gap observations. total_gap_count > 0 on the latest row is the alert condition.';


--
-- Name: record_mastery_derivation_gap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_mastery_derivation_gap() RETURNS public.mastery_derivation_gap_ledger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_total    integer;
  v_students integer;
  v_oldest   timestamptz;
  v_row      public.mastery_derivation_gap_ledger;
BEGIN
  SELECT
    COALESCE(sum(s.gap_count), 0)::integer,
    count(*)::integer,
    min(s.oldest_gap_at)
  INTO v_total, v_students, v_oldest
  FROM public.mastery_derivation_gap_summary s;

  INSERT INTO public.mastery_derivation_gap_ledger
    (observed_at, total_gap_count, students_affected, oldest_gap_at, detector_version)
  VALUES (clock_timestamp(), v_total, v_students, v_oldest, 'v1.0')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


--
-- Name: FUNCTION record_mastery_derivation_gap(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_mastery_derivation_gap() IS 'Snapshots mastery_derivation_gap_summary into mastery_derivation_gap_ledger. Detection only — writes no mastery table.';


--
-- Name: student_domain_kpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_domain_kpi (
    student_id uuid NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    events_total integer DEFAULT 0 NOT NULL,
    events_last_7d integer DEFAULT 0 NOT NULL,
    events_last_30d integer DEFAULT 0 NOT NULL,
    accuracy_overall numeric(5,4),
    accuracy_last_7d numeric(5,4),
    accuracy_last_30d numeric(5,4),
    last_active_at timestamp with time zone,
    kpi_refresh_version text DEFAULT 'v1.0'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone NOT NULL,
    CONSTRAINT student_domain_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_domain_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_domain_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_domain_kpi_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: refresh_domain_kpi(uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_domain_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone DEFAULT now()) RETURNS public.student_domain_kpi
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_domain_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_domain|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: domain KPI lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section %, domain % (refresh_domain_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH domain_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*)                                                AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0
           THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) ELSE NULL END AS acc_30d,
      MAX(occurred_at) AS last_active
    FROM domain_events
  )
  INSERT INTO public.student_domain_kpi (
    student_id, section, domain, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, p_domain, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a
  ON CONFLICT (student_id, section, domain) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;


--
-- Name: student_domain_mastery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_domain_mastery (
    student_id uuid NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    mastery_score numeric(5,4),
    mastery_pct numeric(5,2),
    mastery_level smallint,
    event_count_total integer DEFAULT 0 NOT NULL,
    mastery_model_version text DEFAULT 'v1.0'::text NOT NULL,
    constants_snapshot_hash text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    acc_test numeric(7,6),
    acc_practice numeric(7,6),
    acc_review numeric(7,6),
    last_event_id uuid,
    last_event_occurred_at timestamp with time zone,
    CONSTRAINT student_domain_mastery_mastery_level_check CHECK (((mastery_level IS NULL) OR ((mastery_level >= 0) AND (mastery_level <= 4)))),
    CONSTRAINT student_domain_mastery_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: refresh_domain_mastery(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_domain_mastery(p_student_id uuid, p_section text, p_domain text) RETURNS public.student_domain_mastery
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: student_overall_kpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_overall_kpi (
    student_id uuid NOT NULL,
    events_total integer DEFAULT 0 NOT NULL,
    events_last_7d integer DEFAULT 0 NOT NULL,
    events_last_30d integer DEFAULT 0 NOT NULL,
    accuracy_overall numeric(5,4),
    accuracy_last_7d numeric(5,4),
    accuracy_last_30d numeric(5,4),
    sections_active smallint DEFAULT 0 NOT NULL,
    current_streak_days integer DEFAULT 0 NOT NULL,
    longest_streak_days integer DEFAULT 0 NOT NULL,
    last_active_at timestamp with time zone,
    kpi_refresh_version text DEFAULT 'v1.0'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone NOT NULL,
    CONSTRAINT student_overall_kpi_current_streak_days_check CHECK ((current_streak_days >= 0)),
    CONSTRAINT student_overall_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_overall_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_overall_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_overall_kpi_longest_streak_days_check CHECK ((longest_streak_days >= 0)),
    CONSTRAINT student_overall_kpi_sections_active_check CHECK (((sections_active >= 0) AND (sections_active <= 2)))
);


--
-- Name: refresh_overall_kpi(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_overall_kpi(p_student_id uuid, p_t_now timestamp with time zone DEFAULT now()) RETURNS public.student_overall_kpi
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_overall_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_overall|' || p_student_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: overall KPI lock (%)', p_student_id;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student % (refresh_overall_kpi)', v_bad_count, p_student_id;
  END IF;

  WITH all_events AS (
    SELECT section, correct, occurred_at FROM (
      SELECT pi.question_section AS section, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.section, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*) AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END AS acc_30d,
      COUNT(DISTINCT section)::smallint AS sec_active,
      MAX(occurred_at) AS last_active
    FROM all_events
  ),
  streak AS (
    SELECT
      public.compute_streak_days(p_student_id, NULL::text, NULL::text, NULL::text, p_t_now) AS current_streak,
      public.compute_longest_streak_days(p_student_id, p_t_now) AS longest_streak
  )
  INSERT INTO public.student_overall_kpi (
    student_id, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    sections_active, current_streak_days, longest_streak_days, last_active_at,
    kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, a.evt_total, a.evt_7d, a.evt_30d,
    a.acc_overall, a.acc_7d, a.acc_30d,
    a.sec_active, s.current_streak, s.longest_streak, a.last_active,
    'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    sections_active=EXCLUDED.sections_active, current_streak_days=EXCLUDED.current_streak_days,
    longest_streak_days=EXCLUDED.longest_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;


--
-- Name: student_section_kpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_section_kpi (
    student_id uuid NOT NULL,
    section text NOT NULL,
    events_total integer DEFAULT 0 NOT NULL,
    events_last_7d integer DEFAULT 0 NOT NULL,
    events_last_30d integer DEFAULT 0 NOT NULL,
    accuracy_overall numeric(5,4),
    accuracy_last_7d numeric(5,4),
    accuracy_last_30d numeric(5,4),
    current_streak_days integer DEFAULT 0 NOT NULL,
    last_active_at timestamp with time zone,
    kpi_refresh_version text DEFAULT 'v1.0'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone NOT NULL,
    CONSTRAINT student_section_kpi_current_streak_days_check CHECK ((current_streak_days >= 0)),
    CONSTRAINT student_section_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_section_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_section_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_section_kpi_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: refresh_section_kpi(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamp with time zone DEFAULT now()) RETURNS public.student_section_kpi
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_section_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_section|' || p_student_id::text || '|' || p_section));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: section KPI lock (%, %)', p_student_id, p_section;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- RB-05B-V1-02: explicit data-integrity validation, no silent NULL filter.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section % (refresh_section_kpi)', v_bad_count, p_student_id, p_section;
  END IF;

  WITH section_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*)                                                AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0
           THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) ELSE NULL END AS acc_30d,
      MAX(occurred_at) AS last_active
    FROM section_events
  ),
  streak AS (
    SELECT public.compute_streak_days(p_student_id, p_section, NULL::text, NULL::text, p_t_now) AS current_streak
  )
  INSERT INTO public.student_section_kpi (
    student_id, section, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    current_streak_days, last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    s.current_streak, a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id, section) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    current_streak_days=EXCLUDED.current_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;


--
-- Name: refresh_skill_kpi(uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_skill_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone DEFAULT now()) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_skill_batch|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: skill KPI batch lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.question_skill AS skill, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL OR e.skill IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at/skill for student %, section %, domain % (refresh_skill_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH skill_events AS (
    SELECT skill, correct, occurred_at FROM (
      SELECT pi.question_skill AS skill, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
  )
  INSERT INTO public.student_skill_kpi (
    student_id, section, domain, skill, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT
    p_student_id, p_section, p_domain, se.skill,
    COUNT(*),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff),
    ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4),
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END,
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END,
    MAX(occurred_at),
    'v1.0', now(), p_t_now
  FROM skill_events se
  GROUP BY se.skill
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now;
END;
$$;


--
-- Name: request_account_deletion(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer DEFAULT 7) RETURNS TABLE(requested_at timestamp with time zone, scheduled_hard_delete_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now   timestamptz := now();
  v_sched timestamptz := now() + make_interval(days => p_grace_days);
BEGIN
  -- Idempotency: surface the existing pending request rather than creating a second one.
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests adr
     WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
  ) THEN
    RETURN QUERY
      SELECT adr.requested_at, adr.scheduled_hard_delete_at
        FROM public.account_deletion_requests adr
       WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
       LIMIT 1;
    RETURN;
  END IF;

  UPDATE public.profiles SET deleted_at = v_now, updated_at = v_now WHERE id = p_profile_id;

  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status,
     stripe_cancellation_status, recovery_token_hash, recovery_token_expires_at)
  VALUES
    (p_profile_id, v_now, v_sched, p_actor_id, 'pending',
     'pending', p_recovery_token_hash, v_sched);

  RETURN QUERY SELECT v_now, v_sched;
END;
$$;


--
-- Name: restore_account_deletion(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_account_deletion(p_recovery_token_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT adr.profile_id INTO v_profile_id
    FROM public.account_deletion_requests adr
   WHERE adr.recovery_token_hash    = p_recovery_token_hash
     AND adr.status                 = 'pending'
     AND adr.recovery_token_expires_at > now()
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = v_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE recovery_token_hash = p_recovery_token_hash
     AND status              = 'pending';

  RETURN v_profile_id;
END;
$$;


--
-- Name: revoke_guardian_link_audited(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text) RETURNS public.guardian_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_after  public.guardian_links;
  v_target uuid;
BEGIN
  UPDATE public.guardian_links
     SET status = 'revoked',
         revoked_at = now(),
         revoked_by_profile_id = p_revoked_by,
         revocation_reason = p_reason
   WHERE guardian_profile_id = p_guardian_id
     AND student_profile_id  = p_student_id
     AND status = 'active'
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link is not active' USING ERRCODE = 'LY003';
  END IF;

  v_target := CASE WHEN p_revoked_by = v_after.student_profile_id
                   THEN v_after.guardian_profile_id
                   ELSE v_after.student_profile_id
              END;

  -- The reason is on the ROW and deliberately NOT in `changes`: free text, often written by a
  -- minor, and the trail records the transition rather than its prose (§12.1).
  PERFORM public.guardian_link_audit(
    'guardian_link_revoked', p_revoked_by, v_target,
    jsonb_build_object('from', 'active', 'to', v_after.status),
    v_after.id, p_request_id
  );

  RETURN v_after;
END;
$$;


--
-- Name: round_to_step(numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.round_to_step(p_value numeric, p_step integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (ROUND(p_value / p_step) * p_step)::integer;
$$;


--
-- Name: select_diagnostic_pool(integer, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.select_diagnostic_pool(p_per_domain integer DEFAULT 5, p_exclude_ids text[] DEFAULT NULL::text[]) RETURNS TABLE(id text, section text, stem text, options jsonb, difficulty integer, correct_answer text, explanation text, domain text, skill_codes text[], source_type integer, item_type text, correct_variants text[], passage text, assets jsonb, option_metadata jsonb, estimated_time_seconds integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  -- Step 1: define the 8 canonical domains (byte-identical to Doc 05 Parent §10.2 /
  -- projection evidence gate / mastery_constants domain strings).
  WITH canonical_domains(cd_section, cd_domain) AS (
    VALUES
      ('M',  'Algebra'),
      ('M',  'Advanced Math'),
      ('M',  'Problem Solving and Data Analysis'),
      ('M',  'Geometry and Trigonometry'),
      ('RW', 'Information and Ideas'),
      ('RW', 'Craft and Structure'),
      ('RW', 'Expression of Ideas'),
      ('RW', 'Standard English Conventions')
  ),
  -- Step 2: rank questions within each (domain, difficulty) group randomly.
  per_difficulty AS (
    SELECT
      q.id, q.section, q.stem, q.options, q.difficulty, q.correct_answer,
      q.explanation, q.domain, q.skill_codes, q.source_type, q.item_type,
      q.correct_variants, q.passage, q.assets, q.option_metadata,
      q.estimated_time_seconds,
      ROW_NUMBER() OVER (
        PARTITION BY q.domain, q.difficulty
        ORDER BY random()
      ) AS diff_rank
    FROM public.servable_questions q
    JOIN canonical_domains cd ON q.domain = cd.cd_domain AND q.section = cd.cd_section
    WHERE (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ),
  -- Step 3: interleave across difficulties within each domain.
  -- ORDER BY diff_rank (round), then difficulty (1→2→3 within each round).
  -- For 5 picks: round 1 gets easy/medium/hard, round 2 gets easy/medium = 5 total.
  interleaved AS (
    SELECT
      pd.*,
      ROW_NUMBER() OVER (
        PARTITION BY pd.domain
        ORDER BY pd.diff_rank, pd.difficulty
      ) AS domain_rank
    FROM per_difficulty pd
  )
  -- Step 4: take top p_per_domain per domain, ordered by section then domain.
  SELECT
    il.id, il.section, il.stem, il.options, il.difficulty, il.correct_answer,
    il.explanation, il.domain, il.skill_codes, il.source_type, il.item_type,
    il.correct_variants, il.passage, il.assets, il.option_metadata,
    il.estimated_time_seconds
  FROM interleaved il
  WHERE il.domain_rank <= p_per_domain
  ORDER BY il.section, il.domain, il.domain_rank;
$$;


--
-- Name: select_practice_pool_random(text[], text[], text[], integer[], text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.select_practice_pool_random(p_sections text[] DEFAULT NULL::text[], p_domains text[] DEFAULT NULL::text[], p_skills text[] DEFAULT NULL::text[], p_difficulties integer[] DEFAULT NULL::integer[], p_exclude_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10) RETURNS TABLE(id text, section text, stem text, options jsonb, difficulty integer, correct_answer text, explanation text, domain text, skill_codes text[], source_type integer, item_type text, correct_variants text[], passage text, assets jsonb, option_metadata jsonb, estimated_time_seconds integer)
    LANGUAGE sql
    AS $$
  SELECT
    q.id,
    q.section,
    q.stem,
    q.options,
    q.difficulty,
    q.correct_answer,
    q.explanation,
    q.domain,
    q.skill_codes,
    q.source_type,
    q.item_type,
    q.correct_variants,
    q.passage,
    q.assets,
    q.option_metadata,
    q.estimated_time_seconds
  FROM public.servable_questions q
  WHERE (p_sections IS NULL    OR q.section = ANY(p_sections))
    AND (p_domains IS NULL     OR q.domain = ANY(p_domains))
    AND (p_skills IS NULL      OR q.skill_codes && p_skills)
    AND (p_difficulties IS NULL OR q.difficulty = ANY(p_difficulties))
    AND (p_exclude_ids IS NULL OR q.id != ALL(p_exclude_ids))
  ORDER BY random()
  LIMIT p_limit;
$$;


--
-- Name: set_profile_age_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_profile_age_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.date_of_birth IS NULL THEN
    NEW.age_years   := NULL;
    NEW.is_under_13 := NULL;
  ELSE
    NEW.age_years   := EXTRACT(YEAR FROM age(NEW.date_of_birth))::INTEGER;
    NEW.is_under_13 := (EXTRACT(YEAR FROM age(NEW.date_of_birth))::INTEGER < 13);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: student_diagnostic_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_diagnostic_state(p_student_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    (SELECT s.state FROM public.student_diagnostic_states s
      WHERE s.student_id = p_student_id),
    'not_taken'
  );
$$;


--
-- Name: FUNCTION student_diagnostic_state(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.student_diagnostic_state(p_student_id uuid) IS 'Diagnostic lifecycle state for one student. Returns not_taken for a student with no diagnostic session, so callers never have to interpret an absent row.';


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: validate_memory_summary_schema(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_memory_summary_schema() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_content JSONB := NEW.content_json;
  v_type    TEXT  := NEW.summary_type;
  v_version TEXT;
BEGIN
  -- Every summary must have summary_version
  IF NOT (v_content ? 'summary_version') THEN
    RAISE EXCEPTION 'Memory summary missing summary_version';
  END IF;

  v_version := v_content->>'summary_version';

  IF v_version != '1.0' THEN
    RAISE EXCEPTION 'Unsupported summary_version: %', v_version;
  END IF;

  -- Per-type validation
  IF v_type = 'teaching_profile' THEN
    IF NOT (v_content ? 'learning_style_signals'
      AND v_content ? 'last_struggled_skill'
      AND v_content ? 'last_mastered_skill'
      AND v_content ? 'engagement_summary') THEN
      RAISE EXCEPTION 'teaching_profile missing required fields';
    END IF;

  ELSIF v_type = 'chat_compaction' THEN
    IF NOT (v_content ? 'conversation_id'
      AND v_content ? 'source_window_start'
      AND v_content ? 'source_window_end'
      AND v_content ? 'turns_compacted'
      AND v_content ? 'topics_discussed'
      AND v_content ? 'skills_referenced'
      AND v_content ? 'key_insights'
      AND v_content ? 'unresolved_confusion') THEN
      RAISE EXCEPTION 'chat_compaction missing required fields';
    END IF;

    -- Bounds check
    IF jsonb_array_length(v_content->'key_insights') > 5 THEN
      RAISE EXCEPTION 'chat_compaction key_insights exceeds 5 entries';
    END IF;
    IF jsonb_array_length(v_content->'unresolved_confusion') > 5 THEN
      RAISE EXCEPTION 'chat_compaction unresolved_confusion exceeds 5 entries';
    END IF;
    IF jsonb_array_length(v_content->'topics_discussed') > 10 THEN
      RAISE EXCEPTION 'chat_compaction topics_discussed exceeds 10 entries';
    END IF;

  ELSIF v_type = 'recent_learning_pattern' THEN
    IF NOT (v_content ? 'window_days'
      AND v_content ? 'sections_active'
      AND v_content ? 'skills_improved'
      AND v_content ? 'skills_regressed'
      AND v_content ? 'skills_stuck'
      AND v_content ? 'attempts_total'
      AND v_content ? 'pass_rate') THEN
      RAISE EXCEPTION 'recent_learning_pattern missing required fields';
    END IF;

  ELSIF v_type = 'study_context' THEN
    IF NOT (v_content ? 'current_focus_skills'
      AND v_content ? 'upcoming_scheduled_sessions') THEN
      RAISE EXCEPTION 'study_context missing required fields';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown summary_type: %', v_type;
  END IF;

  -- Size bound (10KB max)
  IF pg_column_size(v_content) > 10240 THEN
    RAISE EXCEPTION 'Memory summary exceeds 10KB size bound';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: abuse_score_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abuse_score_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_profile_id uuid NOT NULL,
    incident_type text NOT NULL,
    severity smallint NOT NULL,
    context jsonb,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    source_module text NOT NULL,
    CONSTRAINT abuse_score_incidents_severity_check CHECK (((severity >= 1) AND (severity <= 5)))
);


--
-- Name: abuse_score_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abuse_score_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT abuse_score_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT abuse_score_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: abuse_score_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abuse_score_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: abuse_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abuse_scores (
    student_profile_id uuid NOT NULL,
    score integer NOT NULL,
    tier text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_override boolean DEFAULT false,
    manual_override_expires_at timestamp with time zone,
    appeal_history jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT abuse_scores_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: account_deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_hard_delete_at timestamp with time zone NOT NULL,
    actor_profile_id uuid NOT NULL,
    status text NOT NULL,
    stripe_cancellation_status text DEFAULT 'pending'::text NOT NULL,
    completion_at timestamp with time zone,
    deletion_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recovery_token_hash text,
    recovery_token_expires_at timestamp with time zone,
    CONSTRAINT account_deletion_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'cancelled'::text, 'completed'::text]))),
    CONSTRAINT account_deletion_requests_stripe_cancellation_status_check CHECK ((stripe_cancellation_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed_manual'::text, 'cancelled_by_recovery'::text])))
);


--
-- Name: account_deletion_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT account_deletion_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT account_deletion_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: account_deletion_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: anonymized_actors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anonymized_actors (
    actor_id uuid NOT NULL,
    anonymized_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_profile_id uuid,
    target_profile_id uuid,
    action text NOT NULL,
    changes jsonb,
    context jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_mfa_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT auth_mfa_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT auth_mfa_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: auth_mfa_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT auth_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT auth_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: auth_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: caching_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caching_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT caching_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT caching_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: caching_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caching_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id text NOT NULL,
    section text NOT NULL,
    source_type integer NOT NULL,
    domain text NOT NULL,
    skill_codes text[] NOT NULL,
    difficulty integer NOT NULL,
    stem text NOT NULL,
    passage text,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_metadata jsonb,
    assets jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    retired_at timestamp with time zone,
    source_lineage jsonb,
    generation_attribution jsonb,
    estimated_time_seconds integer,
    premium_flag boolean DEFAULT false,
    quality_score numeric,
    issue_flags text[],
    item_type text DEFAULT 'mcq'::text NOT NULL,
    correct_variants text[],
    CONSTRAINT questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 3))),
    CONSTRAINT questions_domain_section_canonical CHECK ((((section = 'M'::text) AND (domain = ANY (ARRAY['Algebra'::text, 'Advanced Math'::text, 'Problem Solving and Data Analysis'::text, 'Geometry and Trigonometry'::text]))) OR ((section = 'RW'::text) AND (domain = ANY (ARRAY['Information and Ideas'::text, 'Craft and Structure'::text, 'Expression of Ideas'::text, 'Standard English Conventions'::text]))))),
    CONSTRAINT questions_id_check CHECK ((id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'::text)),
    CONSTRAINT questions_item_shape_chk CHECK ((((item_type = 'mcq'::text) AND (jsonb_typeof(options) = 'array'::text) AND (jsonb_array_length(options) = 4) AND (correct_variants IS NULL)) OR ((item_type = 'grid_in'::text) AND (jsonb_typeof(options) = 'array'::text) AND (jsonb_array_length(options) = 0) AND (correct_variants IS NOT NULL) AND (array_length(correct_variants, 1) >= 1)))),
    CONSTRAINT questions_item_type_check CHECK ((item_type = ANY (ARRAY['mcq'::text, 'grid_in'::text]))),
    CONSTRAINT questions_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT questions_source_type_check CHECK ((source_type = ANY (ARRAY[1, 2]))),
    CONSTRAINT questions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'qa'::text, 'published'::text, 'retired'::text])))
);


--
-- Name: canonical_skill_catalog; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.canonical_skill_catalog WITH (security_invoker='true') AS
 SELECT DISTINCT q.section,
    q.domain,
    s.skill
   FROM (public.questions q
     CROSS JOIN LATERAL unnest(q.skill_codes) s(skill))
  WHERE ((q.status = 'published'::text) AND (btrim(s.skill) <> ''::text));


--
-- Name: VIEW canonical_skill_catalog; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.canonical_skill_catalog IS 'Distinct (section, domain, skill) over published questions. The drill-down catalog: replaces the hardcoded SAT_TAXONOMY whose slugs never matched the canonical DB values. Projection-only, carries no question content.';


--
-- Name: consent_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT consent_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT consent_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: consent_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crisis_review_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crisis_review_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid,
    conversation_id uuid,
    reviewer_id uuid NOT NULL,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crisis_review_audit_log_action_check CHECK ((action = ANY (ARRAY['viewed'::text, 'status_changed'::text, 'disposition_set'::text, 'note_added'::text])))
);


--
-- Name: crisis_review_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crisis_review_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    student_id uuid NOT NULL,
    source text NOT NULL,
    signature_id uuid,
    model_confidence numeric,
    status text DEFAULT 'open'::text NOT NULL,
    disposition text,
    reviewer_id uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    sla_deadline timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crisis_review_cases_disposition_check CHECK (((disposition IS NULL) OR (disposition = ANY (ARRAY['true_positive'::text, 'false_positive'::text])))),
    CONSTRAINT crisis_review_cases_source_check CHECK ((source = ANY (ARRAY['signature'::text, 'model'::text, 'both'::text, 'classifier_degraded'::text, 'classifier_degraded_no_floor'::text, 'infrastructure_failure'::text]))),
    CONSTRAINT crisis_review_cases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text])))
);


--
-- Name: difficulties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.difficulties (
    value integer NOT NULL,
    label text NOT NULL,
    description text
);


--
-- Name: distractor_taxonomy_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distractor_taxonomy_v1 (
    section text NOT NULL,
    label text NOT NULL,
    description text,
    version text DEFAULT 'distractor_taxonomy.v1'::text NOT NULL
);


--
-- Name: entitlement_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_features (
    feature_key text NOT NULL,
    required_tier text NOT NULL,
    required_age_minimum integer DEFAULT 13,
    requires_tier_1_country boolean DEFAULT true,
    blocked_during_live_exam boolean DEFAULT false,
    min_abuse_score_tier text DEFAULT 'clean'::text,
    enabled boolean DEFAULT true,
    description text,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    deprecated_at timestamp with time zone,
    CONSTRAINT entitlement_features_required_tier_check CHECK ((required_tier = ANY (ARRAY['free'::text, 'premium'::text])))
);


--
-- Name: entitlement_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT entitlement_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT entitlement_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: entitlement_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    tier text NOT NULL,
    status text NOT NULL,
    stripe_subscription_id text,
    stripe_subscription_item_id text,
    stripe_price_id text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    grace_period_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entitlements_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'canceled'::text, 'unpaid'::text, 'incomplete'::text, 'incomplete_expired'::text, 'trialing'::text]))),
    CONSTRAINT entitlements_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'premium'::text])))
);


--
-- Name: COLUMN entitlements.stripe_subscription_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.entitlements.stripe_subscription_item_id IS 'SCL-045: the subscription ITEM this entitlement is keyed to. One item per entitled student, so one guardian subscription can carry several. NULL on rows written before 2026-08-27 and backfilled by the next customer.subscription.updated for that subscription — the item id is not derivable in SQL.';


--
-- Name: exam_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT exam_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT exam_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: exam_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: full_length_adaptive_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.full_length_adaptive_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT full_length_adaptive_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT full_length_adaptive_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: full_length_adaptive_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.full_length_adaptive_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guardian_consent_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardian_consent_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_profile_id uuid NOT NULL,
    guardian_email text NOT NULL,
    guardian_profile_id uuid,
    status text NOT NULL,
    consent_token text NOT NULL,
    consent_token_expires_at timestamp with time zone NOT NULL,
    consented_at timestamp with time zone,
    denied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardian_consent_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'consented'::text, 'denied'::text, 'expired'::text])))
);


--
-- Name: idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_records (
    scope text NOT NULL,
    client_key text NOT NULL,
    content_hash text NOT NULL,
    result jsonb,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_records_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'in_progress'::text, 'failed'::text])))
);


--
-- Name: idempotency_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT idempotency_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT idempotency_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: idempotency_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: internal_service_auth_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_service_auth_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT internal_service_auth_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT internal_service_auth_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: internal_service_auth_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_service_auth_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legal_acceptance_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_acceptance_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: COLUMN legal_acceptance_outbox.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legal_acceptance_outbox.user_id IS 'Auth user id (no FK). Independent durable key so consent intent survives even when the profiles row is not yet present; the drain resolves it into legal_acceptances (which keeps its profiles FK).';


--
-- Name: legal_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    doc_key text NOT NULL,
    doc_version text NOT NULL,
    actor_type text NOT NULL,
    minor boolean DEFAULT false NOT NULL,
    consent_source text NOT NULL,
    user_agent text,
    ip_address text,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_acceptances_actor_type_check CHECK ((actor_type = ANY (ARRAY['student'::text, 'parent'::text]))),
    CONSTRAINT legal_acceptances_consent_source_check CHECK ((consent_source = ANY (ARRAY['email_signup_form'::text, 'google_continue_pre_oauth'::text, 'google_continue_click'::text])))
);


--
-- Name: mastery_constants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_constants (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid
);


--
-- Name: mastery_constants_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_constants_change_log (
    change_id bigint NOT NULL,
    key text NOT NULL,
    op text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    affects_formula_hash boolean NOT NULL,
    actor_role text NOT NULL,
    actor_session_user text NOT NULL,
    txid bigint NOT NULL,
    resulting_state_hash text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mastery_constants_change_log_op_check CHECK ((op = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: mastery_constants_change_log_change_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants_change_log ALTER COLUMN change_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mastery_constants_change_log_change_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mastery_constants_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_constants_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mastery_domain_refresh_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_domain_refresh_audit_log (
    audit_row_id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    section text NOT NULL,
    domain text NOT NULL,
    mastery_score_before numeric(5,4),
    mastery_score_after numeric(5,4),
    mastery_level_before smallint,
    mastery_level_after smallint,
    event_count_after integer NOT NULL,
    constants_snapshot_hash text NOT NULL,
    mastery_model_version text NOT NULL,
    triggered_by text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    CONSTRAINT mastery_domain_refresh_audit_log_event_count_after_check CHECK ((event_count_after >= 0)),
    CONSTRAINT mastery_domain_refresh_audit_log_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT mastery_domain_refresh_audit_log_triggered_by_check CHECK ((triggered_by = ANY (ARRAY['event'::text, 'backfill_recompute'::text])))
);


--
-- Name: mastery_event_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_event_audit_log (
    audit_row_id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    section text NOT NULL,
    domain text NOT NULL,
    skill text NOT NULL,
    source_family text NOT NULL,
    event_source_kind text NOT NULL,
    event_id uuid NOT NULL,
    question_id text,
    difficulty smallint,
    correct boolean,
    occurred_at timestamp with time zone,
    mastery_score_before numeric(5,4),
    mastery_score_after numeric(5,4),
    mastery_level_before smallint,
    mastery_level_after smallint,
    event_count_after integer NOT NULL,
    constants_snapshot_hash text NOT NULL,
    mastery_model_version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    CONSTRAINT mastery_event_audit_log_event_count_after_check CHECK ((event_count_after >= 0)),
    CONSTRAINT mastery_event_audit_log_event_source_kind_check CHECK ((event_source_kind = ANY (ARRAY['practice_attempt'::text, 'diagnostic_attempt'::text, 'review_error_attempt'::text, 'full_length_answer'::text]))),
    CONSTRAINT mastery_event_audit_log_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT mastery_event_audit_log_source_family_check CHECK ((source_family = ANY (ARRAY['test'::text, 'practice'::text, 'review'::text])))
);


--
-- Name: practice_session_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_session_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    ordinal integer NOT NULL,
    question_id text NOT NULL,
    question_stem text NOT NULL,
    question_passage text,
    question_options jsonb NOT NULL,
    question_correct_answer text NOT NULL,
    question_explanation text NOT NULL,
    question_option_metadata jsonb,
    question_domain text NOT NULL,
    question_skill text NOT NULL,
    question_difficulty smallint NOT NULL,
    question_section text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    selected_answer text,
    is_correct boolean,
    outcome text,
    time_spent_ms integer,
    client_attempt_id text,
    answered_at timestamp with time zone,
    served_at timestamp with time zone,
    occurred_at timestamp with time zone,
    actor_id uuid NOT NULL,
    option_order text[],
    option_token_map jsonb,
    client_instance_id text,
    question_item_type text DEFAULT 'mcq'::text NOT NULL,
    question_correct_variants text[],
    question_assets jsonb,
    question_estimated_time_seconds integer,
    CONSTRAINT practice_session_items_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['correct'::text, 'incorrect'::text, 'skipped'::text])))),
    CONSTRAINT practice_session_items_question_difficulty_check CHECK (((question_difficulty >= 1) AND (question_difficulty <= 3))),
    CONSTRAINT practice_session_items_question_item_type_check CHECK ((question_item_type = ANY (ARRAY['mcq'::text, 'grid_in'::text]))),
    CONSTRAINT practice_session_items_question_section_check CHECK ((question_section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT practice_session_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'served'::text, 'answered'::text, 'skipped'::text]))),
    CONSTRAINT psi_item_shape_chk CHECK ((((question_item_type = 'mcq'::text) AND (question_correct_variants IS NULL)) OR ((question_item_type = 'grid_in'::text) AND (question_correct_variants IS NOT NULL) AND (array_length(question_correct_variants, 1) >= 1) AND (question_options = '[]'::jsonb)))),
    CONSTRAINT psi_question_domain_section_canonical CHECK ((((question_section = 'M'::text) AND (question_domain = ANY (ARRAY['Algebra'::text, 'Advanced Math'::text, 'Problem Solving and Data Analysis'::text, 'Geometry and Trigonometry'::text]))) OR ((question_section = 'RW'::text) AND (question_domain = ANY (ARRAY['Information and Ideas'::text, 'Craft and Structure'::text, 'Expression of Ideas'::text, 'Standard English Conventions'::text]))))),
    CONSTRAINT psi_resolved_requires_occurred_at CHECK (((status <> ALL (ARRAY['answered'::text, 'skipped'::text])) OR (occurred_at IS NOT NULL)))
);


--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    mode text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    target_count integer NOT NULL,
    platform text NOT NULL,
    client_instance_id text,
    status text DEFAULT 'created'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    actor_id uuid NOT NULL,
    abandoned_at timestamp with time zone,
    CONSTRAINT practice_sessions_abandoned_not_completed CHECK (((status <> 'abandoned'::text) OR ((completed_at IS NULL) AND (abandoned_at IS NOT NULL)))),
    CONSTRAINT practice_sessions_mode_check CHECK ((mode = ANY (ARRAY['flow'::text, 'structured'::text, 'balanced'::text, 'timed'::text, 'diagnostic'::text]))),
    CONSTRAINT practice_sessions_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'mobile'::text]))),
    CONSTRAINT practice_sessions_status_check CHECK ((status = ANY (ARRAY['created'::text, 'active'::text, 'completed'::text, 'abandoned'::text]))),
    CONSTRAINT practice_sessions_target_count_check CHECK ((target_count > 0))
);


--
-- Name: COLUMN practice_sessions.abandoned_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.practice_sessions.abandoned_at IS 'When the session was abandoned. Mutually exclusive with completed_at — enforced by practice_sessions_abandoned_not_completed.';


--
-- Name: review_error_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_error_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_item_id uuid,
    student_id uuid,
    question_id text NOT NULL,
    selected_answer text,
    is_correct boolean NOT NULL,
    seconds_spent integer,
    client_attempt_id text,
    used_tutor boolean DEFAULT false NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    skill text NOT NULL,
    difficulty smallint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    CONSTRAINT review_error_attempts_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 3))),
    CONSTRAINT review_error_attempts_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: mastery_derivation_gaps; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.mastery_derivation_gaps AS
 SELECT pi.user_id AS student_id,
    public.practice_session_mode_to_event_kind(ps.mode) AS event_source_kind,
    pi.id AS event_id,
    pi.question_section AS section,
    pi.question_domain AS domain,
    pi.question_skill AS skill,
    pi.question_id,
    pi.occurred_at
   FROM (public.practice_session_items pi
     JOIN public.practice_sessions ps ON ((ps.id = pi.session_id)))
  WHERE ((pi.status = 'answered'::text) AND (pi.user_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.mastery_event_audit_log al
          WHERE ((al.event_id = pi.id) AND (al.event_source_kind = public.practice_session_mode_to_event_kind(ps.mode)))))) AND (NOT (EXISTS ( SELECT 1
           FROM public.mastery_domain_refresh_audit_log ral
          WHERE ((ral.triggered_by = 'backfill_recompute'::text) AND (ral.student_id = pi.user_id) AND (ral.section = pi.question_section) AND (ral.domain = pi.question_domain) AND (pi.occurred_at <= ral.applied_at))))))
UNION ALL
 SELECT ra.student_id,
    'review_error_attempt'::text AS event_source_kind,
    ra.id AS event_id,
    ra.section,
    ra.domain,
    ra.skill,
    ra.question_id,
    ra.occurred_at
   FROM public.review_error_attempts ra
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM public.mastery_event_audit_log al
          WHERE ((al.event_id = ra.id) AND (al.event_source_kind = 'review_error_attempt'::text))))) AND (NOT (EXISTS ( SELECT 1
           FROM public.mastery_domain_refresh_audit_log ral
          WHERE ((ral.triggered_by = 'backfill_recompute'::text) AND (ral.student_id = ra.student_id) AND (ral.section = ra.section) AND (ral.domain = ra.domain) AND (ra.occurred_at <= ral.applied_at))))));


--
-- Name: VIEW mastery_derivation_gaps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.mastery_derivation_gaps IS 'Events derivable by canonical_mastery_events that have no attributable mastery_event_audit_log row AND were not rebuilt by a backfill covering their (student, section, domain) at or before they occurred. Non-empty = mastery emission is failing. Detection only — no writer.';


--
-- Name: mastery_derivation_gap_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.mastery_derivation_gap_summary AS
 SELECT student_id,
    (count(*))::integer AS gap_count,
    min(occurred_at) AS oldest_gap_at,
    max(occurred_at) AS newest_gap_at
   FROM public.mastery_derivation_gaps g
  GROUP BY student_id;


--
-- Name: VIEW mastery_derivation_gap_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.mastery_derivation_gap_summary IS 'Per-student rollup of mastery_derivation_gaps. Total across the platform = sum(gap_count).';


--
-- Name: mastery_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_levels (
    level_key text NOT NULL,
    level smallint,
    display_name text NOT NULL,
    sort_order smallint NOT NULL,
    CONSTRAINT mastery_levels_display_name_not_blank CHECK ((length(btrim(display_name)) > 0)),
    CONSTRAINT mastery_levels_level_range CHECK (((level IS NULL) OR ((level >= 0) AND (level <= 4)))),
    CONSTRAINT mastery_levels_unmeasured_is_null CHECK (((level_key = 'unmeasured'::text) = (level IS NULL)))
);


--
-- Name: TABLE mastery_levels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mastery_levels IS 'Display name per mastery level (0-4) plus the unmeasured state. Reference data: read-only at runtime, names only, never score boundaries (owner ruling 2026-08-20 RULE 2).';


--
-- Name: COLUMN mastery_levels.level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mastery_levels.level IS 'The integer the mastery formula emits, or NULL for the unmeasured state. NULL is not zero.';


--
-- Name: mobile_auth_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_auth_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT mobile_auth_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT mobile_auth_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: mobile_auth_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_auth_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    recipient_kind text NOT NULL,
    recipient_profile_id uuid NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    channel_hint text,
    CONSTRAINT notification_outbox_channel_hint_check CHECK (((channel_hint IS NULL) OR (channel_hint = ANY (ARRAY['in_app'::text, 'email'::text, 'push'::text])))),
    CONSTRAINT notification_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['guardian_linked'::text, 'quota_reached'::text, 'trial_ending'::text, 'payment_failed'::text, 'score_projection_updated'::text, 'mastery_milestone'::text]))),
    CONSTRAINT notification_outbox_recipient_kind_check CHECK ((recipient_kind = ANY (ARRAY['student'::text, 'guardian'::text, 'both'::text])))
);


--
-- Name: observability_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observability_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT observability_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT observability_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: observability_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observability_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: practice_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT practice_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT practice_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: practice_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    display_name text,
    role public.profile_role DEFAULT 'student'::public.profile_role NOT NULL,
    date_of_birth date,
    age_years integer,
    is_under_13 boolean,
    country_code text,
    stripe_customer_id text,
    guardian_email text,
    guardian_consent boolean DEFAULT false,
    consent_given_at timestamp with time zone,
    guardian_profile_id uuid,
    student_link_code text,
    student_link_code_issued_at timestamp with time zone,
    last_login_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_completed_at timestamp with time zone,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    actor_id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: COLUMN profiles.student_link_code_issued_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.student_link_code_issued_at IS 'SCL-080: when the current student_link_code was issued. NULL means no code has been issued yet. TTL comes from auth_runtime_config.student_link_code_ttl_seconds.';


--
-- Name: projection_refresh_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projection_refresh_outbox (
    outbox_id bigint NOT NULL,
    student_id uuid NOT NULL,
    reason text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT projection_refresh_outbox_reason_check CHECK ((reason = 'full_length_completed'::text))
);


--
-- Name: projection_refresh_outbox_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.projection_refresh_outbox ALTER COLUMN outbox_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.projection_refresh_outbox_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: psi_occurred_at_backfill_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.psi_occurred_at_backfill_log (
    item_id uuid NOT NULL,
    occurred_at_applied timestamp with time zone NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    migration_version text NOT NULL
);


--
-- Name: TABLE psi_occurred_at_backfill_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.psi_occurred_at_backfill_log IS 'One row per practice_session_items row repaired by migration 20260816000000. The only record of which rows the backfill touched — post-state cannot re-derive the set, because a repaired row is indistinguishable from one that always had occurred_at = answered_at.';


--
-- Name: rate_limit_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_ledger (
    profile_id uuid NOT NULL,
    bucket_key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    limit_count integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT rate_limit_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT rate_limit_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: rate_limit_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: review_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT review_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT review_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: review_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: review_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    question_id text NOT NULL,
    repetition_count integer DEFAULT 0 NOT NULL,
    interval_days integer DEFAULT 0 NOT NULL,
    ease_factor numeric NOT NULL,
    next_review_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    first_missed_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_schedule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'graduated'::text, 'retired'::text])))
);


--
-- Name: review_session_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_session_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    student_id uuid,
    ordinal integer NOT NULL,
    question_id text NOT NULL,
    question_stem text NOT NULL,
    question_passage text,
    question_options jsonb NOT NULL,
    question_correct_answer text NOT NULL,
    question_explanation text NOT NULL,
    question_option_metadata jsonb,
    question_domain text NOT NULL,
    question_skill text NOT NULL,
    question_difficulty smallint NOT NULL,
    question_section text NOT NULL,
    retry_mode text DEFAULT 'same_question'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    served_at timestamp with time zone,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    CONSTRAINT review_session_items_question_difficulty_check CHECK (((question_difficulty >= 1) AND (question_difficulty <= 3))),
    CONSTRAINT review_session_items_question_section_check CHECK ((question_section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT review_session_items_retry_mode_check CHECK ((retry_mode = ANY (ARRAY['same_question'::text, 'similar_question'::text]))),
    CONSTRAINT review_session_items_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'served'::text, 'answered'::text, 'skipped'::text])))
);


--
-- Name: review_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    source_origin text NOT NULL,
    client_instance_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    CONSTRAINT review_sessions_source_origin_check CHECK ((source_origin = ANY (ARRAY['practice'::text, 'full_test'::text]))),
    CONSTRAINT review_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    code text NOT NULL,
    label text NOT NULL,
    description text
);


--
-- Name: servable_questions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.servable_questions WITH (security_invoker='true') AS
 SELECT id,
    section,
    source_type,
    domain,
    skill_codes,
    difficulty,
    stem,
    passage,
    options,
    correct_answer,
    explanation,
    option_metadata,
    assets,
    status,
    version,
    created_at,
    published_at,
    retired_at,
    source_lineage,
    generation_attribution,
    estimated_time_seconds,
    premium_flag,
    quality_score,
    issue_flags,
    item_type,
    correct_variants
   FROM public.questions
  WHERE ((status = 'published'::text) AND ((issue_flags IS NULL) OR (array_length(issue_flags, 1) IS NULL)));


--
-- Name: service_auth_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_auth_secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    caller_service text NOT NULL,
    callee_service text NOT NULL,
    secret_material text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active_until timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: source_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_types (
    code integer NOT NULL,
    label text NOT NULL,
    description text
);


--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_events (
    id text NOT NULL,
    type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE stripe_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stripe_webhook_events IS 'Idempotency gate for Stripe webhook processing (STRIPE-001)';


--
-- Name: student_section_projection_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_section_projection_snapshots (
    snapshot_id bigint NOT NULL,
    student_id uuid NOT NULL,
    section text NOT NULL,
    projected_score_mid integer,
    projected_score_low integer,
    projected_score_high integer,
    range_width integer,
    relevant_question_count integer,
    mastery_term numeric(8,4),
    fl1_score integer,
    fl2_score integer,
    fl_count_used smallint DEFAULT 0 NOT NULL,
    blend_denominator smallint DEFAULT 1 NOT NULL,
    projection_constants_hash text,
    mastery_model_version text DEFAULT 'v1.0'::text NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_kind text DEFAULT 'periodic'::text NOT NULL,
    CONSTRAINT snapshot_kind_valid CHECK ((snapshot_kind = ANY (ARRAY['periodic'::text, 'diagnostic_baseline'::text]))),
    CONSTRAINT student_section_projection_snapshots_projected_score_high_check CHECK (((projected_score_high IS NULL) OR ((projected_score_high >= 200) AND (projected_score_high <= 800)))),
    CONSTRAINT student_section_projection_snapshots_projected_score_low_check CHECK (((projected_score_low IS NULL) OR ((projected_score_low >= 200) AND (projected_score_low <= 800)))),
    CONSTRAINT student_section_projection_snapshots_projected_score_mid_check CHECK (((projected_score_mid IS NULL) OR ((projected_score_mid >= 200) AND (projected_score_mid <= 800)))),
    CONSTRAINT student_section_projection_snapshots_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: student_diagnostic_states; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_diagnostic_states AS
 WITH diag AS (
         SELECT ps.user_id AS student_id,
            count(*) FILTER (WHERE (ps.status = 'completed'::text)) AS completed_count,
            count(*) FILTER (WHERE (ps.status = ANY (ARRAY['created'::text, 'active'::text]))) AS in_flight_count,
            max(ps.completed_at) FILTER (WHERE (ps.status = 'completed'::text)) AS diagnostic_completed_at,
            max(ps.last_activity_at) FILTER (WHERE (ps.status = 'completed'::text)) AS diagnostic_last_activity_at
           FROM public.practice_sessions ps
          WHERE ((ps.mode = 'diagnostic'::text) AND (ps.user_id IS NOT NULL))
          GROUP BY ps.user_id
        ), baseline AS (
         SELECT sn.student_id,
            count(DISTINCT sn.section) FILTER (WHERE (sn.projected_score_mid IS NOT NULL)) AS scored_sections,
            min(sn.snapshot_at) AS baseline_captured_at
           FROM public.student_section_projection_snapshots sn
          WHERE (sn.snapshot_kind = 'diagnostic_baseline'::text)
          GROUP BY sn.student_id
        )
 SELECT d.student_id,
        CASE
            WHEN ((d.completed_count > 0) AND (COALESCE(b.scored_sections, (0)::bigint) >= 2)) THEN 'baseline_ready'::text
            WHEN (d.completed_count > 0) THEN 'baseline_pending'::text
            WHEN (d.in_flight_count > 0) THEN 'in_progress'::text
            ELSE 'not_taken'::text
        END AS state,
    (d.completed_count)::integer AS completed_diagnostic_count,
    (d.in_flight_count)::integer AS in_flight_diagnostic_count,
    d.diagnostic_completed_at,
    COALESCE(d.diagnostic_completed_at, d.diagnostic_last_activity_at) AS diagnostic_finished_at,
    b.baseline_captured_at,
    (COALESCE(b.scored_sections, (0)::bigint))::integer AS baseline_scored_sections
   FROM (diag d
     LEFT JOIN baseline b ON ((b.student_id = d.student_id)));


--
-- Name: VIEW student_diagnostic_states; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.student_diagnostic_states IS 'One row per student with any diagnostic session. state is the single canonical answer to "where is this student in the diagnostic lifecycle": not_taken | in_progress | baseline_pending | baseline_ready. Precedence matches resolveDiagnosticStartDecision — completed is checked first and is terminal.';


--
-- Name: student_baseline_pending; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_baseline_pending AS
 SELECT student_id,
    diagnostic_finished_at,
    baseline_scored_sections,
    (EXTRACT(epoch FROM (now() - diagnostic_finished_at)))::bigint AS pending_seconds
   FROM public.student_diagnostic_states s
  WHERE (state = 'baseline_pending'::text);


--
-- Name: VIEW student_baseline_pending; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.student_baseline_pending IS 'Students who completed the diagnostic but have no usable diagnostic_baseline snapshot, with the age of that state. Age, not count, is the alert condition — a brief pending state is normal after every completion.';


--
-- Name: student_kpi_rollups_current; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_kpi_rollups_current (
    student_id uuid NOT NULL,
    scope text NOT NULL,
    scope_key text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_projection_refresh_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_projection_refresh_state (
    student_id uuid NOT NULL,
    events_since_refresh integer DEFAULT 0 NOT NULL,
    last_refresh_at timestamp with time zone,
    CONSTRAINT student_projection_refresh_state_events_since_refresh_check CHECK ((events_since_refresh >= 0))
);


--
-- Name: student_section_projection_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.student_section_projection_snapshots ALTER COLUMN snapshot_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_section_projection_snapshots_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_skill_kpi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_skill_kpi (
    student_id uuid NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    skill text NOT NULL,
    events_total integer DEFAULT 0 NOT NULL,
    events_last_7d integer DEFAULT 0 NOT NULL,
    events_last_30d integer DEFAULT 0 NOT NULL,
    accuracy_overall numeric(5,4),
    accuracy_last_7d numeric(5,4),
    accuracy_last_30d numeric(5,4),
    last_active_at timestamp with time zone,
    kpi_refresh_version text DEFAULT 'v1.0'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at_t_now timestamp with time zone NOT NULL,
    CONSTRAINT student_skill_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_skill_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_skill_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_skill_kpi_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: taxonomy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taxonomy_versions (
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    is_active boolean DEFAULT true
);


--
-- Name: tutor_context_resolution_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_context_resolution_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    turn_ordinal integer NOT NULL,
    context_version text,
    memory_summaries_count integer DEFAULT 0 NOT NULL,
    recent_messages_count integer DEFAULT 0 NOT NULL,
    mastery_snapshot_present boolean DEFAULT false NOT NULL,
    friction_signals_present boolean DEFAULT false NOT NULL,
    scope_type text,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tutor_context_resolution_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_context_resolution_log IS 'Doc 03A §11.3: per-turn context assembly audit. Records what context was assembled (version, counts, flags). Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';


--
-- Name: tutor_context_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_context_runtime_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    value_type text NOT NULL,
    min_value jsonb,
    max_value jsonb,
    allowed_values jsonb,
    owner text NOT NULL,
    description text NOT NULL,
    environment text DEFAULT 'all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_profile_id uuid,
    CONSTRAINT tutor_context_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT tutor_context_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: tutor_context_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_context_runtime_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by_profile_id uuid,
    change_reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutor_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    entry_mode text NOT NULL,
    source_surface text NOT NULL,
    source_session_id uuid,
    source_session_item_id uuid,
    source_question_row_id text,
    source_question_canonical_id text,
    policy_family text DEFAULT 'instructional_tutor'::text NOT NULL,
    policy_variant text DEFAULT 'scaffolded'::text NOT NULL,
    policy_version text DEFAULT '1.0'::text NOT NULL,
    prompt_version text,
    assignment_mode text DEFAULT 'deterministic'::text NOT NULL,
    assignment_key text,
    initialization_snapshot jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    crisis_flagged boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    entitlement_lost_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT tutor_conversations_assignment_mode_check CHECK ((assignment_mode = ANY (ARRAY['deterministic'::text, 'explore'::text, 'manual_override'::text]))),
    CONSTRAINT tutor_conversations_entry_mode_check CHECK ((entry_mode = ANY (ARRAY['scoped_question'::text, 'scoped_session'::text, 'general'::text]))),
    CONSTRAINT tutor_conversations_policy_variant_check CHECK ((policy_variant = ANY (ARRAY['concise'::text, 'scaffolded'::text, 'socratic'::text, 'strategy_first'::text]))),
    CONSTRAINT tutor_conversations_source_surface_check CHECK ((source_surface = ANY (ARRAY['practice'::text, 'review'::text, 'test_review'::text, 'dashboard'::text]))),
    CONSTRAINT tutor_conversations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'abandoned'::text])))
);


--
-- Name: TABLE tutor_conversations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_conversations IS 'LISA conversation envelopes with scope metadata. §18.1. Owner: tutor_runtime_writer (§17.4).';


--
-- Name: tutor_injection_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_injection_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    student_id uuid,
    message_id uuid,
    signature_matched text,
    detection_layer text NOT NULL,
    action_taken text NOT NULL,
    response_substituted text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tutor_injection_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_injection_log IS 'Injection/abuse detection events for safety review queue (INV-03-13). §18.7.';


--
-- Name: tutor_injection_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_injection_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signature_pattern text NOT NULL,
    signature_type text NOT NULL,
    severity text NOT NULL,
    action text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by text,
    CONSTRAINT tutor_injection_signatures_action_check CHECK ((action = ANY (ARRAY['flag'::text, 'reject'::text, 'silent_redirect'::text]))),
    CONSTRAINT tutor_injection_signatures_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE tutor_injection_signatures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_injection_signatures IS 'Known injection attack patterns. Admin-managed. §18.7.';


--
-- Name: tutor_instruction_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_instruction_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    student_id uuid NOT NULL,
    related_message_id uuid,
    source_session_id uuid,
    source_session_item_id uuid,
    source_question_row_id text,
    source_question_canonical_id text,
    policy_family text DEFAULT 'instructional_tutor'::text NOT NULL,
    policy_variant text NOT NULL,
    policy_version text NOT NULL,
    prompt_version text,
    assignment_mode text NOT NULL,
    assignment_key text,
    emotional_register text DEFAULT 'default'::text NOT NULL,
    reason_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reason_snapshot_size_bound CHECK ((pg_column_size(reason_snapshot) < 2048)),
    CONSTRAINT tutor_instruction_assignments_assignment_mode_check CHECK ((assignment_mode = ANY (ARRAY['deterministic'::text, 'explore'::text, 'manual_override'::text]))),
    CONSTRAINT tutor_instruction_assignments_emotional_register_check CHECK ((emotional_register = ANY (ARRAY['default'::text, 'elite'::text, 'recovery'::text, 'sprint'::text, 'calm'::text]))),
    CONSTRAINT tutor_instruction_assignments_policy_variant_check CHECK ((policy_variant = ANY (ARRAY['concise'::text, 'scaffolded'::text, 'socratic'::text, 'strategy_first'::text])))
);


--
-- Name: TABLE tutor_instruction_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_instruction_assignments IS 'Policy decision log — every material instructional decision (INV-03-11). §18.4.';


--
-- Name: tutor_instruction_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_instruction_exposures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    student_id uuid NOT NULL,
    exposure_type text NOT NULL,
    content_variant_key text,
    content_version text,
    rendered_difficulty integer,
    hint_depth integer,
    tone_style text,
    sequence_ordinal integer NOT NULL,
    shown_at timestamp with time zone DEFAULT now() NOT NULL,
    consumed_ms integer,
    CONSTRAINT tutor_instruction_exposures_exposure_type_check CHECK ((exposure_type = ANY (ARRAY['hint'::text, 'explanation'::text, 'strategy'::text, 'similar_question_offer'::text, 'broader_coaching_offer'::text, 'consent_prompt'::text])))
);


--
-- Name: TABLE tutor_instruction_exposures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_instruction_exposures IS 'Rendered surface log — what the student actually saw. §18.6.';


--
-- Name: tutor_memory_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_memory_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    summary_type text NOT NULL,
    summary_version text DEFAULT '1.0'::text NOT NULL,
    content_json jsonb NOT NULL,
    source_window_start timestamp with time zone,
    source_window_end timestamp with time zone,
    last_refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    refresh_trigger text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_memory_summaries_summary_type_check CHECK ((summary_type = ANY (ARRAY['teaching_profile'::text, 'chat_compaction'::text, 'recent_learning_pattern'::text, 'study_context'::text])))
);


--
-- Name: TABLE tutor_memory_summaries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_memory_summaries IS 'Durable compact summaries with V1 structured fields. Written by trusted code only (§7.6). §18.3.';


--
-- Name: tutor_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    student_id uuid NOT NULL,
    role text NOT NULL,
    content_kind text DEFAULT 'message'::text NOT NULL,
    message text NOT NULL,
    content_json jsonb,
    explanation_level text,
    source_session_id uuid,
    source_session_item_id uuid,
    source_question_row_id text,
    source_question_canonical_id text,
    client_turn_id uuid,
    injection_flag boolean DEFAULT false NOT NULL,
    injection_signature_matched text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_messages_content_kind_check CHECK ((content_kind = ANY (ARRAY['message'::text, 'suggestion'::text, 'consent_prompt'::text, 'system_note'::text]))),
    CONSTRAINT tutor_messages_role_check CHECK ((role = ANY (ARRAY['student'::text, 'tutor'::text, 'system'::text])))
);


--
-- Name: TABLE tutor_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_messages IS 'LISA line-by-line conversation history. Append-only from student perspective. §18.2.';


--
-- Name: tutor_question_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_question_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    student_id uuid NOT NULL,
    source_question_row_id text,
    source_question_canonical_id text,
    related_question_row_id text,
    related_question_canonical_id text,
    relationship_type text NOT NULL,
    difficulty_delta integer,
    reason_code text NOT NULL,
    link_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_question_links_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['current'::text, 'similar_retry'::text, 'simpler_variant'::text, 'harder_variant'::text, 'concept_extension'::text])))
);


--
-- Name: TABLE tutor_question_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_question_links IS 'Question relationship log — audit trail for tutor-suggested retries (§8.5). §18.5.';


--
-- Name: tutor_turn_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_turn_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    turn_ordinal integer NOT NULL,
    orchestration_duration_ms integer NOT NULL,
    model_name text NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cache_hit boolean DEFAULT false NOT NULL,
    compaction_recommended boolean DEFAULT false NOT NULL,
    anti_leak_triggered boolean DEFAULT false NOT NULL,
    injection_detected boolean DEFAULT false NOT NULL,
    crisis_triggered boolean DEFAULT false NOT NULL,
    crisis_classifier_outcome text,
    prompt_version text,
    context_hash text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tutor_turn_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_turn_metrics IS 'Doc 03A §11.5: per-turn operational telemetry. Fire-and-forget writes from tutor-policy-logger.ts. Service-internal — never exposed to clients.';


--
-- Name: usage_rate_limit_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_rate_limit_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    event_key text NOT NULL,
    student_user_id uuid NOT NULL,
    account_id uuid,
    session_id uuid,
    session_item_id uuid,
    dedupe_key text,
    units integer DEFAULT 1 NOT NULL,
    reservation_state text NOT NULL,
    reservation_expires_at timestamp with time zone,
    cooldown_until timestamp with time zone,
    input_tokens_reserved integer,
    output_tokens_reserved integer,
    cost_micros_reserved bigint,
    input_tokens_final integer,
    output_tokens_final integer,
    cost_micros_final bigint,
    denial_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_rate_limit_ledger_cost_micros_final_check CHECK (((cost_micros_final IS NULL) OR (cost_micros_final >= 0))),
    CONSTRAINT usage_rate_limit_ledger_cost_micros_reserved_check CHECK (((cost_micros_reserved IS NULL) OR (cost_micros_reserved >= 0))),
    CONSTRAINT usage_rate_limit_ledger_input_tokens_final_check CHECK (((input_tokens_final IS NULL) OR (input_tokens_final >= 0))),
    CONSTRAINT usage_rate_limit_ledger_input_tokens_reserved_check CHECK (((input_tokens_reserved IS NULL) OR (input_tokens_reserved >= 0))),
    CONSTRAINT usage_rate_limit_ledger_output_tokens_final_check CHECK (((output_tokens_final IS NULL) OR (output_tokens_final >= 0))),
    CONSTRAINT usage_rate_limit_ledger_output_tokens_reserved_check CHECK (((output_tokens_reserved IS NULL) OR (output_tokens_reserved >= 0))),
    CONSTRAINT usage_rate_limit_ledger_reservation_state_check CHECK ((reservation_state = ANY (ARRAY['consumed'::text, 'reserved'::text, 'finalized'::text, 'failed'::text, 'denied'::text]))),
    CONSTRAINT usage_rate_limit_ledger_scope_check CHECK ((scope = ANY (ARRAY['practice'::text, 'full_length'::text, 'tutor'::text, 'calendar'::text]))),
    CONSTRAINT usage_rate_limit_ledger_units_check CHECK ((units >= 0))
);


--
-- Name: abuse_score_incidents abuse_score_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_incidents
    ADD CONSTRAINT abuse_score_incidents_pkey PRIMARY KEY (id);


--
-- Name: abuse_score_runtime_config_history abuse_score_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_runtime_config_history
    ADD CONSTRAINT abuse_score_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: abuse_score_runtime_config abuse_score_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_runtime_config
    ADD CONSTRAINT abuse_score_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: abuse_scores abuse_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_scores
    ADD CONSTRAINT abuse_scores_pkey PRIMARY KEY (student_profile_id);


--
-- Name: account_deletion_requests account_deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_requests
    ADD CONSTRAINT account_deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_runtime_config_history account_deletion_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_runtime_config_history
    ADD CONSTRAINT account_deletion_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_runtime_config account_deletion_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_runtime_config
    ADD CONSTRAINT account_deletion_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: anonymized_actors anonymized_actors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymized_actors
    ADD CONSTRAINT anonymized_actors_pkey PRIMARY KEY (actor_id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auth_mfa_config_history auth_mfa_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_config_history
    ADD CONSTRAINT auth_mfa_config_history_pkey PRIMARY KEY (id);


--
-- Name: auth_mfa_config auth_mfa_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_config
    ADD CONSTRAINT auth_mfa_config_pkey PRIMARY KEY (key);


--
-- Name: auth_runtime_config_history auth_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_runtime_config_history
    ADD CONSTRAINT auth_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: auth_runtime_config auth_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_runtime_config
    ADD CONSTRAINT auth_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: caching_runtime_config_history caching_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caching_runtime_config_history
    ADD CONSTRAINT caching_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: caching_runtime_config caching_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caching_runtime_config
    ADD CONSTRAINT caching_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: consent_runtime_config_history consent_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_runtime_config_history
    ADD CONSTRAINT consent_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: consent_runtime_config consent_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_runtime_config
    ADD CONSTRAINT consent_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: crisis_review_audit_log crisis_review_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_audit_log
    ADD CONSTRAINT crisis_review_audit_log_pkey PRIMARY KEY (id);


--
-- Name: crisis_review_cases crisis_review_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_cases
    ADD CONSTRAINT crisis_review_cases_pkey PRIMARY KEY (id);


--
-- Name: difficulties difficulties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.difficulties
    ADD CONSTRAINT difficulties_pkey PRIMARY KEY (value);


--
-- Name: distractor_taxonomy_v1 distractor_taxonomy_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distractor_taxonomy_v1
    ADD CONSTRAINT distractor_taxonomy_v1_pkey PRIMARY KEY (section, label);


--
-- Name: entitlement_features entitlement_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_features
    ADD CONSTRAINT entitlement_features_pkey PRIMARY KEY (feature_key);


--
-- Name: entitlement_runtime_config_history entitlement_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_runtime_config_history
    ADD CONSTRAINT entitlement_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: entitlement_runtime_config entitlement_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_runtime_config
    ADD CONSTRAINT entitlement_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: entitlements entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_pkey PRIMARY KEY (id);


--
-- Name: exam_runtime_config_history exam_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_runtime_config_history
    ADD CONSTRAINT exam_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: exam_runtime_config exam_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_runtime_config
    ADD CONSTRAINT exam_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: full_length_adaptive_config_history full_length_adaptive_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.full_length_adaptive_config_history
    ADD CONSTRAINT full_length_adaptive_config_history_pkey PRIMARY KEY (id);


--
-- Name: full_length_adaptive_config full_length_adaptive_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.full_length_adaptive_config
    ADD CONSTRAINT full_length_adaptive_config_pkey PRIMARY KEY (key);


--
-- Name: guardian_consent_requests guardian_consent_requests_consent_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_consent_requests
    ADD CONSTRAINT guardian_consent_requests_consent_token_key UNIQUE (consent_token);


--
-- Name: guardian_consent_requests guardian_consent_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_consent_requests
    ADD CONSTRAINT guardian_consent_requests_pkey PRIMARY KEY (id);


--
-- Name: guardian_links guardian_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT guardian_links_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (scope, client_key);


--
-- Name: idempotency_runtime_config_history idempotency_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_runtime_config_history
    ADD CONSTRAINT idempotency_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: idempotency_runtime_config idempotency_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_runtime_config
    ADD CONSTRAINT idempotency_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: internal_service_auth_config_history internal_service_auth_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_service_auth_config_history
    ADD CONSTRAINT internal_service_auth_config_history_pkey PRIMARY KEY (id);


--
-- Name: internal_service_auth_config internal_service_auth_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_service_auth_config
    ADD CONSTRAINT internal_service_auth_config_pkey PRIMARY KEY (key);


--
-- Name: legal_acceptance_outbox legal_acceptance_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptance_outbox
    ADD CONSTRAINT legal_acceptance_outbox_pkey PRIMARY KEY (id);


--
-- Name: legal_acceptances legal_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);


--
-- Name: legal_acceptances legal_acceptances_unique_doc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_unique_doc UNIQUE (user_id, doc_key, doc_version, actor_type);


--
-- Name: mastery_constants_change_log mastery_constants_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_constants_change_log
    ADD CONSTRAINT mastery_constants_change_log_pkey PRIMARY KEY (change_id);


--
-- Name: mastery_constants_history mastery_constants_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_constants_history
    ADD CONSTRAINT mastery_constants_history_pkey PRIMARY KEY (id);


--
-- Name: mastery_constants mastery_constants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_constants
    ADD CONSTRAINT mastery_constants_pkey PRIMARY KEY (key);


--
-- Name: mastery_derivation_gap_ledger mastery_derivation_gap_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_derivation_gap_ledger
    ADD CONSTRAINT mastery_derivation_gap_ledger_pkey PRIMARY KEY (observation_id);


--
-- Name: mastery_domain_refresh_audit_log mastery_domain_refresh_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_domain_refresh_audit_log
    ADD CONSTRAINT mastery_domain_refresh_audit_log_pkey PRIMARY KEY (audit_row_id);


--
-- Name: mastery_event_audit_log mastery_event_audit_log_dedup_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_event_audit_log
    ADD CONSTRAINT mastery_event_audit_log_dedup_uq UNIQUE (event_source_kind, event_id);


--
-- Name: mastery_event_audit_log mastery_event_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_event_audit_log
    ADD CONSTRAINT mastery_event_audit_log_pkey PRIMARY KEY (audit_row_id);


--
-- Name: mastery_levels mastery_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_levels
    ADD CONSTRAINT mastery_levels_pkey PRIMARY KEY (level_key);


--
-- Name: mobile_auth_config_history mobile_auth_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_config_history
    ADD CONSTRAINT mobile_auth_config_history_pkey PRIMARY KEY (id);


--
-- Name: mobile_auth_config mobile_auth_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_config
    ADD CONSTRAINT mobile_auth_config_pkey PRIMARY KEY (key);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (event_id);


--
-- Name: observability_runtime_config_history observability_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_runtime_config_history
    ADD CONSTRAINT observability_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: observability_runtime_config observability_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_runtime_config
    ADD CONSTRAINT observability_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: practice_runtime_config_history practice_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_runtime_config_history
    ADD CONSTRAINT practice_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: practice_runtime_config practice_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_runtime_config
    ADD CONSTRAINT practice_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: practice_session_items practice_session_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_session_items
    ADD CONSTRAINT practice_session_items_pkey PRIMARY KEY (id);


--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: projection_refresh_outbox projection_refresh_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projection_refresh_outbox
    ADD CONSTRAINT projection_refresh_outbox_pkey PRIMARY KEY (outbox_id);


--
-- Name: psi_occurred_at_backfill_log psi_occurred_at_backfill_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.psi_occurred_at_backfill_log
    ADD CONSTRAINT psi_occurred_at_backfill_log_pkey PRIMARY KEY (item_id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_ledger rate_limit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_ledger
    ADD CONSTRAINT rate_limit_ledger_pkey PRIMARY KEY (profile_id, bucket_key, window_start);


--
-- Name: rate_limit_runtime_config_history rate_limit_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_runtime_config_history
    ADD CONSTRAINT rate_limit_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_runtime_config rate_limit_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_runtime_config
    ADD CONSTRAINT rate_limit_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: review_error_attempts review_error_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_error_attempts
    ADD CONSTRAINT review_error_attempts_pkey PRIMARY KEY (id);


--
-- Name: review_runtime_config_history review_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_runtime_config_history
    ADD CONSTRAINT review_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: review_runtime_config review_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_runtime_config
    ADD CONSTRAINT review_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: review_schedule review_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_schedule
    ADD CONSTRAINT review_schedule_pkey PRIMARY KEY (id);


--
-- Name: review_session_items review_session_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_pkey PRIMARY KEY (id);


--
-- Name: review_sessions review_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (code);


--
-- Name: service_auth_secrets service_auth_secrets_caller_service_callee_service_created__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_auth_secrets
    ADD CONSTRAINT service_auth_secrets_caller_service_callee_service_created__key UNIQUE (caller_service, callee_service, created_at);


--
-- Name: service_auth_secrets service_auth_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_auth_secrets
    ADD CONSTRAINT service_auth_secrets_pkey PRIMARY KEY (id);


--
-- Name: source_types source_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_types
    ADD CONSTRAINT source_types_pkey PRIMARY KEY (code);


--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: student_domain_kpi student_domain_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_domain_kpi
    ADD CONSTRAINT student_domain_kpi_pkey PRIMARY KEY (student_id, section, domain);


--
-- Name: student_domain_mastery student_domain_mastery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_domain_mastery
    ADD CONSTRAINT student_domain_mastery_pkey PRIMARY KEY (student_id, section, domain);


--
-- Name: student_kpi_rollups_current student_kpi_rollups_current_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_kpi_rollups_current
    ADD CONSTRAINT student_kpi_rollups_current_pkey PRIMARY KEY (student_id, scope, scope_key);


--
-- Name: student_overall_kpi student_overall_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_overall_kpi
    ADD CONSTRAINT student_overall_kpi_pkey PRIMARY KEY (student_id);


--
-- Name: student_projection_refresh_state student_projection_refresh_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_projection_refresh_state
    ADD CONSTRAINT student_projection_refresh_state_pkey PRIMARY KEY (student_id);


--
-- Name: student_section_kpi student_section_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_section_kpi
    ADD CONSTRAINT student_section_kpi_pkey PRIMARY KEY (student_id, section);


--
-- Name: student_section_projection_snapshots student_section_projection_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_section_projection_snapshots
    ADD CONSTRAINT student_section_projection_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: student_section_projections student_section_projections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_section_projections
    ADD CONSTRAINT student_section_projections_pkey PRIMARY KEY (student_id, section);


--
-- Name: student_skill_kpi student_skill_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_skill_kpi
    ADD CONSTRAINT student_skill_kpi_pkey PRIMARY KEY (student_id, section, domain, skill);


--
-- Name: student_skill_mastery student_skill_mastery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_skill_mastery
    ADD CONSTRAINT student_skill_mastery_pkey PRIMARY KEY (student_id, section, domain, skill);


--
-- Name: taxonomy_versions taxonomy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxonomy_versions
    ADD CONSTRAINT taxonomy_versions_pkey PRIMARY KEY (version);


--
-- Name: tutor_context_resolution_log tutor_context_resolution_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_resolution_log
    ADD CONSTRAINT tutor_context_resolution_log_pkey PRIMARY KEY (id);


--
-- Name: tutor_context_runtime_config_history tutor_context_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_runtime_config_history
    ADD CONSTRAINT tutor_context_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: tutor_context_runtime_config tutor_context_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_runtime_config
    ADD CONSTRAINT tutor_context_runtime_config_pkey PRIMARY KEY (key);


--
-- Name: tutor_conversations tutor_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_pkey PRIMARY KEY (id);


--
-- Name: tutor_injection_log tutor_injection_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_injection_log
    ADD CONSTRAINT tutor_injection_log_pkey PRIMARY KEY (id);


--
-- Name: tutor_injection_signatures tutor_injection_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_injection_signatures
    ADD CONSTRAINT tutor_injection_signatures_pkey PRIMARY KEY (id);


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_assignments
    ADD CONSTRAINT tutor_instruction_assignments_pkey PRIMARY KEY (id);


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_exposures
    ADD CONSTRAINT tutor_instruction_exposures_pkey PRIMARY KEY (id);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_current_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_memory_summaries
    ADD CONSTRAINT tutor_memory_summaries_current_unique UNIQUE (student_id, summary_type);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_memory_summaries
    ADD CONSTRAINT tutor_memory_summaries_pkey PRIMARY KEY (id);


--
-- Name: tutor_messages tutor_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_pkey PRIMARY KEY (id);


--
-- Name: tutor_question_links tutor_question_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_question_links
    ADD CONSTRAINT tutor_question_links_pkey PRIMARY KEY (id);


--
-- Name: tutor_turn_metrics tutor_turn_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_turn_metrics
    ADD CONSTRAINT tutor_turn_metrics_pkey PRIMARY KEY (id);


--
-- Name: review_schedule uq_review_schedule_profile_question; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_schedule
    ADD CONSTRAINT uq_review_schedule_profile_question UNIQUE (student_id, question_id);


--
-- Name: usage_rate_limit_ledger usage_rate_limit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_rate_limit_ledger
    ADD CONSTRAINT usage_rate_limit_ledger_pkey PRIMARY KEY (id);


--
-- Name: entitlements_profile_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entitlements_profile_id_unique ON public.entitlements USING btree (profile_id);


--
-- Name: entitlements_stripe_subscription_item_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entitlements_stripe_subscription_item_id_key ON public.entitlements USING btree (stripe_subscription_item_id) WHERE (stripe_subscription_item_id IS NOT NULL);


--
-- Name: idx_abuse_incidents_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abuse_incidents_student ON public.abuse_score_incidents USING btree (student_profile_id, detected_at DESC);


--
-- Name: idx_abuse_incidents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abuse_incidents_type ON public.abuse_score_incidents USING btree (incident_type, detected_at DESC);


--
-- Name: idx_abuse_scores_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abuse_scores_tier ON public.abuse_scores USING btree (tier) WHERE (tier <> 'clean'::text);


--
-- Name: idx_account_deletion_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_deletion_pending ON public.account_deletion_requests USING btree (scheduled_hard_delete_at) WHERE (status = 'pending'::text);


--
-- Name: idx_account_deletion_recovery_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_deletion_recovery_token ON public.account_deletion_requests USING btree (recovery_token_hash) WHERE (status = 'pending'::text);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action, created_at DESC);


--
-- Name: idx_audit_logs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (actor_profile_id, created_at DESC);


--
-- Name: idx_audit_logs_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_target ON public.audit_logs USING btree (target_profile_id, created_at DESC);


--
-- Name: idx_baseline_once_per_student_section; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_baseline_once_per_student_section ON public.student_section_projection_snapshots USING btree (student_id, section) WHERE (snapshot_kind = 'diagnostic_baseline'::text);


--
-- Name: idx_crisis_audit_log_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crisis_audit_log_case ON public.crisis_review_audit_log USING btree (case_id, created_at);


--
-- Name: idx_crisis_audit_log_reviewer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crisis_audit_log_reviewer ON public.crisis_review_audit_log USING btree (reviewer_id, created_at DESC);


--
-- Name: idx_crisis_review_cases_conversation_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_crisis_review_cases_conversation_active ON public.crisis_review_cases USING btree (conversation_id) WHERE (status = ANY (ARRAY['open'::text, 'in_review'::text]));


--
-- Name: idx_crisis_review_cases_sla_breach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crisis_review_cases_sla_breach ON public.crisis_review_cases USING btree (sla_deadline) WHERE (status = 'open'::text);


--
-- Name: idx_crisis_review_cases_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crisis_review_cases_status ON public.crisis_review_cases USING btree (status, created_at DESC);


--
-- Name: idx_entitlements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_active ON public.entitlements USING btree (profile_id) WHERE ((status = 'active'::text) OR (status = 'past_due'::text) OR (status = 'trialing'::text));


--
-- Name: idx_entitlements_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_profile ON public.entitlements USING btree (profile_id);


--
-- Name: idx_entitlements_stripe_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_stripe_subscription ON public.entitlements USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: idx_guardian_links_guardian; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardian_links_guardian ON public.guardian_links USING btree (guardian_profile_id) WHERE (status = 'active'::text);


--
-- Name: idx_guardian_links_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardian_links_student ON public.guardian_links USING btree (student_profile_id) WHERE (status = 'active'::text);


--
-- Name: idx_idempotency_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_expires ON public.idempotency_records USING btree (expires_at);


--
-- Name: idx_idempotency_scope_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_scope_status ON public.idempotency_records USING btree (scope, status);


--
-- Name: idx_legal_acceptance_outbox_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_acceptance_outbox_unprocessed ON public.legal_acceptance_outbox USING btree (user_id) WHERE (processed_at IS NULL);


--
-- Name: idx_legal_acceptances_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_acceptances_user ON public.legal_acceptances USING btree (user_id);


--
-- Name: idx_mastery_domain_refresh_audit_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastery_domain_refresh_audit_student ON public.mastery_domain_refresh_audit_log USING btree (student_id, section, domain, applied_at DESC);


--
-- Name: idx_mastery_gap_ledger_observed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastery_gap_ledger_observed_at ON public.mastery_derivation_gap_ledger USING btree (observed_at DESC);


--
-- Name: idx_mccl_key_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mccl_key_time ON public.mastery_constants_change_log USING btree (key, changed_at DESC);


--
-- Name: idx_mccl_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mccl_time ON public.mastery_constants_change_log USING btree (changed_at DESC);


--
-- Name: idx_notification_outbox_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_recipient ON public.notification_outbox USING btree (recipient_profile_id, created_at DESC);


--
-- Name: idx_notification_outbox_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_unprocessed ON public.notification_outbox USING btree (created_at) WHERE (processed_at IS NULL);


--
-- Name: idx_practice_items_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_items_session ON public.practice_session_items USING btree (session_id, ordinal);


--
-- Name: idx_practice_items_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_items_user ON public.practice_session_items USING btree (user_id, answered_at DESC);


--
-- Name: idx_practice_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_active ON public.practice_sessions USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: idx_practice_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_user ON public.practice_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_profiles_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_profiles_actor_id ON public.profiles USING btree (actor_id);


--
-- Name: idx_profiles_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_completed_at ON public.profiles USING btree (profile_completed_at);


--
-- Name: idx_profiles_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_deleted ON public.profiles USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_profiles_email_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_profiles_email_active ON public.profiles USING btree (lower(email)) WHERE (deleted_at IS NULL);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role) WHERE (deleted_at IS NULL);


--
-- Name: idx_profiles_stripe_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_stripe_customer ON public.profiles USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_projection_refresh_outbox_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projection_refresh_outbox_unprocessed ON public.projection_refresh_outbox USING btree (requested_at) WHERE (processed_at IS NULL);


--
-- Name: idx_projection_snapshots_student_section_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projection_snapshots_student_section_time ON public.student_section_projection_snapshots USING btree (student_id, section, snapshot_at DESC);


--
-- Name: idx_questions_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_section ON public.questions USING btree (section) WHERE (status = 'published'::text);


--
-- Name: idx_questions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_status ON public.questions USING btree (status);


--
-- Name: idx_ratelimit_window_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratelimit_window_end ON public.rate_limit_ledger USING btree (window_end);


--
-- Name: idx_review_attempts_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_attempts_item ON public.review_error_attempts USING btree (session_item_id);


--
-- Name: idx_review_attempts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_attempts_student ON public.review_error_attempts USING btree (student_id, occurred_at DESC);


--
-- Name: idx_review_items_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_items_session ON public.review_session_items USING btree (session_id, ordinal);


--
-- Name: idx_review_items_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_items_student ON public.review_session_items USING btree (student_id);


--
-- Name: idx_review_schedule_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_schedule_due ON public.review_schedule USING btree (student_id, next_review_at) WHERE (status = 'active'::text);


--
-- Name: idx_review_sessions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_sessions_student ON public.review_sessions USING btree (student_id, created_at DESC);


--
-- Name: idx_service_auth_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_auth_active ON public.service_auth_secrets USING btree (caller_service, callee_service) WHERE (revoked_at IS NULL);


--
-- Name: idx_student_domain_kpi_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_domain_kpi_student ON public.student_domain_kpi USING btree (student_id);


--
-- Name: idx_student_domain_kpi_student_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_domain_kpi_student_section ON public.student_domain_kpi USING btree (student_id, section);


--
-- Name: idx_student_domain_mastery_computed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_domain_mastery_computed_at ON public.student_domain_mastery USING btree (computed_at);


--
-- Name: idx_student_domain_mastery_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_domain_mastery_student ON public.student_domain_mastery USING btree (student_id);


--
-- Name: idx_student_domain_mastery_student_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_domain_mastery_student_section ON public.student_domain_mastery USING btree (student_id, section);


--
-- Name: idx_student_section_kpi_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_section_kpi_student ON public.student_section_kpi USING btree (student_id);


--
-- Name: idx_student_section_projections_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_section_projections_student ON public.student_section_projections USING btree (student_id);


--
-- Name: idx_student_skill_kpi_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_skill_kpi_student ON public.student_skill_kpi USING btree (student_id);


--
-- Name: idx_student_skill_kpi_student_section_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_skill_kpi_student_section_domain ON public.student_skill_kpi USING btree (student_id, section, domain);


--
-- Name: idx_tutor_context_resolution_log_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_context_resolution_log_conversation ON public.tutor_context_resolution_log USING btree (conversation_id, turn_ordinal);


--
-- Name: idx_tutor_conversations_crisis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_conversations_crisis ON public.tutor_conversations USING btree (crisis_flagged, created_at DESC) WHERE (crisis_flagged = true);


--
-- Name: idx_tutor_conversations_deletion_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_conversations_deletion_window ON public.tutor_conversations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_tutor_conversations_reuse_envelope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_conversations_reuse_envelope ON public.tutor_conversations USING btree (student_id, source_surface, entry_mode, source_session_id, source_question_row_id, status, updated_at DESC) WHERE (status = 'active'::text);


--
-- Name: idx_tutor_conversations_student_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_conversations_student_status ON public.tutor_conversations USING btree (student_id, status, updated_at DESC);


--
-- Name: idx_tutor_injection_log_signature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_injection_log_signature ON public.tutor_injection_log USING btree (signature_matched, detected_at DESC);


--
-- Name: idx_tutor_injection_log_student_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_injection_log_student_recent ON public.tutor_injection_log USING btree (student_id, detected_at DESC);


--
-- Name: idx_tutor_instruction_assignments_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_instruction_assignments_conversation ON public.tutor_instruction_assignments USING btree (conversation_id, created_at);


--
-- Name: idx_tutor_instruction_assignments_register; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_instruction_assignments_register ON public.tutor_instruction_assignments USING btree (emotional_register, created_at DESC) WHERE (emotional_register <> 'default'::text);


--
-- Name: idx_tutor_instruction_assignments_student_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_instruction_assignments_student_recent ON public.tutor_instruction_assignments USING btree (student_id, created_at DESC);


--
-- Name: idx_tutor_instruction_exposures_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_instruction_exposures_assignment ON public.tutor_instruction_exposures USING btree (assignment_id, sequence_ordinal);


--
-- Name: idx_tutor_instruction_exposures_student_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_instruction_exposures_student_type ON public.tutor_instruction_exposures USING btree (student_id, exposure_type, shown_at DESC);


--
-- Name: idx_tutor_memory_summaries_staleness; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_memory_summaries_staleness ON public.tutor_memory_summaries USING btree (last_refreshed_at);


--
-- Name: idx_tutor_memory_summaries_student_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_memory_summaries_student_type ON public.tutor_memory_summaries USING btree (student_id, summary_type);


--
-- Name: idx_tutor_messages_client_turn_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tutor_messages_client_turn_idempotency ON public.tutor_messages USING btree (student_id, conversation_id, client_turn_id, role) WHERE (client_turn_id IS NOT NULL);


--
-- Name: idx_tutor_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_messages_conversation ON public.tutor_messages USING btree (conversation_id, created_at);


--
-- Name: idx_tutor_messages_injection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_messages_injection ON public.tutor_messages USING btree (injection_flag, created_at DESC) WHERE (injection_flag = true);


--
-- Name: idx_tutor_messages_student_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_messages_student_recent ON public.tutor_messages USING btree (student_id, created_at DESC);


--
-- Name: idx_tutor_question_links_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_question_links_conversation ON public.tutor_question_links USING btree (conversation_id, created_at);


--
-- Name: idx_tutor_question_links_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_question_links_source ON public.tutor_question_links USING btree (source_question_canonical_id);


--
-- Name: idx_tutor_question_links_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_question_links_student ON public.tutor_question_links USING btree (student_id, created_at DESC);


--
-- Name: idx_tutor_turn_metrics_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_turn_metrics_conversation ON public.tutor_turn_metrics USING btree (conversation_id, turn_ordinal);


--
-- Name: idx_tutor_turn_metrics_crisis_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_turn_metrics_crisis_outcome ON public.tutor_turn_metrics USING btree (crisis_classifier_outcome) WHERE (crisis_classifier_outcome IS NOT NULL);


--
-- Name: idx_usage_rate_limit_ledger_scope_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_rate_limit_ledger_scope_user_created ON public.usage_rate_limit_ledger USING btree (scope, student_user_id, created_at DESC);


--
-- Name: mastery_levels_level_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mastery_levels_level_unique ON public.mastery_levels USING btree (level) WHERE (level IS NOT NULL);


--
-- Name: mastery_levels_sort_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mastery_levels_sort_order_unique ON public.mastery_levels USING btree (sort_order);


--
-- Name: practice_sessions_one_completed_diagnostic_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX practice_sessions_one_completed_diagnostic_uq ON public.practice_sessions USING btree (user_id) WHERE ((mode = 'diagnostic'::text) AND (status = 'completed'::text));


--
-- Name: INDEX practice_sessions_one_completed_diagnostic_uq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.practice_sessions_one_completed_diagnostic_uq IS 'Owner ruling Q1 2026-08-17: a diagnostic is taken once. Uniqueness is on COMPLETED only — an abandoned diagnostic does not spend the student''s one diagnostic, and in-flight sessions are owned by the route''s anti-concurrency guard.';


--
-- Name: profiles_student_link_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_student_link_code_key ON public.profiles USING btree (student_link_code) WHERE (student_link_code IS NOT NULL);


--
-- Name: unique_active_guardian_link; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_active_guardian_link ON public.guardian_links USING btree (guardian_profile_id, student_profile_id) WHERE (status = 'active'::text);


--
-- Name: uq_practice_items_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_practice_items_idem ON public.practice_session_items USING btree (user_id, client_attempt_id) WHERE (client_attempt_id IS NOT NULL);


--
-- Name: uq_review_attempts_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_review_attempts_idem ON public.review_error_attempts USING btree (student_id, client_attempt_id) WHERE (client_attempt_id IS NOT NULL);


--
-- Name: uq_usage_rate_limit_ledger_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_usage_rate_limit_ledger_dedupe ON public.usage_rate_limit_ledger USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: abuse_score_incidents abuse_score_incidents_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER abuse_score_incidents_no_mutate BEFORE DELETE OR UPDATE ON public.abuse_score_incidents FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: abuse_score_runtime_config_history abuse_score_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER abuse_score_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.abuse_score_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: abuse_score_runtime_config abuse_score_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER abuse_score_runtime_config_notify AFTER INSERT OR UPDATE ON public.abuse_score_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: account_deletion_runtime_config_history account_deletion_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER account_deletion_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.account_deletion_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: account_deletion_runtime_config account_deletion_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER account_deletion_runtime_config_notify AFTER INSERT OR UPDATE ON public.account_deletion_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: audit_logs audit_logs_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_no_mutate BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: auth_mfa_config_history auth_mfa_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auth_mfa_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.auth_mfa_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: auth_mfa_config auth_mfa_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auth_mfa_config_notify AFTER INSERT OR UPDATE ON public.auth_mfa_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: auth_runtime_config_history auth_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auth_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.auth_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: auth_runtime_config auth_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auth_runtime_config_notify AFTER INSERT OR UPDATE ON public.auth_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: caching_runtime_config_history caching_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER caching_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.caching_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: caching_runtime_config caching_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER caching_runtime_config_notify AFTER INSERT OR UPDATE ON public.caching_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: consent_runtime_config_history consent_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consent_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.consent_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: consent_runtime_config consent_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consent_runtime_config_notify AFTER INSERT OR UPDATE ON public.consent_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: crisis_review_cases crisis_review_cases_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crisis_review_cases_set_updated_at BEFORE UPDATE ON public.crisis_review_cases FOR EACH ROW EXECUTE FUNCTION public.crisis_review_cases_updated_at();


--
-- Name: entitlement_runtime_config_history entitlement_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER entitlement_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.entitlement_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: entitlement_runtime_config entitlement_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER entitlement_runtime_config_notify AFTER INSERT OR UPDATE ON public.entitlement_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: exam_runtime_config_history exam_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.exam_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: exam_runtime_config exam_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_runtime_config_notify AFTER INSERT OR UPDATE ON public.exam_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: full_length_adaptive_config_history full_length_adaptive_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER full_length_adaptive_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.full_length_adaptive_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: full_length_adaptive_config full_length_adaptive_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER full_length_adaptive_config_notify AFTER INSERT OR UPDATE ON public.full_length_adaptive_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: idempotency_runtime_config_history idempotency_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER idempotency_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.idempotency_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: idempotency_runtime_config idempotency_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER idempotency_runtime_config_notify AFTER INSERT OR UPDATE ON public.idempotency_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: internal_service_auth_config_history internal_service_auth_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER internal_service_auth_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.internal_service_auth_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: internal_service_auth_config internal_service_auth_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER internal_service_auth_config_notify AFTER INSERT OR UPDATE ON public.internal_service_auth_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: mastery_constants_history mastery_constants_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mastery_constants_history_no_mutate BEFORE DELETE OR UPDATE ON public.mastery_constants_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: mobile_auth_config_history mobile_auth_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mobile_auth_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.mobile_auth_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: mobile_auth_config mobile_auth_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mobile_auth_config_notify AFTER INSERT OR UPDATE ON public.mobile_auth_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: observability_runtime_config_history observability_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER observability_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.observability_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: observability_runtime_config observability_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER observability_runtime_config_notify AFTER INSERT OR UPDATE ON public.observability_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: practice_runtime_config_history practice_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER practice_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.practice_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: practice_runtime_config practice_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER practice_runtime_config_notify AFTER INSERT OR UPDATE ON public.practice_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: profiles profiles_set_age; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_age BEFORE INSERT OR UPDATE OF date_of_birth ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_profile_age_fields();


--
-- Name: rate_limit_runtime_config_history rate_limit_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rate_limit_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.rate_limit_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: rate_limit_runtime_config rate_limit_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rate_limit_runtime_config_notify AFTER INSERT OR UPDATE ON public.rate_limit_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: review_runtime_config_history review_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.review_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: review_runtime_config review_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_runtime_config_notify AFTER INSERT OR UPDATE ON public.review_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: mastery_constants trg_capture_mastery_constant_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_capture_mastery_constant_change AFTER INSERT OR DELETE OR UPDATE ON public.mastery_constants FOR EACH ROW EXECUTE FUNCTION public.capture_mastery_constant_change();

ALTER TABLE public.mastery_constants ENABLE ALWAYS TRIGGER trg_capture_mastery_constant_change;


--
-- Name: tutor_context_runtime_config_history tutor_context_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_context_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.tutor_context_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: tutor_context_runtime_config tutor_context_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_context_runtime_config_notify AFTER INSERT OR UPDATE ON public.tutor_context_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


--
-- Name: tutor_conversations tutor_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_conversations_updated_at BEFORE UPDATE ON public.tutor_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tutor_memory_summaries tutor_memory_summaries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_memory_summaries_updated_at BEFORE UPDATE ON public.tutor_memory_summaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tutor_memory_summaries tutor_memory_summaries_validate_schema; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_memory_summaries_validate_schema BEFORE INSERT OR UPDATE ON public.tutor_memory_summaries FOR EACH ROW EXECUTE FUNCTION public.validate_memory_summary_schema();


--
-- Name: abuse_score_incidents abuse_score_incidents_student_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_incidents
    ADD CONSTRAINT abuse_score_incidents_student_profile_id_fkey FOREIGN KEY (student_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: abuse_score_runtime_config_history abuse_score_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_runtime_config_history
    ADD CONSTRAINT abuse_score_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: abuse_score_runtime_config abuse_score_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_score_runtime_config
    ADD CONSTRAINT abuse_score_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: abuse_scores abuse_scores_student_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_scores
    ADD CONSTRAINT abuse_scores_student_profile_id_fkey FOREIGN KEY (student_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: account_deletion_requests account_deletion_requests_actor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_requests
    ADD CONSTRAINT account_deletion_requests_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id);


--
-- Name: account_deletion_requests account_deletion_requests_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_requests
    ADD CONSTRAINT account_deletion_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: account_deletion_runtime_config_history account_deletion_runtime_config_hist_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_runtime_config_history
    ADD CONSTRAINT account_deletion_runtime_config_hist_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: account_deletion_runtime_config account_deletion_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_runtime_config
    ADD CONSTRAINT account_deletion_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: auth_mfa_config_history auth_mfa_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_config_history
    ADD CONSTRAINT auth_mfa_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: auth_mfa_config auth_mfa_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_config
    ADD CONSTRAINT auth_mfa_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: auth_runtime_config_history auth_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_runtime_config_history
    ADD CONSTRAINT auth_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: auth_runtime_config auth_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_runtime_config
    ADD CONSTRAINT auth_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: caching_runtime_config_history caching_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caching_runtime_config_history
    ADD CONSTRAINT caching_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: caching_runtime_config caching_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caching_runtime_config
    ADD CONSTRAINT caching_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: consent_runtime_config_history consent_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_runtime_config_history
    ADD CONSTRAINT consent_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: consent_runtime_config consent_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_runtime_config
    ADD CONSTRAINT consent_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: crisis_review_audit_log crisis_review_audit_log_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_audit_log
    ADD CONSTRAINT crisis_review_audit_log_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crisis_review_cases(id) ON DELETE RESTRICT;


--
-- Name: crisis_review_audit_log crisis_review_audit_log_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_audit_log
    ADD CONSTRAINT crisis_review_audit_log_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: crisis_review_cases crisis_review_cases_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_cases
    ADD CONSTRAINT crisis_review_cases_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE RESTRICT;


--
-- Name: crisis_review_cases crisis_review_cases_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_cases
    ADD CONSTRAINT crisis_review_cases_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crisis_review_cases crisis_review_cases_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crisis_review_cases
    ADD CONSTRAINT crisis_review_cases_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: distractor_taxonomy_v1 distractor_taxonomy_v1_section_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distractor_taxonomy_v1
    ADD CONSTRAINT distractor_taxonomy_v1_section_fkey FOREIGN KEY (section) REFERENCES public.sections(code);


--
-- Name: entitlement_runtime_config_history entitlement_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_runtime_config_history
    ADD CONSTRAINT entitlement_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: entitlement_runtime_config entitlement_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_runtime_config
    ADD CONSTRAINT entitlement_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: entitlements entitlements_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: exam_runtime_config_history exam_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_runtime_config_history
    ADD CONSTRAINT exam_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: exam_runtime_config exam_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_runtime_config
    ADD CONSTRAINT exam_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: full_length_adaptive_config_history full_length_adaptive_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.full_length_adaptive_config_history
    ADD CONSTRAINT full_length_adaptive_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: full_length_adaptive_config full_length_adaptive_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.full_length_adaptive_config
    ADD CONSTRAINT full_length_adaptive_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: guardian_consent_requests guardian_consent_requests_guardian_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_consent_requests
    ADD CONSTRAINT guardian_consent_requests_guardian_profile_id_fkey FOREIGN KEY (guardian_profile_id) REFERENCES public.profiles(id);


--
-- Name: guardian_consent_requests guardian_consent_requests_student_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_consent_requests
    ADD CONSTRAINT guardian_consent_requests_student_profile_id_fkey FOREIGN KEY (student_profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: guardian_links guardian_links_accepted_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT guardian_links_accepted_by_profile_id_fkey FOREIGN KEY (accepted_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: guardian_links guardian_links_guardian_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT guardian_links_guardian_profile_id_fkey FOREIGN KEY (guardian_profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: guardian_links guardian_links_revoked_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT guardian_links_revoked_by_profile_id_fkey FOREIGN KEY (revoked_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: guardian_links guardian_links_student_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT guardian_links_student_profile_id_fkey FOREIGN KEY (student_profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: idempotency_runtime_config_history idempotency_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_runtime_config_history
    ADD CONSTRAINT idempotency_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: idempotency_runtime_config idempotency_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_runtime_config
    ADD CONSTRAINT idempotency_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: internal_service_auth_config_history internal_service_auth_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_service_auth_config_history
    ADD CONSTRAINT internal_service_auth_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: internal_service_auth_config internal_service_auth_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_service_auth_config
    ADD CONSTRAINT internal_service_auth_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: legal_acceptances legal_acceptances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mastery_constants_history mastery_constants_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_constants_history
    ADD CONSTRAINT mastery_constants_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: mastery_constants mastery_constants_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastery_constants
    ADD CONSTRAINT mastery_constants_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: mobile_auth_config_history mobile_auth_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_config_history
    ADD CONSTRAINT mobile_auth_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: mobile_auth_config mobile_auth_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_config
    ADD CONSTRAINT mobile_auth_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: notification_outbox notification_outbox_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: observability_runtime_config_history observability_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_runtime_config_history
    ADD CONSTRAINT observability_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: observability_runtime_config observability_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_runtime_config
    ADD CONSTRAINT observability_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: practice_runtime_config_history practice_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_runtime_config_history
    ADD CONSTRAINT practice_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: practice_runtime_config practice_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_runtime_config
    ADD CONSTRAINT practice_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: practice_session_items practice_session_items_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_session_items
    ADD CONSTRAINT practice_session_items_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: practice_session_items practice_session_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_session_items
    ADD CONSTRAINT practice_session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: practice_session_items practice_session_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_session_items
    ADD CONSTRAINT practice_session_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: profiles profiles_guardian_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_guardian_profile_id_fkey FOREIGN KEY (guardian_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: rate_limit_ledger rate_limit_ledger_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_ledger
    ADD CONSTRAINT rate_limit_ledger_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: rate_limit_runtime_config_history rate_limit_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_runtime_config_history
    ADD CONSTRAINT rate_limit_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: rate_limit_runtime_config rate_limit_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_runtime_config
    ADD CONSTRAINT rate_limit_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: review_error_attempts review_error_attempts_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_error_attempts
    ADD CONSTRAINT review_error_attempts_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: review_error_attempts review_error_attempts_session_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_error_attempts
    ADD CONSTRAINT review_error_attempts_session_item_id_fkey FOREIGN KEY (session_item_id) REFERENCES public.review_session_items(id) ON DELETE CASCADE;


--
-- Name: review_error_attempts review_error_attempts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_error_attempts
    ADD CONSTRAINT review_error_attempts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: review_runtime_config_history review_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_runtime_config_history
    ADD CONSTRAINT review_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: review_runtime_config review_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_runtime_config
    ADD CONSTRAINT review_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: review_schedule review_schedule_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_schedule
    ADD CONSTRAINT review_schedule_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: review_schedule review_schedule_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_schedule
    ADD CONSTRAINT review_schedule_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: review_session_items review_session_items_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: review_session_items review_session_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.review_sessions(id) ON DELETE CASCADE;


--
-- Name: review_session_items review_session_items_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: review_sessions review_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_sessions
    ADD CONSTRAINT review_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id);


--
-- Name: tutor_context_resolution_log tutor_context_resolution_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_resolution_log
    ADD CONSTRAINT tutor_context_resolution_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: tutor_context_runtime_config_history tutor_context_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_runtime_config_history
    ADD CONSTRAINT tutor_context_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: tutor_context_runtime_config tutor_context_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_context_runtime_config
    ADD CONSTRAINT tutor_context_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: tutor_conversations tutor_conversations_source_question_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_source_question_row_id_fkey FOREIGN KEY (source_question_row_id) REFERENCES public.questions(id) ON DELETE SET NULL;


--
-- Name: tutor_conversations tutor_conversations_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_conversations
    ADD CONSTRAINT tutor_conversations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_injection_log tutor_injection_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_injection_log
    ADD CONSTRAINT tutor_injection_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE SET NULL;


--
-- Name: tutor_injection_log tutor_injection_log_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_injection_log
    ADD CONSTRAINT tutor_injection_log_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.tutor_messages(id) ON DELETE SET NULL;


--
-- Name: tutor_injection_log tutor_injection_log_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_injection_log
    ADD CONSTRAINT tutor_injection_log_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_assignments
    ADD CONSTRAINT tutor_instruction_assignments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_related_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_assignments
    ADD CONSTRAINT tutor_instruction_assignments_related_message_id_fkey FOREIGN KEY (related_message_id) REFERENCES public.tutor_messages(id) ON DELETE SET NULL;


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_assignments
    ADD CONSTRAINT tutor_instruction_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_exposures
    ADD CONSTRAINT tutor_instruction_exposures_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.tutor_instruction_assignments(id) ON DELETE CASCADE;


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_exposures
    ADD CONSTRAINT tutor_instruction_exposures_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_instruction_exposures
    ADD CONSTRAINT tutor_instruction_exposures_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_memory_summaries tutor_memory_summaries_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_memory_summaries
    ADD CONSTRAINT tutor_memory_summaries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_messages tutor_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: tutor_messages tutor_messages_source_question_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_source_question_row_id_fkey FOREIGN KEY (source_question_row_id) REFERENCES public.questions(id) ON DELETE SET NULL;


--
-- Name: tutor_messages tutor_messages_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_question_links tutor_question_links_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_question_links
    ADD CONSTRAINT tutor_question_links_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: tutor_question_links tutor_question_links_related_question_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_question_links
    ADD CONSTRAINT tutor_question_links_related_question_row_id_fkey FOREIGN KEY (related_question_row_id) REFERENCES public.questions(id) ON DELETE SET NULL;


--
-- Name: tutor_question_links tutor_question_links_source_question_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_question_links
    ADD CONSTRAINT tutor_question_links_source_question_row_id_fkey FOREIGN KEY (source_question_row_id) REFERENCES public.questions(id) ON DELETE SET NULL;


--
-- Name: tutor_question_links tutor_question_links_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_question_links
    ADD CONSTRAINT tutor_question_links_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: tutor_turn_metrics tutor_turn_metrics_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_turn_metrics
    ADD CONSTRAINT tutor_turn_metrics_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.tutor_conversations(id) ON DELETE CASCADE;


--
-- Name: usage_rate_limit_ledger usage_rate_limit_ledger_student_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_rate_limit_ledger
    ADD CONSTRAINT usage_rate_limit_ledger_student_user_id_fkey FOREIGN KEY (student_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abuse_score_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abuse_score_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: abuse_score_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abuse_score_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: abuse_score_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abuse_score_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: abuse_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abuse_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: account_deletion_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: account_deletion_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_deletion_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: account_deletion_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_deletion_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: anonymized_actors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.anonymized_actors ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_mfa_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_mfa_config ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_mfa_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_mfa_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: caching_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.caching_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: caching_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.caching_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: crisis_review_audit_log crisis_review_admin insert crisis_review_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_admin insert crisis_review_audit_log" ON public.crisis_review_audit_log FOR INSERT TO crisis_review_admin WITH CHECK (true);


--
-- Name: crisis_review_audit_log crisis_review_admin select crisis_review_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_admin select crisis_review_audit_log" ON public.crisis_review_audit_log FOR SELECT TO crisis_review_admin USING (true);


--
-- Name: crisis_review_cases crisis_review_admin select crisis_review_cases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_admin select crisis_review_cases" ON public.crisis_review_cases FOR SELECT TO crisis_review_admin USING (true);


--
-- Name: crisis_review_cases crisis_review_admin update crisis_review_cases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_admin update crisis_review_cases" ON public.crisis_review_cases FOR UPDATE TO crisis_review_admin USING (true) WITH CHECK (true);


--
-- Name: crisis_review_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crisis_review_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: crisis_review_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crisis_review_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: crisis_review_audit_log crisis_review_writer insert crisis_review_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_writer insert crisis_review_audit_log" ON public.crisis_review_audit_log FOR INSERT TO crisis_review_writer WITH CHECK (true);


--
-- Name: crisis_review_cases crisis_review_writer insert crisis_review_cases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crisis_review_writer insert crisis_review_cases" ON public.crisis_review_cases FOR INSERT TO crisis_review_writer WITH CHECK (true);


--
-- Name: difficulties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.difficulties ENABLE ROW LEVEL SECURITY;

--
-- Name: difficulties difficulties_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY difficulties_read ON public.difficulties FOR SELECT TO anon, authenticated USING (true);


--
-- Name: distractor_taxonomy_v1; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distractor_taxonomy_v1 ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlement_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlement_features ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlement_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlement_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlement_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlement_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: full_length_adaptive_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.full_length_adaptive_config ENABLE ROW LEVEL SECURITY;

--
-- Name: full_length_adaptive_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.full_length_adaptive_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: guardian_consent_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guardian_consent_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: guardian_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guardian_links ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: internal_service_auth_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.internal_service_auth_config ENABLE ROW LEVEL SECURITY;

--
-- Name: internal_service_auth_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.internal_service_auth_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_acceptance_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_acceptance_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_acceptances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_constants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_constants_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_constants_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants_history ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_derivation_gap_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_derivation_gap_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_domain_refresh_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_domain_refresh_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_event_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_event_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_config ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: observability_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.observability_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: observability_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.observability_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_session_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_session_items ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_session_items practice_session_items_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_session_items_select_self ON public.practice_session_items FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: practice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_sessions practice_sessions_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_sessions_select_self ON public.practice_sessions FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_self ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- Name: projection_refresh_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projection_refresh_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_projection_snapshots projection_snapshots_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projection_snapshots_guardian_read ON public.student_section_projection_snapshots FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_section_projection_snapshots projection_snapshots_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projection_snapshots_student_read ON public.student_section_projection_snapshots FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: psi_occurred_at_backfill_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.psi_occurred_at_backfill_log ENABLE ROW LEVEL SECURITY;

--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: review_error_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_error_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: review_error_attempts review_error_attempts_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY review_error_attempts_select_self ON public.review_error_attempts FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: review_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: review_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: review_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: review_schedule review_schedule_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY review_schedule_select_self ON public.review_schedule FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: review_session_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_session_items ENABLE ROW LEVEL SECURITY;

--
-- Name: review_session_items review_session_items_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY review_session_items_select_self ON public.review_session_items FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: review_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: review_sessions review_sessions_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY review_sessions_select_self ON public.review_sessions FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

--
-- Name: sections sections_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sections_read ON public.sections FOR SELECT TO anon, authenticated USING (true);


--
-- Name: service_auth_secrets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_auth_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: crisis_review_audit_log service_role_crisis_review_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_crisis_review_audit_log ON public.crisis_review_audit_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: crisis_review_cases service_role_crisis_review_cases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_crisis_review_cases ON public.crisis_review_cases TO service_role USING (true) WITH CHECK (true);


--
-- Name: source_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.source_types ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: student_domain_kpi; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_domain_kpi ENABLE ROW LEVEL SECURITY;

--
-- Name: student_domain_kpi student_domain_kpi_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_domain_kpi_guardian_read ON public.student_domain_kpi FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_domain_kpi student_domain_kpi_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_domain_kpi_student_read ON public.student_domain_kpi FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_domain_mastery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_domain_mastery ENABLE ROW LEVEL SECURITY;

--
-- Name: student_domain_mastery student_domain_mastery_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_domain_mastery_guardian_read ON public.student_domain_mastery FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_domain_mastery student_domain_mastery_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_domain_mastery_student_read ON public.student_domain_mastery FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_kpi_rollups_current; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_kpi_rollups_current ENABLE ROW LEVEL SECURITY;

--
-- Name: student_overall_kpi; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_overall_kpi ENABLE ROW LEVEL SECURITY;

--
-- Name: student_overall_kpi student_overall_kpi_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_overall_kpi_guardian_read ON public.student_overall_kpi FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_overall_kpi student_overall_kpi_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_overall_kpi_student_read ON public.student_overall_kpi FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_projection_refresh_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_projection_refresh_state ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_kpi; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_section_kpi ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_kpi student_section_kpi_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_section_kpi_guardian_read ON public.student_section_kpi FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_section_kpi student_section_kpi_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_section_kpi_student_read ON public.student_section_kpi FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_section_projection_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_section_projection_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_projections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_section_projections ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_projections student_section_projections_guardian_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_section_projections_guardian_read ON public.student_section_projections FOR SELECT TO authenticated USING (public.guardian_can_view_student(student_id));


--
-- Name: student_section_projections student_section_projections_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_section_projections_student_read ON public.student_section_projections FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_skill_kpi; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_skill_kpi ENABLE ROW LEVEL SECURITY;

--
-- Name: student_skill_kpi student_skill_kpi_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_skill_kpi_student_read ON public.student_skill_kpi FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: student_skill_mastery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_skill_mastery ENABLE ROW LEVEL SECURITY;

--
-- Name: student_skill_mastery student_skill_mastery_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_skill_mastery_student_read ON public.student_skill_mastery FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: taxonomy_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taxonomy_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_context_resolution_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_context_resolution_log ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_context_resolution_log tutor_context_resolution_log_service_role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_context_resolution_log_service_role ON public.tutor_context_resolution_log TO service_role USING (true);


--
-- Name: tutor_context_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_context_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_context_runtime_config tutor_context_runtime_config_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_context_runtime_config_context_read ON public.tutor_context_runtime_config FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_context_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_context_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_conversations tutor_conversations_archival_harddelete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_archival_harddelete ON public.tutor_conversations FOR DELETE TO tutor_archival_writer USING (((deleted_at IS NOT NULL) AND (deleted_at < (now() - '7 days'::interval))));


--
-- Name: tutor_conversations tutor_conversations_archival_softdelete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_archival_softdelete ON public.tutor_conversations FOR UPDATE TO tutor_archival_writer USING (true) WITH CHECK ((deleted_at IS NOT NULL));


--
-- Name: tutor_conversations tutor_conversations_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_context_read ON public.tutor_conversations FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_conversations tutor_conversations_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_insert_own ON public.tutor_conversations FOR INSERT WITH CHECK ((student_id = auth.uid()));


--
-- Name: tutor_conversations tutor_conversations_runtime_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_runtime_insert ON public.tutor_conversations FOR INSERT TO tutor_runtime_writer WITH CHECK (true);


--
-- Name: tutor_conversations tutor_conversations_runtime_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_runtime_update ON public.tutor_conversations FOR UPDATE TO tutor_runtime_writer USING (true);


--
-- Name: tutor_conversations tutor_conversations_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_select_own ON public.tutor_conversations FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_conversations tutor_conversations_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_conversations_update_own ON public.tutor_conversations FOR UPDATE USING ((student_id = auth.uid()));


--
-- Name: tutor_injection_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_injection_log ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_injection_log tutor_injection_log_archival_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_log_archival_delete ON public.tutor_injection_log FOR DELETE TO tutor_archival_writer USING (true);


--
-- Name: tutor_injection_log tutor_injection_log_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_log_context_read ON public.tutor_injection_log FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_injection_log tutor_injection_log_injection_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_log_injection_insert ON public.tutor_injection_log FOR INSERT TO tutor_injection_writer WITH CHECK (true);


--
-- Name: tutor_injection_log tutor_injection_log_injection_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_log_injection_update ON public.tutor_injection_log FOR UPDATE TO tutor_injection_writer USING (true);


--
-- Name: tutor_injection_log tutor_injection_log_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_log_select_own ON public.tutor_injection_log FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_injection_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_injection_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_injection_signatures tutor_injection_signatures_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_injection_signatures_context_read ON public.tutor_injection_signatures FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_instruction_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_instruction_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_archival_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_assignments_archival_delete ON public.tutor_instruction_assignments FOR DELETE TO tutor_archival_writer USING (true);


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_assignments_context_read ON public.tutor_instruction_assignments FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_runtime_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_assignments_runtime_insert ON public.tutor_instruction_assignments FOR INSERT TO tutor_runtime_writer WITH CHECK (true);


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_runtime_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_assignments_runtime_update ON public.tutor_instruction_assignments FOR UPDATE TO tutor_runtime_writer USING (true);


--
-- Name: tutor_instruction_assignments tutor_instruction_assignments_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_assignments_select_own ON public.tutor_instruction_assignments FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_instruction_exposures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_instruction_exposures ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_archival_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_exposures_archival_delete ON public.tutor_instruction_exposures FOR DELETE TO tutor_archival_writer USING (true);


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_exposures_context_read ON public.tutor_instruction_exposures FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_runtime_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_exposures_runtime_insert ON public.tutor_instruction_exposures FOR INSERT TO tutor_runtime_writer WITH CHECK (true);


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_runtime_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_exposures_runtime_update ON public.tutor_instruction_exposures FOR UPDATE TO tutor_runtime_writer USING (true);


--
-- Name: tutor_instruction_exposures tutor_instruction_exposures_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_instruction_exposures_select_own ON public.tutor_instruction_exposures FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_memory_summaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_memory_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_memory_summaries tutor_memory_summaries_archival_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_memory_summaries_archival_delete ON public.tutor_memory_summaries FOR DELETE TO tutor_archival_writer USING (true);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_memory_summaries_context_read ON public.tutor_memory_summaries FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_memory_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_memory_summaries_memory_insert ON public.tutor_memory_summaries FOR INSERT TO tutor_memory_writer WITH CHECK (true);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_memory_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_memory_summaries_memory_update ON public.tutor_memory_summaries FOR UPDATE TO tutor_memory_writer USING (true);


--
-- Name: tutor_memory_summaries tutor_memory_summaries_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_memory_summaries_select_own ON public.tutor_memory_summaries FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_messages tutor_messages_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_messages_context_read ON public.tutor_messages FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_messages tutor_messages_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_messages_insert_own ON public.tutor_messages FOR INSERT WITH CHECK ((student_id = auth.uid()));


--
-- Name: tutor_messages tutor_messages_runtime_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_messages_runtime_insert ON public.tutor_messages FOR INSERT TO tutor_runtime_writer WITH CHECK (true);


--
-- Name: tutor_messages tutor_messages_runtime_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_messages_runtime_update ON public.tutor_messages FOR UPDATE TO tutor_runtime_writer USING (true);


--
-- Name: tutor_messages tutor_messages_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_messages_select_own ON public.tutor_messages FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_question_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_question_links ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_question_links tutor_question_links_context_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_question_links_context_read ON public.tutor_question_links FOR SELECT TO tutor_context_reader USING (true);


--
-- Name: tutor_question_links tutor_question_links_runtime_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_question_links_runtime_insert ON public.tutor_question_links FOR INSERT TO tutor_runtime_writer WITH CHECK (true);


--
-- Name: tutor_question_links tutor_question_links_runtime_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_question_links_runtime_update ON public.tutor_question_links FOR UPDATE TO tutor_runtime_writer USING (true);


--
-- Name: tutor_question_links tutor_question_links_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_question_links_select_own ON public.tutor_question_links FOR SELECT USING ((student_id = auth.uid()));


--
-- Name: tutor_turn_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_turn_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_turn_metrics tutor_turn_metrics_service_role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_turn_metrics_service_role ON public.tutor_turn_metrics TO service_role USING (true);


--
-- Name: usage_rate_limit_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_rate_limit_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_rate_limit_ledger usage_rate_limit_ledger_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_rate_limit_ledger_select_own ON public.usage_rate_limit_ledger FOR SELECT TO authenticated USING ((student_user_id = auth.uid()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _rl_has_active_entitlement(p_student_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._rl_has_active_entitlement(p_student_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._rl_has_active_entitlement(p_student_user_id uuid) TO service_role;


--
-- Name: FUNCTION _rl_resolve_student_account(p_student_user_id uuid, p_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._rl_resolve_student_account(p_student_user_id uuid, p_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._rl_resolve_student_account(p_student_user_id uuid, p_account_id uuid) TO service_role;


--
-- Name: TABLE student_skill_mastery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_skill_mastery TO service_role;


--
-- Name: COLUMN student_skill_mastery.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: COLUMN student_skill_mastery.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: COLUMN student_skill_mastery.domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(domain) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: COLUMN student_skill_mastery.skill; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(skill) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: COLUMN student_skill_mastery.mastery_level; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(mastery_level) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: COLUMN student_skill_mastery.computed_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(computed_at) ON TABLE public.student_skill_mastery TO authenticated;


--
-- Name: FUNCTION apply_mastery_event(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamp with time zone, p_event_id uuid, p_question_id text, p_section_state text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_mastery_event(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamp with time zone, p_event_id uuid, p_question_id text, p_section_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_mastery_event(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamp with time zone, p_event_id uuid, p_question_id text, p_section_state text) TO service_role;


--
-- Name: FUNCTION backfill_recompute_student(p_student_id uuid, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.backfill_recompute_student(p_student_id uuid, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.backfill_recompute_student(p_student_id uuid, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION bump_projection_refresh_counter(p_student_id uuid, p_section text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bump_projection_refresh_counter(p_student_id uuid, p_section text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_projection_refresh_counter(p_student_id uuid, p_section text) TO service_role;


--
-- Name: FUNCTION cancel_account_deletion(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_account_deletion(p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_account_deletion(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION canonical_mastery_events(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonical_mastery_events(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonical_mastery_events(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) TO service_role;


--
-- Name: FUNCTION canonical_mastery_events_for_student(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonical_mastery_events_for_student(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonical_mastery_events_for_student(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION canonicalize_active_mastery_constants_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_active_mastery_constants_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonicalize_active_mastery_constants_state() TO service_role;


--
-- Name: FUNCTION canonicalize_jsonb_value(p_val jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_jsonb_value(p_val jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonicalize_jsonb_value(p_val jsonb) TO service_role;


--
-- Name: FUNCTION canonicalize_mastery_constants(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_mastery_constants() FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonicalize_mastery_constants() TO service_role;


--
-- Name: FUNCTION canonicalize_mastery_constants_serialized(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_mastery_constants_serialized() FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonicalize_mastery_constants_serialized() TO service_role;


--
-- Name: FUNCTION canonicalize_projection_constants_serialized(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonicalize_projection_constants_serialized() FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonicalize_projection_constants_serialized() TO service_role;


--
-- Name: FUNCTION capture_mastery_constant_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.capture_mastery_constant_change() TO service_role;


--
-- Name: FUNCTION check_and_reserve_practice_quota(p_student_user_id uuid, p_account_id uuid, p_session_id uuid, p_session_item_id uuid, p_dry_run boolean, p_request_id text, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_and_reserve_practice_quota(p_student_user_id uuid, p_account_id uuid, p_session_id uuid, p_session_item_id uuid, p_dry_run boolean, p_request_id text, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_and_reserve_practice_quota(p_student_user_id uuid, p_account_id uuid, p_session_id uuid, p_session_item_id uuid, p_dry_run boolean, p_request_id text, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION complete_and_anonymize_account(p_request_id uuid, p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_and_anonymize_account(p_request_id uuid, p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_and_anonymize_account(p_request_id uuid, p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION compute_longest_streak_days(p_student_id uuid, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compute_longest_streak_days(p_student_id uuid, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_longest_streak_days(p_student_id uuid, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION compute_mastery_for_entity(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compute_mastery_for_entity(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_mastery_for_entity(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) TO service_role;


--
-- Name: TABLE student_section_projections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_section_projections TO service_role;


--
-- Name: COLUMN student_section_projections.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.projected_score_mid; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_mid) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.projected_score_low; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_low) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.projected_score_high; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_high) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.range_width; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(range_width) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.relevant_question_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(relevant_question_count) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: COLUMN student_section_projections.computed_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(computed_at) ON TABLE public.student_section_projections TO authenticated;


--
-- Name: FUNCTION compute_section_projection(p_student_id uuid, p_section text, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compute_section_projection(p_student_id uuid, p_section text, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_section_projection(p_student_id uuid, p_section text, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION compute_streak_days(p_student_id uuid, p_section text, p_domain text, p_skill text, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compute_streak_days(p_student_id uuid, p_section text, p_domain text, p_skill text, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_streak_days(p_student_id uuid, p_section text, p_domain text, p_skill text, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION constant_affects_formula_hash(p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.constant_affects_formula_hash(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.constant_affects_formula_hash(p_key text) TO service_role;


--
-- Name: TABLE guardian_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guardian_links TO service_role;


--
-- Name: FUNCTION crisis_review_cases_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crisis_review_cases_updated_at() TO service_role;


--
-- Name: FUNCTION deidentify_user(target_user_id uuid, deleted_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deidentify_user(target_user_id uuid, deleted_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deidentify_user(target_user_id uuid, deleted_email text) TO service_role;


--
-- Name: FUNCTION entitlement_active(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.entitlement_active(p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.entitlement_active(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION execute_account_deletion_cascade(p_profile_id uuid, p_privacy_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.execute_account_deletion_cascade(p_profile_id uuid, p_privacy_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.execute_account_deletion_cascade(p_profile_id uuid, p_privacy_mode text) TO service_role;


--
-- Name: FUNCTION guardian_can_view_student(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardian_can_view_student(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_can_view_student(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.guardian_can_view_student(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_can_view_student_as(p_guardian_id uuid, p_student_id uuid) TO service_role;


--
-- Name: FUNCTION guardian_link_audit(p_action text, p_actor uuid, p_target uuid, p_changes jsonb, p_link_id uuid, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardian_link_audit(p_action text, p_actor uuid, p_target uuid, p_changes jsonb, p_link_id uuid, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_link_audit(p_action text, p_actor uuid, p_target uuid, p_changes jsonb, p_link_id uuid, p_request_id text) TO service_role;


--
-- Name: FUNCTION guardian_view_decision(p_guardian_id uuid, p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardian_view_decision(p_guardian_id uuid, p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_view_decision(p_guardian_id uuid, p_student_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION lookup_mastery_level(p_score numeric, p_constants jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lookup_mastery_level(p_score numeric, p_constants jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lookup_mastery_level(p_score numeric, p_constants jsonb) TO service_role;


--
-- Name: FUNCTION mastery_min_events(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mastery_min_events() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mastery_min_events() TO service_role;


--
-- Name: FUNCTION mastery_model_version(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mastery_model_version() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mastery_model_version() TO service_role;


--
-- Name: FUNCTION notify_config_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_config_change() TO service_role;


--
-- Name: FUNCTION pg_notify_memory_summary(p_student_id uuid, p_summary_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pg_notify_memory_summary(p_student_id uuid, p_summary_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pg_notify_memory_summary(p_student_id uuid, p_summary_type text) TO service_role;


--
-- Name: FUNCTION practice_session_mode_to_event_kind(p_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.practice_session_mode_to_event_kind(p_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.practice_session_mode_to_event_kind(p_mode text) TO service_role;


--
-- Name: FUNCTION prevent_update_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_update_delete() TO service_role;


--
-- Name: FUNCTION rate_limit_check_and_increment(p_profile_id uuid, p_bucket_key text, p_cost integer, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rate_limit_check_and_increment(p_profile_id uuid, p_bucket_key text, p_cost integer, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_limit integer) TO service_role;


--
-- Name: FUNCTION read_kpi_recency_constants(OUT short_days integer, OUT long_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.read_kpi_recency_constants(OUT short_days integer, OUT long_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_kpi_recency_constants(OUT short_days integer, OUT long_days integer) TO service_role;


--
-- Name: FUNCTION read_projection_constants(OUT target_qcount integer, OUT min_delta numeric, OUT max_delta numeric, OUT mid_round integer, OUT bound_round integer, OUT section_max integer, OUT section_min integer, OUT weights jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.read_projection_constants(OUT target_qcount integer, OUT min_delta numeric, OUT max_delta numeric, OUT mid_round integer, OUT bound_round integer, OUT section_max integer, OUT section_min integer, OUT weights jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_projection_constants(OUT target_qcount integer, OUT min_delta numeric, OUT max_delta numeric, OUT mid_round integer, OUT bound_round integer, OUT section_max integer, OUT section_min integer, OUT weights jsonb) TO service_role;


--
-- Name: FUNCTION recompute_skill_mastery(p_student_id uuid, p_section text, p_domain text, p_skill text, p_chain_downstream boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_skill_mastery(p_student_id uuid, p_section text, p_domain text, p_skill text, p_chain_downstream boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_skill_mastery(p_student_id uuid, p_section text, p_domain text, p_skill text, p_chain_downstream boolean) TO service_role;


--
-- Name: TABLE mastery_derivation_gap_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.mastery_derivation_gap_ledger TO service_role;


--
-- Name: FUNCTION record_mastery_derivation_gap(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_mastery_derivation_gap() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_mastery_derivation_gap() TO service_role;


--
-- Name: TABLE student_domain_kpi; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_domain_kpi TO service_role;


--
-- Name: COLUMN student_domain_kpi.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(domain) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.events_total; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_total) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.events_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_7d) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.events_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_30d) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.accuracy_overall; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_overall) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.accuracy_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_7d) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.accuracy_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_30d) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: COLUMN student_domain_kpi.last_active_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_active_at) ON TABLE public.student_domain_kpi TO authenticated;


--
-- Name: FUNCTION refresh_domain_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_domain_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_domain_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone) TO service_role;


--
-- Name: TABLE student_domain_mastery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_domain_mastery TO service_role;


--
-- Name: COLUMN student_domain_mastery.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_domain_mastery TO authenticated;


--
-- Name: COLUMN student_domain_mastery.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_domain_mastery TO authenticated;


--
-- Name: COLUMN student_domain_mastery.domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(domain) ON TABLE public.student_domain_mastery TO authenticated;


--
-- Name: COLUMN student_domain_mastery.mastery_level; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(mastery_level) ON TABLE public.student_domain_mastery TO authenticated;


--
-- Name: COLUMN student_domain_mastery.computed_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(computed_at) ON TABLE public.student_domain_mastery TO authenticated;


--
-- Name: FUNCTION refresh_domain_mastery(p_student_id uuid, p_section text, p_domain text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_domain_mastery(p_student_id uuid, p_section text, p_domain text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_domain_mastery(p_student_id uuid, p_section text, p_domain text) TO service_role;


--
-- Name: TABLE student_overall_kpi; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_overall_kpi TO service_role;


--
-- Name: COLUMN student_overall_kpi.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.events_total; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_total) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.events_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_7d) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.events_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_30d) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.accuracy_overall; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_overall) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.accuracy_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_7d) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.accuracy_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_30d) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.sections_active; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(sections_active) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.current_streak_days; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(current_streak_days) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.longest_streak_days; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(longest_streak_days) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: COLUMN student_overall_kpi.last_active_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_active_at) ON TABLE public.student_overall_kpi TO authenticated;


--
-- Name: FUNCTION refresh_overall_kpi(p_student_id uuid, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_overall_kpi(p_student_id uuid, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_overall_kpi(p_student_id uuid, p_t_now timestamp with time zone) TO service_role;


--
-- Name: TABLE student_section_kpi; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_section_kpi TO service_role;


--
-- Name: COLUMN student_section_kpi.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.events_total; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_total) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.events_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_7d) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.events_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_30d) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.accuracy_overall; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_overall) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.accuracy_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_7d) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.accuracy_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_30d) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.current_streak_days; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(current_streak_days) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: COLUMN student_section_kpi.last_active_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_active_at) ON TABLE public.student_section_kpi TO authenticated;


--
-- Name: FUNCTION refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION refresh_skill_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_skill_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_skill_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer) TO service_role;


--
-- Name: FUNCTION restore_account_deletion(p_recovery_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restore_account_deletion(p_recovery_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_account_deletion(p_recovery_token_hash text) TO service_role;


--
-- Name: FUNCTION revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text) TO service_role;


--
-- Name: FUNCTION round_to_step(p_value numeric, p_step integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.round_to_step(p_value numeric, p_step integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.round_to_step(p_value numeric, p_step integer) TO service_role;


--
-- Name: FUNCTION select_diagnostic_pool(p_per_domain integer, p_exclude_ids text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.select_diagnostic_pool(p_per_domain integer, p_exclude_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.select_diagnostic_pool(p_per_domain integer, p_exclude_ids text[]) TO service_role;


--
-- Name: FUNCTION select_practice_pool_random(p_sections text[], p_domains text[], p_skills text[], p_difficulties integer[], p_exclude_ids text[], p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.select_practice_pool_random(p_sections text[], p_domains text[], p_skills text[], p_difficulties integer[], p_exclude_ids text[], p_limit integer) TO service_role;


--
-- Name: FUNCTION set_profile_age_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_profile_age_fields() TO service_role;


--
-- Name: FUNCTION student_diagnostic_state(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.student_diagnostic_state(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.student_diagnostic_state(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION validate_memory_summary_schema(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_memory_summary_schema() FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_memory_summary_schema() TO service_role;


--
-- Name: TABLE abuse_score_incidents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.abuse_score_incidents TO service_role;


--
-- Name: TABLE abuse_score_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.abuse_score_runtime_config TO service_role;


--
-- Name: TABLE abuse_score_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.abuse_score_runtime_config_history TO service_role;


--
-- Name: TABLE abuse_scores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.abuse_scores TO service_role;


--
-- Name: TABLE account_deletion_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_deletion_requests TO service_role;


--
-- Name: TABLE account_deletion_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_deletion_runtime_config TO service_role;


--
-- Name: TABLE account_deletion_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_deletion_runtime_config_history TO service_role;


--
-- Name: TABLE anonymized_actors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.anonymized_actors TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE auth_mfa_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_mfa_config TO service_role;


--
-- Name: TABLE auth_mfa_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_mfa_config_history TO service_role;


--
-- Name: TABLE auth_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_runtime_config TO service_role;


--
-- Name: TABLE auth_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_runtime_config_history TO service_role;


--
-- Name: TABLE caching_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.caching_runtime_config TO service_role;


--
-- Name: TABLE caching_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.caching_runtime_config_history TO service_role;


--
-- Name: TABLE questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.questions TO service_role;


--
-- Name: TABLE canonical_skill_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.canonical_skill_catalog TO service_role;


--
-- Name: TABLE consent_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_runtime_config TO service_role;


--
-- Name: TABLE consent_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_runtime_config_history TO service_role;


--
-- Name: TABLE crisis_review_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crisis_review_audit_log TO service_role;


--
-- Name: TABLE crisis_review_cases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crisis_review_cases TO service_role;


--
-- Name: TABLE difficulties; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.difficulties TO service_role;
GRANT SELECT ON TABLE public.difficulties TO anon;
GRANT SELECT ON TABLE public.difficulties TO authenticated;


--
-- Name: TABLE distractor_taxonomy_v1; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.distractor_taxonomy_v1 TO service_role;


--
-- Name: TABLE entitlement_features; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.entitlement_features TO service_role;


--
-- Name: TABLE entitlement_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.entitlement_runtime_config TO service_role;


--
-- Name: TABLE entitlement_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.entitlement_runtime_config_history TO service_role;


--
-- Name: TABLE entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.entitlements TO service_role;


--
-- Name: TABLE exam_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.exam_runtime_config TO service_role;


--
-- Name: TABLE exam_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_runtime_config_history TO service_role;


--
-- Name: TABLE full_length_adaptive_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.full_length_adaptive_config TO service_role;


--
-- Name: TABLE full_length_adaptive_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.full_length_adaptive_config_history TO service_role;


--
-- Name: TABLE guardian_consent_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guardian_consent_requests TO service_role;


--
-- Name: TABLE idempotency_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.idempotency_records TO service_role;


--
-- Name: TABLE idempotency_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.idempotency_runtime_config TO service_role;


--
-- Name: TABLE idempotency_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.idempotency_runtime_config_history TO service_role;


--
-- Name: TABLE internal_service_auth_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.internal_service_auth_config TO service_role;


--
-- Name: TABLE internal_service_auth_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.internal_service_auth_config_history TO service_role;


--
-- Name: TABLE legal_acceptance_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.legal_acceptance_outbox TO service_role;


--
-- Name: TABLE legal_acceptances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.legal_acceptances TO service_role;


--
-- Name: TABLE mastery_constants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mastery_constants TO service_role;


--
-- Name: TABLE mastery_constants_change_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mastery_constants_change_log TO service_role;


--
-- Name: SEQUENCE mastery_constants_change_log_change_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.mastery_constants_change_log_change_id_seq TO service_role;


--
-- Name: TABLE mastery_constants_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mastery_constants_history TO service_role;


--
-- Name: TABLE mastery_domain_refresh_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mastery_domain_refresh_audit_log TO service_role;


--
-- Name: TABLE mastery_event_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mastery_event_audit_log TO service_role;


--
-- Name: TABLE practice_session_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practice_session_items TO service_role;


--
-- Name: COLUMN practice_session_items.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.session_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(session_id) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.ordinal; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ordinal) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_id) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_stem; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_stem) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_passage; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_passage) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_options; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_options) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_domain) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_skill; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_skill) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_difficulty; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_difficulty) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.question_section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_section) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.selected_answer; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(selected_answer) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.is_correct; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_correct) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.outcome; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(outcome) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.time_spent_ms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(time_spent_ms) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.client_attempt_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(client_attempt_id) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.answered_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(answered_at) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.served_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(served_at) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: COLUMN practice_session_items.occurred_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(occurred_at) ON TABLE public.practice_session_items TO authenticated;


--
-- Name: TABLE practice_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practice_sessions TO service_role;
GRANT SELECT ON TABLE public.practice_sessions TO authenticated;


--
-- Name: TABLE review_error_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_error_attempts TO service_role;


--
-- Name: COLUMN review_error_attempts.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.session_item_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(session_item_id) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.question_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_id) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.selected_answer; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(selected_answer) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.is_correct; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_correct) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.seconds_spent; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(seconds_spent) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.client_attempt_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(client_attempt_id) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.used_tutor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(used_tutor) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(domain) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.skill; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(skill) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.difficulty; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(difficulty) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: COLUMN review_error_attempts.occurred_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(occurred_at) ON TABLE public.review_error_attempts TO authenticated;


--
-- Name: TABLE mastery_derivation_gaps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mastery_derivation_gaps TO service_role;


--
-- Name: TABLE mastery_derivation_gap_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mastery_derivation_gap_summary TO service_role;


--
-- Name: TABLE mastery_levels; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mastery_levels TO service_role;


--
-- Name: TABLE mobile_auth_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mobile_auth_config TO service_role;


--
-- Name: TABLE mobile_auth_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mobile_auth_config_history TO service_role;


--
-- Name: TABLE notification_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_outbox TO service_role;


--
-- Name: TABLE observability_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.observability_runtime_config TO service_role;


--
-- Name: TABLE observability_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.observability_runtime_config_history TO service_role;


--
-- Name: TABLE practice_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practice_runtime_config TO service_role;


--
-- Name: TABLE practice_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.practice_runtime_config_history TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE projection_refresh_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projection_refresh_outbox TO service_role;


--
-- Name: SEQUENCE projection_refresh_outbox_outbox_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.projection_refresh_outbox_outbox_id_seq TO service_role;


--
-- Name: TABLE psi_occurred_at_backfill_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.psi_occurred_at_backfill_log TO service_role;


--
-- Name: TABLE rate_limit_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_limit_ledger TO service_role;


--
-- Name: TABLE rate_limit_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_limit_runtime_config TO service_role;


--
-- Name: TABLE rate_limit_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_limit_runtime_config_history TO service_role;


--
-- Name: TABLE review_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_runtime_config TO service_role;


--
-- Name: TABLE review_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.review_runtime_config_history TO service_role;


--
-- Name: TABLE review_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_schedule TO service_role;
GRANT SELECT ON TABLE public.review_schedule TO authenticated;


--
-- Name: TABLE review_session_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_session_items TO service_role;


--
-- Name: COLUMN review_session_items.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.session_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(session_id) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.ordinal; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ordinal) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_id) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_stem; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_stem) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_passage; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_passage) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_options; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_options) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_domain) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_skill; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_skill) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_difficulty; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_difficulty) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.question_section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(question_section) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.retry_mode; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(retry_mode) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.served_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(served_at) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.answered_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(answered_at) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.review_session_items TO authenticated;


--
-- Name: TABLE review_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_sessions TO service_role;
GRANT SELECT ON TABLE public.review_sessions TO authenticated;


--
-- Name: TABLE sections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sections TO service_role;
GRANT SELECT ON TABLE public.sections TO anon;
GRANT SELECT ON TABLE public.sections TO authenticated;


--
-- Name: TABLE servable_questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.servable_questions TO service_role;


--
-- Name: TABLE service_auth_secrets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_auth_secrets TO service_role;


--
-- Name: TABLE source_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.source_types TO service_role;


--
-- Name: TABLE stripe_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stripe_webhook_events TO service_role;


--
-- Name: TABLE student_section_projection_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_section_projection_snapshots TO service_role;


--
-- Name: COLUMN student_section_projection_snapshots.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.projected_score_mid; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_mid) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.projected_score_low; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_low) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.projected_score_high; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(projected_score_high) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.range_width; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(range_width) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.relevant_question_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(relevant_question_count) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.snapshot_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(snapshot_at) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: COLUMN student_section_projection_snapshots.snapshot_kind; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(snapshot_kind) ON TABLE public.student_section_projection_snapshots TO authenticated;


--
-- Name: TABLE student_diagnostic_states; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.student_diagnostic_states TO service_role;


--
-- Name: TABLE student_baseline_pending; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.student_baseline_pending TO service_role;


--
-- Name: TABLE student_kpi_rollups_current; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_kpi_rollups_current TO service_role;


--
-- Name: TABLE student_projection_refresh_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_projection_refresh_state TO service_role;


--
-- Name: SEQUENCE student_section_projection_snapshots_snapshot_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.student_section_projection_snapshots_snapshot_id_seq TO service_role;


--
-- Name: TABLE student_skill_kpi; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_skill_kpi TO service_role;


--
-- Name: COLUMN student_skill_kpi.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.section; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(section) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.domain; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(domain) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.skill; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(skill) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.events_total; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_total) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.events_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_7d) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.events_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(events_last_30d) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.accuracy_overall; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_overall) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.accuracy_last_7d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_7d) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.accuracy_last_30d; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accuracy_last_30d) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: COLUMN student_skill_kpi.last_active_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_active_at) ON TABLE public.student_skill_kpi TO authenticated;


--
-- Name: TABLE taxonomy_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.taxonomy_versions TO service_role;


--
-- Name: TABLE tutor_context_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tutor_context_runtime_config TO service_role;


--
-- Name: TABLE tutor_context_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_context_runtime_config_history TO service_role;


--
-- Name: TABLE tutor_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_conversations TO service_role;


--
-- Name: TABLE tutor_injection_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_injection_log TO service_role;


--
-- Name: TABLE tutor_injection_signatures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_injection_signatures TO service_role;


--
-- Name: TABLE tutor_instruction_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_instruction_assignments TO service_role;


--
-- Name: TABLE tutor_instruction_exposures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_instruction_exposures TO service_role;


--
-- Name: TABLE tutor_memory_summaries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_memory_summaries TO service_role;


--
-- Name: TABLE tutor_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_messages TO service_role;


--
-- Name: TABLE tutor_question_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_question_links TO service_role;


--
-- Name: TABLE usage_rate_limit_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_rate_limit_ledger TO service_role;


--
-- PostgreSQL database dump complete
--


