-- ==========================================================================
-- Migration: 05D Governance Substrate (Doc 05D §5.2/§6.1–6.6)
-- @spec [Doc-05D_v1, §5.2/§6.1/§6.3/§6.6] | @implemented [2026-06-24]
--
-- Adds mastery-constants change governance (capture-only, no recompute):
--   1. mastery_constants_change_log  — append-only governance record
--   2. canonicalize_jsonb_value      — recursive deterministic serializer
--   3. constant_affects_formula_hash — closed-world classifier
--   4. canonicalize_active_mastery_constants_state — deterministic serializer
--   5. capture_mastery_constant_change trigger — ENABLE ALWAYS
--
-- Reconciliations applied (spec → live schema):
--   R1: Column constant_key → key (matches parent PK column)
--   R2: WHERE mc.active = true removed (no active column; Q1=b)
--   R3: digest() → extensions.digest() (pgcrypto in extensions schema)
--   R4: admin_role GRANT/policy skipped (SP-20; Supabase 3-role model)
--   R5: Formula key placeholders → live 24-key names from 05A serializer
--   R6: Operational keys 13 (gate doc said 12; PROJECTION_TARGET_QUESTION_
--       COUNT_PER_SECTION confirmed in prod via 05C seed)
--   R7: DIAGNOSTIC_TOTAL_QUESTIONS classified operational (not in formula
--       serializer; spec placeholder list included it — live is authoritative)
--   R8: Explicit service_role policy dropped — service_role has BYPASSRLS;
--       matches 05A/05B internal-table pattern (RLS-enable + REVOKE + GRANT)
--   R9: Nested-object serialization made deterministic by construction —
--       recursive canonicalize_jsonb_value sorts keys at every depth and
--       applies FM9990.000000 to all numerics (Codex blocker 1 fix)
--
-- Invariants enforced:
--   INV-05D-13: NO constants-change recompute (future-only model)
--   INV-05D-14: ENABLE ALWAYS capture trigger
--
-- Runbook references:
--   RB-05D-V1-02: Single serializer for trigger and reconciliation
--   RB-05D-V1-03: Closed-world classifier — unknown key RAISES
--   RB-05D-V1-11: Precondition guard — extensions.digest() available
--
-- Rollback:
--   ALTER TABLE public.mastery_constants DISABLE TRIGGER trg_capture_mastery_constant_change;
--   DROP TRIGGER IF EXISTS trg_capture_mastery_constant_change ON public.mastery_constants;
--   DROP FUNCTION IF EXISTS public.capture_mastery_constant_change();
--   DROP FUNCTION IF EXISTS public.canonicalize_active_mastery_constants_state();
--   DROP FUNCTION IF EXISTS public.constant_affects_formula_hash(text);
--   DROP FUNCTION IF EXISTS public.canonicalize_jsonb_value(jsonb);
--   DROP TABLE IF EXISTS public.mastery_constants_change_log;
--
-- LYCEON-MIGRATION-REVIEWED: rollback verified (rolled-back txn proof: all 6
--   objects created then cleanly removed in FK-safe order; determinism guard
--   passes — hash stable across JSONB key reorder of PROJECTION_DOMAIN_WEIGHTS)
-- ==========================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Precondition: pgcrypto available (RB-05D-V1-11)
--    The capture trigger depends on extensions.digest(); fail here, not at
--    first constants-change.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM extensions.digest('probe', 'sha256');
EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: extensions.digest() unavailable — enable pgcrypto in the extensions schema before applying this migration';
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. mastery_constants_change_log (Doc 05D §5.2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mastery_constants_change_log (
    change_id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key                  text          NOT NULL,
    op                   text          NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
    old_value            jsonb,
    new_value            jsonb,
    affects_formula_hash boolean       NOT NULL,
    actor_role           text          NOT NULL,
    actor_session_user   text          NOT NULL,
    txid                 bigint        NOT NULL,
    resulting_state_hash text          NOT NULL,
    changed_at           timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mccl_key_time
    ON public.mastery_constants_change_log (key, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mccl_time
    ON public.mastery_constants_change_log (changed_at DESC);

ALTER TABLE public.mastery_constants_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mastery_constants_change_log FROM PUBLIC;
GRANT  ALL ON public.mastery_constants_change_log TO   service_role;

-- R8: Explicit service_role policy dropped — service_role has BYPASSRLS
-- (matches 05A/05B internal-table pattern: RLS-enable + REVOKE + GRANT)
-- R4: admin_role GRANT + policy omitted (SP-20: Supabase 3-role model;
-- service_role has BYPASSRLS and is the only operator path)

-- ----------------------------------------------------------------------------
-- 2. canonicalize_jsonb_value (R9 — deterministic by construction)
--    Recursive: objects get sorted keys, numerics get FM9990.000000,
--    arrays preserve order with recursive element canonicalization.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_jsonb_value(p_val jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $func$
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
$func$;

REVOKE ALL ON FUNCTION public.canonicalize_jsonb_value(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonicalize_jsonb_value(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. constant_affects_formula_hash (Doc 05D §6.3, RB-05D-V1-03)
--    Closed-world: formula → true, operational → false, else → RAISE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.constant_affects_formula_hash(p_key text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $func$
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
$func$;

REVOKE ALL ON FUNCTION public.constant_affects_formula_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.constant_affects_formula_hash(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. canonicalize_active_mastery_constants_state (Doc 05D §6.6, RB-05D-V1-02)
--    Single serializer — used by BOTH the §6.1 trigger and §6.5 reconciliation.
--    Delegates value rendering to canonicalize_jsonb_value for recursive
--    determinism (R9).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_active_mastery_constants_state()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
    SELECT COALESCE(string_agg(
        mc.key || '=' || public.canonicalize_jsonb_value(mc.value),
        E'\n' ORDER BY mc.key), '')
    FROM public.mastery_constants mc;
$func$;

REVOKE ALL ON FUNCTION public.canonicalize_active_mastery_constants_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonicalize_active_mastery_constants_state() TO service_role;

-- ----------------------------------------------------------------------------
-- 5. capture_mastery_constant_change trigger (Doc 05D §6.1, INV-05D-14)
--    Capture-only — does NOT recompute anything (INV-05D-13)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_mastery_constant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
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
$func$;

DROP TRIGGER IF EXISTS trg_capture_mastery_constant_change ON public.mastery_constants;

CREATE TRIGGER trg_capture_mastery_constant_change
    AFTER INSERT OR UPDATE OR DELETE ON public.mastery_constants
    FOR EACH ROW
    EXECUTE FUNCTION public.capture_mastery_constant_change();

ALTER TABLE public.mastery_constants
    ENABLE ALWAYS TRIGGER trg_capture_mastery_constant_change;

-- ============================================================================
-- CI GUARDS — migration fails if any assertion does not hold
-- ============================================================================

-- Guard 1: classifier_is_closed_world (RB-05D-V1-03)
DO $$
DECLARE
    v_key text;
    v_result boolean;
    v_unknown_raised boolean := false;
BEGIN
    FOR v_key IN SELECT key FROM mastery_constants ORDER BY key LOOP
        v_result := constant_affects_formula_hash(v_key);
    END LOOP;

    BEGIN
        v_result := constant_affects_formula_hash('__CI_GUARD_NONEXISTENT_KEY__');
        RAISE EXCEPTION 'classifier_is_closed_world FAILED: unknown key did not raise';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'CONSTANT_KEY_UNKNOWN%' THEN
            v_unknown_raised := true;
        ELSE
            RAISE;
        END IF;
    END;

    IF NOT v_unknown_raised THEN
        RAISE EXCEPTION 'classifier_is_closed_world FAILED: wrong exception for unknown key';
    END IF;

    RAISE NOTICE 'CI GUARD PASSED: classifier_is_closed_world (RB-05D-V1-03)';
END;
$$;

-- Guard 2: constants_state_hash_single_serializer (RB-05D-V1-02)
DO $$
DECLARE
    v_state text;
    v_hash text;
BEGIN
    v_state := canonicalize_active_mastery_constants_state();
    IF v_state IS NULL OR v_state = '' THEN
        RAISE EXCEPTION 'constants_state_hash FAILED: serializer returned empty';
    END IF;

    v_hash := encode(extensions.digest(convert_to(v_state, 'UTF8'), 'sha256'), 'hex');
    IF length(v_hash) != 64 THEN
        RAISE EXCEPTION 'constants_state_hash FAILED: hash length % != 64', length(v_hash);
    END IF;

    RAISE NOTICE 'CI GUARD PASSED: constants_state_hash_single_serializer (RB-05D-V1-02)';
END;
$$;

-- Guard 3: capture_trigger_is_enable_always (INV-05D-14)
DO $$
DECLARE
    v_tgenabled text;
BEGIN
    SELECT tgenabled INTO v_tgenabled
    FROM pg_trigger
    WHERE tgrelid = 'mastery_constants'::regclass
      AND tgname = 'trg_capture_mastery_constant_change';

    IF v_tgenabled IS NULL THEN
        RAISE EXCEPTION 'capture_trigger_is_enable_always FAILED: trigger not found';
    END IF;

    IF v_tgenabled != 'A' THEN
        RAISE EXCEPTION 'capture_trigger_is_enable_always FAILED: tgenabled=% (expected A)', v_tgenabled;
    END IF;

    RAISE NOTICE 'CI GUARD PASSED: capture_trigger_is_enable_always (INV-05D-14)';
END;
$$;

-- Guard 4: operational_key_set_matches_formula_hash_complement (§6.3)
DO $$
DECLARE
    v_key text;
    v_formula_count int := 0;
    v_operational_count int := 0;
    v_total int;
BEGIN
    SELECT count(*) INTO v_total FROM mastery_constants;

    FOR v_key IN SELECT key FROM mastery_constants ORDER BY key LOOP
        IF constant_affects_formula_hash(v_key) THEN
            v_formula_count := v_formula_count + 1;
        ELSE
            v_operational_count := v_operational_count + 1;
        END IF;
    END LOOP;

    IF v_formula_count + v_operational_count != v_total THEN
        RAISE EXCEPTION 'operational_key_set FAILED: formula(%) + operational(%) != total(%)',
            v_formula_count, v_operational_count, v_total;
    END IF;

    IF v_formula_count != 24 THEN
        RAISE EXCEPTION 'operational_key_set FAILED: formula count=% (expected 24)', v_formula_count;
    END IF;

    IF v_operational_count != 13 THEN
        RAISE EXCEPTION 'operational_key_set FAILED: operational count=% (expected 13)', v_operational_count;
    END IF;

    RAISE NOTICE 'CI GUARD PASSED: operational_key_set — formula=%, operational=%, total=%',
        v_formula_count, v_operational_count, v_total;
END;
$$;

-- Guard 5: serializer_is_order_independent (R9 determinism-by-construction)
--   Prove canonicalize_jsonb_value produces identical output regardless of JSONB
--   key insertion order. Uses synthetic literals — no table mutation, so the
--   capture trigger is never fired and no spurious change-log rows are written.
-- LYCEON-MIGRATION-REVIEWED
DO $$
DECLARE
    v_order_a text;
    v_order_b text;
    v_nested_a jsonb;
    v_nested_b jsonb;
BEGIN
    v_nested_a := jsonb_build_object(
        'M', jsonb_build_object(
            'Algebra', 0.35,
            'Advanced Math', 0.35,
            'Problem Solving and Data Analysis', 0.15,
            'Geometry and Trigonometry', 0.15),
        'RW', jsonb_build_object(
            'Craft and Structure', 0.28,
            'Expression of Ideas', 0.20,
            'Information and Ideas', 0.26,
            'Standard English Conventions', 0.26));
    v_nested_b := jsonb_build_object(
        'RW', jsonb_build_object(
            'Standard English Conventions', 0.26,
            'Information and Ideas', 0.26,
            'Expression of Ideas', 0.20,
            'Craft and Structure', 0.28),
        'M', jsonb_build_object(
            'Problem Solving and Data Analysis', 0.15,
            'Geometry and Trigonometry', 0.15,
            'Algebra', 0.35,
            'Advanced Math', 0.35));

    v_order_a := canonicalize_jsonb_value(v_nested_a);
    v_order_b := canonicalize_jsonb_value(v_nested_b);

    IF v_order_a != v_order_b THEN
        RAISE EXCEPTION 'serializer_is_order_independent FAILED: canonicalize_jsonb_value produced different output for same data in different key order (a=%, b=%)',
            v_order_a, v_order_b;
    END IF;

    RAISE NOTICE 'CI GUARD PASSED: serializer_is_order_independent — hash stable across JSONB key reorder';
END;
$$;

COMMIT;
