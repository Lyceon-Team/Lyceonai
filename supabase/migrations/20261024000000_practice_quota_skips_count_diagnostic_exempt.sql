-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Free daily practice quota: skipped questions count, diagnostic questions do not.
--
-- @spec [Owner ruling (Karl) 2026-10-05, student-UI register §9 OQ-50: "skips count,
--        diagnostic doesn't, SCL against Doc 02B" — SCL-209, which amends Doc-02B_V4 §13
--        "What Counts Against Quota" (a skip counts; diagnostic questions are excluded) and
--        "Quota Check Mechanism" (the window is on `occurred_at`), and reads §16's "Skipped
--        questions (served but not submitted)" as the review-entry rule it is, no longer as the
--        quota's definition of a skip; builds on owner ruling (Karl) 2026-10-03 OQ-43 / F-61
--        (Doc 02B §13 clock: America/Chicago midnight; one shared function for the 402 and the
--        quota read), migration 20261023000000]
-- | @implemented [2026-10-05]
--
-- plain English: 20261023000000 made the free daily count "today's ANSWERED practice items"
-- and, following Doc 02B literally, left skips and diagnostic answers on either side of the
-- line the owner has now drawn the other way (OQ-50). This replaces the body of
-- `check_and_reserve_practice_quota` so that:
--   - the free daily count is the student's `practice_session_items` rows with
--     `status IN ('answered','skipped')` — a skip uses a question, so a free student can no
--     longer page through unlimited stems by skipping them;
--   - the count is windowed on `occurred_at`, not `answered_at`: CHECK
--     `psi_resolved_requires_occurred_at` guarantees `occurred_at` on every answered or skipped
--     row, and nothing guarantees `answered_at` (the same switch mastery made in
--     20260921000000 and the calendar's practice adapter made 2026-09-22). Both are written
--     from one `now` by today's answer and skip writers, so no existing row moves day;
--   - rows of a `practice_sessions.mode = 'diagnostic'` session are excluded (joined on
--     `session_id`, NOT NULL with its FK): a diagnostic answer or skip consumes nothing;
--   - the serve of a diagnostic item is never refused by the free daily cap. The diagnostic
--     start (`POST /api/practice/diagnostic/sessions`) serves its first item without calling
--     this function, but items 2..N are served by the practice `GET /sessions/:id/next`, which
--     calls it with `p_session_id` (server/routes/practice-canonical.ts `serveNextForSession`
--     → `reservePracticeQuestionQuota`). Before this, a free student who had used the day's
--     quota was refused (402) mid-diagnostic. The exemption is decided here from the session
--     row itself (`id = p_session_id AND user_id = p_student_user_id AND mode = 'diagnostic'`),
--     never from a client claim; an unknown session or another student's session is not
--     exempt (fail closed).
-- Unchanged: the signature, ACL, identity guard, advisory lock, config reads and their
-- fail-closed errors, the America/Chicago local-day window and `reset_at`, the entitled bypass
-- of the daily cap, the paid per-session cap and its serve-log rows (diagnostic serves still
-- write one), the `practice:served:<item>` dedupe, every response key. A served-but-unresolved
-- item still counts zero, and a replayed answer is still one row. The dry run (session-start
-- pre-cap and its 402, `GET /api/practice/quota`, no session) and the serve share the one
-- count and the one cap branch, so they cannot disagree. Not ruled (OQ-50 (b)), so kept as it
-- was: an item already on screen when the limit is reached can still be answered or skipped,
-- since `/answer` and `/skip` never call this function.
--
-- Additive: CREATE OR REPLACE of one function body. No table, column, constraint, index or
-- row is created, altered or written.
--
-- ROLLBACK (restores the answered-only, diagnostic-counted rule of OQ-43):
--   re-run 20261023000000_practice_quota_chicago_submitted.sql (its CREATE OR REPLACE of
--   public.check_and_reserve_practice_quota and its REVOKE/GRANT). Nothing else to revert.
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
  v_diagnostic_session boolean := false;
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

  -- A diagnostic serve is never refused by the free daily cap (OQ-50, Karl 2026-10-05). Read
  -- from the student's own session row; an unknown or foreign session is not exempt.
  IF p_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.practice_sessions ps
      WHERE ps.id = p_session_id
        AND ps.user_id = p_student_user_id
        AND ps.mode = 'diagnostic'
    )
    INTO v_diagnostic_session;
  END IF;

  -- Today's resolved practice questions (Doc 02B §13 as amended by SCL-209 / OQ-50): one row
  -- per answered OR skipped item, dated by `occurred_at` (CHECK-guaranteed on both), outside
  -- diagnostic sessions. An idempotent replay re-reads the same row; a served item that is
  -- neither answered nor skipped counts zero.
  SELECT count(*)::integer
  INTO v_used
  FROM public.practice_session_items psi
  JOIN public.practice_sessions ps ON ps.id = psi.session_id
  WHERE psi.user_id = p_student_user_id
    AND psi.status IN ('answered', 'skipped')
    AND psi.occurred_at >= v_today_start
    AND psi.occurred_at < v_tomorrow_start
    AND ps.mode <> 'diagnostic';

  -- Daily cap check (unpaid only) — the one branch the dry run and the serve share; a
  -- diagnostic serve passes it.
  IF v_counts_toward_limit AND NOT v_diagnostic_session AND v_used >= v_daily_limit THEN
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
