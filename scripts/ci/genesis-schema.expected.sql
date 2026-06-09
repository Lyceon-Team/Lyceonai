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
-- Name: recompute_skill_mastery(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_skill_mastery(p_student_id uuid, p_section text, p_domain text, p_skill text) RETURNS public.student_skill_mastery
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
  -- refresh_domain_mastery is 05B (later item); not called here in B-WS3-1.
  RETURN v_row;
END;
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
    CONSTRAINT guardian_links_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending_student_accept'::text, 'pending_guardian_accept'::text, 'revoked'::text]))),
    CONSTRAINT guardian_not_self CHECK ((guardian_profile_id <> student_profile_id))
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
-- Name: mastery_event_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastery_event_audit_log (
    audit_row_id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    section text NOT NULL,
    domain text NOT NULL,
    skill text NOT NULL,
    source_family text NOT NULL,
    event_source_kind text NOT NULL,
    event_id uuid NOT NULL,
    question_id uuid,
    difficulty smallint,
    correct boolean,
    occurred_at timestamp with time zone,
    mastery_score_before numeric(10,9),
    mastery_score_after numeric(10,9),
    mastery_level_before smallint,
    mastery_level_after smallint,
    event_count_after integer NOT NULL,
    constants_snapshot_hash text NOT NULL,
    mastery_model_version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mastery_event_audit_log_event_count_after_check CHECK ((event_count_after >= 0)),
    CONSTRAINT mastery_event_audit_log_event_source_kind_check CHECK ((event_source_kind = ANY (ARRAY['practice_attempt'::text, 'diagnostic_attempt'::text, 'review_error_attempt'::text, 'full_length_answer'::text]))),
    CONSTRAINT mastery_event_audit_log_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT mastery_event_audit_log_source_family_check CHECK ((source_family = ANY (ARRAY['test'::text, 'practice'::text, 'review'::text])))
);


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
    last_login_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
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
    CONSTRAINT questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 3))),
    CONSTRAINT questions_id_check CHECK ((id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'::text)),
    CONSTRAINT questions_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text]))),
    CONSTRAINT questions_source_type_check CHECK ((source_type = ANY (ARRAY[1, 2]))),
    CONSTRAINT questions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'qa'::text, 'published'::text, 'retired'::text])))
);


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
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    code text NOT NULL,
    label text NOT NULL,
    description text
);


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
    CONSTRAINT student_domain_mastery_mastery_level_check CHECK (((mastery_level IS NULL) OR ((mastery_level >= 0) AND (mastery_level <= 4)))),
    CONSTRAINT student_domain_mastery_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
);


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
-- Name: student_section_projections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_section_projections (
    student_id uuid NOT NULL,
    section text NOT NULL,
    projected_score numeric,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_section_projections_section_check CHECK ((section = ANY (ARRAY['M'::text, 'RW'::text])))
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
-- Name: entitlements entitlements_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


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
-- Name: student_section_projections student_section_projections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_section_projections
    ADD CONSTRAINT student_section_projections_pkey PRIMARY KEY (student_id, section);


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
-- Name: guardian_links unique_active_link; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_links
    ADD CONSTRAINT unique_active_link UNIQUE NULLS NOT DISTINCT (guardian_profile_id, student_profile_id, status) DEFERRABLE INITIALLY DEFERRED;


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
-- Name: idx_entitlements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_active ON public.entitlements USING btree (profile_id) WHERE ((status = 'active'::text) OR (status = 'past_due'::text));


--
-- Name: idx_entitlements_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_profile ON public.entitlements USING btree (profile_id);


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
-- Name: idx_service_auth_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_auth_active ON public.service_auth_secrets USING btree (caller_service, callee_service) WHERE (revoked_at IS NULL);


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
-- Name: tutor_context_runtime_config_history tutor_context_runtime_config_history_no_mutate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_context_runtime_config_history_no_mutate BEFORE DELETE OR UPDATE ON public.tutor_context_runtime_config_history FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();


--
-- Name: tutor_context_runtime_config tutor_context_runtime_config_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_context_runtime_config_notify AFTER INSERT OR UPDATE ON public.tutor_context_runtime_config FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();


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
-- Name: audit_logs audit_logs_actor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id);


--
-- Name: audit_logs audit_logs_target_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id);


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
-- Name: mastery_constants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_constants_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_constants_history ENABLE ROW LEVEL SECURITY;

--
-- Name: mastery_event_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mastery_event_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_config ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_config_history ENABLE ROW LEVEL SECURITY;

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
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_self ON public.profiles FOR SELECT USING ((id = auth.uid()));


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
-- Name: review_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: review_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_runtime_config_history ENABLE ROW LEVEL SECURITY;

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
-- Name: source_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.source_types ENABLE ROW LEVEL SECURITY;

--
-- Name: student_domain_mastery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_domain_mastery ENABLE ROW LEVEL SECURITY;

--
-- Name: student_kpi_rollups_current; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_kpi_rollups_current ENABLE ROW LEVEL SECURITY;

--
-- Name: student_section_projections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_section_projections ENABLE ROW LEVEL SECURITY;

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
-- Name: tutor_context_runtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_context_runtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_context_runtime_config_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_context_runtime_config_history ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION notify_config_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_config_change() TO service_role;


--
-- Name: FUNCTION prevent_update_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_update_delete() TO service_role;


--
-- Name: FUNCTION rate_limit_check_and_increment(p_profile_id uuid, p_bucket_key text, p_cost integer, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rate_limit_check_and_increment(p_profile_id uuid, p_bucket_key text, p_cost integer, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_limit integer) TO service_role;


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
-- Name: FUNCTION set_profile_age_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_profile_age_fields() TO service_role;


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
-- Name: TABLE consent_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_runtime_config TO service_role;


--
-- Name: TABLE consent_runtime_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_runtime_config_history TO service_role;


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
-- Name: TABLE full_length_adaptive_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.full_length_adaptive_config TO service_role;


--
-- Name: TABLE guardian_consent_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guardian_consent_requests TO service_role;


--
-- Name: TABLE guardian_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guardian_links TO service_role;


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
-- Name: TABLE mastery_constants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mastery_constants TO service_role;


--
-- Name: TABLE mastery_event_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mastery_event_audit_log TO service_role;


--
-- Name: TABLE mobile_auth_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mobile_auth_config TO service_role;


--
-- Name: TABLE mobile_auth_config_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mobile_auth_config_history TO service_role;


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
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.questions TO service_role;


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
-- Name: TABLE sections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sections TO service_role;
GRANT SELECT ON TABLE public.sections TO anon;
GRANT SELECT ON TABLE public.sections TO authenticated;


--
-- Name: TABLE service_auth_secrets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_auth_secrets TO service_role;


--
-- Name: TABLE source_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.source_types TO service_role;


--
-- Name: TABLE student_domain_mastery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_domain_mastery TO service_role;


--
-- Name: TABLE student_kpi_rollups_current; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_kpi_rollups_current TO service_role;


--
-- Name: TABLE student_section_projections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.student_section_projections TO service_role;


--
-- Name: TABLE taxonomy_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.taxonomy_versions TO service_role;


--
-- Name: TABLE tutor_context_runtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tutor_context_runtime_config TO service_role;


--
-- PostgreSQL database dump complete
--


