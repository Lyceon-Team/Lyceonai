-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Free daily practice quota: counts submitted answers, resets at the configured-timezone
-- midnight (America/Chicago at launch).
--
-- @spec [Owner ruling (Karl) 2026-10-03, OQ-43 / F-61: "follow Doc 02B. The quota counts
--        submitted answers and resets at Chicago midnight. One shared function for the 402
--        and the quota read"; Doc-02B_V4 §13 "Quota Contract" (`daily_quota_free` per
--        calendar day, reset at `quota_reset_timezone` midnight), "Reset Algorithm",
--        "Quota Check Mechanism" (count submissions with `answered_at >=` the most recent
--        configured-timezone midnight; checked at session start and next-question request),
--        "What Counts Against Quota" (served-but-unanswered excluded); §12 Entitlement Matrix
--        (premium unlimited); Doc-02B_V4 §16 review entry ("Skipped questions (served but not
--        submitted)")]
-- | @implemented [2026-10-03]
--
-- plain English: `check_and_reserve_practice_quota` (20260630000000 §4) counted ledger rows
-- written when a question was SERVED, over a UTC-midnight window. The owner ruled (OQ-43,
-- 2026-10-03) that it follows Doc 02B §13. This replaces the body so that the free daily
-- count is:
--   - the number of `practice_session_items` rows of the student with `status = 'answered'`
--     and `answered_at` inside the current local day of
--     `practice_runtime_config.quota_reset_timezone` — the answer row IS the submission, so
--     an idempotent replay of the same answer (same item, same `client_attempt_id`) is one
--     row and counts once, and a served or skipped item (Doc 02B: "served but not
--     submitted") counts zero;
--   - the window is [local midnight today, local midnight tomorrow), each computed as a
--     local date `AT TIME ZONE` the configured zone, so a DST day is 23 or 25 hours long
--     and `reset_at` is the absolute instant of the next local midnight;
--   - the timezone is read from config (INV-02B-15), required, and fails closed when it is
--     missing or not a zone Postgres knows.
-- Unchanged: the signature, ACL, identity guard, advisory lock, entitled bypass of the
-- daily cap, the paid per-session cap (`max_session_count_premium`, counted over the serve
-- ledger rows of the session), the serve-time ledger row and its `practice:served:<item>`
-- dedupe, and every response key. A serve still writes its ledger row (the serve log the
-- per-session cap reads), but that row no longer moves the free daily count, and the
-- reservation's `current` / `remaining` no longer step on a serve. The dry run (session
-- start pre-cap and its 402, `GET /api/practice/quota`) and the serve (`GET /next` and
-- its 402) go through the same daily-cap branch below, so they cannot disagree.
-- `p_now` (already a parameter, DEFAULT now()) lets the day boundary be tested
-- deterministically; the application never passes it.
--
-- ROLLBACK (restores the UTC-midnight, served-question rule):
--   re-run section 4 of 20260630000000_practice_quota_rpc.sql (its CREATE OR REPLACE of
--   public.check_and_reserve_practice_quota) and its section 5 REVOKE/GRANT. No table or
--   data is touched here, so nothing else needs reverting.
-- ---------------------------------------------------------------------------

BEGIN;

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
  v_tz text;
  v_local_day date;
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

  -- Reset timezone from config (required — no hardcoded fallback). Doc 02B §13.
  SELECT value #>> '{}' INTO v_tz
  FROM public.practice_runtime_config
  WHERE key = 'quota_reset_timezone';
  IF v_tz IS NULL OR v_tz = '' THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key quota_reset_timezone'
      USING ERRCODE = 'P0002';
  END IF;

  -- Local-day boundaries in the configured zone (DST-correct: each boundary is a local
  -- midnight converted to an absolute instant, never a fixed offset).
  BEGIN
    v_local_day := (v_now AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key quota_reset_timezone'
      USING ERRCODE = 'P0002';
  END;
  v_today_start := v_local_day::timestamp AT TIME ZONE v_tz;
  v_tomorrow_start := (v_local_day + 1)::timestamp AT TIME ZONE v_tz;
  v_reset_at := v_tomorrow_start;

  -- Resolve account + entitlement
  v_account := public._rl_resolve_student_account(p_student_user_id, p_account_id);
  v_entitled := public._rl_has_active_entitlement(p_student_user_id);
  v_counts_toward_limit := NOT v_entitled;

  -- Today's submitted practice answers (Doc 02B §13 "Quota Check Mechanism"). One row per
  -- answered item: an idempotent replay re-reads the same row, a served or skipped item
  -- never reaches 'answered'.
  SELECT count(*)::integer
  INTO v_used
  FROM public.practice_session_items psi
  WHERE psi.user_id = p_student_user_id
    AND psi.status = 'answered'
    AND psi.answered_at >= v_today_start
    AND psi.answered_at < v_tomorrow_start;

  -- Daily cap check (unpaid only) — the one branch the dry run and the serve share.
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

  -- Per-session cap (paid users) — unchanged: counted over the session's serve ledger rows.
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

  -- Idempotency: dedupe the serve log on session_item_id
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

  -- Serve log row: feeds the paid per-session cap; the free daily count does not read it.
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

  -- A serve consumes no free quota (Doc 02B §13): only the paid session count steps.
  IF NOT v_counts_toward_limit THEN
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

-- ACL as 20260630000000 §5 (CREATE OR REPLACE keeps it; restated so this file stands alone).
REVOKE ALL ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) TO service_role;

COMMIT;
