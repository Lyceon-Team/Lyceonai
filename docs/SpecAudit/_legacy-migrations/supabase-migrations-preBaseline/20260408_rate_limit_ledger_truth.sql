BEGIN;

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

-- Premium-required families are entitlement-gated by the server before invoking quota gates:
-- tutor, full_length, calendar, and mastery surfaces.
-- This package owns quota/budget truth only (not primary entitlement decisions).

CREATE INDEX IF NOT EXISTS idx_usage_rate_limit_ledger_scope_user_created
  ON public.usage_rate_limit_ledger(scope, student_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_rate_limit_ledger_cooldown
  ON public.usage_rate_limit_ledger(scope, student_user_id, cooldown_until DESC);

CREATE INDEX IF NOT EXISTS idx_usage_rate_limit_ledger_tutor_state
  ON public.usage_rate_limit_ledger(scope, student_user_id, reservation_state, reservation_expires_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_rate_limit_ledger_dedupe
  ON public.usage_rate_limit_ledger(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lyceon_accounts'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usage_rate_limit_ledger_account_id_fkey'
      AND conrelid = 'public.usage_rate_limit_ledger'::regclass
  ) THEN
    ALTER TABLE public.usage_rate_limit_ledger
      ADD CONSTRAINT usage_rate_limit_ledger_account_id_fkey
      FOREIGN KEY (account_id)
      REFERENCES public.lyceon_accounts(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.usage_rate_limit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_rate_limit_ledger_select_own ON public.usage_rate_limit_ledger;
DROP POLICY IF EXISTS usage_rate_limit_ledger_service_role_all ON public.usage_rate_limit_ledger;

DO $$
BEGIN
  IF to_regclass('public.lyceon_account_members') IS NOT NULL THEN
    EXECUTE $policy$
      CREATE POLICY usage_rate_limit_ledger_select_own
        ON public.usage_rate_limit_ledger
        FOR SELECT
        TO authenticated
        USING (
          student_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.lyceon_account_members lam
            WHERE lam.account_id = usage_rate_limit_ledger.account_id
              AND lam.user_id = auth.uid()
          )
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY usage_rate_limit_ledger_select_own
        ON public.usage_rate_limit_ledger
        FOR SELECT
        TO authenticated
        USING (student_user_id = auth.uid())
    $policy$;
  END IF;
END $$;

CREATE POLICY usage_rate_limit_ledger_service_role_all
  ON public.usage_rate_limit_ledger
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP TRIGGER IF EXISTS set_usage_rate_limit_ledger_updated_at ON public.usage_rate_limit_ledger;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    CREATE TRIGGER set_usage_rate_limit_ledger_updated_at
      BEFORE UPDATE ON public.usage_rate_limit_ledger
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._rl_estimate_tutor_cost_micros(
  p_input_tokens integer,
  p_output_tokens integer
)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_input integer := GREATEST(COALESCE(p_input_tokens, 0), 0);
  v_output integer := GREATEST(COALESCE(p_output_tokens, 0), 0);
BEGIN
  -- Rough-cost estimator for gating:
  -- input: $0.000075 / 1K tokens, output: $0.000300 / 1K tokens.
  RETURN CEIL((v_input::numeric / 1000.0) * 75 + (v_output::numeric / 1000.0) * 300);
END;
$$;

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

CREATE OR REPLACE FUNCTION public._rl_has_active_entitlement(
  p_account_id uuid,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_active boolean := false;
BEGIN
  IF p_account_id IS NULL OR to_regclass('public.entitlements') IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.entitlements e
    WHERE e.account_id = p_account_id
      AND e.plan = 'paid'
      AND e.status IN ('active', 'trialing')
      AND (e.current_period_end IS NULL OR e.current_period_end > p_now)
  )
  INTO v_active;

  RETURN COALESCE(v_active, false);
END;
$$;

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
  v_window_start timestamptz := v_now - interval '24 hours';
  v_limit integer := 20;
  v_used integer := 0;
  v_reset_at timestamptz := NULL;
  v_oldest timestamptz := NULL;
  v_account uuid := NULL;
  v_entitled boolean := false;
  v_counts_toward_limit boolean := true;
  v_dedupe_key text := NULL;
  v_existing_id uuid := NULL;
  v_existing_state text := NULL;
  v_inserted_id uuid := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('practice_quota:' || p_student_user_id::text));

  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);
  v_entitled := public._rl_has_active_entitlement(v_account, v_now);
  v_counts_toward_limit := NOT v_entitled;

  SELECT
    COALESCE(SUM(units), 0)::integer,
    MIN(created_at)
  INTO v_used, v_oldest
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'practice'
    AND l.student_user_id = p_student_user_id
    AND l.reservation_state IN ('consumed', 'finalized')
    AND COALESCE((l.metadata->>'counts_toward_limit')::boolean, true)
    AND l.created_at >= v_window_start;

  IF v_oldest IS NOT NULL THEN
    v_reset_at := v_oldest + interval '24 hours';
  ELSIF v_counts_toward_limit THEN
    v_reset_at := v_now + interval '24 hours';
  END IF;

  IF v_counts_toward_limit AND v_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'PRACTICE_FREE_DAILY_QUOTA_EXCEEDED',
      'message', 'Practice free-tier limit reached (20 served questions per rolling 24 hours).',
      'current', v_used,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - v_used, 0),
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', CASE WHEN v_counts_toward_limit THEN 'PRACTICE_OK' ELSE 'PRACTICE_BYPASS_ENTITLED' END,
      'message', CASE WHEN v_counts_toward_limit THEN 'Practice quota available.' ELSE 'Active entitlement bypasses free-tier practice cap.' END,
      'current', v_used,
      'limit', CASE WHEN v_counts_toward_limit THEN v_limit ELSE NULL END,
      'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_limit - v_used, 0) ELSE NULL END,
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  IF p_session_item_id IS NOT NULL THEN
    v_dedupe_key := 'practice:served:' || p_session_item_id::text;
    SELECT l.id, l.reservation_state
    INTO v_existing_id, v_existing_state
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
      'limit', CASE WHEN v_counts_toward_limit THEN v_limit ELSE NULL END,
      'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_limit - v_used, 0) ELSE NULL END,
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', v_existing_id,
      'duplicate', true
    );
  END IF;

  INSERT INTO public.usage_rate_limit_ledger (
    scope,
    event_key,
    student_user_id,
    account_id,
    session_id,
    session_item_id,
    dedupe_key,
    units,
    reservation_state,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    'practice',
    'practice_question_served',
    p_student_user_id,
    v_account,
    p_session_id,
    p_session_item_id,
    v_dedupe_key,
    1,
    'consumed',
    jsonb_build_object(
      'counts_toward_limit', v_counts_toward_limit,
      'request_id', p_request_id
    ),
    v_now,
    v_now
  )
  RETURNING id INTO v_inserted_id;

  IF v_counts_toward_limit THEN
    v_used := v_used + 1;
    IF v_reset_at IS NULL THEN
      v_reset_at := v_now + interval '24 hours';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', CASE WHEN v_counts_toward_limit THEN 'PRACTICE_RESERVED' ELSE 'PRACTICE_BYPASS_ENTITLED' END,
    'message', CASE WHEN v_counts_toward_limit THEN 'Practice quota reserved.' ELSE 'Active entitlement bypasses free-tier practice cap.' END,
    'current', v_used,
    'limit', CASE WHEN v_counts_toward_limit THEN v_limit ELSE NULL END,
    'remaining', CASE WHEN v_counts_toward_limit THEN GREATEST(v_limit - v_used, 0) ELSE NULL END,
    'reset_at', v_reset_at,
    'cooldown_until', NULL,
    'reservation_id', v_inserted_id,
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_reserve_full_length_quota(
  p_student_user_id uuid,
  p_account_id uuid DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_window_start timestamptz := v_now - interval '7 days';
  v_limit integer := 2;
  v_used integer := 0;
  v_reset_at timestamptz := NULL;
  v_oldest timestamptz := NULL;
  v_account uuid := NULL;
  v_dedupe_key text := NULL;
  v_existing_id uuid := NULL;
  v_inserted_id uuid := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('full_length_quota:' || p_student_user_id::text));

  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);

  IF p_reference_id IS NOT NULL AND length(trim(p_reference_id)) > 0 THEN
    v_dedupe_key := 'full_length:start:' || trim(p_reference_id);
    SELECT id
    INTO v_existing_id
    FROM public.usage_rate_limit_ledger
    WHERE dedupe_key = v_dedupe_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      SELECT
        COALESCE(SUM(units), 0)::integer,
        MIN(created_at)
      INTO v_used, v_oldest
      FROM public.usage_rate_limit_ledger l
      WHERE l.scope = 'full_length'
        AND l.student_user_id = p_student_user_id
        AND l.reservation_state IN ('consumed', 'finalized')
        AND l.created_at >= v_window_start;

      IF v_oldest IS NOT NULL THEN
        v_reset_at := v_oldest + interval '7 days';
      END IF;

      RETURN jsonb_build_object(
        'allowed', true,
        'code', 'FULL_LENGTH_ALREADY_RESERVED',
        'message', 'Full-length start already counted for this reference.',
        'current', v_used,
        'limit', v_limit,
        'remaining', GREATEST(v_limit - v_used, 0),
        'reset_at', v_reset_at,
        'cooldown_until', NULL,
        'reservation_id', v_existing_id,
        'duplicate', true
      );
    END IF;
  END IF;

  SELECT
    COALESCE(SUM(units), 0)::integer,
    MIN(created_at)
  INTO v_used, v_oldest
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'full_length'
    AND l.student_user_id = p_student_user_id
    AND l.reservation_state IN ('consumed', 'finalized')
    AND l.created_at >= v_window_start;

  IF v_oldest IS NOT NULL THEN
    v_reset_at := v_oldest + interval '7 days';
  ELSE
    v_reset_at := v_now + interval '7 days';
  END IF;

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'FULL_LENGTH_QUOTA_EXCEEDED',
      'message', 'Full-length start limit reached (2 qualifying starts per rolling 7 days).',
      'current', v_used,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - v_used, 0),
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  INSERT INTO public.usage_rate_limit_ledger (
    scope,
    event_key,
    student_user_id,
    account_id,
    dedupe_key,
    units,
    reservation_state,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    'full_length',
    'full_length_start',
    p_student_user_id,
    v_account,
    v_dedupe_key,
    1,
    'consumed',
    jsonb_build_object('reference_id', p_reference_id, 'counts_toward_limit', true),
    v_now,
    v_now
  )
  RETURNING id INTO v_inserted_id;

  v_used := v_used + 1;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'FULL_LENGTH_RESERVED',
    'message', 'Full-length start reserved.',
    'current', v_used,
    'limit', v_limit,
    'remaining', GREATEST(v_limit - v_used, 0),
    'reset_at', v_reset_at,
    'cooldown_until', NULL,
    'reservation_id', v_inserted_id,
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_reserve_calendar_quota(
  p_student_user_id uuid,
  p_account_id uuid DEFAULT NULL,
  p_event_key text DEFAULT NULL,
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
  v_window_start timestamptz := v_now - interval '7 days';
  v_limit integer := 3;
  v_used integer := 0;
  v_oldest timestamptz := NULL;
  v_reset_at timestamptz := NULL;
  v_account uuid := NULL;
  v_inserted_id uuid := NULL;
  v_dedupe_key text := NULL;
  v_existing_id uuid := NULL;
  v_allowed_event_keys text[] := ARRAY[
    'calendar_refresh_auto',
    'calendar_regenerate_full',
    'calendar_regenerate_day'
  ];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('calendar_quota:' || p_student_user_id::text));

  IF p_event_key IS NULL OR NOT (p_event_key = ANY(v_allowed_event_keys)) THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'code', 'CALENDAR_EVENT_NOT_COUNTED',
      'message', 'Calendar action does not count toward refresh quota.',
      'current', NULL,
      'limit', NULL,
      'remaining', NULL,
      'reset_at', NULL,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);

  SELECT
    COALESCE(SUM(units), 0)::integer,
    MIN(created_at)
  INTO v_used, v_oldest
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'calendar'
    AND l.student_user_id = p_student_user_id
    AND l.reservation_state IN ('consumed', 'finalized')
    AND l.event_key = ANY(v_allowed_event_keys)
    AND l.created_at >= v_window_start;

  IF v_oldest IS NOT NULL THEN
    v_reset_at := v_oldest + interval '7 days';
  ELSE
    v_reset_at := v_now + interval '7 days';
  END IF;

  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    v_dedupe_key := 'calendar:' || p_student_user_id::text || ':' || p_event_key || ':' || trim(p_request_id);
    SELECT l.id
    INTO v_existing_id
    FROM public.usage_rate_limit_ledger l
    WHERE l.dedupe_key = v_dedupe_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'allowed', true,
        'code', 'CALENDAR_ALREADY_RESERVED',
        'message', 'Calendar action already counted for this request.',
        'current', v_used,
        'limit', v_limit,
        'remaining', GREATEST(v_limit - v_used, 0),
        'reset_at', v_reset_at,
        'cooldown_until', NULL,
        'reservation_id', v_existing_id,
        'duplicate', true
      );
    END IF;
  END IF;

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'CALENDAR_REFRESH_QUOTA_EXCEEDED',
      'message', 'Calendar refresh/regeneration limit reached (3 actions per rolling 7 days).',
      'current', v_used,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - v_used, 0),
      'reset_at', v_reset_at,
      'cooldown_until', NULL,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  INSERT INTO public.usage_rate_limit_ledger (
    scope,
    event_key,
    student_user_id,
    account_id,
    dedupe_key,
    units,
    reservation_state,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    'calendar',
    p_event_key,
    p_student_user_id,
    v_account,
    v_dedupe_key,
    1,
    'consumed',
    jsonb_build_object('request_id', p_request_id, 'counts_toward_limit', true),
    v_now,
    v_now
  )
  RETURNING id INTO v_inserted_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'CALENDAR_RESERVED',
    'message', 'Calendar refresh/regeneration quota reserved.',
    'current', v_used + 1,
    'limit', v_limit,
    'remaining', GREATEST(v_limit - (v_used + 1), 0),
    'reset_at', v_reset_at,
    'cooldown_until', NULL,
    'reservation_id', v_inserted_id,
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_reserve_tutor_budget(
  p_student_user_id uuid,
  p_account_id uuid DEFAULT NULL,
  p_session_key text DEFAULT NULL,
  p_reserved_input_tokens integer DEFAULT 1800,
  p_reserved_output_tokens integer DEFAULT 1200,
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
  v_window_5m timestamptz := v_now - interval '5 minutes';
  v_window_24h timestamptz := v_now - interval '24 hours';
  v_account uuid := NULL;
  v_entitled boolean := false;

  v_global_density_limit integer := 10;
  v_session_density_limit integer := 6;
  v_token_limit integer := 60000;
  v_cost_limit bigint := 900000;

  v_interactions_5m integer := 0;
  v_session_interactions_5m integer := 0;
  v_tokens_used_24h integer := 0;
  v_cost_used_24h bigint := 0;

  v_reserved_input integer := GREATEST(COALESCE(p_reserved_input_tokens, 0), 0);
  v_reserved_output integer := GREATEST(COALESCE(p_reserved_output_tokens, 0), 0);
  v_reserved_cost bigint := 0;

  v_cooldown_until timestamptz := NULL;
  v_reset_at timestamptz := v_now + interval '24 hours';
  v_oldest_budget_event timestamptz := NULL;
  v_reservation_id uuid := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tutor_quota:' || p_student_user_id::text));

  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);
  v_entitled := public._rl_has_active_entitlement(v_account, v_now);

  IF v_entitled THEN
    v_global_density_limit := 18;
    v_session_density_limit := 12;
    v_token_limit := 300000;
    v_cost_limit := 4000000;
  END IF;

  SELECT MAX(l.cooldown_until)
  INTO v_cooldown_until
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'tutor'
    AND l.student_user_id = p_student_user_id
    AND l.cooldown_until IS NOT NULL
    AND l.cooldown_until > v_now;

  IF v_cooldown_until IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'TUTOR_COOLDOWN_ACTIVE',
      'message', 'Tutor cooldown is active. Please wait before sending another request.',
      'current', NULL,
      'limit', NULL,
      'remaining', NULL,
      'reset_at', NULL,
      'cooldown_until', v_cooldown_until,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  SELECT COALESCE(SUM(units), 0)::integer
  INTO v_interactions_5m
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'tutor'
    AND l.student_user_id = p_student_user_id
    AND l.reservation_state IN ('reserved', 'finalized')
    AND l.created_at >= v_window_5m;

  IF v_interactions_5m >= v_global_density_limit THEN
    v_cooldown_until := v_now + interval '2 minutes';

    INSERT INTO public.usage_rate_limit_ledger (
      scope, event_key, student_user_id, account_id, units, reservation_state,
      cooldown_until, denial_code, metadata, created_at, updated_at
    )
    VALUES (
      'tutor', 'tutor_deny_density', p_student_user_id, v_account, 0, 'denied',
      v_cooldown_until, 'TUTOR_DENSITY_LIMIT_EXCEEDED',
      jsonb_build_object('request_id', p_request_id, 'session_key', p_session_key, 'density_scope', 'global'),
      v_now, v_now
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'TUTOR_DENSITY_LIMIT_EXCEEDED',
      'message', 'Tutor request density exceeded. Please slow down.',
      'current', v_interactions_5m,
      'limit', v_global_density_limit,
      'remaining', GREATEST(v_global_density_limit - v_interactions_5m, 0),
      'reset_at', v_now + interval '5 minutes',
      'cooldown_until', v_cooldown_until,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  IF p_session_key IS NOT NULL AND length(trim(p_session_key)) > 0 THEN
    SELECT COALESCE(SUM(units), 0)::integer
    INTO v_session_interactions_5m
    FROM public.usage_rate_limit_ledger l
    WHERE l.scope = 'tutor'
      AND l.student_user_id = p_student_user_id
      AND l.reservation_state IN ('reserved', 'finalized')
      AND l.created_at >= v_window_5m
      AND COALESCE(l.metadata->>'session_key', '') = trim(p_session_key);

    IF v_session_interactions_5m >= v_session_density_limit THEN
      v_cooldown_until := v_now + interval '2 minutes';

      INSERT INTO public.usage_rate_limit_ledger (
        scope, event_key, student_user_id, account_id, units, reservation_state,
        cooldown_until, denial_code, metadata, created_at, updated_at
      )
      VALUES (
        'tutor', 'tutor_deny_session_density', p_student_user_id, v_account, 0, 'denied',
        v_cooldown_until, 'TUTOR_DENSITY_LIMIT_EXCEEDED',
        jsonb_build_object('request_id', p_request_id, 'session_key', trim(p_session_key), 'density_scope', 'session'),
        v_now, v_now
      );

      RETURN jsonb_build_object(
        'allowed', false,
        'code', 'TUTOR_DENSITY_LIMIT_EXCEEDED',
        'message', 'Tutor interaction density exceeded for this session context.',
        'current', v_session_interactions_5m,
        'limit', v_session_density_limit,
        'remaining', GREATEST(v_session_density_limit - v_session_interactions_5m, 0),
        'reset_at', v_now + interval '5 minutes',
        'cooldown_until', v_cooldown_until,
        'reservation_id', NULL,
        'duplicate', false
      );
    END IF;
  END IF;

  IF v_reserved_input = 0 AND v_reserved_output = 0 THEN
    v_reserved_input := 1800;
    v_reserved_output := 1200;
  END IF;

  v_reserved_cost := public._rl_estimate_tutor_cost_micros(v_reserved_input, v_reserved_output);

  SELECT
    COALESCE(SUM(
      CASE
        WHEN l.reservation_state = 'finalized'
          THEN COALESCE(l.input_tokens_final, l.input_tokens_reserved, 0) + COALESCE(l.output_tokens_final, l.output_tokens_reserved, 0)
        WHEN l.reservation_state = 'reserved' AND (l.reservation_expires_at IS NULL OR l.reservation_expires_at > v_now)
          THEN COALESCE(l.input_tokens_reserved, 0) + COALESCE(l.output_tokens_reserved, 0)
        ELSE 0
      END
    ), 0)::integer,
    COALESCE(SUM(
      CASE
        WHEN l.reservation_state = 'finalized'
          THEN COALESCE(l.cost_micros_final, l.cost_micros_reserved, 0)
        WHEN l.reservation_state = 'reserved' AND (l.reservation_expires_at IS NULL OR l.reservation_expires_at > v_now)
          THEN COALESCE(l.cost_micros_reserved, 0)
        ELSE 0
      END
    ), 0)::bigint,
    MIN(l.created_at)
  INTO v_tokens_used_24h, v_cost_used_24h, v_oldest_budget_event
  FROM public.usage_rate_limit_ledger l
  WHERE l.scope = 'tutor'
    AND l.student_user_id = p_student_user_id
    AND l.created_at >= v_window_24h;

  IF v_oldest_budget_event IS NOT NULL THEN
    v_reset_at := v_oldest_budget_event + interval '24 hours';
  END IF;

  IF (v_tokens_used_24h + v_reserved_input + v_reserved_output) > v_token_limit
    OR (v_cost_used_24h + v_reserved_cost) > v_cost_limit THEN
    v_cooldown_until := v_now + interval '5 minutes';

    INSERT INTO public.usage_rate_limit_ledger (
      scope, event_key, student_user_id, account_id, units, reservation_state,
      cooldown_until, denial_code, metadata, created_at, updated_at
    )
    VALUES (
      'tutor', 'tutor_deny_budget', p_student_user_id, v_account, 0, 'denied',
      v_cooldown_until, 'TUTOR_BUDGET_EXCEEDED',
      jsonb_build_object(
        'request_id', p_request_id,
        'session_key', p_session_key,
        'tokens_used_24h', v_tokens_used_24h,
        'token_limit', v_token_limit,
        'cost_used_24h', v_cost_used_24h,
        'cost_limit', v_cost_limit
      ),
      v_now, v_now
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'TUTOR_BUDGET_EXCEEDED',
      'message', 'Tutor token/cost budget reached. Please try again after reset.',
      'current', v_tokens_used_24h,
      'limit', v_token_limit,
      'remaining', GREATEST(v_token_limit - v_tokens_used_24h, 0),
      'reset_at', v_reset_at,
      'cooldown_until', v_cooldown_until,
      'reservation_id', NULL,
      'duplicate', false
    );
  END IF;

  INSERT INTO public.usage_rate_limit_ledger (
    scope,
    event_key,
    student_user_id,
    account_id,
    units,
    reservation_state,
    reservation_expires_at,
    input_tokens_reserved,
    output_tokens_reserved,
    cost_micros_reserved,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    'tutor',
    'tutor_budget_reservation',
    p_student_user_id,
    v_account,
    1,
    'reserved',
    v_now + interval '15 minutes',
    v_reserved_input,
    v_reserved_output,
    v_reserved_cost,
    jsonb_build_object(
      'request_id', p_request_id,
      'session_key', p_session_key,
      'entitled', v_entitled
    ),
    v_now,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'TUTOR_RESERVED',
    'message', 'Tutor budget reserved.',
    'current', v_tokens_used_24h + v_reserved_input + v_reserved_output,
    'limit', v_token_limit,
    'remaining', GREATEST(v_token_limit - (v_tokens_used_24h + v_reserved_input + v_reserved_output), 0),
    'reset_at', v_reset_at,
    'cooldown_until', NULL,
    'reservation_id', v_reservation_id,
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_tutor_usage(
  p_reservation_id uuid,
  p_success boolean DEFAULT true,
  p_failure_code text DEFAULT NULL,
  p_final_input_tokens integer DEFAULT NULL,
  p_final_output_tokens integer DEFAULT NULL,
  p_final_cost_micros bigint DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_row public.usage_rate_limit_ledger%ROWTYPE;
  v_input integer := 0;
  v_output integer := 0;
  v_cost bigint := 0;
  v_state text := NULL;
BEGIN
  SELECT *
  INTO v_row
  FROM public.usage_rate_limit_ledger
  WHERE id = p_reservation_id
    AND scope = 'tutor'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'TUTOR_RESERVATION_NOT_FOUND',
      'message', 'Tutor reservation not found.',
      'reservation_id', p_reservation_id
    );
  END IF;

  IF v_row.reservation_state NOT IN ('reserved', 'finalized') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'TUTOR_RESERVATION_NOT_ACTIVE',
      'message', 'Tutor reservation is not active.',
      'reservation_id', p_reservation_id,
      'state', v_row.reservation_state
    );
  END IF;

  v_input := GREATEST(COALESCE(p_final_input_tokens, v_row.input_tokens_reserved, 0), 0);
  v_output := GREATEST(COALESCE(p_final_output_tokens, v_row.output_tokens_reserved, 0), 0);
  v_cost := GREATEST(COALESCE(p_final_cost_micros, public._rl_estimate_tutor_cost_micros(v_input, v_output)), 0);
  v_state := CASE WHEN p_success THEN 'finalized' ELSE 'failed' END;

  UPDATE public.usage_rate_limit_ledger
  SET
    reservation_state = v_state,
    reservation_expires_at = NULL,
    input_tokens_final = v_input,
    output_tokens_final = v_output,
    cost_micros_final = v_cost,
    denial_code = CASE WHEN p_success THEN NULL ELSE COALESCE(p_failure_code, 'TUTOR_RUNTIME_ERROR') END,
    updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', CASE WHEN p_success THEN 'TUTOR_FINALIZED' ELSE 'TUTOR_FAILED' END,
    'message', CASE WHEN p_success THEN 'Tutor usage finalized.' ELSE 'Tutor usage marked failed.' END,
    'reservation_id', p_reservation_id,
    'state', v_state,
    'final_input_tokens', v_input,
    'final_output_tokens', v_output,
    'final_cost_micros', v_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_full_length_quota(uuid, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_full_length_quota(uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_calendar_quota(uuid, uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_calendar_quota(uuid, uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_tutor_budget(uuid, uuid, text, integer, integer, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_tutor_budget(uuid, uuid, text, integer, integer, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_tutor_usage(uuid, boolean, text, integer, integer, bigint, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_tutor_usage(uuid, boolean, text, integer, integer, bigint, timestamptz) TO service_role;

COMMIT;
