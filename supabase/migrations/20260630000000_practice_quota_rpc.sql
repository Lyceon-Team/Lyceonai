-- LYCEON-MIGRATION-REVIEWED: practice quota RPC + ledger table
-- @spec [Doc-02B_V4 §41; freemium-practice-quota.contract.md] | @implemented [2026-06-30]
-- Creates usage_rate_limit_ledger table and check_and_reserve_practice_quota RPC.
-- Quota: 40/day UTC-reset (unpaid), unlimited (entitled), 60/session (paid).
-- Reads daily_quota_free from practice_runtime_config (no hardcoded limit).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.check_and_reserve_practice_quota CASCADE;
--   DROP FUNCTION IF EXISTS public._rl_has_active_entitlement CASCADE;
--   DROP FUNCTION IF EXISTS public._rl_resolve_student_account CASCADE;
--   DROP TABLE IF EXISTS public.usage_rate_limit_ledger CASCADE;

BEGIN;

-- ============================================================
-- 1. Ledger table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usage_rate_limit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('practice', 'full_length', 'tutor', 'calendar')),
  event_key text NOT NULL,
  student_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NULL,
  session_id uuid NULL,
  session_item_id uuid NULL,
  dedupe_key text NULL,
  units integer NOT NULL DEFAULT 1 CHECK (units >= 0),
  reservation_state text NOT NULL CHECK (reservation_state IN ('consumed', 'reserved', 'finalized', 'failed', 'denied')),
  reservation_expires_at timestamptz NULL,
  cooldown_until timestamptz NULL,
  input_tokens_reserved integer NULL CHECK (input_tokens_reserved IS NULL OR input_tokens_reserved >= 0),
  output_tokens_reserved integer NULL CHECK (output_tokens_reserved IS NULL OR output_tokens_reserved >= 0),
  cost_micros_reserved bigint NULL CHECK (cost_micros_reserved IS NULL OR cost_micros_reserved >= 0),
  input_tokens_final integer NULL CHECK (input_tokens_final IS NULL OR input_tokens_final >= 0),
  output_tokens_final integer NULL CHECK (output_tokens_final IS NULL OR output_tokens_final >= 0),
  cost_micros_final bigint NULL CHECK (cost_micros_final IS NULL OR cost_micros_final >= 0),
  denial_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_rate_limit_ledger_scope_user_created
  ON public.usage_rate_limit_ledger(scope, student_user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_rate_limit_ledger_dedupe
  ON public.usage_rate_limit_ledger(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.usage_rate_limit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_rate_limit_ledger_select_own ON public.usage_rate_limit_ledger;
CREATE POLICY usage_rate_limit_ledger_select_own
  ON public.usage_rate_limit_ledger
  FOR SELECT
  TO authenticated
  USING (student_user_id = auth.uid());

-- ============================================================
-- 2. Helper: resolve student → account
-- ============================================================
CREATE OR REPLACE FUNCTION public._rl_resolve_student_account(
  p_student_user_id uuid,
  p_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
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

-- ============================================================
-- 3. Helper: entitlement check (delegates to entitlement_active)
-- ============================================================
CREATE OR REPLACE FUNCTION public._rl_has_active_entitlement(
  p_student_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'entitlement_active'
     )
  THEN
    RETURN COALESCE(
      (SELECT public.entitlement_active(pr.id)
       FROM public.profiles pr
       WHERE pr.user_id = p_student_user_id
       LIMIT 1),
      false
    );
  END IF;
  RETURN false;
END;
$$;

-- ============================================================
-- 4. Main RPC: check_and_reserve_practice_quota
--    - Reads daily_quota_free from practice_runtime_config
--    - UTC-day reset window
--    - Entitled users bypass daily cap
--    - Per-session cap of 60 for paid users
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_and_reserve_practice_quota(
  p_student_user_id uuid,
  p_account_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_session_item_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false,
  p_request_id text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
  v_daily_limit integer := 40;
  v_session_limit integer := 60;
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
  PERFORM pg_advisory_xact_lock(hashtext('practice_quota:' || p_student_user_id::text));

  -- Read daily limit from config (no hardcoded value)
  SELECT value INTO v_config_val
  FROM public.practice_runtime_config
  WHERE key = 'daily_quota_free';
  IF v_config_val IS NOT NULL AND v_config_val ~ '^\d+$' THEN
    v_daily_limit := v_config_val::integer;
  END IF;

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

  -- Per-session cap (paid users get 60/session)
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
$$;

COMMIT;
