-- ============================================================================
-- B-WS3-1 — Mastery formula core (Doc 05A V1.0) — formula + constants + tables
-- ============================================================================
-- @spec [Doc-05A_V1 §4/§5/§6/§7/§8/§9/§12] [Doc-05 Parent §4/§10.1] [Doc-05D §3/§4]
-- @implemented [2026-06-10] -- spec-auditor pass 2026-06-10; LYCEON-MIGRATION-REVIEWED
-- plain English: the canonical mastery formula as PL/pgSQL reading every constant from
--   mastery_constants (no literals), the formula-class constants seeded with the exact
--   Doc 05 V1.0 values, and the mastery tables with RLS deny-all + single-writer.
--   compute_mastery_for_entity / lookup_mastery_level transcribed verbatim from Doc 05A §6/§6.3.
--   canonical_mastery_events (the read-contract over WS-2 tables) is LANE C — this migration
--   creates the formula that calls it (resolved at call time); the parity test supplies a
--   fixture-backed canonical_mastery_events.
-- @adaptation SP-18: Doc 05 Parent §10.1 line 529 mislabels ROUND_MASTERY_SCORE_DECIMALS=2
--   ("for mastery_pct"); the §12 fixtures (score 4dp, pct 2dp) + Doc 05A §6 require
--   SCORE_DECIMALS=4 + PCT_DECIMALS=2. Seeded to satisfy the locked parity fixtures.
--
-- OWNER-RUN: tracked pipeline; genesis-extending; genesis-fresh-apply gate covers it.
-- ROLLBACK (INV-06): transactional. Revert = DROP the functions + the 6 tables + their
--   _history. CREATE/seed only; no forward-data destruction.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — DROP FUNCTION compute_mastery_for_entity,
--   lookup_mastery_level, canonicalize_mastery_constants(_serialized), recompute_skill_mastery;
--   DROP TABLE the mastery/audit tables + mastery_constants(+_history). CREATE/seed only.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. mastery_constants (formula-class) + _history (append-only, 01A doctrine) + seed
-- ----------------------------------------------------------------------------
CREATE TABLE public.mastery_constants (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_profile_id UUID REFERENCES public.profiles(id)
);
CREATE TABLE public.mastery_constants_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL, key TEXT NOT NULL, old_value JSONB, new_value JSONB NOT NULL,
  changed_by_profile_id UUID REFERENCES public.profiles(id), change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER mastery_constants_history_no_mutate BEFORE UPDATE OR DELETE ON public.mastery_constants_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();
ALTER TABLE public.mastery_constants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mastery_constants_history ENABLE ROW LEVEL SECURITY;

-- @spec [Doc-05 Parent §10.1] exact V1.0 formula constants (value stored as jsonb scalar/string)
INSERT INTO public.mastery_constants (key, value, description) VALUES
  ('POSITION_HALF_LIFE',            '30',       'recency half-life in event positions'),
  ('MIN_EVENTS_FOR_MASTERY',        '5',        'min total events before mastery computed'),
  ('weight_source_test',            '0.50',     'macro-average source weight: test'),
  ('weight_source_practice',        '0.30',     'macro-average source weight: practice'),
  ('weight_source_review',          '0.20',     'macro-average source weight: review'),
  ('difficulty_weight_easy',        '0.79',     'numerator-only difficulty weight: easy (bucket 1)'),
  ('difficulty_weight_medium',      '1.0',      'numerator-only difficulty weight: medium (bucket 2)'),
  ('difficulty_weight_hard',        '1.20',     'numerator-only difficulty weight: hard (bucket 3)'),
  ('mastery_min',                   '0.0',      'defensive lower clamp'),
  ('mastery_max',                   '1.0',      'defensive upper clamp'),
  ('mastery_level_0_max',           '0.19',     'level 0 upper bound'),
  ('mastery_level_1_min',           '0.20',     'level 1 lower bound'),
  ('mastery_level_1_max',           '0.39',     'level 1 upper bound'),
  ('mastery_level_2_min',           '0.40',     'level 2 lower bound'),
  ('mastery_level_2_max',           '0.59',     'level 2 upper bound'),
  ('mastery_level_3_min',           '0.60',     'level 3 lower bound'),
  ('mastery_level_3_max',           '0.79',     'level 3 upper bound'),
  ('mastery_level_4_min',           '0.80',     'level 4 lower bound'),
  ('ROUND_MASTERY_SCORE_DECIMALS',  '4',        'mastery_score precision (SP-18; fixtures require 4)'),
  ('ROUND_MASTERY_PCT_DECIMALS',    '2',        'mastery_pct precision'),
  ('ROUND_ACCURACY_DECIMALS',       '6',        'per-source accuracy precision'),
  ('ROUND_EVIDENCE_DECIMALS',       '6',        'fractional evidence-counter precision'),
  ('ROUNDING_MODE',                 '"HALF_UP"','rounding policy (HALF_UP = Postgres numeric ROUND)'),
  ('mastery_model_version',         '"v1.0"',   'formula+constants version stamp'),
  ('DIAGNOSTIC_TOTAL_QUESTIONS',    '40',       'diagnostic window 8 domains x 5 (non-hash; MA-10)');

-- ----------------------------------------------------------------------------
-- 2. Constants canonicalization + hash (Doc 05A §9.2/§9.3, VERBATIM key list)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_mastery_constants()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_object_agg(key, value ORDER BY key)
  FROM public.mastery_constants
  WHERE key IN ('POSITION_HALF_LIFE','MIN_EVENTS_FOR_MASTERY','weight_source_test',
    'weight_source_practice','weight_source_review','difficulty_weight_easy','difficulty_weight_medium',
    'difficulty_weight_hard','mastery_min','mastery_max','mastery_level_0_max','mastery_level_1_min',
    'mastery_level_1_max','mastery_level_2_min','mastery_level_2_max','mastery_level_3_min',
    'mastery_level_3_max','mastery_level_4_min','ROUND_MASTERY_SCORE_DECIMALS','ROUND_MASTERY_PCT_DECIMALS',
    'ROUND_ACCURACY_DECIMALS','ROUND_EVIDENCE_DECIMALS','ROUNDING_MODE','mastery_model_version');
$$;
CREATE OR REPLACE FUNCTION public.canonicalize_mastery_constants_serialized()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT string_agg(key || '=' || value::text, E'\n' ORDER BY key)
  FROM public.mastery_constants
  WHERE key IN ('POSITION_HALF_LIFE','MIN_EVENTS_FOR_MASTERY','weight_source_test',
    'weight_source_practice','weight_source_review','difficulty_weight_easy','difficulty_weight_medium',
    'difficulty_weight_hard','mastery_min','mastery_max','mastery_level_0_max','mastery_level_1_min',
    'mastery_level_1_max','mastery_level_2_min','mastery_level_2_max','mastery_level_3_min',
    'mastery_level_3_max','mastery_level_4_min','ROUND_MASTERY_SCORE_DECIMALS','ROUND_MASTERY_PCT_DECIMALS',
    'ROUND_ACCURACY_DECIMALS','ROUND_EVIDENCE_DECIMALS','ROUNDING_MODE','mastery_model_version');
$$;

-- ----------------------------------------------------------------------------
-- 3. lookup_mastery_level (Doc 05A §6.3, VERBATIM; half-open intervals)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_mastery_level(p_score numeric, p_constants jsonb)
RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL::smallint
    WHEN p_score < (p_constants->>'mastery_level_1_min')::numeric THEN 0::smallint
    WHEN p_score < (p_constants->>'mastery_level_2_min')::numeric THEN 1::smallint
    WHEN p_score < (p_constants->>'mastery_level_3_min')::numeric THEN 2::smallint
    WHEN p_score < (p_constants->>'mastery_level_4_min')::numeric THEN 3::smallint
    ELSE 4::smallint
  END;
$$;

-- ----------------------------------------------------------------------------
-- 4. compute_mastery_for_entity (Doc 05A §6, VERBATIM — single implementation, INV-05A-11)
--    Reads canonical_mastery_events (Lane C / fixture-backed in the parity test).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_mastery_for_entity(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text DEFAULT NULL
) RETURNS TABLE (
  total_events integer, acc_test numeric, acc_practice numeric, acc_review numeric,
  mastery_score numeric, mastery_pct numeric, mastery_level smallint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- ----------------------------------------------------------------------------
-- 5. Mastery / KPI / projection tables (Doc 05A §7.1) — RLS deny-all + single-writer
-- ----------------------------------------------------------------------------
CREATE TABLE public.student_skill_mastery (
  student_id uuid NOT NULL, section text NOT NULL CHECK (section IN ('M','RW')),
  domain text NOT NULL, skill text NOT NULL,
  mastery_score numeric(5,4), mastery_pct numeric(5,2),
  mastery_level smallint CHECK (mastery_level IS NULL OR mastery_level BETWEEN 0 AND 4),
  acc_test numeric(7,6), acc_practice numeric(7,6), acc_review numeric(7,6),
  event_count_total integer NOT NULL DEFAULT 0 CHECK (event_count_total >= 0),
  mastery_model_version text NOT NULL DEFAULT 'v1.0', constants_snapshot_hash text NOT NULL,
  last_event_id uuid, last_event_occurred_at timestamptz, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, section, domain, skill)
);
CREATE TABLE public.student_domain_mastery (
  student_id uuid NOT NULL, section text NOT NULL CHECK (section IN ('M','RW')), domain text NOT NULL,
  mastery_score numeric(5,4), mastery_pct numeric(5,2),
  mastery_level smallint CHECK (mastery_level IS NULL OR mastery_level BETWEEN 0 AND 4),
  event_count_total integer NOT NULL DEFAULT 0,
  mastery_model_version text NOT NULL DEFAULT 'v1.0', constants_snapshot_hash text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (student_id, section, domain)
);
-- KPI + projection shells (05B/05C fill the refresher bodies later)
CREATE TABLE public.student_kpi_rollups_current (
  student_id uuid NOT NULL, scope text NOT NULL, scope_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, scope, scope_key)
);
CREATE TABLE public.student_section_projections (
  student_id uuid NOT NULL, section text NOT NULL CHECK (section IN ('M','RW')),
  projected_score numeric, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (student_id, section)
);
-- 05D audit table (the idempotency anchor; UNIQUE(event_source_kind,event_id))
CREATE TABLE public.mastery_event_audit_log (
  audit_row_id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL, section text NOT NULL CHECK (section IN ('M','RW')),
  domain text NOT NULL, skill text NOT NULL,
  source_family text NOT NULL CHECK (source_family IN ('test','practice','review')),
  event_source_kind text NOT NULL CHECK (event_source_kind IN ('practice_attempt','diagnostic_attempt','review_error_attempt','full_length_answer')),
  -- event_id (uuid) is the per-attempt idempotency key. question_id is TEXT: it carries the
  -- canonical SAT question id (public.questions.id, '^SAT(M|RW)[12][A-Z0-9]{6}$'), NOT a uuid.
  -- Codex F-002 ruling (SP-21): TEXT is authoritative; Doc 05A's p_question_id uuid is stale and
  -- is amended to TEXT before Lane C wires apply_mastery_event. LYCEON-MIGRATION-REVIEWED
  event_id uuid NOT NULL, question_id text, difficulty smallint, correct boolean, occurred_at timestamptz,
  -- audit before/after match student_skill_mastery.mastery_score numeric(5,4) (§7.1)
  mastery_score_before numeric(5,4), mastery_score_after numeric(5,4),
  mastery_level_before smallint, mastery_level_after smallint,
  event_count_after integer NOT NULL CHECK (event_count_after >= 0),
  constants_snapshot_hash text NOT NULL, mastery_model_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mastery_event_audit_log_dedup_uq UNIQUE (event_source_kind, event_id)
);

ALTER TABLE public.student_skill_mastery        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_domain_mastery       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_kpi_rollups_current  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_section_projections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mastery_event_audit_log      ENABLE ROW LEVEL SECURITY;

-- @spec [Doc-05A §7.4] defense-in-depth: REVOKE the implicit PUBLIC privileges first, then grant
-- only the explicit roles. Doc 05A §7.4 also names admin_role; the genesis identity model is the
-- Supabase 3-role set (anon/authenticated/service_role) and treats "admin" as a PROFILE role
-- enforced in app/RLS, not a DB role — so admin/internal DB reads go via service_role (genesis
-- convention, genesis.sql GRANT ... TO service_role). The §7.4 admin_role reference is logged as
-- SP-20 for spec reconciliation. LYCEON-MIGRATION-REVIEWED
REVOKE ALL ON public.student_skill_mastery, public.student_domain_mastery,
  public.student_kpi_rollups_current, public.student_section_projections,
  public.mastery_event_audit_log, public.mastery_constants, public.mastery_constants_history
  FROM PUBLIC;

-- @spec [Doc-05A §7.3/§7.4 INV-05A-12] student self-read; column-grant to mastery_level only; no guardian
CREATE POLICY student_skill_mastery_student_read ON public.student_skill_mastery
  FOR SELECT TO authenticated USING (student_id = auth.uid());
GRANT SELECT (student_id, section, domain, skill, mastery_level, computed_at)
  ON public.student_skill_mastery TO authenticated;

-- service_role owns all mastery writes (single-writer choke point: apply_mastery_event / recompute)
-- and serves admin/internal reads per the 3-role model (SP-20).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.student_skill_mastery, public.student_domain_mastery, public.student_kpi_rollups_current,
  public.student_section_projections, public.mastery_event_audit_log, public.mastery_constants
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6. recompute_skill_mastery (Doc 05A §5.1, VERBATIM-faithful)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_skill_mastery(
  p_student_id uuid, p_section text, p_domain text, p_skill text
) RETURNS public.student_skill_mastery LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  -- TODO(05B): refresh_domain_mastery(p_student_id,p_section,p_domain) is owned by 05B (a later
  -- item) and MUST be called here once 05B lands, per Doc 05A §5.1 — else skill/domain drift.
  -- Tracked in the B-WS3-1 contract §G as a hard sequential dependency; not in B-WS3-1 scope.
  RETURN v_row;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Function lockdown (Doc 05A §5.1/§6.1/§6.3/§9.2) — PUBLIC has EXECUTE on new functions by
--    default; revoke it. Only service_role (the RPC caller) may execute the formula functions.
--    LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.canonicalize_mastery_constants()                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonicalize_mastery_constants_serialized()                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_mastery_level(numeric, jsonb)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_mastery_for_entity(uuid, text, text, text, text)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_skill_mastery(uuid, text, text, text)              FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonicalize_mastery_constants()                            TO service_role;
GRANT EXECUTE ON FUNCTION public.canonicalize_mastery_constants_serialized()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_mastery_level(numeric, jsonb)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_mastery_for_entity(uuid, text, text, text, text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_skill_mastery(uuid, text, text, text)            TO service_role;

COMMIT;
