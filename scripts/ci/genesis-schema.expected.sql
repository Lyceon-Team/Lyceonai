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


--
-- Name: apply_audit_logs_retention(text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_audit_logs_retention(p_action text, p_profile_id uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 1000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_rows   bigint;
BEGIN
  IF p_action NOT IN ('strip_identity', 'purge_expired') THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: unknown action %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'strip_identity' AND p_profile_id IS NULL THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: strip_identity requires a profile id' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'purge_expired' AND (p_batch_size IS NULL OR p_batch_size < 1) THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Open the gate for this transaction only.
  PERFORM set_config('lyceon.audit_logs_retention', 'on', true);

  IF p_action = 'strip_identity' THEN
    UPDATE public.audit_logs
       SET actor_profile_id  = NULL,
           target_profile_id = NULL
     WHERE actor_profile_id = p_profile_id
        OR target_profile_id = p_profile_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Close it again, so nothing later in THIS transaction inherits the exemption.
    PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
    RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', NULL);
  END IF;

  v_cutoff := now() - make_interval(days => public.audit_logs_retention_days());

  DELETE FROM public.audit_logs a
   WHERE a.id IN (
     SELECT b.id FROM public.audit_logs b
      WHERE b.created_at < v_cutoff
      ORDER BY b.created_at
      LIMIT p_batch_size
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
  RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', v_cutoff);
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
-- Name: apply_notification_delivery_event(text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_notification_delivery_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_message_id uuid;
  v_applied    boolean;
BEGIN
  INSERT INTO public.notification_delivery_events
    (provider_event_id, provider_message_id, event_type, occurred_at, outcome)
  VALUES (p_provider_event_id, p_provider_message_id, p_event_type, p_occurred_at, 'unmatched')
  ON CONFLICT (provider_event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  SELECT message_id INTO v_message_id
    FROM public.notification_messages
   WHERE provider_message_id = p_provider_message_id
     AND channel = 'email'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unmatched';   -- reconciled by record_notification_send_attempt if the send lands later
  END IF;

  v_applied := public.notification_apply_transition(v_message_id, p_event_type);

  UPDATE public.notification_delivery_events
     SET message_id = v_message_id,
         outcome    = CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END,
         applied_at = now()
   WHERE provider_event_id = p_provider_event_id;

  RETURN CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END;
END;
$$;


--
-- Name: audit_logs_retention_days(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_logs_retention_days() RETURNS integer
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_raw   jsonb;
  v_days  integer;
BEGIN
  SELECT c.value INTO v_raw
    FROM public.account_deletion_runtime_config c
   WHERE c.key = 'anonymization_retention_days';

  IF v_raw IS NULL OR jsonb_typeof(v_raw) <> 'number' THEN
    RETURN 365;
  END IF;

  v_days := (v_raw #>> '{}')::integer;
  IF v_days IS NULL OR v_days < 1 THEN
    RETURN 365;
  END IF;
  RETURN v_days;
END;
$$;


--
-- Name: audit_logs_retention_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_logs_retention_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- The sole exemption (SCL-087 / R3). `current_setting(..., true)` returns NULL rather than
  -- raising when the GUC was never set, so the default posture of every session is "refused".
  IF current_setting('lyceon.audit_logs_retention', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE are not permitted', TG_TABLE_NAME;
END;
$$;


--
-- Name: FUNCTION audit_logs_retention_guard(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_logs_retention_guard() IS 'Append-only guard for audit_logs ONLY (SCL-087 / R3). Identical refusal to public.prevent_update_delete(), plus the single retention exemption gated on the lyceon.audit_logs_retention GUC that public.apply_audit_logs_retention sets transaction-locally. The shared guard is deliberately not modified: nineteen other append-only tables use it and must not inherit this exemption.';


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
-- Name: calendar_acknowledge_version(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_acknowledge_version(p_student_id uuid, p_version_no integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ceiling integer;
  v_new     integer;
BEGIN
  SELECT COALESCE(max(version_no), 0) INTO v_ceiling
  FROM public.calendar_plan_versions
  WHERE student_id = p_student_id AND validator_result = 'accepted';

  UPDATE public.student_study_profile
     SET last_acknowledged_nonstudent_version_no =
           GREATEST(last_acknowledged_nonstudent_version_no, LEAST(p_version_no, v_ceiling)),
         updated_at = now()
   WHERE student_id = p_student_id
   RETURNING last_acknowledged_nonstudent_version_no INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_acknowledge_version: student % has no study profile', p_student_id
      USING ERRCODE = '22023';
  END IF;

  RETURN v_new;
END;
$$;


--
-- Name: FUNCTION calendar_acknowledge_version(p_student_id uuid, p_version_no integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_acknowledge_version(p_student_id uuid, p_version_no integer) IS 'Doc 05F §12.7 / INV-08-13: raises last_acknowledged_nonstudent_version_no monotonically, clamped to the student’s highest accepted version. Monotonic by construction, which is why POST /api/calendar/acknowledge carries no idempotency key (§15).';


--
-- Name: calendar_build_plan_input(uuid, date[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
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

  -- The exams seam has no table yet: full-length is a rebuild vertical and its
  -- adapter ships as a fail-open stub (G-08-02, sheet §8 item 12). Recording it
  -- in degraded[] is the honest form — the alternative is a snapshot that claims
  -- the student has never sat an exam, which is a different statement.
  v_degraded := v_degraded || '"exams"'::jsonb;

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
      'full_length_weekday', v_profile.full_length_weekday,
      'planner_mode', v_profile.planner_mode,
      'setup_date', COALESCE(
        (v_profile.setup_completed_at AT TIME ZONE v_profile.timezone)::date,
        (v_profile.created_at AT TIME ZONE v_profile.timezone)::date)::text),

    'mastery', COALESCE(v_mastery, '[]'::jsonb),

    -- Anything already overdue folds onto today rather than being lost: the
    -- generator walks the horizon forward and never looks behind its first date.
    'review_due_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', q.d::text, 'due_count', q.n) ORDER BY q.d)
      FROM (
        SELECT greatest((r.queued_at AT TIME ZONE v_profile.timezone)::date, v_today) AS d,
               count(*)::integer AS n
        FROM public.review_schedule r
        WHERE r.student_id = p_student_id
          AND r.status = 'active'
          AND (r.queued_at AT TIME ZONE v_profile.timezone)::date <= v_horizon_hi
        GROUP BY 1
      ) q), '[]'::jsonb),

    'exams', jsonb_build_object(
      'last_completed_local_date', NULL,
      'days_since_exam', NULL,
      'missed_count', NULL,
      'reviewed', NULL,
      'weak_domains', '[]'::jsonb),

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


--
-- Name: FUNCTION calendar_build_plan_input(p_student_id uuid, p_dates date[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[]) IS 'Doc 05F §10.1 / formula sheet §5. The only calendar function that reads canonical tables, and freezes them into the snapshot so the generator reads nothing else (INV-08-06). Raises on a missing profile or missing constants — essential inputs are never invented.';


--
-- Name: calendar_carry_started(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_carry_started(p_input jsonb, p_output jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT jsonb_set(p_output, '{dates}', COALESCE((
    SELECT jsonb_agg(jsonb_set(d, '{members}',
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('kind','carried','block_id', s ->> 'block_id')
                                ORDER BY s ->> 'block_id')
               FROM jsonb_array_elements(COALESCE(p_input -> 'started_blocks_by_date','[]'::jsonb)) s
               WHERE (s ->> 'scheduled_date')::date = (d ->> 'scheduled_date')::date
                 AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(COALESCE(d -> 'members','[]'::jsonb)) m
                   WHERE m ->> 'kind' = 'carried' AND m ->> 'block_id' = s ->> 'block_id')
             ), '[]'::jsonb) || COALESCE(d -> 'members', '[]'::jsonb))
           ORDER BY ord)
    FROM jsonb_array_elements(p_output -> 'dates') WITH ORDINALITY AS t(d, ord)
  ), '[]'::jsonb));
$$;


--
-- Name: FUNCTION calendar_carry_started(p_input jsonb, p_output jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_carry_started(p_input jsonb, p_output jsonb) IS 'Doc 05F §12.2. Prepends the date''s already-started blocks as carried members, idempotently — a member list that already carries one is left alone.';


--
-- Name: calendar_compute_plan(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_compute_plan(p_input jsonb) RETURNS jsonb
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
      d_why := d_why || (CASE WHEN d_lvl[v_i] <= 1 THEN 'weak'
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
    FROM jsonb_array_elements(v_fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL),
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
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
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

  RETURN jsonb_build_object('generator', 'deterministic_v1', 'days', v_days);
END;
$$;


--
-- Name: FUNCTION calendar_compute_plan(p_input jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_compute_plan(p_input jsonb) IS 'Doc 05F §11 as superseded by the Doc 05F Formula Sheet §2 (sheet §8 item 4). Pure, IMMUTABLE, integer-only. scripts/ci/calendar-parity.ts proves it byte-equal to scripts/ci/reference/calendar_formula_reference.py on the nine fixtures and the seeded 3,000-snapshot suite.';


--
-- Name: calendar_compute_plan_fallback(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) RETURNS jsonb
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
    FROM jsonb_array_elements(fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_fl_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL),
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
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
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

  RETURN jsonb_build_object('generator', 'fallback_v1', 'days', v_days);
END;
$$;


--
-- Name: FUNCTION calendar_compute_plan_fallback(p_input jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) IS 'Doc 05F formula sheet §5A. The fail-open backup: profile-only inputs, no mastery, no per-date review queue, no plan history. Same output shape and validator as deterministic_v1, and every practice block carries explanation_key = fallback.';


--
-- Name: calendar_do_it_now(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_stored  jsonb;
  v_src     record;
  v_input   jsonb;
  v_output  jsonb;
  v_result  jsonb;
  v_tz      text;
  v_today   date;
  v_members jsonb;
  v_ovr     boolean;
  v_target  integer;
  v_avail   integer;
BEGIN
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey — the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_do_it_now: student % has no study profile', p_student_id USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT * INTO v_src FROM public.calendar_blocks
  WHERE block_id = p_block_id AND student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_do_it_now: block % does not belong to student %', p_block_id, p_student_id
      USING ERRCODE = '42501';
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  v_input := public.calendar_build_plan_input(p_student_id, ARRAY[v_today]);

  -- Today’s current members and override flag, carried unchanged (§12.6).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','carried','block_id', cp.block_id::text)
                            ORDER BY cp.display_ordinal), '[]'::jsonb),
         bool_or(cp.is_user_override)
    INTO v_members, v_ovr
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = p_student_id AND cp.scheduled_date = v_today AND cp.block_id IS NOT NULL;

  v_target := v_src.target_count;
  IF v_src.block_type = 'review' THEN
    SELECT COALESCE(sum((r ->> 'due_count')::integer), 0) INTO v_avail
    FROM jsonb_array_elements(v_input -> 'review_due_by_date') r
    WHERE (r ->> 'date')::date <= v_today;
    v_target := least(v_target, v_avail);
    IF v_target < 1 THEN
      RAISE EXCEPTION 'calendar_do_it_now: block % is review work and nothing is due today', p_block_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_output := jsonb_build_object(
    'generator', 'deterministic_v1',
    'generator_version', p_generator_version,
    'dates', jsonb_build_array(jsonb_build_object(
      'scheduled_date', v_today::text,
      'is_user_override', COALESCE(v_ovr, false),
      'members', v_members || jsonb_build_array(jsonb_build_object(
        'kind','created',
        'block', jsonb_build_object(
          'block_type', v_src.block_type,
          'section', v_src.section,
          'scope', CASE WHEN v_src.block_type = 'practice' AND v_src.scope ->> 'level' = 'section'
                        THEN jsonb_set(v_src.scope, '{count}', to_jsonb(v_target))
                        ELSE v_src.scope END,
          'target_count', v_target,
          'explanation_key', v_src.explanation_key,
          'derived_from_block_id', p_block_id::text))))));

  v_output := public.calendar_carry_started(v_input, v_output);

  v_result := public.calendar_write_version(p_student_id, 'do_it_now', 'student',
                'deterministic_v1', p_generator_version, v_input, v_output, 'do_it_now', NULL);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_do_it_now',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;


--
-- Name: FUNCTION calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid) IS 'Doc 05F §12.6. One version owning today, carrying today''s members and override flag unchanged, appending one created block derived from the missed one. A review target is clamped to today''s availability (V-10), never copied.';


--
-- Name: calendar_drop_today_for_system(jsonb, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_drop_today_for_system(p_output jsonb, p_trigger text, p_today date) RETURNS jsonb
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
    WHEN p_trigger NOT IN ('weekly', 'post_exam') THEN p_output
    ELSE jsonb_set(p_output, '{dates}', COALESCE((
      SELECT jsonb_agg(d ORDER BY d ->> 'scheduled_date')
      FROM jsonb_array_elements(p_output -> 'dates') d
      WHERE (d ->> 'scheduled_date')::date <> p_today
    ), '[]'::jsonb))
  END;
$$;


--
-- Name: FUNCTION calendar_drop_today_for_system(p_output jsonb, p_trigger text, p_today date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_drop_today_for_system(p_output jsonb, p_trigger text, p_today date) IS 'Doc 05F §12.1 / owner ruling 2026-09-22: weekly and post_exam are system-initiated and own dates from tomorrow. Drops today from a generated plan OUTPUT, leaving generated_for.dates whole so V-01''s membership test still passes. A no-op for setup, profile_change, student_refresh, day_* and rollback.';


--
-- Name: calendar_edit_day(uuid, date, jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_stored jsonb;
  v_input  jsonb;
  v_output jsonb;
  v_result jsonb;
  v_tz     text;
  v_today  date;
BEGIN
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey — the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_edit_day: student % has no study profile', p_student_id USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- §12.2: a past date is never owned and never edited.
  IF p_date < v_today THEN
    RAISE EXCEPTION 'calendar_edit_day: % is in the past and cannot be edited', p_date
      USING ERRCODE = '23514';
  END IF;

  v_input  := public.calendar_build_plan_input(p_student_id, ARRAY[p_date]);
  v_output := public.calendar_carry_started(v_input, jsonb_build_object(
                'generator', 'deterministic_v1',
                'generator_version', p_generator_version,
                'dates', jsonb_build_array(jsonb_build_object(
                  'scheduled_date', p_date::text,
                  'is_user_override', true,
                  'members', COALESCE(p_members, '[]'::jsonb)))));

  v_result := public.calendar_write_version(p_student_id, 'day_edit', 'student',
                'deterministic_v1', p_generator_version, v_input, v_output, 'student_edit', NULL);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_edit_day',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;


--
-- Name: FUNCTION calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid) IS 'Doc 05F §12.4. Full desired member list for one date. Started blocks injected if omitted, validated in student_edit mode, persisted with is_user_override = true. No budget check (R-08-19).';


--
-- Name: calendar_is_known_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_is_known_timezone(p_timezone text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name = p_timezone);
$$;


--
-- Name: FUNCTION calendar_is_known_timezone(p_timezone text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_is_known_timezone(p_timezone text) IS 'Doc 05F §7.1: the route validates a timezone against pg_timezone_names, which PostgREST cannot reach. Formula sheet §8 item 19 makes a false answer a fall-open to America/Chicago, not a rejection.';


--
-- Name: calendar_link_launch(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: FUNCTION calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid) IS 'Doc 05F §7.7, §15.1 (INV-08-18). Append-only, idempotent on (engine, engine_session_id). Takes FOR UPDATE on the block row before allocating launch_sequence: the applied 20260917130000 body held nothing, so two concurrent launches of one block both computed max + 1 and the second died on the primary key with a raw 23505.';


--
-- Name: calendar_move_block(uuid, uuid, date, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_move_block(p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_stored    jsonb;
  v_src       record;
  v_input     jsonb;
  v_output    jsonb;
  v_result    jsonb;
  v_tz        text;
  v_today     date;
  v_from      date;
  v_from_mem  jsonb;
  v_to_mem    jsonb;
  v_created   jsonb;
  v_lo        date;
  v_hi        date;
BEGIN
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey -- the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_move_block: student % has no study profile', p_student_id USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT * INTO v_src FROM public.calendar_blocks
  WHERE block_id = p_block_id AND student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_move_block: block % does not belong to student %', p_block_id, p_student_id
      USING ERRCODE = '42501';
  END IF;
  v_from := v_src.scheduled_date;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- §12.2: a past date is never owned and never edited, at either end. Moving
  -- work INTO the past would rewrite what the student did not do. Moving it
  -- OUT of the past would erase it.
  IF v_from < v_today OR p_to_date < v_today THEN
    RETURN jsonb_build_object('refused', 'date_in_past',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  IF v_from = p_to_date THEN
    RETURN jsonb_build_object('refused', 'same_date',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  v_lo := least(v_from, p_to_date);
  v_hi := greatest(v_from, p_to_date);
  v_input := public.calendar_build_plan_input(p_student_id, ARRAY[v_lo, v_hi]);

  -- §12.2 V-12: a started block is protected state. started_blocks_by_date is
  -- the canonical answer to "has this block been launched" -- calendar_carry_started
  -- and the V-12 validator arm both read exactly this key, so the refusal is
  -- decided by the same fact they are, never by a second query that could drift.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_input -> 'started_blocks_by_date', '[]'::jsonb)) s
    WHERE (s ->> 'block_id')::uuid = p_block_id
  ) THEN
    RETURN jsonb_build_object('refused', 'block_started',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  -- The source date, re-stated WITHOUT the block being moved. Everything else
  -- on that day is carried by id, so nothing is regenerated by moving a sibling.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','carried','block_id', cp.block_id::text)
                            ORDER BY cp.display_ordinal), '[]'::jsonb)
    INTO v_from_mem
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = p_student_id AND cp.scheduled_date = v_from
    AND cp.block_id IS NOT NULL AND cp.block_id <> p_block_id;

  -- The target date, as it stands today. The moved copy is appended, so it
  -- lands last in display order rather than displacing the day.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','carried','block_id', cp.block_id::text)
                            ORDER BY cp.display_ordinal), '[]'::jsonb)
    INTO v_to_mem
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = p_student_id AND cp.scheduled_date = p_to_date
    AND cp.block_id IS NOT NULL;

  v_created := jsonb_build_array(jsonb_build_object(
    'kind','created',
    'block', jsonb_build_object(
      'block_type', v_src.block_type,
      'section', v_src.section,
      'scope', v_src.scope,
      'target_count', v_src.target_count,
      'explanation_key', v_src.explanation_key,
      'derived_from_block_id', p_block_id::text)));

  -- Ascending date order, so the emitted output is a function of the inputs and
  -- not of which direction the student dragged.
  v_output := jsonb_build_object(
    'generator', 'deterministic_v1',
    'generator_version', p_generator_version,
    'dates', CASE WHEN v_from < p_to_date THEN
      jsonb_build_array(
        jsonb_build_object('scheduled_date', v_from::text,    'is_user_override', true, 'members', v_from_mem),
        jsonb_build_object('scheduled_date', p_to_date::text, 'is_user_override', true, 'members', v_to_mem || v_created))
    ELSE
      jsonb_build_array(
        jsonb_build_object('scheduled_date', p_to_date::text, 'is_user_override', true, 'members', v_to_mem || v_created),
        jsonb_build_object('scheduled_date', v_from::text,    'is_user_override', true, 'members', v_from_mem))
    END);

  v_output := public.calendar_carry_started(v_input, v_output);

  v_result := public.calendar_write_version(p_student_id, 'day_edit', 'student',
                'deterministic_v1', p_generator_version, v_input, v_output, 'student_edit', NULL);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_move_block',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;


--
-- Name: FUNCTION calendar_move_block(p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_move_block(p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid) IS 'Doc 05F §12.2/§12.4. Moves one unstarted block to another date in a single day_edit version owning both dates; the target gets a created copy with derived_from_block_id set, and both dates become user overrides. Refuses a started block, a past date at either end, and a move to the same date as DATA ({"refused": ...}), never as an exception.';


--
-- Name: calendar_persist_version(uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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
  SELECT COALESCE(array_agg(t), '{}') INTO v_degraded
  FROM jsonb_array_elements_text(COALESCE(v_input -> 'degraded', '[]'::jsonb)) t;

  -- §5A: a degraded mastery read or review queue means the primary generator
  -- would be working from something it cannot trust.
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
      v_output := public.calendar_drop_today_for_system(
                    public.calendar_carry_started(v_input,
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                    p_trigger, v_today);
      v_res := public.calendar_validate_plan('generated', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    v_output := public.calendar_drop_today_for_system(
                  public.calendar_carry_started(v_input,
                    public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                  p_trigger, v_today);
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


--
-- Name: FUNCTION calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid) IS 'Doc 05F §12.3. FOR UPDATE on the profile, build, compute, validate, insert, one transaction. Falls back to fallback_v1 on degraded input, a raise, or a rejection, recording the reason on the version (sheet §5A). Since 2026-09-22 the two SYSTEM triggers, weekly and post_exam, own dates from tomorrow: the generator still reasons over the whole horizon and the OUTPUT is narrowed by calendar_drop_today_for_system.';


--
-- Name: calendar_place_full_lengths(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_place_full_lengths(p_input jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  k_horizon_days integer;
  k_fl_every_n   integer;
  k_fl_min_gap   integer;
  k_final_lead   integer;
  k_fl_max       integer;
  p_today        date;
  p_setup        date;
  p_target       date;
  p_wd           integer;
  x_last         date;
  fl_date        date[] := '{}';
  fl_key         text[] := '{}';
  v_i            integer;
  v_d            date;
  v_probe        date;
  v_anchor       date;
  v_ok           boolean;
  v_out          jsonb := '[]'::jsonb;
BEGIN
  k_horizon_days := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_fl_every_n   := public.calendar_require_int(p_input -> 'constants', 'full_length_every_n_occurrences');
  k_fl_min_gap   := public.calendar_require_int(p_input -> 'constants', 'full_length_min_gap_days');
  k_final_lead   := public.calendar_require_int(p_input -> 'constants', 'final_exam_lead_days');
  k_fl_max       := public.calendar_require_int(p_input -> 'constants', 'max_full_length_per_horizon');

  p_today  := (p_input ->> 'today')::date;
  p_setup  := (p_input #>> '{profile,setup_date}')::date;
  p_target := (p_input #>> '{profile,target_exam_date}')::date;
  p_wd     := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                   ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  x_last   := (p_input #>> '{exams,last_completed_local_date}')::date;

  -- No full-length weekday means no automatic exams at all (§7.1).
  IF p_wd IS NULL THEN
    RETURN v_out;
  END IF;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_place_full_lengths: profile.setup_date is essential and was not supplied'
      USING ERRCODE = '22023';
  END IF;

  IF p_target IS NOT NULL THEN
    v_probe := p_target - k_final_lead;
    WHILE EXTRACT(DOW FROM v_probe)::integer <> p_wd LOOP
      v_probe := v_probe - 1;
    END LOOP;
    IF v_probe >= p_today AND v_probe <= p_today + (k_horizon_days - 1) THEN
      fl_date := fl_date || v_probe;
      fl_key  := fl_key  || 'final_rehearsal'::text;
    END IF;
  END IF;

  v_anchor := p_setup;
  WHILE EXTRACT(DOW FROM v_anchor)::integer <> p_wd LOOP
    v_anchor := v_anchor + 1;
  END LOOP;

  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    -- COALESCE, not a bare array_length: an empty array measures NULL, and
    -- NULL >= 0 is NULL, which would let a cap of zero place exams anyway.
    EXIT WHEN COALESCE(array_length(fl_date, 1), 0) >= k_fl_max;
    v_d := p_today + v_i;
    CONTINUE WHEN EXTRACT(DOW FROM v_d)::integer <> p_wd;
    CONTINUE WHEN v_d = ANY (fl_date);
    CONTINUE WHEN v_d < v_anchor;                      -- guards the division below
    CONTINUE WHEN ((v_d - v_anchor) / 7) % k_fl_every_n <> 0;
    CONTINUE WHEN p_target IS NOT NULL AND (v_d >= p_target OR (p_target - v_d) < k_final_lead);
    v_ok := true;
    FOREACH v_probe IN ARRAY fl_date LOOP
      IF abs(v_d - v_probe) < k_fl_min_gap THEN v_ok := false; END IF;
    END LOOP;
    IF x_last IS NOT NULL AND abs(v_d - x_last) < k_fl_min_gap THEN v_ok := false; END IF;
    IF v_ok THEN
      fl_date := fl_date || v_d;
      fl_key  := fl_key  || 'exam_cadence'::text;
    END IF;
  END LOOP;

  FOR v_i IN 1 .. COALESCE(array_length(fl_date, 1), 0) LOOP
    v_out := v_out || jsonb_build_object('date', fl_date[v_i]::text, 'explanation_key', fl_key[v_i]);
  END LOOP;
  RETURN v_out;
END;
$$;


--
-- Name: FUNCTION calendar_place_full_lengths(p_input jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_place_full_lengths(p_input jsonb) IS 'Doc 05F formula sheet §2 step 2. Shared by both generators (sheet §5A: exam placement is identical), so the precedence rules have exactly one implementation.';


--
-- Name: calendar_plan_to_output(jsonb, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_plan_to_output(p_plan jsonb, p_generator_version text, p_enabled_block_types text[]) RETURNS jsonb
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT jsonb_build_object(
    'generator', p_plan ->> 'generator',
    'generator_version', p_generator_version,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'scheduled_date', d ->> 'date',
               'is_user_override', false,
               'members', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('kind', 'created', 'block', b) ORDER BY ord)
                 FROM jsonb_array_elements(d -> 'blocks') WITH ORDINALITY AS e(b, ord)
                 WHERE (b ->> 'block_type') = ANY (p_enabled_block_types)
               ), '[]'::jsonb))
             ORDER BY ord)
      FROM jsonb_array_elements(p_plan -> 'days') WITH ORDINALITY AS t(d, ord)
    ), '[]'::jsonb));
$$;


--
-- Name: FUNCTION calendar_plan_to_output(p_plan jsonb, p_generator_version text, p_enabled_block_types text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_plan_to_output(p_plan jsonb, p_generator_version text, p_enabled_block_types text[]) IS 'Doc 05F §10.2. Generator days -> PlanOutput dates/members, filtered to enabled_block_types (§21 / sheet §8 item 12). Created members only. Carried members are merged by calendar_persist_version from §12.2 protected state.';


--
-- Name: calendar_regenerate_day(uuid, date, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: FUNCTION calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid) IS 'Doc 05F §12.1 / §15: the writer behind POST /api/calendar/days/:date/regenerate and /reset. Owns exactly one date, derives it from the generator and leaves is_user_override false, which is how the student’s override clears. Validates in mode day_regenerate — generated minus V-14, because clearing that override is the operation. FOR UPDATE on the profile before the ledger read, as every calendar writer does.';


--
-- Name: calendar_regenerate_day_only(jsonb, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_regenerate_day_only(p_output jsonb, p_date date) RETURNS jsonb
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT jsonb_set(p_output, '{dates}', COALESCE((
    SELECT jsonb_agg(d)
    FROM jsonb_array_elements(p_output -> 'dates') d
    WHERE (d ->> 'scheduled_date')::date = p_date
  ), '[]'::jsonb));
$$;


--
-- Name: FUNCTION calendar_regenerate_day_only(p_output jsonb, p_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_regenerate_day_only(p_output jsonb, p_date date) IS 'Doc 05F §12.1: keeps one date of a horizon plan so a day-scoped version owns exactly that date. calendar_compute_plan always emits the full horizon and ignores generated_for.dates, so narrowing happens on the output, after generation, never by shrinking the snapshot.';


--
-- Name: calendar_require_int(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_require_int(p_obj jsonb, p_key text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
DECLARE v text;
BEGIN
  v := p_obj ->> p_key;
  IF v IS NULL OR v !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION 'calendar_runtime_config: missing or invalid key ''%''', p_key
      USING ERRCODE = '22023';
  END IF;
  RETURN v::integer;
END;
$_$;


--
-- Name: FUNCTION calendar_require_int(p_obj jsonb, p_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_require_int(p_obj jsonb, p_key text) IS 'Doc 05F formula sheet §6: essential inputs are never invented. Raises 22023 rather than defaulting. The integer regex also refuses a float, keeping sheet §2 (integers only) true at the boundary.';


--
-- Name: calendar_scope_is_valid(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_scope_is_valid(p_block_type text, p_section text, p_scope jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$
  SELECT CASE p_block_type

    WHEN 'practice' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NOT NULL AND p_section IN ('M', 'RW')
      AND CASE p_scope ->> 'level'

        WHEN 'section' THEN
              p_scope ?& ARRAY['level', 'count', 'explanation_key']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'count') = 'number'
          AND (p_scope ->> 'count') ~ '^[1-9][0-9]*$'
          AND jsonb_typeof(p_scope -> 'explanation_key') = 'string'

        WHEN 'domain' THEN
              p_scope ?& ARRAY['level', 'mix']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 2
          AND jsonb_typeof(p_scope -> 'mix') = 'array'
          AND jsonb_array_length(p_scope -> 'mix') >= 1
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry)
            WHERE NOT (
                  jsonb_typeof(entry) = 'object'
              AND entry ?& ARRAY['domain', 'count', 'explanation_key']
              AND (SELECT count(*) FROM jsonb_object_keys(entry)) = 3
              AND jsonb_typeof(entry -> 'domain') = 'string'
              AND jsonb_typeof(entry -> 'count') = 'number'
              AND (entry ->> 'count') ~ '^[1-9][0-9]*$'
              AND jsonb_typeof(entry -> 'explanation_key') = 'string'
              AND (
                (p_section = 'M'  AND entry ->> 'domain' IN (
                   'Algebra', 'Advanced Math',
                   'Problem Solving and Data Analysis',
                   'Geometry and Trigonometry'))
                OR
                (p_section = 'RW' AND entry ->> 'domain' IN (
                   'Information and Ideas', 'Craft and Structure',
                   'Expression of Ideas', 'Standard English Conventions'))
              )
            )
          )
          -- a domain appears at most once in a mix
          AND (SELECT count(DISTINCT e.entry ->> 'domain')
               FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry))
              = jsonb_array_length(p_scope -> 'mix')

        ELSE false
      END

    WHEN 'review' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      AND CASE p_scope ->> 'mode'
        WHEN 'queue' THEN
              p_scope ?& ARRAY['mode']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 1
        WHEN 'session' THEN
              p_scope ?& ARRAY['mode', 'source_engine', 'source_session_id']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'source_engine') = 'string'
          AND p_scope ->> 'source_engine' IN ('practice', 'full_length')
          AND jsonb_typeof(p_scope -> 'source_session_id') = 'string'
        ELSE false
      END

    WHEN 'full_length' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      AND p_scope ?& ARRAY['form_id']
      AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 1
      AND jsonb_typeof(p_scope -> 'form_id') IN ('string', 'null')

    ELSE false
  END;
$_$;


--
-- Name: FUNCTION calendar_scope_is_valid(p_block_type text, p_section text, p_scope jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_scope_is_valid(p_block_type text, p_section text, p_scope jsonb) IS 'Doc 05F §7.4 (formula sheet §8 item 3): per-block-type shape guard for calendar_blocks.scope. Shape only — config-derived magnitudes belong to calendar_validate_plan (V-04).';


--
-- Name: calendar_validate_plan(text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb) RETURNS jsonb
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


--
-- Name: FUNCTION calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb) IS 'Doc 05F §10.3 as amended by formula sheet §8 item 6 and by the day_regenerate mode (2026-09-17). Pure. Returns a rejection as data rather than raising. Mode day_regenerate is mode generated minus V-14: the day-scoped student triggers exist to clear the student’s own override, which is the one thing V-14 forbids a generated version from doing. V-07 is retired: sheet §8 item 3 removed skill_codes.';


--
-- Name: calendar_viewer_is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_viewer_is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'::public.profile_role
  );
$$;


--
-- Name: FUNCTION calendar_viewer_is_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_viewer_is_admin() IS 'Doc 05F §7.12 admin SELECT policies (formula sheet §8 item 10: is_admin() does not exist in prod). Collapses into Doc 01 is_admin() when that primitive ships.';


--
-- Name: calendar_weekly_candidates(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_weekly_candidates(p_limit integer DEFAULT 500) RETURNS TABLE(student_id uuid, period_key date, outcome text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p.student_id,
         (date_trunc('week', now() AT TIME ZONE p.timezone))::date AS period_key,
         CASE
           WHEN p.planner_mode <> 'auto' THEN 'skipped_custom'
           WHEN NOT public.entitlement_active(p.student_id) THEN 'skipped_no_entitlement'
           WHEN EXISTS (
             SELECT 1 FROM public.calendar_plan_versions v
             WHERE v.student_id = p.student_id
               AND v.validator_result = 'accepted'
               AND v.trigger IN ('setup','profile_change','weekly','student_refresh','post_exam')
               AND (v.created_at AT TIME ZONE p.timezone)
                     >= date_trunc('week', now() AT TIME ZONE p.timezone)
           ) THEN 'skipped_fresh'
           ELSE NULL
         END AS outcome
  FROM public.student_study_profile p
  WHERE p.setup_completed_at IS NOT NULL
  ORDER BY p.student_id
  LIMIT p_limit;
$$;


--
-- Name: FUNCTION calendar_weekly_candidates(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_weekly_candidates(p_limit integer) IS 'Doc 05F §12.5 / R-08-30: the weekly job population and its per-student outcome. outcome NULL means generate; the three skip values are the calendar_job_runs CHECK verbatim, so every student the job considered gets a row. Monday-anchored in each student''s own timezone.';


--
-- Name: calendar_write_version(uuid, text, text, text, text, jsonb, jsonb, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_write_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator text, p_generator_version text, p_input jsonb, p_output jsonb, p_mode text, p_fallback_reason jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_version_id uuid;
  v_version_no integer;
  v_res        jsonb;
  v_detail     jsonb;
  v_source     text;
  v_date       record;
  v_member     jsonb;
  v_block      jsonb;
  v_ord        integer;
  v_block_id   uuid;
  v_tz         text;
BEGIN
  v_res := public.calendar_validate_plan(p_mode, p_input, p_output);
  v_detail := CASE WHEN p_fallback_reason IS NULL THEN v_res -> 'violations'
                   ELSE COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('fallback', p_fallback_reason) END;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version_no
  FROM public.calendar_plan_versions WHERE student_id = p_student_id;

  v_tz := p_input #>> '{profile,timezone}';

  INSERT INTO public.calendar_plan_versions
    (student_id, version_no, generator, generator_version, trigger, initiated_by,
     input_snapshot, input_snapshot_hash, constants_snapshot, validator_result, validator_detail)
  VALUES
    (p_student_id, v_version_no, p_generator, p_generator_version, p_trigger, p_initiated_by,
     p_input, encode(sha256(p_input::text::bytea), 'hex'), p_input -> 'constants',
     v_res ->> 'result', v_detail)
  RETURNING plan_version_id INTO v_version_id;

  IF v_res ->> 'result' <> 'accepted' THEN
    RETURN jsonb_build_object('plan_version_id', v_version_id, 'version_no', v_version_no,
                              'generator', p_generator, 'validator_result', 'rejected',
                              'violations', v_res -> 'violations');
  END IF;

  -- §12.1: what created a block is what the version was for.
  v_source := CASE p_trigger
                WHEN 'post_exam' THEN 'post_exam'
                WHEN 'day_edit' THEN 'student'
                WHEN 'do_it_now' THEN 'student'
                ELSE 'auto' END;

  FOR v_date IN
    SELECT (d ->> 'scheduled_date')::date AS sd,
           COALESCE((d ->> 'is_user_override')::boolean, false) AS ovr,
           d -> 'members' AS members
    FROM jsonb_array_elements(p_output -> 'dates') d
  LOOP
    INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone, is_user_override)
    VALUES (v_version_id, p_student_id, v_date.sd, v_tz, v_date.ovr);

    v_ord := 0;
    FOR v_member IN SELECT m FROM jsonb_array_elements(COALESCE(v_date.members, '[]'::jsonb)) m LOOP
      v_ord := v_ord + 1;
      IF v_member ->> 'kind' = 'carried' THEN
        -- Carried blocks keep their identity: no new row, only a membership on
        -- the new version (§12.2, §22.5).
        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES (v_version_id, p_student_id, v_date.sd, (v_member ->> 'block_id')::uuid, v_ord, 'carried');
      ELSE
        v_block := v_member -> 'block';
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope,
           target_count, source, derived_from_block_id, explanation_key)
        VALUES
          (p_student_id, v_version_id, v_date.sd, v_block ->> 'block_type', v_block ->> 'section',
           v_block -> 'scope', (v_block ->> 'target_count')::integer, v_source,
           (v_block ->> 'derived_from_block_id')::uuid, v_block ->> 'explanation_key')
        RETURNING block_id INTO v_block_id;

        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES (v_version_id, p_student_id, v_date.sd, v_block_id, v_ord, 'created');
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('plan_version_id', v_version_id, 'version_no', v_version_no,
                            'generator', p_generator, 'validator_result', 'accepted');
END;
$$;


--
-- Name: FUNCTION calendar_write_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator text, p_generator_version text, p_input jsonb, p_output jsonb, p_mode text, p_fallback_reason jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calendar_write_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator text, p_generator_version text, p_input jsonb, p_output jsonb, p_mode text, p_fallback_reason jsonb) IS 'Doc 05F §12.3. The single calendar writer: validate, allocate version_no under the caller''s FOR UPDATE, insert append-only. A rejected version is recorded and owns nothing, so the prior plan stands.';


--
-- Name: cancel_account_deletion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_account_deletion(p_profile_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_request_id uuid;
  v_log_id     uuid;
BEGIN
  SELECT adr.id, adr.log_id INTO v_request_id, v_log_id
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

  IF v_log_id IS NOT NULL THEN
    UPDATE public.deletion_request_log
       SET status = 'cancelled', responded_on = (now() AT TIME ZONE 'utc')::date
     WHERE log_id = v_log_id AND status IN ('pending', 'executing');
  END IF;

  -- @spec [Doc-01_V8 §5 action enum; §40.4] | @implemented [2026-09-17]
  -- The in-app twin of the recovery path above; same action, different route, recorded as such.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_profile_id,
    p_profile_id,
    'profile_restored',
    jsonb_build_object('deleted_at', jsonb_build_object('from', 'set', 'to', NULL)),
    jsonb_build_object('source', 'cancel_account_deletion', 'path', 'in_app')
  );

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
-- Name: complete_deletion_log(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_deletion_log(p_completions text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'utc')::date;
  v_json      jsonb;
  v_ids       uuid[];
  v_completed bigint;
  v_billing   bigint;
  v_profile   uuid;
  v_stripped  bigint := 0;
  v_strip     jsonb;
BEGIN
  v_json := p_completions::jsonb;
  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'array' THEN
    RAISE EXCEPTION 'complete_deletion_log: p_completions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE _completions ON COMMIT DROP AS
    SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id,
           c.stripe_subscription_item_id, c.final_status, c.profile_id
      FROM jsonb_to_recordset(v_json)
        AS c(log_id uuid, stripe_customer_id text, stripe_subscription_id text,
             stripe_subscription_item_id text, final_status text, profile_id uuid);

  SELECT array_agg(c.log_id ORDER BY c.log_id) INTO v_ids FROM _completions c;

  UPDATE public.deletion_request_log
     SET status = 'completed', responded_on = v_today
   WHERE log_id = ANY (v_ids)
     AND status = 'executing';
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  INSERT INTO public.deletion_billing_record
    (log_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id, cancelled_on, final_status)
  SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id, c.stripe_subscription_item_id, v_today, c.final_status
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE c.final_status IS NOT NULL
     AND (c.stripe_customer_id IS NOT NULL OR c.stripe_subscription_id IS NOT NULL)
   ORDER BY c.log_id
  ON CONFLICT (log_id) DO NOTHING;
  GET DIAGNOSTICS v_billing = ROW_COUNT;

  -- @spec [Doc-01_V8 §5 (profile_hard_deleted), §5.1 (ids become NULL at hard delete);
  -- SCL-087 PROPOSED; owner brief 2026-09-17 §3.1/§3.3] | @implemented [2026-09-17]
  --
  -- THE AUDIT HALF OF T3. This is the evidence-side transaction, so neither of the two writes
  -- below can share an xmin with an actor_id-side row — that isolation is the whole reason they
  -- are here and not in the cascade (see this migration's header).
  --
  -- p_completions carries profile_id for exactly this: the profile row is already gone, so the
  -- uuid is a dead key used to FIND audit rows and then erased from them. It is never stored on
  -- the evidence side — the PG suite asserts structurally that no evidence table has a uuid
  -- column other than log_id.
  FOR v_profile IN SELECT c.profile_id FROM _completions c WHERE c.profile_id IS NOT NULL ORDER BY c.profile_id
  LOOP
    v_strip := public.apply_audit_logs_retention('strip_identity', v_profile);
    v_stripped := v_stripped + COALESCE((v_strip ->> 'rows')::bigint, 0);
  END LOOP;

  -- One row per completed deletion, with NO ids from the start: §5.1 retains "action type,
  -- timestamp, status code" and nothing else once a profile is hard-deleted. Written NULL rather
  -- than written-then-stripped, so this row never needs the exemption at all.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  SELECT NULL, NULL, 'profile_hard_deleted', NULL,
         jsonb_build_object('source', 'complete_deletion_log', 'status', 'completed')
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE l.status = 'completed';

  RETURN jsonb_build_object(
    'completed', v_completed,
    'billing_records', v_billing,
    'audit_rows_stripped', v_stripped
  );
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
  v_row          public.guardian_links;
  v_student_name text;
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

  -- Doc 01 §36.1 step 6 — both parties notified, in THIS transaction (contract §2.2).
  -- Student: in_app. Guardian: in_app + email. Payload: link_id and the student's display
  -- name only (contract §8.1; Doc 01 §38.1/§38.2 — nothing beyond identity to a guardian).
  SELECT display_name INTO v_student_name FROM public.profiles WHERE id = p_student_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_linked', v_row.id::text),
    'guardian_linked',
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id,  'channels', jsonb_build_array('in_app')),
      jsonb_build_object('profile_id', p_guardian_id, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object('link_id', v_row.id, 'student_display_name', coalesce(v_student_name, ''))
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
-- Name: deletion_evidence_retention_months(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deletion_evidence_retention_months() RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT 24;
$$;


--
-- Name: emit_notification_event(uuid, text, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.emit_notification_event(p_event_id uuid, p_event_type text, p_subject_profile_id uuid, p_recipients jsonb, p_payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'emit_notification_event: p_recipients must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_events (event_id, event_type, subject_profile_id, payload)
  VALUES (p_event_id, p_event_type, p_subject_profile_id, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  -- in_app rows are the delivery: delivered on insert. email rows start queued.
  INSERT INTO public.notification_messages
    (event_id, recipient_profile_id, channel, status, delivered_at)
  SELECT
    p_event_id,
    (r ->> 'profile_id')::uuid,
    c.channel,
    CASE WHEN c.channel = 'in_app' THEN 'delivered' ELSE 'queued' END,
    CASE WHEN c.channel = 'in_app' THEN now() ELSE NULL END
  FROM jsonb_array_elements(p_recipients) AS r
  CROSS JOIN LATERAL jsonb_array_elements_text(r -> 'channels') AS c(channel)
  ON CONFLICT (event_id, recipient_profile_id, channel) DO NOTHING;
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

  -- PS-2 .. PS-4: the pre-clears that touch rows belonging to OTHER identities
  -- (a student's consent request when a guardian deletes; another person's deletion
  -- request that named this profile as actor; the guardian_links rows on either side).
  --
  -- ANONYMIZE MODE (the user-facing path): these MUST already have run in their own
  -- transaction — public.preclear_account_deletion_links, T1.5 of the executor. A row
  -- of a LIVE identity written in THIS transaction would share its xmin with the
  -- anonymized_actors row written below, which is a deterministic join from actor_id
  -- to that live person and, through profiles.guardian_email, to the deleted one
  -- (evidence invariant rule 3, SCL-088; plan v4 §1). So this mode does not clear:
  -- it verifies, and fails closed (INV-05E-05: explicit, gated, nothing implicit).
  --
  -- HARD_DELETE MODE (service_role-only internal tool, Doc 05E §1): self-clears, as
  -- before. Nothing pseudonymous is retained by that mode, so the join has nothing
  -- to reach.
  IF p_privacy_mode = 'anonymize' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links
                WHERE accepted_by_profile_id = p_profile_id
                   OR revoked_by_profile_id  = p_profile_id
                   OR student_profile_id     = p_profile_id
                   OR guardian_profile_id    = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.guardian_consent_requests
                   WHERE guardian_profile_id = p_profile_id
                      OR student_profile_id  = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.account_deletion_requests
                   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id)
    THEN
      RAISE EXCEPTION 'PRECLEAR_REQUIRED: profile % still has guardian_links / guardian_consent_requests / actor_profile_id references — run public.preclear_account_deletion_links(profile) in its own transaction first (evidence invariant rule 3)',
        p_profile_id;
    END IF;
  ELSE
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
  END IF;

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

  -- L1-13. legal_acceptance_outbox (2026-09-16 evidence audit, plan v4 Phase 1). The
  -- outbox has NO profiles FK (20260619000300 dropped it so consent intent survives a
  -- late profile insert), sat in no cascade list, and is invisible to the FK-driven
  -- preflight above — so its rows, keyed by the auth uuid (= profile id), survived a
  -- deletion in signup order. Classified here as identity-keyed queue state: DELETED in
  -- both modes. The consent EVIDENCE lives in deletion_consent_evidence, copied from
  -- legal_acceptances by mark_deletion_log_executing before this transaction; an
  -- undrained outbox row at T+7 is intent that never became an acceptance and is not
  -- evidence of one.
  DELETE FROM public.legal_acceptance_outbox WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('legal_acceptance_outbox', v_count);

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
    -- ANONYMIZED_ACTORS LEDGER — Doc 05E §3 Rule 4 / INV-05E-01 / INV-05E-02
    -- (build-derived ledger; no spec anchor — SCL-088. The earlier citation of section 3.1 ("Industry precedent")
    -- was wrong.)
    -- ====================================================================
    -- Records that this actor_id is anonymized, BEFORE the profile deletion below
    -- destroys the one linkage surface. actor_id ONLY: no timestamp (SCL-088 — a
    -- deletion time on the pseudonymous side joins a dated evidence record at this
    -- volume), and public.rewrite_anonymized_actors() strips insertion order after
    -- every executor pass so xmin/ctid carry no sequence either.
    INSERT INTO public.anonymized_actors (actor_id)
    VALUES (v_actor_id)
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
  -- abuse_scores, notification_events, notification_messages, legal_acceptances.
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
-- Name: mark_all_notifications_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_notifications_read(p_recipient_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  -- Read implies seen (the same rule mark_notification applies per row). Archived rows are
  -- left alone: the archive is not the inbox, and "mark all read" is an inbox action.
  UPDATE public.notification_messages
     SET read_at = now(),
         seen_at = coalesce(seen_at, now())
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


--
-- Name: mark_all_notifications_seen(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_notifications_seen(p_recipient_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.notification_messages
     SET seen_at = now()
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND seen_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


--
-- Name: mark_deletion_log_executing(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_deletion_log_executing(p_log_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_consent bigint;
  v_marked  bigint;
BEGIN
  IF p_log_ids IS NULL OR cardinality(p_log_ids) = 0 THEN
    RETURN jsonb_build_object('marked', 0, 'consent_rows', 0);
  END IF;

  INSERT INTO public.deletion_consent_evidence
    (log_id, accepted_on, doc_key, doc_version, actor_type, minor, consent_source, ip_address, user_agent)
  SELECT adr.log_id,
         (la.accepted_at AT TIME ZONE 'utc')::date,
         la.doc_key, la.doc_version, la.actor_type, la.minor, la.consent_source,
         public.redact_evidence_ip(la.ip_address),
         public.redact_evidence_user_agent(la.user_agent)
    FROM public.account_deletion_requests adr
    JOIN public.legal_acceptances la ON la.user_id = adr.profile_id
   WHERE adr.log_id = ANY (p_log_ids)
     AND adr.status = 'pending'
   ORDER BY adr.log_id, la.doc_key, la.doc_version, la.actor_type
  ON CONFLICT (log_id, doc_key, doc_version, actor_type) DO NOTHING;
  GET DIAGNOSTICS v_consent = ROW_COUNT;

  UPDATE public.deletion_request_log
     SET status = 'executing'
   WHERE log_id = ANY (p_log_ids)
     AND status = 'pending';
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  RETURN jsonb_build_object('marked', v_marked, 'consent_rows', v_consent);
END;
$$;


--
-- Name: notification_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_messages (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    recipient_profile_id uuid NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    seen_at timestamp with time zone,
    read_at timestamp with time zone,
    archived_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_messages_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text]))),
    CONSTRAINT notification_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'complained'::text, 'failed'::text])))
);


--
-- Name: TABLE notification_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_messages IS 'One row per (event, recipient, channel). in_app rows are delivered on insert and ARE the feed; email rows are moved queued->sent by the dispatcher and onward by verified provider webhooks.';


--
-- Name: mark_notification(uuid, uuid, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notification(p_recipient_id uuid, p_message_id uuid, p_seen boolean, p_read boolean, p_archived boolean) RETURNS SETOF public.notification_messages
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE public.notification_messages
     SET seen_at     = CASE WHEN (p_seen OR p_read) AND seen_at IS NULL THEN now() ELSE seen_at END,
         read_at     = CASE WHEN p_read AND read_at IS NULL THEN now() ELSE read_at END,
         archived_at = CASE WHEN p_archived AND archived_at IS NULL THEN now() ELSE archived_at END
   WHERE message_id = p_message_id
     AND recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
  RETURNING *;
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
-- Name: notification_apply_transition(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_apply_transition(p_message_id uuid, p_event_type text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status text;
  v_next   text;
BEGIN
  SELECT status INTO v_status
    FROM public.notification_messages
   WHERE message_id = p_message_id AND channel = 'email'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_next := CASE
    WHEN p_event_type = 'email.delivered'  AND v_status = 'sent'                      THEN 'delivered'
    WHEN p_event_type = 'email.bounced'    AND v_status IN ('sent', 'delivered')      THEN 'bounced'
    WHEN p_event_type = 'email.complained' AND v_status IN ('sent', 'delivered')      THEN 'complained'
    WHEN p_event_type = 'email.failed'     AND v_status = 'sent'                      THEN 'failed'
    ELSE NULL
  END;

  IF v_next IS NULL THEN
    RETURN false;   -- illegal or no-op transition: recorded by the caller, never applied
  END IF;

  UPDATE public.notification_messages
     SET status       = v_next,
         delivered_at = CASE WHEN v_next = 'delivered' THEN now() ELSE delivered_at END,
         last_error   = CASE WHEN v_next = 'failed' THEN 'provider reported email.failed' ELSE last_error END
   WHERE message_id = p_message_id;
  RETURN true;
END;
$$;


--
-- Name: notification_event_id(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_event_id(p_event_type text, p_source_id text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
  v_bytes bytea;
BEGIN
  v_bytes := substring(sha256(convert_to(p_event_type || ':' || p_source_id, 'UTF8')) FROM 1 FOR 16);
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 80);   -- version 5 nibble
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);  -- RFC 4122 variant
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$;


--
-- Name: notification_feed(uuid, integer, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_feed(p_recipient_id uuid, p_limit integer, p_before_message_id uuid DEFAULT NULL::uuid, p_archived boolean DEFAULT false) RETURNS TABLE(message_id uuid, event_id uuid, event_type text, subject_profile_id uuid, payload jsonb, created_at timestamp with time zone, seen_at timestamp with time zone, read_at timestamp with time zone, archived_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.message_id, m.event_id, e.event_type, e.subject_profile_id, e.payload,
         m.created_at, m.seen_at, m.read_at, m.archived_at
    FROM public.notification_messages m
    JOIN public.notification_events   e ON e.event_id = m.event_id
   WHERE m.recipient_profile_id = p_recipient_id
     AND m.channel = 'in_app'
     -- One view or the other, never both: the inbox is the unarchived rows, the archive is
     -- the archived rows. A row moves between them exactly when archived_at is set.
     AND ((m.archived_at IS NOT NULL) = p_archived)
     -- Keyset cursor keyed by message id only: the (created_at, message_id) tuple is read back
     -- here at full microsecond precision, so a client that carries timestamps at millisecond
     -- precision (or none) cannot skip or repeat a row. A cursor naming another recipient's
     -- message resolves to NULL and yields an empty page.
     AND (p_before_message_id IS NULL
          OR (m.created_at, m.message_id) < (
               SELECT b.created_at, b.message_id
                 FROM public.notification_messages b
                WHERE b.message_id = p_before_message_id
                  AND b.recipient_profile_id = p_recipient_id))
   ORDER BY m.created_at DESC, m.message_id DESC
   LIMIT p_limit;
$$;


--
-- Name: notification_messages_guard_recipient_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_messages_guard_recipient_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- SECURITY INVOKER: current_user is the role issuing the UPDATE. The dispatcher and the
  -- webhook receiver run as service_role (or as the SECURITY DEFINER owner) and pass through.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.message_id           IS DISTINCT FROM OLD.message_id
    OR NEW.event_id             IS DISTINCT FROM OLD.event_id
    OR NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
    OR NEW.channel              IS DISTINCT FROM OLD.channel
    OR NEW.status               IS DISTINCT FROM OLD.status
    OR NEW.provider_message_id  IS DISTINCT FROM OLD.provider_message_id
    OR NEW.attempts             IS DISTINCT FROM OLD.attempts
    OR NEW.last_error           IS DISTINCT FROM OLD.last_error
    OR NEW.sent_at              IS DISTINCT FROM OLD.sent_at
    OR NEW.delivered_at         IS DISTINCT FROM OLD.delivered_at
    OR NEW.created_at           IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'notification_messages: a recipient may change only seen_at, read_at and archived_at'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: notification_retention_days(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_retention_days() RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT 90;
$$;


--
-- Name: FUNCTION notification_retention_days(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notification_retention_days() IS 'contracts/notifications.contract.md C11.1: the notification retention window in days. THE single definition; the sweep reads it.';


--
-- Name: notification_unread_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_unread_count(p_recipient_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
    FROM public.notification_messages
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND seen_at IS NULL;
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
-- Name: practice_item_enqueue_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.practice_item_enqueue_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_outcome text;
BEGIN
  -- An anonymized item has no owner to queue for. Practice's anonymize path
  -- UPDATEs user_id to NULL on already-resolved rows (20260917000000:732), so
  -- this is reached on exactly that path and must write nothing (G10).
  IF NEW.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ruling 2: misses AND skips enter the queue. Ruling 13: a correct answer
  -- never touches it.
  IF NEW.status = 'answered' AND NEW.is_correct = false THEN
    v_outcome := 'incorrect';
  ELSIF NEW.status = 'skipped' THEN
    v_outcome := 'skipped';
  ELSE
    RETURN NULL;
  END IF;

  -- occurred_at, not answered_at: psi_resolved_requires_occurred_at guarantees
  -- the former on every resolved row, and nothing guarantees the latter.
  PERFORM public.review_queue_record(
    NEW.user_id, NEW.question_id, 'practice',
    NEW.session_id, NEW.id, v_outcome, NEW.occurred_at
  );

  RETURN NULL;
END
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
-- Name: preclear_account_deletion_links(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preclear_account_deletion_links(p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_count  bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests adr
     WHERE adr.profile_id = p_profile_id
       AND adr.status = 'pending'
       AND adr.scheduled_hard_delete_at <= now()
  ) THEN
    RAISE EXCEPTION 'PRECLEAR_NOT_DUE: no pending, due deletion request for profile %', p_profile_id;
  END IF;

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
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_consent_requests_as_guardian', v_count);
  DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

  -- PS-4. account_deletion_requests — actor_profile_id edge case
  UPDATE public.account_deletion_requests
     SET actor_profile_id = profile_id
   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests_as_actor', v_count);

  RETURN jsonb_build_object('status', 'precleared', 'profile_id', p_profile_id, 'rows_affected', v_result);
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
-- Name: reconcile_deletion_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_deletion_log() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'utc')::date;
  v_reverted    bigint;
  v_completed   bigint;
  v_cancelled   bigint;
BEGIN
  UPDATE public.deletion_request_log l
     SET status = 'pending'
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'pending');
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE public.deletion_request_log l
     SET status = 'cancelled', responded_on = coalesce(l.responded_on, v_today)
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'cancelled');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.deletion_request_log l
     SET status = 'completed', responded_on = coalesce(l.responded_on, v_today)
   WHERE l.status = 'executing'
     AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                      WHERE adr.log_id = l.log_id);
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  RETURN jsonb_build_object('reverted_to_pending', v_reverted, 'completed', v_completed, 'cancelled', v_cancelled);
END;
$$;


--
-- Name: record_deletion_suppression_outcome(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_deletion_suppression_outcome(p_log_id uuid, p_status text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_status NOT IN ('applied', 'failed_manual') THEN
    RAISE EXCEPTION 'record_deletion_suppression_outcome: % is not a suppression status', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.deletion_request_log
     SET suppression_status = p_status
   WHERE log_id = p_log_id
     AND suppression_requested = true
     AND suppression_status IS DISTINCT FROM 'applied';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
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
-- Name: record_notification_send_attempt(uuid, boolean, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_notification_send_attempt(p_message_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_max_attempts integer) RETURNS SETOF public.notification_messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row  public.notification_messages;
  v_ev   record;
  v_applied boolean;
BEGIN
  SELECT * INTO v_row
    FROM public.notification_messages
   WHERE message_id = p_message_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_notification_send_attempt: message % not found', p_message_id
      USING ERRCODE = 'LYN01';
  END IF;
  IF v_row.channel <> 'email' OR v_row.status <> 'queued' THEN
    RAISE EXCEPTION 'record_notification_send_attempt: message % is not a queued email (channel=%, status=%)',
      p_message_id, v_row.channel, v_row.status
      USING ERRCODE = 'LYN02';
  END IF;

  IF p_ok THEN
    IF p_provider_message_id IS NULL OR p_provider_message_id = '' THEN
      RAISE EXCEPTION 'record_notification_send_attempt: a successful send must carry a provider message id'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.notification_messages
       SET status              = 'sent',
           sent_at             = now(),
           provider_message_id = p_provider_message_id,
           attempts            = attempts + 1,
           last_error          = NULL
     WHERE message_id = p_message_id;

    -- Race closure (§6.5): webhooks that arrived before this record are applied now, oldest first.
    FOR v_ev IN
      SELECT provider_event_id, event_type
        FROM public.notification_delivery_events
       WHERE provider_message_id = p_provider_message_id
         AND message_id IS NULL
       ORDER BY occurred_at, received_at
       FOR UPDATE
    LOOP
      v_applied := public.notification_apply_transition(p_message_id, v_ev.event_type);
      UPDATE public.notification_delivery_events
         SET message_id = p_message_id,
             outcome    = CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END,
             applied_at = now()
       WHERE provider_event_id = v_ev.provider_event_id;
    END LOOP;
  ELSE
    -- A failed send stays queued, distinguishable from an unattempted one by attempts/last_error,
    -- until the cap is reached. Never `sent`, never silently dropped.
    UPDATE public.notification_messages
       SET attempts   = attempts + 1,
           last_error = coalesce(p_error, 'send failed'),
           status     = CASE WHEN attempts + 1 >= p_max_attempts THEN 'failed' ELSE 'queued' END
     WHERE message_id = p_message_id;
  END IF;

  RETURN QUERY SELECT * FROM public.notification_messages WHERE message_id = p_message_id;
END;
$$;


--
-- Name: redact_evidence_ip(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redact_evidence_ip(p_ip text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  v inet;
BEGIN
  IF p_ip IS NULL OR btrim(p_ip) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v := btrim(p_ip)::inet;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  -- an IPv4-mapped IPv6 address (::ffff:a.b.c.d, what Node reports behind a proxy) is IPv4
  IF family(v) = 6 AND host(v) LIKE '::ffff:%' THEN
    BEGIN
      v := substr(host(v), 8)::inet;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;
  IF family(v) = 4 THEN
    RETURN text(network(set_masklen(v, 24)));
  END IF;
  RETURN text(network(set_masklen(v, 48)));
END;
$$;


--
-- Name: redact_evidence_user_agent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redact_evidence_user_agent(p_ua text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_ua IS NULL OR btrim(p_ua) = '' THEN NULL
    ELSE
      (CASE
         WHEN p_ua ~* 'Edg/'            THEN 'Edge'
         WHEN p_ua ~* 'OPR/|Opera'      THEN 'Opera'
         WHEN p_ua ~* 'Firefox/|FxiOS/' THEN 'Firefox'
         WHEN p_ua ~* 'Chrome/|CriOS/'  THEN 'Chrome'
         WHEN p_ua ~* 'Safari/'         THEN 'Safari'
         ELSE 'Other'
       END)
      || '/' ||
      (CASE
         WHEN p_ua ~* 'Windows'             THEN 'Windows'
         WHEN p_ua ~* 'Android'             THEN 'Android'
         WHEN p_ua ~* 'iPhone|iPad|iPod'    THEN 'iOS'
         WHEN p_ua ~* 'Mac OS X|Macintosh'  THEN 'macOS'
         WHEN p_ua ~* 'CrOS'                THEN 'ChromeOS'
         WHEN p_ua ~* 'Linux'               THEN 'Linux'
         ELSE 'Other'
       END)
  END
$$;


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
    excluded_event_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT student_overall_kpi_current_streak_days_check CHECK ((current_streak_days >= 0)),
    CONSTRAINT student_overall_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_overall_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_overall_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_overall_kpi_longest_streak_days_check CHECK ((longest_streak_days >= 0)),
    CONSTRAINT student_overall_kpi_sections_active_check CHECK (((sections_active >= 0) AND (sections_active <= 2)))
);


--
-- Name: COLUMN student_overall_kpi.excluded_event_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_overall_kpi.excluded_event_count IS 'Canonical events excluded from this row''s aggregates for NULL correct/occurred_at. Recomputed every refresh from the same event set as every other column (INV-05B-14). Operator-only: Doc 05 Parent AC#20 locks student and guardian read surfaces to mastery_level.';


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

  -- RB-05B-V1-02 partially superseded (SCL-054). This is the student-wide validator whose
  -- RAISE produced the outage's blast radius: it aborted the whole mastery transaction for
  -- a student because of a row in a section the event under test never touched.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;

  WITH all_events AS (
    SELECT section, correct, occurred_at FROM (
      SELECT pi.question_section AS section, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.section, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id
    ) e
    -- The quarantine itself. Excluded rows enter NO aggregate below.
    WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL
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
    kpi_refresh_version, refreshed_at, refreshed_at_t_now,
    excluded_event_count
  )
  SELECT p_student_id, a.evt_total, a.evt_7d, a.evt_30d,
    a.acc_overall, a.acc_7d, a.acc_30d,
    a.sec_active, s.current_streak, s.longest_streak, a.last_active,
    'v1.0', now(), p_t_now,
    v_bad_count
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    sections_active=EXCLUDED.sections_active, current_streak_days=EXCLUDED.current_streak_days,
    longest_streak_days=EXCLUDED.longest_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now,
    excluded_event_count=EXCLUDED.excluded_event_count
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
    excluded_event_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT student_section_kpi_current_streak_days_check CHECK ((current_streak_days >= 0)),
    CONSTRAINT student_section_kpi_events_last_30d_check CHECK ((events_last_30d >= 0)),
    CONSTRAINT student_section_kpi_events_last_7d_check CHECK ((events_last_7d >= 0)),
    CONSTRAINT student_section_kpi_events_total_check CHECK ((events_total >= 0)),
    CONSTRAINT student_section_kpi_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


--
-- Name: COLUMN student_section_kpi.excluded_event_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_section_kpi.excluded_event_count IS 'Canonical events excluded from this row''s aggregates for NULL correct/occurred_at. Recomputed every refresh from the same event set as every other column (INV-05B-14). Operator-only: Doc 05 Parent AC#20 locks student and guardian read surfaces to mastery_level.';


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

  -- RB-05B-V1-02 partially superseded (SCL-054): the identical predicate now CLASSIFIES
  -- rather than aborts. The count is kept and persisted below; it is not discarded, which
  -- is what separates this from the silent NULL filter RB-05B-V1-02 correctly rejected.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;

  WITH section_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section
    ) e
    -- The quarantine itself. Excluded rows enter NO aggregate below.
    WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL
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
    current_streak_days, last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now,
    excluded_event_count
  )
  SELECT p_student_id, p_section, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    s.current_streak, a.last_active, 'v1.0', now(), p_t_now,
    v_bad_count
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id, section) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    current_streak_days=EXCLUDED.current_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now,
    excluded_event_count=EXCLUDED.excluded_event_count
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
-- Name: request_account_deletion(uuid, uuid, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer DEFAULT 7, p_request_channel text DEFAULT 'self_service_web'::text) RETURNS TABLE(requested_at timestamp with time zone, scheduled_hard_delete_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now       timestamptz := now();
  v_sched     timestamptz := now() + make_interval(days => p_grace_days);
  v_subject   text;
  v_requester text;
  v_log_id    uuid;
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

  SELECT p.email INTO v_subject FROM public.profiles p WHERE p.id = p_profile_id;
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion: profile % not found', p_profile_id;
  END IF;
  SELECT p.email INTO v_requester FROM public.profiles p WHERE p.id = p_actor_id;
  v_requester := coalesce(v_requester, v_subject);

  -- T0 (evidence side): the request record, at day granularity.
  INSERT INTO public.deletion_request_log
    (subject_email, requester_email, request_channel, requested_on, status)
  VALUES
    (v_subject, v_requester, p_request_channel, (v_now AT TIME ZONE 'utc')::date, 'pending')
  RETURNING log_id INTO v_log_id;

  UPDATE public.profiles SET deleted_at = v_now, updated_at = v_now WHERE id = p_profile_id;

  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status,
     stripe_cancellation_status, recovery_token_hash, recovery_token_expires_at, log_id)
  VALUES
    (p_profile_id, v_now, v_sched, p_actor_id, 'pending',
     'pending', p_recovery_token_hash, v_sched, v_log_id);

  -- @spec [Doc-01_V8 §5 action enum; §40.2.1 Phase 1 "Emit audit event" inside the DB
  -- transaction] | @implemented [2026-09-17]
  -- The profile is live and identified here, so the row carries real ids: §5's trail is worth
  -- nothing if it cannot say whose account it was. No address, no token, no free text — the
  -- changes/context payloads carry the schedule and the source, which are not personal data.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor_id,
    p_profile_id,
    'profile_soft_deleted',
    jsonb_build_object('deleted_at', jsonb_build_object('from', NULL, 'to', 'set')),
    jsonb_build_object(
      'source', 'request_account_deletion',
      'scheduled_hard_delete_at', v_sched,
      'grace_days', p_grace_days
    )
  );

  RETURN QUERY SELECT v_now, v_sched;
END;
$$;


--
-- Name: resolve_deletion_billing_record(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_deletion_billing_record(p_log_id uuid, p_final_status text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_final_status NOT IN ('cancelled', 'item_removed', 'none_active') THEN
    RAISE EXCEPTION 'resolve_deletion_billing_record: % is not a resolved status', p_final_status
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.deletion_billing_record
     SET final_status = p_final_status,
         cancelled_on = (now() AT TIME ZONE 'utc')::date
   WHERE log_id = p_log_id
     AND final_status = 'failed_manual';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
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
  v_log_id     uuid;
BEGIN
  SELECT adr.profile_id, adr.log_id INTO v_profile_id, v_log_id
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

  IF v_log_id IS NOT NULL THEN
    UPDATE public.deletion_request_log
       SET status = 'cancelled', responded_on = (now() AT TIME ZONE 'utc')::date
     WHERE log_id = v_log_id AND status IN ('pending', 'executing');
  END IF;

  -- @spec [Doc-01_V8 §5 action enum; §40.4 "profile_restored audit event"]
  -- | @implemented [2026-09-17] Self-service recovery: the actor is the profile itself (§5
  -- "may be the profile itself for self-service"). The token hash is deliberately absent.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    v_profile_id,
    v_profile_id,
    'profile_restored',
    jsonb_build_object('deleted_at', jsonb_build_object('from', 'set', 'to', NULL)),
    jsonb_build_object('source', 'restore_account_deletion', 'path', 'recovery_token')
  );

  RETURN v_profile_id;
END;
$$;


--
-- Name: review_item_resolve(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_item_resolve() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'answered' THEN
    -- id = NEW.id so the attempt id EQUALS the item id. R3 passes that as the
    -- mastery event id (ruling 11), and canonical_mastery_events reads
    -- review_error_attempts.id as event_id.
    INSERT INTO public.review_error_attempts (
      id, session_item_id, student_id, question_id,
      selected_answer, is_correct, seconds_spent, client_attempt_id,
      used_tutor, section, domain, skill, difficulty, occurred_at, actor_id
    ) VALUES (
      NEW.id, NEW.id, NEW.student_id, NEW.question_id,
      NEW.selected_answer, NEW.is_correct,
      NEW.time_spent_ms / 1000, NEW.client_attempt_id,
      false,                      -- ruling 9: LISA is out at launch
      NEW.question_section, NEW.question_domain, NEW.question_skill,
      NEW.question_difficulty, NEW.occurred_at, NEW.actor_id
    );

    IF NEW.is_correct THEN
      PERFORM public.review_queue_graduate(
        NEW.student_id, NEW.question_id, NEW.id, NEW.occurred_at);
    ELSE
      PERFORM public.review_queue_record(
        NEW.student_id, NEW.question_id, 'review',
        NEW.session_id, NEW.id, 'incorrect', NEW.occurred_at);
    END IF;

  ELSIF NEW.status = 'skipped' THEN
    -- No attempt row. Pre-build check 7: canonical_mastery_events' practice
    -- branch filters status='answered' (20260806000000_diagnostic_gate.sql:140),
    -- so practice skips carry no mastery. Review mirrors that; writing an
    -- attempt here would make review skips count where practice skips do not.
    PERFORM public.review_queue_record(
      NEW.student_id, NEW.question_id, 'review',
      NEW.session_id, NEW.id, 'skipped', NEW.occurred_at);
  END IF;

  RETURN NULL;
END
$$;


--
-- Name: review_queue_graduate(uuid, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_queue_graduate(p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_question_id));

  UPDATE public.review_schedule
     SET status            = 'graduated',
         closed_at         = p_at,
         closed_by_item_id = p_review_item_id,
         updated_at        = p_at
   WHERE student_id = p_student_id
     AND question_id = p_question_id
     AND status = 'active'
  RETURNING id INTO v_id;

  -- No active entry is a normal outcome, not an error: the question may have
  -- graduated in another open session (plan §6, "the same question in two open
  -- sessions"). Returning NULL says "nothing to close" without raising.
  RETURN v_id;
END
$$;


--
-- Name: FUNCTION review_queue_graduate(p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.review_queue_graduate(p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone) IS 'Ruled plan §3 ruling 4. Closes the question''s open queue entry as graduated. Returns NULL when there is none — the question graduated elsewhere first.';


--
-- Name: review_queue_record(uuid, text, text, uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_queue_record(p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_existing uuid;
  v_new      uuid;
BEGIN
  -- The lock is taken BEFORE any read of the state it protects. Two concurrent
  -- misses on one question must not both see "no active entry" and both insert
  -- (G6). Transaction-scoped: released at commit, so the caller's CAS owns it.
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_question_id));

  -- Replay: this exact source item already enqueued. Returning the existing row
  -- rather than raising is what makes the backfill re-runnable (§4) and makes a
  -- retried CAS harmless (G4).
  SELECT id INTO v_existing
  FROM public.review_schedule
  WHERE source_engine = p_source_engine AND source_item_id = p_source_item_id;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Ruling 12: a new miss supersedes the question's open entry rather than
  -- mutating it, so the queue keeps one row per event. closed_by_item_id is the
  -- review item that closed it, which only exists when review is the source —
  -- a practice miss closes the entry but is not a review item.
  UPDATE public.review_schedule
     SET status            = 'superseded',
         closed_at         = p_at,
         closed_by_item_id = CASE WHEN p_source_engine = 'review' THEN p_source_item_id END,
         updated_at        = p_at
   WHERE student_id = p_student_id
     AND question_id = p_question_id
     AND status = 'active';

  INSERT INTO public.review_schedule (
    student_id, question_id, status, queued_at,
    source_engine, source_session_id, source_item_id, source_outcome,
    created_at, updated_at
  ) VALUES (
    p_student_id, p_question_id, 'active', p_at,
    p_source_engine, p_source_session_id, p_source_item_id, p_source_outcome,
    p_at, p_at
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END
$$;


--
-- Name: FUNCTION review_queue_record(p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.review_queue_record(p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone) IS 'Ruled plan §3 ruling 12. The only writer of review_schedule entries. Takes the (student, question) advisory lock before reading, replays on (source_engine, source_item_id), supersedes the open entry, inserts the new one.';


--
-- Name: revoke_guardian_link_audited(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text) RETURNS public.guardian_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_after         public.guardian_links;
  v_target        uuid;
  v_student_name  text;
  v_guardian_name text;
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

  -- THE one derivation of the counterparty: the party who did not revoke. The audit row and
  -- the notification below both read v_target; nothing derives the recipient a second time.
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

  -- §36.3 — the other party is told, in THIS transaction (contract §2.2). Recipient: v_target
  -- only, in_app + email; the revoker gets UI confirmation, never a notification. Subject is
  -- the student (the account the link is about), as for guardian_linked. Payload: the link id
  -- and the two display names (contract §8.1; Doc 01 §38.1 — identity only). The reason is
  -- NEVER here: it would become student-readable under RLS and leave in an email body.
  SELECT display_name INTO v_student_name
    FROM public.profiles WHERE id = v_after.student_profile_id;
  SELECT display_name INTO v_guardian_name
    FROM public.profiles WHERE id = v_after.guardian_profile_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_unlinked', v_after.id::text),
    'guardian_unlinked',
    v_after.student_profile_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', v_target, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object(
      'link_id', v_after.id,
      'student_display_name', coalesce(v_student_name, ''),
      'guardian_display_name', coalesce(v_guardian_name, '')
    )
  );

  RETURN v_after;
END;
$$;


--
-- Name: rewrite_anonymized_actors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rewrite_anonymized_actors() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  -- Concurrency (spec-auditor finding C on PR #769): a cascade committing between the
  -- snapshot and the DELETE would have its ledger row destroyed and never re-inserted —
  -- the only proof that an actor_id was anonymized. ACCESS EXCLUSIVE makes a concurrent
  -- cascade's INSERT wait for this transaction to commit; the function is milliseconds.
  LOCK TABLE public.anonymized_actors IN ACCESS EXCLUSIVE MODE;
  CREATE TEMP TABLE _ledger ON COMMIT DROP AS
    SELECT actor_id FROM public.anonymized_actors;
  DELETE FROM public.anonymized_actors;
  INSERT INTO public.anonymized_actors (actor_id)
    SELECT actor_id FROM _ledger ORDER BY actor_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
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
-- Name: sweep_deletion_evidence(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sweep_deletion_evidence(p_batch_size integer) RETURNS TABLE(stripped_log_rows integer, stripped_consent_rows integer, cutoff date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cutoff  date;
  v_ids     uuid[];
  v_logs    integer;
  v_consent integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_deletion_evidence: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := ((now() AT TIME ZONE 'utc')::date
               - make_interval(months => public.deletion_evidence_retention_months()))::date;

  SELECT array_agg(l.log_id ORDER BY l.log_id)
    INTO v_ids
    FROM (
      SELECT r.log_id
        FROM public.deletion_request_log r
       WHERE r.status IN ('completed', 'cancelled', 'denied')
         AND r.responded_on IS NOT NULL
         AND r.responded_on < v_cutoff
         AND (r.subject_email IS NOT NULL OR r.requester_email IS NOT NULL)
       ORDER BY r.responded_on, r.log_id
       LIMIT p_batch_size
    ) l;

  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 0, 0, v_cutoff;
    RETURN;
  END IF;

  -- The identity columns, and only those. requested_on, responded_on, status and denial_basis
  -- are the aggregate the entry exists to keep.
  UPDATE public.deletion_request_log
     SET subject_email = NULL, requester_email = NULL
   WHERE log_id = ANY (v_ids);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- Consent evidence rides the same clock (SCL-085, one clock for the whole bundle). doc_key,
  -- doc_version, actor_type, minor, consent_source and accepted_on survive: that tuple is what
  -- defends a COPPA claim, and none of it identifies anyone once the network and the browser
  -- family are gone.
  UPDATE public.deletion_consent_evidence
     SET ip_address = NULL, user_agent = NULL
   WHERE log_id = ANY (v_ids)
     AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS v_consent = ROW_COUNT;

  -- Nothing here touches the do-not-contact promise: it is an entry on Resend's suppression
  -- list, not a row in this database. See the header.

  RETURN QUERY SELECT v_logs, v_consent, v_cutoff;
END;
$$;


--
-- Name: sweep_notification_retention(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sweep_notification_retention(p_batch_size integer) RETURNS TABLE(deleted_events integer, deleted_messages integer, deleted_orphan_delivery_events integer, cutoff timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cutoff                          timestamptz;
  v_deleted_events                  integer;
  v_deleted_messages                integer;
  v_deleted_orphan_delivery_events  integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_notification_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- ONE cutoff for both branches, from the ONE window definition.
  v_cutoff := now() - make_interval(days => public.notification_retention_days());

  -- Branch 1 — the parent path. Expired events go; messages and the delivery events
  -- attached to them go by FK cascade. Every CTE sees the same snapshot, so
  -- `doomed_messages` counts the messages the DELETE's cascade is about to remove.
  WITH doomed AS (
    SELECT e.event_id
      FROM public.notification_events e
     WHERE e.created_at < v_cutoff
     ORDER BY e.created_at ASC, e.event_id ASC
     LIMIT p_batch_size
  ),
  doomed_messages AS (
    SELECT count(*)::integer AS n
      FROM public.notification_messages m
     WHERE m.event_id IN (SELECT d.event_id FROM doomed d)
  ),
  deleted AS (
    DELETE FROM public.notification_events e
     WHERE e.event_id IN (SELECT d.event_id FROM doomed d)
    RETURNING e.event_id
  )
  SELECT (SELECT count(*)::integer FROM deleted), (SELECT n FROM doomed_messages)
    INTO v_deleted_events, v_deleted_messages;

  -- Branch 2 — the orphan path. A delivery event with no message has no parent to cascade
  -- from; it is aged on its own `received_at` against the SAME cutoff. Bounded on its own.
  WITH doomed_orphans AS (
    SELECT d.provider_event_id
      FROM public.notification_delivery_events d
     WHERE d.message_id IS NULL
       AND d.received_at < v_cutoff
     ORDER BY d.received_at ASC, d.provider_event_id ASC
     LIMIT p_batch_size
  ),
  deleted_orphans AS (
    DELETE FROM public.notification_delivery_events d
     WHERE d.provider_event_id IN (SELECT o.provider_event_id FROM doomed_orphans o)
    RETURNING d.provider_event_id
  )
  SELECT count(*)::integer INTO v_deleted_orphan_delivery_events FROM deleted_orphans;

  deleted_events                 := v_deleted_events;
  deleted_messages               := v_deleted_messages;
  deleted_orphan_delivery_events := v_deleted_orphan_delivery_events;
  cutoff                         := v_cutoff;
  RETURN NEXT;
END;
$$;


--
-- Name: FUNCTION sweep_notification_retention(p_batch_size integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sweep_notification_retention(p_batch_size integer) IS 'contracts/notifications.contract.md C11.2: ONE window (notification_retention_days()), two branches in one transaction — (1) notification_events older than the window, oldest first, at most p_batch_size per call, messages and matched delivery events by FK cascade; (2) unmatched delivery events (message_id IS NULL) whose received_at is older than the same window, at most p_batch_size per call. Returns both counts and the cutoff so every run can be logged.';


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
    log_id uuid,
    CONSTRAINT account_deletion_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'cancelled'::text, 'completed'::text]))),
    CONSTRAINT account_deletion_requests_stripe_cancellation_status_check CHECK ((stripe_cancellation_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed_manual'::text, 'cancelled_by_recovery'::text])))
);


--
-- Name: COLUMN account_deletion_requests.log_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_deletion_requests.log_id IS 'deletion_request_log.log_id for this request (no FK on purpose). Set by request_account_deletion; NULL for rows created before migration 20260917000000. Dies with the row at cascade PS-5.';


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
    actor_id uuid NOT NULL
);


--
-- Name: TABLE anonymized_actors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.anonymized_actors IS 'Ledger of anonymized actor_ids (Doc 05E §3 Rule 4, INV-05E-01/02; build-derived, no spec anchor — SCL-088). actor_id only: no timestamp, and rewrite_anonymized_actors() strips insertion order after every executor pass.';


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
-- Name: calendar_block_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_block_launches (
    block_id uuid NOT NULL,
    student_id uuid NOT NULL,
    launch_sequence smallint NOT NULL,
    engine text NOT NULL,
    engine_session_id uuid NOT NULL,
    launched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_block_launches_engine_check CHECK ((engine = ANY (ARRAY['practice'::text, 'review'::text, 'full_length'::text]))),
    CONSTRAINT calendar_block_launches_launch_sequence_check CHECK ((launch_sequence >= 1))
);


--
-- Name: TABLE calendar_block_launches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calendar_block_launches IS 'Doc 05F §7.7, append-only. Used for Resume/Continue and calendar_launch_rate only. Never for progress — progress is the §13 allocator over engine events.';


--
-- Name: calendar_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_blocks (
    block_id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    created_in_version_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    block_type text NOT NULL,
    section text,
    scope jsonb NOT NULL,
    target_count integer NOT NULL,
    source text NOT NULL,
    derived_from_block_id uuid,
    explanation_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_blocks_block_type_check CHECK ((block_type = ANY (ARRAY['practice'::text, 'review'::text, 'full_length'::text]))),
    CONSTRAINT calendar_blocks_full_length_single CHECK (((block_type <> 'full_length'::text) OR (target_count = 1))),
    CONSTRAINT calendar_blocks_scope_shape CHECK (public.calendar_scope_is_valid(block_type, section, scope)),
    CONSTRAINT calendar_blocks_section_by_type CHECK ((((block_type = 'practice'::text) AND (section IS NOT NULL)) OR ((block_type = ANY (ARRAY['review'::text, 'full_length'::text])) AND (section IS NULL)))),
    CONSTRAINT calendar_blocks_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT calendar_blocks_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'student'::text, 'post_exam'::text]))),
    CONSTRAINT calendar_blocks_target_count_check CHECK ((target_count >= 1))
);


--
-- Name: TABLE calendar_blocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calendar_blocks IS 'Doc 05F §7.4, append-only. No ordinal, no override flag, no status: order is membership, override is the plan date, status is derived.';


--
-- Name: COLUMN calendar_blocks.scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_blocks.scope IS 'Doc 05F §7.4 as amended by formula sheet §8 item 3. practice: {"level":"domain","mix":[{domain,count,explanation_key}]} or {"level":"section","count","explanation_key"} (cold start / fallback — sheet §1). review: {"mode":"queue"} or {"mode":"session","source_engine","source_session_id"} (§8 item 13). full_length: {"form_id"}. Shape enforced by calendar_scope_is_valid.';


--
-- Name: calendar_plan_block_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_plan_block_memberships (
    plan_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    block_id uuid NOT NULL,
    display_ordinal smallint NOT NULL,
    membership_type text NOT NULL,
    CONSTRAINT calendar_plan_block_memberships_display_ordinal_check CHECK ((display_ordinal >= 1)),
    CONSTRAINT calendar_plan_block_memberships_membership_type_check CHECK ((membership_type = ANY (ARRAY['created'::text, 'carried'::text])))
);


--
-- Name: calendar_plan_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_plan_dates (
    plan_version_id uuid NOT NULL,
    student_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    timezone text NOT NULL,
    is_user_override boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN calendar_plan_dates.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_plan_dates.timezone IS 'Doc 05F §7.3: the IANA zone in force when this date was planned. It is the date''s temporal meaning and is immutable — a later profile timezone change does not rewrite it.';


--
-- Name: calendar_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_plan_versions (
    plan_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    version_no integer NOT NULL,
    generator text DEFAULT 'deterministic_v1'::text NOT NULL,
    generator_version text NOT NULL,
    trigger text NOT NULL,
    initiated_by text NOT NULL,
    input_snapshot jsonb NOT NULL,
    input_snapshot_hash text NOT NULL,
    constants_snapshot jsonb NOT NULL,
    validator_result text NOT NULL,
    validator_detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_plan_versions_generator_check CHECK ((generator = ANY (ARRAY['deterministic_v1'::text, 'fallback_v1'::text]))),
    CONSTRAINT calendar_plan_versions_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['student'::text, 'system'::text, 'admin'::text]))),
    CONSTRAINT calendar_plan_versions_trigger_check CHECK ((trigger = ANY (ARRAY['setup'::text, 'profile_change'::text, 'weekly'::text, 'student_refresh'::text, 'post_exam'::text, 'day_edit'::text, 'day_regenerate'::text, 'day_reset'::text, 'do_it_now'::text, 'rollback'::text]))),
    CONSTRAINT calendar_plan_versions_validator_result_check CHECK ((validator_result = ANY (ARRAY['accepted'::text, 'rejected'::text]))),
    CONSTRAINT calendar_plan_versions_version_no_check CHECK ((version_no >= 1))
);


--
-- Name: TABLE calendar_plan_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calendar_plan_versions IS 'Doc 05F §7.2, append-only. generator IN (deterministic_v1, fallback_v1) per formula sheet §8 item 1. When fallback_v1 ran, validator_detail carries the reason.';


--
-- Name: calendar_current_plan; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.calendar_current_plan WITH (security_invoker='true') AS
 WITH owner AS (
         SELECT d_1.student_id,
            d_1.scheduled_date,
            max(v_1.version_no) AS version_no
           FROM (public.calendar_plan_dates d_1
             JOIN public.calendar_plan_versions v_1 ON ((v_1.plan_version_id = d_1.plan_version_id)))
          WHERE (v_1.validator_result = 'accepted'::text)
          GROUP BY d_1.student_id, d_1.scheduled_date
        )
 SELECT d.student_id,
    d.scheduled_date,
    d.timezone,
    d.is_user_override,
    v.version_no,
    v.plan_version_id,
    m.block_id,
    m.display_ordinal,
    m.membership_type
   FROM (((owner o
     JOIN public.calendar_plan_versions v ON (((v.student_id = o.student_id) AND (v.version_no = o.version_no))))
     JOIN public.calendar_plan_dates d ON (((d.plan_version_id = v.plan_version_id) AND (d.scheduled_date = o.scheduled_date))))
     LEFT JOIN public.calendar_plan_block_memberships m ON (((m.plan_version_id = d.plan_version_id) AND (m.scheduled_date = d.scheduled_date))));


--
-- Name: VIEW calendar_current_plan; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.calendar_current_plan IS 'Doc 05F §7.6. security_invoker = true — visibility is decided by the base tables'' RLS policies, not by the view owner.';


--
-- Name: calendar_job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_job_runs (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    job text NOT NULL,
    student_id uuid NOT NULL,
    period_key date NOT NULL,
    outcome text NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_job_runs_job_check CHECK ((job = 'weekly_regen'::text)),
    CONSTRAINT calendar_job_runs_outcome_check CHECK ((outcome = ANY (ARRAY['ok'::text, 'skipped_fresh'::text, 'skipped_custom'::text, 'skipped_no_entitlement'::text, 'failed'::text])))
);


--
-- Name: calendar_mutation_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_mutation_ledger (
    student_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    route text NOT NULL,
    response_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE calendar_mutation_ledger; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calendar_mutation_ledger IS 'Doc 05F §7.8. A replayed key returns the stored response and writes nothing. Retired when Doc 01A Part IV IdempotencyService ships (G-08-04), and the client contract does not change.';


--
-- Name: calendar_plan_versions_student; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.calendar_plan_versions_student WITH (security_invoker='true') AS
 SELECT plan_version_id,
    student_id,
    version_no,
    generator,
    generator_version,
    trigger,
    initiated_by,
    input_snapshot_hash,
    validator_result,
    created_at
   FROM public.calendar_plan_versions v;


--
-- Name: VIEW calendar_plan_versions_student; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.calendar_plan_versions_student IS 'Doc 05F §7.12. Excludes input_snapshot and constants_snapshot. security_invoker = true, so the base table RLS decides rows and the column grants decide columns.';


--
-- Name: calendar_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_runtime_config (
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
    CONSTRAINT calendar_runtime_config_environment_check CHECK ((environment = ANY (ARRAY['all'::text, 'development'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT calendar_runtime_config_value_type_check CHECK ((value_type = ANY (ARRAY['integer'::text, 'string'::text, 'boolean'::text, 'array'::text, 'object'::text, 'float'::text])))
);


--
-- Name: calendar_runtime_config_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_runtime_config_history (
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
    category text DEFAULT 'crisis'::text NOT NULL,
    CONSTRAINT crisis_review_cases_category_check CHECK ((category = ANY (ARRAY['crisis'::text, 'safeguarding'::text]))),
    CONSTRAINT crisis_review_cases_disposition_check CHECK (((disposition IS NULL) OR (disposition = ANY (ARRAY['true_positive'::text, 'false_positive'::text])))),
    CONSTRAINT crisis_review_cases_source_check CHECK ((source = ANY (ARRAY['signature'::text, 'model'::text, 'both'::text, 'classifier_degraded'::text, 'classifier_degraded_no_floor'::text, 'infrastructure_failure'::text]))),
    CONSTRAINT crisis_review_cases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text])))
);


--
-- Name: deletion_billing_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_billing_record (
    log_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_subscription_item_id text,
    cancelled_on date NOT NULL,
    final_status text NOT NULL,
    CONSTRAINT deletion_billing_record_final_status_check CHECK ((final_status = ANY (ARRAY['cancelled'::text, 'item_removed'::text, 'none_active'::text, 'failed_manual'::text])))
);


--
-- Name: TABLE deletion_billing_record; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deletion_billing_record IS 'Minimal financial record of the Stripe outcome at execution (plan v4 §3.7; SCL-086; SCL-089 alert-and-retry). NO actor_id (Doc 05E §3 Rule 2: the synthetic identifier is never written to billing surfaces; stripe_customer_id resolves to an email inside Stripe) and NO email. The item id is kept so a failed_manual teardown can be retried after the entitlement row is gone. Legal-obligation basis, 7-year tier.';


--
-- Name: deletion_consent_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_consent_evidence (
    log_id uuid NOT NULL,
    accepted_on date NOT NULL,
    doc_key text NOT NULL,
    doc_version text NOT NULL,
    actor_type text NOT NULL,
    minor boolean NOT NULL,
    consent_source text NOT NULL,
    ip_address text,
    user_agent text
);


--
-- Name: TABLE deletion_consent_evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deletion_consent_evidence IS 'Consent evidence copied from legal_acceptances at execution, keyed to the deletion request log (plan v4 §3.5; SCL-085). accepted_on is a DATE: signup is minutes before the first activity row, so a timestamp would correlate to the actor_id side. ip_address is the /24 (IPv4) or /48 (IPv6) network and user_agent is browser family/OS family — Doc 01 §5.1 redaction, inherited (SCL-085 amendment, owner ruling 2026-09-16). Composite key on purpose: a serial would reproduce copy order.';


--
-- Name: deletion_request_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_request_log (
    log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_email text,
    requester_email text,
    request_channel text NOT NULL,
    requested_on date NOT NULL,
    responded_on date,
    status text NOT NULL,
    denial_basis text,
    suppression_requested boolean DEFAULT false NOT NULL,
    suppression_status text,
    CONSTRAINT deletion_request_log_request_channel_check CHECK ((request_channel = 'self_service_web'::text)),
    CONSTRAINT deletion_request_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'executing'::text, 'completed'::text, 'cancelled'::text, 'denied'::text]))),
    CONSTRAINT deletion_request_log_suppression_status_check CHECK (((suppression_status IS NULL) OR (suppression_status = ANY (ARRAY['applied'::text, 'failed_manual'::text]))))
);


--
-- Name: TABLE deletion_request_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deletion_request_log IS 'Evidence bundle root (plan v4 §3.3; SCL-085). One row per deletion request: CCPA §7101 fields at day granularity. NO created_at, NO uuid other than the random log_id, NO FK outside the bundle — see the migration header for why (evidence invariant rules 1-3).';


--
-- Name: COLUMN deletion_request_log.log_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deletion_request_log.log_id IS 'Random (gen_random_uuid), NOT a serial: a serial reproduces request order, which at low volume rank-joins the deletion order visible on the actor_id side through xmin.';


--
-- Name: COLUMN deletion_request_log.subject_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deletion_request_log.subject_email IS 'The deleted account address. NULL once the 24-month strip has run (SCL-085): the row then carries only the dated aggregate — when it was asked, when it was answered, the outcome.';


--
-- Name: COLUMN deletion_request_log.requester_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deletion_request_log.requester_email IS 'Who asked; equals subject for self-service. NULL after the 24-month strip, as above.';


--
-- Name: COLUMN deletion_request_log.suppression_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deletion_request_log.suppression_status IS 'Outcome of the Resend suppression call for a request whose suppression_requested is true. NULL = not attempted. applied = Resend accepted it. failed_manual = the call failed and the executor''s retry sweep re-attempts it each pass, as it does a row left NULL. Stays applied after a subject re-consents and the entry is removed at Resend, so the sweep cannot silently re-suppress them.';


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
    doc_slug text,
    content_hash text,
    source_reference text,
    CONSTRAINT legal_acceptances_actor_type_check CHECK ((actor_type = ANY (ARRAY['student'::text, 'parent'::text]))),
    CONSTRAINT legal_acceptances_consent_source_check CHECK ((consent_source = ANY (ARRAY['email_signup_form'::text, 'google_continue_pre_oauth'::text, 'google_continue_click'::text, 'guardian_link_redeem'::text, 'stripe_checkout'::text, 'reconsent_prompt'::text]))),
    CONSTRAINT legal_acceptances_content_hash_shape CHECK (((content_hash IS NULL) OR (content_hash ~ '^sha256:[0-9a-f]{64}$'::text)))
);


--
-- Name: COLUMN legal_acceptances.doc_slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legal_acceptances.doc_slug IS 'legal/<slug> the consent is for. NULL only on rows predating Phase 2.';


--
-- Name: COLUMN legal_acceptances.content_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legal_acceptances.content_hash IS 'sha256:<64 hex> of the exact en.md served at acceptance, copied from that version''s meta.yml. NULL only on rows predating Phase 2, whose text was never retained. Never backfilled — a guessed hash is a false record.';


--
-- Name: COLUMN legal_acceptances.source_reference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legal_acceptances.source_reference IS 'Identifier issued by the surface named in consent_source. A Stripe Checkout Session id (cs_...) for stripe_checkout; NULL for surfaces that issue none.';


--
-- Name: CONSTRAINT legal_acceptances_consent_source_check ON legal_acceptances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT legal_acceptances_consent_source_check ON public.legal_acceptances IS 'Where the acceptance was collected. guardian_link_redeem: a guardian accepting Parent / Guardian Terms while redeeming a student link code. stripe_checkout: auto-renewal consent taken in Checkout per Cal. Bus. & Prof. Code § 17602, separate from Terms of Use acceptance at signup. reconsent_prompt: an existing user accepting a newly published version through the blocking modal shown at next sign-in.';


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
-- Name: notification_delivery_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery_events (
    provider_event_id text NOT NULL,
    provider_message_id text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    message_id uuid,
    outcome text DEFAULT 'unmatched'::text NOT NULL,
    applied_at timestamp with time zone,
    CONSTRAINT notification_delivery_events_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'ignored'::text, 'unmatched'::text])))
);


--
-- Name: TABLE notification_delivery_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_delivery_events IS 'Verified provider (Resend/Svix) webhook receipts. Dedupe key is the svix-id. Inserted and applied in ONE function call (apply_notification_delivery_event) so claimed-but-not-applied is unrepresentable. Unmatched rows are reconciled when the dispatcher records the send.';


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    subject_profile_id uuid NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_events_type_check CHECK ((event_type = ANY (ARRAY['guardian_linked'::text, 'guardian_unlinked'::text])))
);


--
-- Name: TABLE notification_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_events IS 'One row per notifiable moment, written in the same transaction as the mutation that produced it. payload holds identifiers and rendering parameters only (contract §8). Service-role only.';


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
-- Name: review_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    question_id text NOT NULL,
    queued_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_engine text NOT NULL,
    source_session_id uuid NOT NULL,
    source_item_id uuid NOT NULL,
    source_outcome text NOT NULL,
    closed_at timestamp with time zone,
    closed_by_item_id uuid,
    CONSTRAINT review_schedule_closed_iff_not_active CHECK (((status = 'active'::text) = (closed_at IS NULL))),
    CONSTRAINT review_schedule_source_engine_check CHECK ((source_engine = ANY (ARRAY['practice'::text, 'full_length'::text, 'review'::text]))),
    CONSTRAINT review_schedule_source_outcome_check CHECK ((source_outcome = ANY (ARRAY['incorrect'::text, 'skipped'::text]))),
    CONSTRAINT review_schedule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'graduated'::text, 'superseded'::text, 'retired'::text])))
);


--
-- Name: review_question_history; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.review_question_history WITH (security_invoker='true') AS
 SELECT q.student_id,
    q.question_id,
    (count(*))::integer AS entry_count,
    (count(*) FILTER (WHERE (q.source_engine = 'practice'::text)))::integer AS entries_from_practice,
    (count(*) FILTER (WHERE (q.source_engine = 'review'::text)))::integer AS entries_from_review,
    (count(*) FILTER (WHERE (q.source_engine = 'full_length'::text)))::integer AS entries_from_full_length,
    (count(*) FILTER (WHERE (q.source_outcome = 'incorrect'::text)))::integer AS entries_incorrect,
    (count(*) FILTER (WHERE (q.source_outcome = 'skipped'::text)))::integer AS entries_skipped,
    min(q.queued_at) AS first_queued_at,
    max(q.queued_at) AS last_queued_at,
    COALESCE(a.review_attempts, 0) AS review_attempts,
    COALESCE(a.review_fails, 0) AS review_fails,
    max(q.status) FILTER (WHERE (q.status = 'active'::text)) AS open_status,
    max(q.closed_at) FILTER (WHERE (q.status = 'graduated'::text)) AS graduated_at
   FROM (public.review_schedule q
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS review_attempts,
            (count(*) FILTER (WHERE (ra.is_correct = false)))::integer AS review_fails
           FROM public.review_error_attempts ra
          WHERE ((ra.student_id = q.student_id) AND (ra.question_id = q.question_id))) a ON (true))
  GROUP BY q.student_id, q.question_id, a.review_attempts, a.review_fails;


--
-- Name: VIEW review_question_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.review_question_history IS 'Ruled plan §3 ruling 21. One row per (student, question) present in the queue: entry counts by engine and outcome, first/last queued_at, review attempt and fail counts, whether an entry is currently open, and the graduation time. Derived only; stores nothing. service_role only.';


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
    status text DEFAULT 'pending'::text NOT NULL,
    served_at timestamp with time zone,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    selected_answer text,
    is_correct boolean,
    outcome text,
    time_spent_ms integer,
    client_attempt_id text,
    occurred_at timestamp with time zone,
    option_order text[],
    option_token_map jsonb,
    client_instance_id text,
    question_item_type text DEFAULT 'mcq'::text NOT NULL,
    question_correct_variants text[],
    question_assets jsonb,
    question_estimated_time_seconds integer,
    queue_entry_id uuid,
    CONSTRAINT review_session_items_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['correct'::text, 'incorrect'::text, 'skipped'::text])))),
    CONSTRAINT review_session_items_question_difficulty_check CHECK (((question_difficulty >= 1) AND (question_difficulty <= 3))),
    CONSTRAINT review_session_items_question_item_type_check CHECK ((question_item_type = ANY (ARRAY['mcq'::text, 'grid_in'::text]))),
    CONSTRAINT review_session_items_question_section_check CHECK ((question_section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT review_session_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'served'::text, 'answered'::text, 'skipped'::text]))),
    CONSTRAINT rsi_item_shape_chk CHECK ((((question_item_type = 'mcq'::text) AND (question_correct_variants IS NULL)) OR ((question_item_type = 'grid_in'::text) AND (question_correct_variants IS NOT NULL) AND (array_length(question_correct_variants, 1) >= 1) AND (question_options = '[]'::jsonb)))),
    CONSTRAINT rsi_question_domain_section_canonical CHECK ((((question_section = 'M'::text) AND (question_domain = ANY (ARRAY['Algebra'::text, 'Advanced Math'::text, 'Problem Solving and Data Analysis'::text, 'Geometry and Trigonometry'::text]))) OR ((question_section = 'RW'::text) AND (question_domain = ANY (ARRAY['Information and Ideas'::text, 'Craft and Structure'::text, 'Expression of Ideas'::text, 'Standard English Conventions'::text]))))),
    CONSTRAINT rsi_resolved_requires_occurred_at CHECK (((status <> ALL (ARRAY['answered'::text, 'skipped'::text])) OR (occurred_at IS NOT NULL)))
);


--
-- Name: review_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    status text DEFAULT 'created'::text NOT NULL,
    client_instance_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    mode text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    target_count integer NOT NULL,
    platform text NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    abandoned_at timestamp with time zone,
    CONSTRAINT review_sessions_abandoned_not_completed CHECK (((status <> 'abandoned'::text) OR ((completed_at IS NULL) AND (abandoned_at IS NOT NULL)))),
    CONSTRAINT review_sessions_mode_check CHECK ((mode = ANY (ARRAY['queue'::text, 'session'::text, 'filter'::text]))),
    CONSTRAINT review_sessions_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'mobile'::text]))),
    CONSTRAINT review_sessions_status_check CHECK ((status = ANY (ARRAY['created'::text, 'active'::text, 'completed'::text, 'abandoned'::text]))),
    CONSTRAINT review_sessions_target_count_check CHECK ((target_count > 0))
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
-- Name: student_study_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_study_profile (
    student_id uuid NOT NULL,
    timezone text NOT NULL,
    target_exam_date date,
    target_score integer,
    study_days_mask smallint NOT NULL,
    daily_minutes integer NOT NULL,
    full_length_weekday smallint,
    planner_mode text DEFAULT 'auto'::text NOT NULL,
    setup_completed_at timestamp with time zone,
    last_acknowledged_nonstudent_version_no integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT setup_requires_target_score CHECK (((setup_completed_at IS NULL) OR (target_score IS NOT NULL))),
    CONSTRAINT student_study_profile_daily_minutes_check CHECK (((daily_minutes >= 5) AND (daily_minutes <= 600))),
    CONSTRAINT student_study_profile_full_length_weekday_check CHECK (((full_length_weekday >= 0) AND (full_length_weekday <= 6))),
    CONSTRAINT student_study_profile_last_acknowledged_nonstudent_versio_check CHECK ((last_acknowledged_nonstudent_version_no >= 0)),
    CONSTRAINT student_study_profile_planner_mode_check CHECK ((planner_mode = ANY (ARRAY['auto'::text, 'custom'::text]))),
    CONSTRAINT student_study_profile_study_days_mask_check CHECK (((study_days_mask >= 1) AND (study_days_mask <= 127))),
    CONSTRAINT student_study_profile_target_score_check CHECK ((((target_score >= 400) AND (target_score <= 1600)) AND ((target_score % 10) = 0)))
);


--
-- Name: TABLE student_study_profile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.student_study_profile IS 'Doc 05F §7.1. study_days_mask bit i = Postgres DOW i (0 = Sunday), and full_length_weekday uses the same convention (sheet §6 mask convention). timezone is IANA, validated at the route against pg_timezone_names.';


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
    category text,
    version text,
    source text,
    enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT tutor_injection_signatures_action_check CHECK ((action = ANY (ARRAY['flag'::text, 'reject'::text, 'silent_redirect'::text, 'stop_and_review'::text, 'stop_and_safeguarding_review'::text]))),
    CONSTRAINT tutor_injection_signatures_category_check CHECK ((category = ANY (ARRAY['suicide'::text, 'self_harm'::text, 'abuse'::text]))),
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
-- Name: calendar_block_launches calendar_block_launches_engine_engine_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_block_launches
    ADD CONSTRAINT calendar_block_launches_engine_engine_session_id_key UNIQUE (engine, engine_session_id);


--
-- Name: calendar_block_launches calendar_block_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_block_launches
    ADD CONSTRAINT calendar_block_launches_pkey PRIMARY KEY (block_id, launch_sequence);


--
-- Name: calendar_blocks calendar_blocks_block_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_block_id_student_id_key UNIQUE (block_id, student_id);


--
-- Name: calendar_blocks calendar_blocks_block_id_student_id_scheduled_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_block_id_student_id_scheduled_date_key UNIQUE (block_id, student_id, scheduled_date);


--
-- Name: calendar_blocks calendar_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_pkey PRIMARY KEY (block_id);


--
-- Name: calendar_job_runs calendar_job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_job_runs
    ADD CONSTRAINT calendar_job_runs_pkey PRIMARY KEY (run_id);


--
-- Name: calendar_mutation_ledger calendar_mutation_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_mutation_ledger
    ADD CONSTRAINT calendar_mutation_ledger_pkey PRIMARY KEY (student_id, idempotency_key);


--
-- Name: calendar_plan_block_memberships calendar_plan_block_membershi_plan_version_id_scheduled_dat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_block_memberships
    ADD CONSTRAINT calendar_plan_block_membershi_plan_version_id_scheduled_dat_key UNIQUE (plan_version_id, scheduled_date, display_ordinal);


--
-- Name: calendar_plan_block_memberships calendar_plan_block_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_block_memberships
    ADD CONSTRAINT calendar_plan_block_memberships_pkey PRIMARY KEY (plan_version_id, scheduled_date, block_id);


--
-- Name: calendar_plan_dates calendar_plan_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_dates
    ADD CONSTRAINT calendar_plan_dates_pkey PRIMARY KEY (plan_version_id, scheduled_date);


--
-- Name: calendar_plan_dates calendar_plan_dates_plan_version_id_scheduled_date_student__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_dates
    ADD CONSTRAINT calendar_plan_dates_plan_version_id_scheduled_date_student__key UNIQUE (plan_version_id, scheduled_date, student_id);


--
-- Name: calendar_plan_versions calendar_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_versions
    ADD CONSTRAINT calendar_plan_versions_pkey PRIMARY KEY (plan_version_id);


--
-- Name: calendar_plan_versions calendar_plan_versions_plan_version_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_versions
    ADD CONSTRAINT calendar_plan_versions_plan_version_id_student_id_key UNIQUE (plan_version_id, student_id);


--
-- Name: calendar_plan_versions calendar_plan_versions_student_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_versions
    ADD CONSTRAINT calendar_plan_versions_student_id_version_no_key UNIQUE (student_id, version_no);


--
-- Name: calendar_runtime_config_history calendar_runtime_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_runtime_config_history
    ADD CONSTRAINT calendar_runtime_config_history_pkey PRIMARY KEY (id);


--
-- Name: calendar_runtime_config calendar_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_runtime_config
    ADD CONSTRAINT calendar_runtime_config_pkey PRIMARY KEY (key);


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
-- Name: deletion_billing_record deletion_billing_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_billing_record
    ADD CONSTRAINT deletion_billing_record_pkey PRIMARY KEY (log_id);


--
-- Name: deletion_consent_evidence deletion_consent_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_consent_evidence
    ADD CONSTRAINT deletion_consent_evidence_pkey PRIMARY KEY (log_id, doc_key, doc_version, actor_type);


--
-- Name: deletion_request_log deletion_request_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_request_log
    ADD CONSTRAINT deletion_request_log_pkey PRIMARY KEY (log_id);


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
-- Name: notification_delivery_events notification_delivery_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_events
    ADD CONSTRAINT notification_delivery_events_pkey PRIMARY KEY (provider_event_id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (event_id);


--
-- Name: notification_messages notification_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_messages
    ADD CONSTRAINT notification_messages_pkey PRIMARY KEY (message_id);


--
-- Name: notification_messages notification_messages_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_messages
    ADD CONSTRAINT notification_messages_unique UNIQUE (event_id, recipient_profile_id, channel);


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
-- Name: student_study_profile student_study_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_study_profile
    ADD CONSTRAINT student_study_profile_pkey PRIMARY KEY (student_id);


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
-- Name: review_schedule uq_review_schedule_source_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_schedule
    ADD CONSTRAINT uq_review_schedule_source_item UNIQUE (source_engine, source_item_id);


--
-- Name: usage_rate_limit_ledger usage_rate_limit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_rate_limit_ledger
    ADD CONSTRAINT usage_rate_limit_ledger_pkey PRIMARY KEY (id);


--
-- Name: calendar_blocks_student_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_blocks_student_date ON public.calendar_blocks USING btree (student_id, scheduled_date);


--
-- Name: calendar_job_runs_student_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_job_runs_student_period ON public.calendar_job_runs USING btree (student_id, period_key DESC);


--
-- Name: calendar_plan_block_memberships_block; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_plan_block_memberships_block ON public.calendar_plan_block_memberships USING btree (block_id);


--
-- Name: calendar_plan_dates_student_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_plan_dates_student_date ON public.calendar_plan_dates USING btree (student_id, scheduled_date);


--
-- Name: calendar_plan_versions_student_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_plan_versions_student_created ON public.calendar_plan_versions USING btree (student_id, created_at DESC);


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
-- Name: idx_crisis_review_cases_category_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crisis_review_cases_category_active ON public.crisis_review_cases USING btree (category) WHERE (status = ANY (ARRAY['open'::text, 'in_review'::text]));


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
-- Name: idx_legal_acceptances_content_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_acceptances_content_hash ON public.legal_acceptances USING btree (content_hash) WHERE (content_hash IS NOT NULL);


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

CREATE INDEX idx_review_schedule_due ON public.review_schedule USING btree (student_id, queued_at) WHERE (status = 'active'::text);


--
-- Name: idx_review_schedule_source_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_schedule_source_session ON public.review_schedule USING btree (student_id, source_engine, source_session_id);


--
-- Name: idx_review_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_sessions_active ON public.review_sessions USING btree (student_id) WHERE (status = 'active'::text);


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
-- Name: idx_tutor_injection_signatures_category_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_injection_signatures_category_enabled ON public.tutor_injection_signatures USING btree (category) WHERE (enabled = true);


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
-- Name: notification_delivery_events_unmatched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_delivery_events_unmatched_idx ON public.notification_delivery_events USING btree (provider_message_id, occurred_at) WHERE (message_id IS NULL);


--
-- Name: notification_messages_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_messages_dispatch_idx ON public.notification_messages USING btree (created_at) WHERE ((channel = 'email'::text) AND (status = 'queued'::text));


--
-- Name: notification_messages_feed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_messages_feed_idx ON public.notification_messages USING btree (recipient_profile_id, created_at DESC) WHERE ((channel = 'in_app'::text) AND (archived_at IS NULL));


--
-- Name: notification_messages_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_messages_provider_idx ON public.notification_messages USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);


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
-- Name: uq_review_items_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_review_items_idem ON public.review_session_items USING btree (student_id, client_attempt_id) WHERE (client_attempt_id IS NOT NULL);


--
-- Name: uq_review_schedule_open_question; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_review_schedule_open_question ON public.review_schedule USING btree (student_id, question_id) WHERE (status = 'active'::text);


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

CREATE TRIGGER audit_logs_no_mutate BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_logs_retention_guard();


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
-- Name: calendar_runtime_config_history calendar_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calendar_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.calendar_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: calendar_runtime_config calendar_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calendar_runtime_config_notify AFTER INSERT OR UPDATE ON public.calendar_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


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
-- Name: notification_messages notification_messages_recipient_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_messages_recipient_guard BEFORE UPDATE ON public.notification_messages FOR EACH ROW EXECUTE FUNCTION public.notification_messages_guard_recipient_update();


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
-- Name: practice_session_items trg_practice_item_enqueue_review; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_practice_item_enqueue_review AFTER UPDATE ON public.practice_session_items FOR EACH ROW WHEN (((old.status <> ALL (ARRAY['answered'::text, 'skipped'::text])) AND ((new.status = 'skipped'::text) OR ((new.status = 'answered'::text) AND (new.is_correct = false))))) EXECUTE FUNCTION public.practice_item_enqueue_review();


--
-- Name: review_session_items trg_review_item_resolve; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_review_item_resolve AFTER UPDATE ON public.review_session_items FOR EACH ROW WHEN (((old.status <> ALL (ARRAY['answered'::text, 'skipped'::text])) AND (new.status = ANY (ARRAY['answered'::text, 'skipped'::text])))) EXECUTE FUNCTION public.review_item_resolve();


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
-- Name: calendar_block_launches calendar_block_launches_block_id_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_block_launches
    ADD CONSTRAINT calendar_block_launches_block_id_student_id_fkey FOREIGN KEY (block_id, student_id) REFERENCES public.calendar_blocks(block_id, student_id);


--
-- Name: calendar_block_launches calendar_block_launches_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_block_launches
    ADD CONSTRAINT calendar_block_launches_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_blocks calendar_blocks_created_in_version_id_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_created_in_version_id_student_id_fkey FOREIGN KEY (created_in_version_id, student_id) REFERENCES public.calendar_plan_versions(plan_version_id, student_id);


--
-- Name: calendar_blocks calendar_blocks_derived_from_block_id_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_derived_from_block_id_student_id_fkey FOREIGN KEY (derived_from_block_id, student_id) REFERENCES public.calendar_blocks(block_id, student_id);


--
-- Name: calendar_blocks calendar_blocks_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_blocks
    ADD CONSTRAINT calendar_blocks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_job_runs calendar_job_runs_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_job_runs
    ADD CONSTRAINT calendar_job_runs_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_mutation_ledger calendar_mutation_ledger_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_mutation_ledger
    ADD CONSTRAINT calendar_mutation_ledger_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_plan_block_memberships calendar_plan_block_membershi_block_id_student_id_schedule_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_block_memberships
    ADD CONSTRAINT calendar_plan_block_membershi_block_id_student_id_schedule_fkey FOREIGN KEY (block_id, student_id, scheduled_date) REFERENCES public.calendar_blocks(block_id, student_id, scheduled_date);


--
-- Name: calendar_plan_block_memberships calendar_plan_block_membershi_plan_version_id_scheduled_da_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_block_memberships
    ADD CONSTRAINT calendar_plan_block_membershi_plan_version_id_scheduled_da_fkey FOREIGN KEY (plan_version_id, scheduled_date, student_id) REFERENCES public.calendar_plan_dates(plan_version_id, scheduled_date, student_id) ON DELETE CASCADE;


--
-- Name: calendar_plan_dates calendar_plan_dates_plan_version_id_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_dates
    ADD CONSTRAINT calendar_plan_dates_plan_version_id_student_id_fkey FOREIGN KEY (plan_version_id, student_id) REFERENCES public.calendar_plan_versions(plan_version_id, student_id) ON DELETE CASCADE;


--
-- Name: calendar_plan_dates calendar_plan_dates_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_dates
    ADD CONSTRAINT calendar_plan_dates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_plan_versions calendar_plan_versions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_plan_versions
    ADD CONSTRAINT calendar_plan_versions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_runtime_config_history calendar_runtime_config_history_changed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_runtime_config_history
    ADD CONSTRAINT calendar_runtime_config_history_changed_by_profile_id_fkey FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: calendar_runtime_config calendar_runtime_config_updated_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_runtime_config
    ADD CONSTRAINT calendar_runtime_config_updated_by_profile_id_fkey FOREIGN KEY (updated_by_profile_id) REFERENCES public.profiles(id);


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
-- Name: deletion_billing_record deletion_billing_record_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_billing_record
    ADD CONSTRAINT deletion_billing_record_log_id_fkey FOREIGN KEY (log_id) REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE;


--
-- Name: deletion_consent_evidence deletion_consent_evidence_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_consent_evidence
    ADD CONSTRAINT deletion_consent_evidence_log_id_fkey FOREIGN KEY (log_id) REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE;


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
-- Name: notification_delivery_events notification_delivery_events_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_events
    ADD CONSTRAINT notification_delivery_events_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.notification_messages(message_id) ON DELETE CASCADE;


--
-- Name: notification_events notification_events_subject_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_subject_profile_id_fkey FOREIGN KEY (subject_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notification_messages notification_messages_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_messages
    ADD CONSTRAINT notification_messages_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.notification_events(event_id) ON DELETE CASCADE;


--
-- Name: notification_messages notification_messages_recipient_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_messages
    ADD CONSTRAINT notification_messages_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT review_schedule_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: review_session_items review_session_items_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: review_session_items review_session_items_queue_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_session_items
    ADD CONSTRAINT review_session_items_queue_entry_id_fkey FOREIGN KEY (queue_entry_id) REFERENCES public.review_schedule(id) ON DELETE SET NULL;


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
-- Name: student_study_profile student_study_profile_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_study_profile
    ADD CONSTRAINT student_study_profile_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


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
-- Name: calendar_block_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_block_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_block_launches calendar_block_launches_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_block_launches_admin_read ON public.calendar_block_launches FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: calendar_block_launches calendar_block_launches_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_block_launches_student_read ON public.calendar_block_launches FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: calendar_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_blocks calendar_blocks_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_blocks_admin_read ON public.calendar_blocks FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: calendar_blocks calendar_blocks_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_blocks_student_read ON public.calendar_blocks FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: calendar_job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_mutation_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_mutation_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_plan_block_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_plan_block_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_plan_block_memberships calendar_plan_block_memberships_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_block_memberships_admin_read ON public.calendar_plan_block_memberships FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: calendar_plan_block_memberships calendar_plan_block_memberships_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_block_memberships_student_read ON public.calendar_plan_block_memberships FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: calendar_plan_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_plan_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_plan_dates calendar_plan_dates_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_dates_admin_read ON public.calendar_plan_dates FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: calendar_plan_dates calendar_plan_dates_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_dates_student_read ON public.calendar_plan_dates FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: calendar_plan_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_plan_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_plan_versions calendar_plan_versions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_versions_admin_read ON public.calendar_plan_versions FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: calendar_plan_versions calendar_plan_versions_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_plan_versions_student_read ON public.calendar_plan_versions FOR SELECT TO authenticated USING ((student_id = auth.uid()));


--
-- Name: calendar_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_runtime_config_history ENABLE ROW LEVEL SECURITY;

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
-- Name: deletion_billing_record; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deletion_billing_record ENABLE ROW LEVEL SECURITY;

--
-- Name: deletion_consent_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deletion_consent_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: deletion_request_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deletion_request_log ENABLE ROW LEVEL SECURITY;

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
-- Name: notification_delivery_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_delivery_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_messages notification_messages_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_messages_select_self ON public.notification_messages FOR SELECT TO authenticated USING ((recipient_profile_id = auth.uid()));


--
-- Name: notification_messages notification_messages_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_messages_update_self ON public.notification_messages FOR UPDATE TO authenticated USING ((recipient_profile_id = auth.uid())) WITH CHECK ((recipient_profile_id = auth.uid()));


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
-- Name: student_study_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_study_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: student_study_profile student_study_profile_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_study_profile_admin_read ON public.student_study_profile FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());


--
-- Name: student_study_profile student_study_profile_student_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_study_profile_student_read ON public.student_study_profile FOR SELECT TO authenticated USING ((student_id = auth.uid()));


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
-- Name: FUNCTION apply_audit_logs_retention(p_action text, p_profile_id uuid, p_batch_size integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_audit_logs_retention(p_action text, p_profile_id uuid, p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_audit_logs_retention(p_action text, p_profile_id uuid, p_batch_size integer) TO service_role;


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
-- Name: FUNCTION apply_notification_delivery_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_notification_delivery_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_notification_delivery_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone) TO service_role;


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
-- Name: FUNCTION calendar_acknowledge_version(p_student_id uuid, p_version_no integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_acknowledge_version(p_student_id uuid, p_version_no integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_acknowledge_version(p_student_id uuid, p_version_no integer) TO service_role;


--
-- Name: FUNCTION calendar_build_plan_input(p_student_id uuid, p_dates date[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[]) TO service_role;


--
-- Name: FUNCTION calendar_carry_started(p_input jsonb, p_output jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_carry_started(p_input jsonb, p_output jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_compute_plan(p_input jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_compute_plan(p_input jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_compute_plan_fallback(p_input jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_do_it_now(p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid) TO service_role;


--
-- Name: FUNCTION calendar_drop_today_for_system(p_output jsonb, p_trigger text, p_today date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_drop_today_for_system(p_output jsonb, p_trigger text, p_today date) FROM PUBLIC;


--
-- Name: FUNCTION calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_edit_day(p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid) TO service_role;


--
-- Name: FUNCTION calendar_is_known_timezone(p_timezone text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_is_known_timezone(p_timezone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_is_known_timezone(p_timezone text) TO service_role;


--
-- Name: FUNCTION calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_link_launch(p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid) TO service_role;


--
-- Name: FUNCTION calendar_move_block(p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_move_block(p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid) FROM PUBLIC;


--
-- Name: FUNCTION calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_persist_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid) TO service_role;


--
-- Name: FUNCTION calendar_place_full_lengths(p_input jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_place_full_lengths(p_input jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_plan_to_output(p_plan jsonb, p_generator_version text, p_enabled_block_types text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_plan_to_output(p_plan jsonb, p_generator_version text, p_enabled_block_types text[]) FROM PUBLIC;


--
-- Name: FUNCTION calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_regenerate_day(p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid) TO service_role;


--
-- Name: FUNCTION calendar_regenerate_day_only(p_output jsonb, p_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_regenerate_day_only(p_output jsonb, p_date date) FROM PUBLIC;


--
-- Name: FUNCTION calendar_require_int(p_obj jsonb, p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_require_int(p_obj jsonb, p_key text) FROM PUBLIC;


--
-- Name: FUNCTION calendar_scope_is_valid(p_block_type text, p_section text, p_scope jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_scope_is_valid(p_block_type text, p_section text, p_scope jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb) FROM PUBLIC;


--
-- Name: FUNCTION calendar_viewer_is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calendar_viewer_is_admin() TO authenticated;


--
-- Name: FUNCTION calendar_weekly_candidates(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_weekly_candidates(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_weekly_candidates(p_limit integer) TO service_role;


--
-- Name: FUNCTION calendar_write_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator text, p_generator_version text, p_input jsonb, p_output jsonb, p_mode text, p_fallback_reason jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_write_version(p_student_id uuid, p_trigger text, p_initiated_by text, p_generator text, p_generator_version text, p_input jsonb, p_output jsonb, p_mode text, p_fallback_reason jsonb) FROM PUBLIC;


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
-- Name: FUNCTION complete_deletion_log(p_completions text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_deletion_log(p_completions text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_deletion_log(p_completions text) TO service_role;


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
-- Name: FUNCTION emit_notification_event(p_event_id uuid, p_event_type text, p_subject_profile_id uuid, p_recipients jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.emit_notification_event(p_event_id uuid, p_event_type text, p_subject_profile_id uuid, p_recipients jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.emit_notification_event(p_event_id uuid, p_event_type text, p_subject_profile_id uuid, p_recipients jsonb, p_payload jsonb) TO service_role;


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
-- Name: FUNCTION mark_all_notifications_read(p_recipient_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(p_recipient_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_all_notifications_read(p_recipient_id uuid) TO service_role;


--
-- Name: FUNCTION mark_all_notifications_seen(p_recipient_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_all_notifications_seen(p_recipient_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_all_notifications_seen(p_recipient_id uuid) TO service_role;


--
-- Name: FUNCTION mark_deletion_log_executing(p_log_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_deletion_log_executing(p_log_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_deletion_log_executing(p_log_ids uuid[]) TO service_role;


--
-- Name: TABLE notification_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_messages TO service_role;
GRANT SELECT,UPDATE ON TABLE public.notification_messages TO authenticated;


--
-- Name: FUNCTION mark_notification(p_recipient_id uuid, p_message_id uuid, p_seen boolean, p_read boolean, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_notification(p_recipient_id uuid, p_message_id uuid, p_seen boolean, p_read boolean, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_notification(p_recipient_id uuid, p_message_id uuid, p_seen boolean, p_read boolean, p_archived boolean) TO service_role;


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
-- Name: FUNCTION notification_apply_transition(p_message_id uuid, p_event_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_apply_transition(p_message_id uuid, p_event_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notification_apply_transition(p_message_id uuid, p_event_type text) TO service_role;


--
-- Name: FUNCTION notification_event_id(p_event_type text, p_source_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_event_id(p_event_type text, p_source_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notification_event_id(p_event_type text, p_source_id text) TO service_role;


--
-- Name: FUNCTION notification_feed(p_recipient_id uuid, p_limit integer, p_before_message_id uuid, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_feed(p_recipient_id uuid, p_limit integer, p_before_message_id uuid, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notification_feed(p_recipient_id uuid, p_limit integer, p_before_message_id uuid, p_archived boolean) TO service_role;


--
-- Name: FUNCTION notification_retention_days(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_retention_days() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notification_retention_days() TO service_role;


--
-- Name: FUNCTION notification_unread_count(p_recipient_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_unread_count(p_recipient_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notification_unread_count(p_recipient_id uuid) TO service_role;


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
-- Name: FUNCTION practice_item_enqueue_review(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.practice_item_enqueue_review() FROM PUBLIC;


--
-- Name: FUNCTION practice_session_mode_to_event_kind(p_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.practice_session_mode_to_event_kind(p_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.practice_session_mode_to_event_kind(p_mode text) TO service_role;


--
-- Name: FUNCTION preclear_account_deletion_links(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.preclear_account_deletion_links(p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preclear_account_deletion_links(p_profile_id uuid) TO service_role;


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
-- Name: FUNCTION reconcile_deletion_log(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_deletion_log() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_deletion_log() TO service_role;


--
-- Name: FUNCTION record_deletion_suppression_outcome(p_log_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_deletion_suppression_outcome(p_log_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_deletion_suppression_outcome(p_log_id uuid, p_status text) TO service_role;


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
-- Name: FUNCTION record_notification_send_attempt(p_message_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_max_attempts integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_notification_send_attempt(p_message_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_max_attempts integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_notification_send_attempt(p_message_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_max_attempts integer) TO service_role;


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
-- Name: FUNCTION request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer, p_request_channel text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer, p_request_channel text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_account_deletion(p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer, p_request_channel text) TO service_role;


--
-- Name: FUNCTION resolve_deletion_billing_record(p_log_id uuid, p_final_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_deletion_billing_record(p_log_id uuid, p_final_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_deletion_billing_record(p_log_id uuid, p_final_status text) TO service_role;


--
-- Name: FUNCTION restore_account_deletion(p_recovery_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restore_account_deletion(p_recovery_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_account_deletion(p_recovery_token_hash text) TO service_role;


--
-- Name: FUNCTION review_item_resolve(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_item_resolve() FROM PUBLIC;


--
-- Name: FUNCTION review_queue_graduate(p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_queue_graduate(p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION review_queue_record(p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_queue_record(p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_guardian_link_audited(p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text) TO service_role;


--
-- Name: FUNCTION rewrite_anonymized_actors(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rewrite_anonymized_actors() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rewrite_anonymized_actors() TO service_role;


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
-- Name: FUNCTION sweep_deletion_evidence(p_batch_size integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sweep_deletion_evidence(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sweep_deletion_evidence(p_batch_size integer) TO service_role;


--
-- Name: FUNCTION sweep_notification_retention(p_batch_size integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sweep_notification_retention(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sweep_notification_retention(p_batch_size integer) TO service_role;


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
-- Name: TABLE calendar_block_launches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_block_launches TO service_role;
GRANT SELECT ON TABLE public.calendar_block_launches TO authenticated;


--
-- Name: TABLE calendar_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_blocks TO service_role;
GRANT SELECT ON TABLE public.calendar_blocks TO authenticated;


--
-- Name: TABLE calendar_plan_block_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_plan_block_memberships TO service_role;
GRANT SELECT ON TABLE public.calendar_plan_block_memberships TO authenticated;


--
-- Name: TABLE calendar_plan_dates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_plan_dates TO service_role;
GRANT SELECT ON TABLE public.calendar_plan_dates TO authenticated;


--
-- Name: TABLE calendar_plan_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_plan_versions TO service_role;


--
-- Name: COLUMN calendar_plan_versions.plan_version_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(plan_version_id) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.student_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(student_id) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.version_no; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(version_no) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.generator; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(generator) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.generator_version; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(generator_version) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.trigger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(trigger) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.initiated_by; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(initiated_by) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.input_snapshot_hash; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(input_snapshot_hash) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.validator_result; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(validator_result) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: COLUMN calendar_plan_versions.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.calendar_plan_versions TO authenticated;


--
-- Name: TABLE calendar_current_plan; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.calendar_current_plan TO service_role;
GRANT SELECT ON TABLE public.calendar_current_plan TO authenticated;


--
-- Name: TABLE calendar_job_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_job_runs TO service_role;


--
-- Name: TABLE calendar_mutation_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.calendar_mutation_ledger TO service_role;


--
-- Name: TABLE calendar_plan_versions_student; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.calendar_plan_versions_student TO service_role;
GRANT SELECT ON TABLE public.calendar_plan_versions_student TO authenticated;


--
-- Name: TABLE calendar_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.calendar_runtime_config TO service_role;


--
-- Name: TABLE calendar_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.calendar_runtime_config_history TO service_role;


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
-- Name: TABLE deletion_billing_record; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.deletion_billing_record TO service_role;


--
-- Name: TABLE deletion_consent_evidence; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.deletion_consent_evidence TO service_role;


--
-- Name: TABLE deletion_request_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.deletion_request_log TO service_role;


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
-- Name: TABLE notification_delivery_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_delivery_events TO service_role;


--
-- Name: TABLE notification_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_events TO service_role;


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
-- Name: TABLE review_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_schedule TO service_role;
GRANT SELECT ON TABLE public.review_schedule TO authenticated;


--
-- Name: TABLE review_question_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.review_question_history TO service_role;


--
-- Name: TABLE review_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_runtime_config TO service_role;


--
-- Name: TABLE review_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.review_runtime_config_history TO service_role;


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
-- Name: COLUMN review_session_items.selected_answer; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(selected_answer) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.is_correct; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_correct) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.outcome; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(outcome) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.time_spent_ms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(time_spent_ms) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.client_attempt_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(client_attempt_id) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.occurred_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(occurred_at) ON TABLE public.review_session_items TO authenticated;


--
-- Name: COLUMN review_session_items.queue_entry_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(queue_entry_id) ON TABLE public.review_session_items TO authenticated;


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
-- Name: TABLE student_study_profile; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.student_study_profile TO service_role;
GRANT SELECT ON TABLE public.student_study_profile TO authenticated;


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


