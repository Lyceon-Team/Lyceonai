-- ===========================================================================
-- Home QOTD brief, Part B: the Question of the Day on Home, the daily streak, the daily email.
--
-- @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
--       (Karl, decisions 2026-10-08/09) Part B "Rules (locked)", "Data", "API", "Daily email";
--       SCL-224 (the QOTD as a practice source and its exclusion from the free daily quota,
--       against Doc 02B §13 / SCL-209); SCL-225 (consent purpose `qotd_daily_email`);
--       docs/plans/seo/seo-marketing-vertical.md Q1 (qotd_schedule is SEO-owned: READ here,
--       never written)] | @implemented [2026-10-09]
--
-- plain English:
--  1. A signed-in student's QOTD answer IS a practice answer. `qotd_student_answer` does, in
--     ONE transaction: a one-item practice session of mode `qotd`, its item served then
--     answered exactly as the practice answer path writes it (so the existing review trigger
--     queues a miss), and one `student_qotd_attempts` row. A replay of the same idempotency
--     key returns the original; a different answer the same Chicago day is a conflict. The
--     mastery event is emitted by the server after commit through the same call the practice
--     path makes (best-effort, as there). The day is the server's: today in America/Chicago,
--     and only today's scheduled question is accepted.
--  2. The free daily 40 never counts a `qotd` session (check_and_reserve_practice_quota,
--     body otherwise identical to 20261024000000).
--  3. `student_streak` is THE streak: consecutive Chicago days with at least one answered
--     question from any source (practice incl. QOTD and diagnostic, review, full-length),
--     ending today or yesterday. Read-only, computed at read time, nothing stored.
--  4. The daily email: per-student preferences (consent, prompt state, unsubscribe, pause),
--     a send ledger written BEFORE the send (one row per student per Chicago day), and the
--     candidate read the daily email job uses. Consent is logged in marketing_consent_log with the
--     new purpose `qotd_daily_email` and a version.
--  5. Every new table keys on profiles(id) ON DELETE CASCADE, so account deletion removes the
--     attempts, sends and preferences (the FK delete-action guard classifies them).
--
-- Replaced bodies: check_and_reserve_practice_quota (was 20261024000000),
-- practice_session_mode_to_event_kind (was 20260806000000). No mutation plant targets either
-- (checked: scripts/ci/*.mutations.sh).
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Practice mode `qotd` and the quota exclusion (SCL-224)
-- ---------------------------------------------------------------------------
ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_mode_check;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_mode_check
  CHECK (mode IN ('flow', 'structured', 'balanced', 'timed', 'diagnostic', 'qotd'));

-- Mastery reads every answered practice item through practice_session_mode_to_event_kind, which
-- RAISEs on an unmapped mode — so without this a student's first QOTD answer would make every
-- later mastery computation for that skill fail. A QOTD answer is a practice answer (SCL-224):
-- 'practice_attempt'. Body otherwise identical to 20260806000000; packages/shared
-- session-mode.ts SESSION_MODES_DB lists 'qotd' in the same change (the two stay in step).
CREATE OR REPLACE FUNCTION public.practice_session_mode_to_event_kind(p_mode text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Explicit mapping: every recognized mode → its event_source_kind.
  -- flow/structured/balanced/timed are practice modes (Doc-02B §14).
  -- diagnostic is the 40-question initial diagnostic (Doc-05A §11).
  -- qotd is the Home Question of the Day, a one-item practice session (SCL-224).
  CASE p_mode
    WHEN 'flow'       THEN RETURN 'practice_attempt';
    WHEN 'structured' THEN RETURN 'practice_attempt';
    WHEN 'balanced'   THEN RETURN 'practice_attempt';
    WHEN 'timed'      THEN RETURN 'practice_attempt';
    WHEN 'qotd'       THEN RETURN 'practice_attempt';
    WHEN 'diagnostic' THEN RETURN 'diagnostic_attempt';
    ELSE RAISE EXCEPTION 'MASTERY_UNRECOGNIZED_SESSION_MODE: practice_sessions.mode=''%'' has no event_source_kind mapping — add it to practice_session_mode_to_event_kind()', p_mode;
  END CASE;
END;
$function$;
REVOKE ALL ON FUNCTION public.practice_session_mode_to_event_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_session_mode_to_event_kind(text) TO service_role;

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
    -- SCL-224: a Question of the Day answer is practice for mastery and review, but it
    -- never uses the free daily 40.
    AND ps.mode NOT IN ('diagnostic', 'qotd');

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

REVOKE ALL ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_qotd_attempts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qotd_date                date        NOT NULL,
  question_id              text        NOT NULL,
  practice_session_item_id uuid        NOT NULL REFERENCES public.practice_session_items(id) ON DELETE CASCADE,
  selected_answer          text        NOT NULL CHECK (char_length(selected_answer) BETWEEN 1 AND 64),
  is_correct               boolean     NOT NULL,
  answered_at              timestamptz NOT NULL DEFAULT now(),
  idempotency_key          text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT student_qotd_attempts_one_per_day UNIQUE (student_id, qotd_date),
  CONSTRAINT student_qotd_attempts_idempotency UNIQUE (idempotency_key)
);
COMMENT ON TABLE public.student_qotd_attempts IS
  'Home QOTD: one signed-in student answer per America/Chicago day. selected_answer is the canonical option key. The answer itself is the linked practice_session_items row (mode qotd). ON DELETE CASCADE from profiles.';
ALTER TABLE public.student_qotd_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_qotd_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.student_qotd_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Email preferences, prompt state and the send ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_qotd_email_prefs (
  student_id         uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  consented          boolean     NOT NULL DEFAULT false,
  consent_version    text        NULL CHECK (consent_version IS NULL OR consent_version ~ '^\d+\.\d+\.\d+$'),
  consented_at       timestamptz NULL,
  ask_count          integer     NOT NULL DEFAULT 0 CHECK (ask_count >= 0),
  last_asked_on      date        NULL,
  last_decided_on    date        NULL,
  never_ask          boolean     NOT NULL DEFAULT false,
  unsubscribed_at    timestamptz NULL,
  paused_at          timestamptz NULL,
  run_since          date        NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qotd_email_prefs_consent_versioned CHECK (consented = false OR consent_version IS NOT NULL)
);
COMMENT ON TABLE public.student_qotd_email_prefs IS
  'Home QOTD daily email: consent state, the server-side prompt state (asks, last asked, never-ask), unsubscribe and sunset pause. ON DELETE CASCADE from profiles.';
ALTER TABLE public.student_qotd_email_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_qotd_email_prefs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.student_qotd_email_prefs TO service_role;

CREATE TABLE IF NOT EXISTS public.qotd_email_sends (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  send_date           date        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('daily', 'paused_notice')),
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz NULL,
  CONSTRAINT qotd_email_sends_one_per_day UNIQUE (student_id, send_date)
);
COMMENT ON TABLE public.qotd_email_sends IS
  'Home QOTD daily email ledger: one row per student per America/Chicago day, written BEFORE the send so a retry or an overlapping run cannot send twice. ON DELETE CASCADE from profiles.';
ALTER TABLE public.qotd_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qotd_email_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.qotd_email_sends TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Consent purpose (SCL-225)
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketing_consent_log
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'marketing';
ALTER TABLE public.marketing_consent_log DROP CONSTRAINT IF EXISTS marketing_consent_log_purpose_check;
ALTER TABLE public.marketing_consent_log ADD CONSTRAINT marketing_consent_log_purpose_check
  CHECK (purpose IN ('marketing', 'qotd_daily_email'));
ALTER TABLE public.marketing_consent_log DROP CONSTRAINT IF EXISTS marketing_consent_log_source_check;
ALTER TABLE public.marketing_consent_log ADD CONSTRAINT marketing_consent_log_source_check
  CHECK (source IN (
    'signup', 'settings', 'backfill', 'age_clear', 'system',
    'email_unsubscribe', 'email_complaint', 'qotd_prompt'
  ));
COMMENT ON COLUMN public.marketing_consent_log.purpose IS
  'SCL-225: what the consent is for. marketing = profiles.marketing_opt_in (product updates and study news); qotd_daily_email = the daily Question of the Day email.';

-- ---------------------------------------------------------------------------
-- 5. Day helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chicago_day(p_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT (p_at AT TIME ZONE 'America/Chicago')::date;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The answer (one transaction)
-- ---------------------------------------------------------------------------
-- Returns {status: 'created'|'replay'|'conflict'|'not_today', ...}. p_item is the snapshot the
-- server built with the practice path's own builder (buildSessionItemInsertRows), so the item
-- carries exactly the columns any practice item carries.
CREATE OR REPLACE FUNCTION public.qotd_student_answer(
  p_student_id      uuid,
  p_actor_id        uuid,
  p_qotd_date       date,
  p_question_id     text,
  p_item            jsonb,
  p_selected_answer text,
  p_is_correct      boolean,
  p_idempotency_key text,
  p_now             timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing public.student_qotd_attempts%ROWTYPE;
  v_session  uuid;
  v_item     uuid;
BEGIN
  IF p_qotd_date IS DISTINCT FROM public.chicago_day(p_now) THEN
    RETURN jsonb_build_object('status', 'not_today');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.qotd_schedule s
     WHERE s.qotd_date = p_qotd_date AND s.question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('status', 'not_today');
  END IF;

  -- One writer per student per day.
  PERFORM pg_advisory_xact_lock(hashtextextended('qotd_student_answer:' || p_student_id::text || ':' || p_qotd_date::text, 0));

  SELECT * INTO v_existing FROM public.student_qotd_attempts
   WHERE student_id = p_student_id AND qotd_date = p_qotd_date;
  IF FOUND THEN
    IF v_existing.idempotency_key = p_idempotency_key THEN
      RETURN jsonb_build_object(
        'status', 'replay',
        'practice_session_item_id', v_existing.practice_session_item_id,
        'selected_answer', v_existing.selected_answer,
        'is_correct', v_existing.is_correct,
        'answered_at', v_existing.answered_at
      );
    END IF;
    RETURN jsonb_build_object('status', 'conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_qotd_attempts WHERE idempotency_key = p_idempotency_key) THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  INSERT INTO public.practice_sessions
    (user_id, actor_id, mode, filters, target_count, platform, status,
     created_at, updated_at, last_activity_at, completed_at)
  VALUES
    (p_student_id, p_actor_id, 'qotd',
     jsonb_build_object('source', 'qotd', 'qotd_date', p_qotd_date,
                        'session_start_idempotency_key', p_idempotency_key),
     1, 'web', 'active', p_now, p_now, p_now, NULL)
  RETURNING id INTO v_session;

  INSERT INTO public.practice_session_items (
    session_id, user_id, actor_id, ordinal, question_id,
    question_stem, question_passage, question_options, question_correct_answer,
    question_explanation, question_option_metadata, question_domain, question_skill,
    question_difficulty, question_section, question_item_type, question_correct_variants,
    question_assets, question_estimated_time_seconds, option_order, option_token_map,
    status, served_at
  ) VALUES (
    v_session, p_student_id, p_actor_id, 1, p_question_id,
    p_item->>'question_stem', p_item->>'question_passage', p_item->'question_options',
    p_item->>'question_correct_answer', p_item->>'question_explanation',
    p_item->'question_option_metadata', p_item->>'question_domain', p_item->>'question_skill',
    (p_item->>'question_difficulty')::smallint, p_item->>'question_section',
    p_item->>'question_item_type',
    CASE WHEN jsonb_typeof(p_item->'question_correct_variants') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_item->'question_correct_variants')) END,
    p_item->'question_assets', (p_item->>'question_estimated_time_seconds')::integer,
    CASE WHEN jsonb_typeof(p_item->'option_order') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_item->'option_order')) END,
    p_item->'option_token_map',
    'served', p_now
  ) RETURNING id INTO v_item;

  -- The practice answer path's own write (practice-canonical.ts submitPracticeAnswer): the
  -- AFTER UPDATE review trigger queues a miss exactly as it does for any practice item.
  UPDATE public.practice_session_items
     SET status = 'answered',
         selected_answer = p_selected_answer,
         is_correct = p_is_correct,
         outcome = CASE WHEN p_is_correct THEN 'correct' ELSE 'incorrect' END,
         answered_at = p_now,
         occurred_at = p_now,
         client_attempt_id = p_idempotency_key
   WHERE id = v_item AND status = 'served';

  UPDATE public.practice_sessions
     SET status = 'completed', completed_at = p_now, updated_at = p_now, last_activity_at = p_now
   WHERE id = v_session;

  INSERT INTO public.student_qotd_attempts
    (student_id, qotd_date, question_id, practice_session_item_id, selected_answer,
     is_correct, answered_at, idempotency_key)
  VALUES
    (p_student_id, p_qotd_date, p_question_id, v_item, p_selected_answer,
     p_is_correct, p_now, p_idempotency_key);

  RETURN jsonb_build_object(
    'status', 'created',
    'practice_session_id', v_session,
    'practice_session_item_id', v_item,
    'selected_answer', p_selected_answer,
    'is_correct', p_is_correct,
    'answered_at', p_now
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. The streak (read-only)
-- ---------------------------------------------------------------------------
-- Chicago days on which the student answered at least one question, from every source.
-- A skip is not an answer. Bounded to 400 days back; a longer run reads as 400+.
CREATE OR REPLACE FUNCTION public.student_answer_days(p_student_id uuid, p_since date)
RETURNS TABLE (day date)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT DISTINCT public.chicago_day(i.occurred_at)
    FROM public.practice_session_items i
   WHERE i.user_id = p_student_id AND i.status = 'answered' AND i.occurred_at IS NOT NULL
     AND i.occurred_at >= (p_since::timestamp AT TIME ZONE 'America/Chicago')
  UNION
  SELECT DISTINCT public.chicago_day(COALESCE(r.occurred_at, r.answered_at))
    FROM public.review_session_items r
   WHERE r.student_id = p_student_id AND r.status = 'answered'
     AND COALESCE(r.occurred_at, r.answered_at) >= (p_since::timestamp AT TIME ZONE 'America/Chicago')
  UNION
  SELECT DISTINCT public.chicago_day(a.created_at)
    FROM public.test_answer_submissions a
    JOIN public.test_sessions t ON t.id = a.test_session_id
   WHERE t.student_id = p_student_id AND a.answer IS NOT NULL
     AND a.created_at >= (p_since::timestamp AT TIME ZONE 'America/Chicago');
$fn$;

CREATE OR REPLACE FUNCTION public.student_streak(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS TABLE (current_streak integer, today_done boolean, broken boolean)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH today AS (SELECT public.chicago_day(p_now) AS d),
  days AS (
    SELECT day FROM public.student_answer_days(p_student_id, (SELECT d FROM today) - 400)
     WHERE day <= (SELECT d FROM today)
  ),
  anchor AS (
    -- The run ends today if today has an answer, else yesterday if yesterday has one.
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM days WHERE day = (SELECT d FROM today)) THEN (SELECT d FROM today)
             WHEN EXISTS (SELECT 1 FROM days WHERE day = (SELECT d FROM today) - 1) THEN (SELECT d FROM today) - 1
           END AS d
  ),
  run AS (
    -- Consecutive days back from the anchor: the anchor minus k is in the set for k = 0..n-1.
    SELECT count(*)::integer AS n
      FROM generate_series(0, 400) AS k
     WHERE (SELECT d FROM anchor) IS NOT NULL
       AND k < COALESCE((
             SELECT min(g) FROM generate_series(0, 401) AS g
              WHERE NOT EXISTS (SELECT 1 FROM days WHERE day = (SELECT d FROM anchor) - g)
           ), 401)
  )
  SELECT (SELECT n FROM run),
         EXISTS (SELECT 1 FROM days WHERE day = (SELECT d FROM today)),
         (SELECT n FROM run) = 0 AND EXISTS (SELECT 1 FROM days);
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Prompt and consent
-- ---------------------------------------------------------------------------
-- Whether the email prompt may be shown to this student at all (13+ by date of birth, a
-- student, not already consented, never-ask not chosen).
CREATE OR REPLACE FUNCTION public.qotd_email_prompt_state(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'eligible', COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)
                AND p.role = 'student' AND p.deleted_at IS NULL,
    'consented', COALESCE(e.consented, false) AND e.unsubscribed_at IS NULL,
    'never_ask', COALESCE(e.never_ask, false),
    'ask_count', COALESCE(e.ask_count, 0),
    'last_asked_on', e.last_asked_on,
    'last_decided_on', e.last_decided_on,
    'today', public.chicago_day(p_now)
  )
    FROM public.profiles p
    LEFT JOIN public.student_qotd_email_prefs e ON e.student_id = p.id
   WHERE p.id = p_student_id;
$fn$;

-- Counts one ask, at most once per Chicago day. Returns the ask count after.
CREATE OR REPLACE FUNCTION public.qotd_email_record_ask(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today date := public.chicago_day(p_now);
  v_count integer;
BEGIN
  INSERT INTO public.student_qotd_email_prefs (student_id, ask_count, last_asked_on, updated_at)
  VALUES (p_student_id, 1, v_today, p_now)
  ON CONFLICT (student_id) DO UPDATE
     SET ask_count = public.student_qotd_email_prefs.ask_count
                     + CASE WHEN public.student_qotd_email_prefs.last_asked_on IS DISTINCT FROM v_today THEN 1 ELSE 0 END,
         last_asked_on = v_today,
         updated_at = p_now
  RETURNING ask_count INTO v_count;
  RETURN v_count;
END;
$fn$;

-- decision: grant | not_now | never. Returns {ok, reason?}.
CREATE OR REPLACE FUNCTION public.set_qotd_email_consent(
  p_student_id      uuid,
  p_decision        text,
  p_consent_version text,
  p_now             timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_state jsonb := public.qotd_email_prompt_state(p_student_id, p_now);
  v_today date := public.chicago_day(p_now);
BEGIN
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_missing');
  END IF;
  IF p_decision NOT IN ('grant', 'not_now', 'never') THEN
    RAISE EXCEPTION 'set_qotd_email_consent: unknown decision %', p_decision
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT (v_state->>'eligible')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ineligible');
  END IF;

  IF p_decision = 'grant' THEN
    IF NULLIF(btrim(COALESCE(p_consent_version, '')), '') IS NULL THEN
      RAISE EXCEPTION 'set_qotd_email_consent: a grant requires a consent version'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO public.student_qotd_email_prefs
      (student_id, consented, consent_version, consented_at, last_decided_on,
       unsubscribed_at, paused_at, updated_at)
    VALUES (p_student_id, true, p_consent_version, p_now, v_today, NULL, NULL, p_now)
    ON CONFLICT (student_id) DO UPDATE
       SET consented = true, consent_version = EXCLUDED.consent_version,
           consented_at = p_now, last_decided_on = v_today,
           unsubscribed_at = NULL, paused_at = NULL, run_since = v_today, updated_at = p_now;
    IF NOT (v_state->>'consented')::boolean THEN
      INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version, purpose, captured_at)
      VALUES (p_student_id, true, 'qotd_prompt', p_consent_version, 'qotd_daily_email', p_now);
    END IF;
    RETURN jsonb_build_object('ok', true, 'changed', NOT (v_state->>'consented')::boolean);
  END IF;

  IF p_decision = 'never' AND COALESCE((v_state->>'ask_count')::integer, 0) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'never_not_offered');
  END IF;

  INSERT INTO public.student_qotd_email_prefs (student_id, last_decided_on, never_ask, updated_at)
  VALUES (p_student_id, v_today, p_decision = 'never', p_now)
  ON CONFLICT (student_id) DO UPDATE
     SET last_decided_on = v_today,
         never_ask = public.student_qotd_email_prefs.never_ask OR (p_decision = 'never'),
         updated_at = p_now;
  RETURN jsonb_build_object('ok', true, 'changed', false);
END;
$fn$;

-- The one-click unsubscribe (the signed link carries only the student id; the signature is
-- checked by the server). Idempotent.
CREATE OR REPLACE FUNCTION public.qotd_email_unsubscribe(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_was boolean;
BEGIN
  SELECT consented AND unsubscribed_at IS NULL INTO v_was
    FROM public.student_qotd_email_prefs WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;
  UPDATE public.student_qotd_email_prefs
     SET consented = false, unsubscribed_at = COALESCE(unsubscribed_at, p_now),
         -- An unsubscribe is also "don't ask again": the prompt never re-asks someone who left.
         never_ask = true, updated_at = p_now
   WHERE student_id = p_student_id;
  IF v_was THEN
    INSERT INTO public.marketing_consent_log (profile_id, granted, source, consent_version, purpose, captured_at)
    VALUES (p_student_id, false, 'email_unsubscribe', NULL, 'qotd_daily_email', p_now);
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', COALESCE(v_was, false));
END;
$fn$;

-- Resume after the sunset pause (the link in the paused email). Consent is unchanged.
CREATE OR REPLACE FUNCTION public.qotd_email_resume(p_student_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  WITH r AS (
    UPDATE public.student_qotd_email_prefs
       SET paused_at = NULL, run_since = public.chicago_day(p_now), updated_at = p_now
     WHERE student_id = p_student_id AND paused_at IS NOT NULL AND consented AND unsubscribed_at IS NULL
    RETURNING 1
  )
  SELECT jsonb_build_object('ok', true, 'changed', EXISTS (SELECT 1 FROM r));
$fn$;

-- ---------------------------------------------------------------------------
-- 9. The daily email: candidates, claim, record
-- ---------------------------------------------------------------------------
-- Consented, 13+, a student, not deleted, not unsubscribed, not paused, has not answered any
-- question today, has no send today, and today has a question. `unanswered_run` is the number
-- of consecutive previous sends after which the student did not answer that day: at 7 the job
-- sends the pause notice instead of the question (the sunset).
CREATE OR REPLACE FUNCTION public.qotd_email_candidates(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS TABLE (student_id uuid, email text, current_streak integer, unanswered_run integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH today AS (SELECT public.chicago_day(p_now) AS d)
  SELECT e.student_id,
         p.email,
         (SELECT s.current_streak FROM public.student_streak(e.student_id, p_now) s),
         (
           -- The leading run of unanswered sends, most recent first, since the student last
           -- granted or resumed (`run_since`). At most 7 are read: 7 is the sunset.
           SELECT COALESCE(min(t.rn) FILTER (WHERE t.answered) - 1, count(*))::integer
             FROM (
               SELECT row_number() OVER (ORDER BY x.send_date DESC) AS rn,
                      EXISTS (SELECT 1 FROM public.student_answer_days(e.student_id, x.send_date) a
                               WHERE a.day = x.send_date) AS answered
                 FROM public.qotd_email_sends x
                WHERE x.student_id = e.student_id AND x.kind = 'daily' AND x.status = 'sent'
                  AND x.send_date < (SELECT d FROM today)
                  AND x.send_date >= COALESCE(e.run_since, x.send_date)
                ORDER BY x.send_date DESC
                LIMIT 7
             ) t
         )
    FROM public.student_qotd_email_prefs e
    JOIN public.profiles p ON p.id = e.student_id
   WHERE e.consented AND e.unsubscribed_at IS NULL AND e.paused_at IS NULL
     AND p.role = 'student' AND p.deleted_at IS NULL
     AND public.marketing_opt_in_age_eligible(p.date_of_birth)
     AND EXISTS (SELECT 1 FROM public.qotd_schedule q WHERE q.qotd_date = (SELECT d FROM today))
     AND NOT EXISTS (SELECT 1 FROM public.qotd_email_sends s
                      WHERE s.student_id = e.student_id AND s.send_date = (SELECT d FROM today))
     AND NOT EXISTS (SELECT 1 FROM public.student_answer_days(e.student_id, (SELECT d FROM today)) a
                      WHERE a.day = (SELECT d FROM today))
     AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests r
                      WHERE r.profile_id = e.student_id AND r.status = 'pending')
   ORDER BY e.student_id
   LIMIT p_limit;
$fn$;

-- Claims today's one send for this student BEFORE anything is sent. Returns the send id, or
-- NULL when another run already claimed it. A pause notice also pauses the student.
CREATE OR REPLACE FUNCTION public.qotd_email_claim(p_student_id uuid, p_kind text, p_now timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.qotd_email_sends (student_id, send_date, kind, status, created_at)
  VALUES (p_student_id, public.chicago_day(p_now), p_kind, 'pending', p_now)
  ON CONFLICT (student_id, send_date) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL AND p_kind = 'paused_notice' THEN
    UPDATE public.student_qotd_email_prefs
       SET paused_at = p_now, updated_at = p_now
     WHERE student_id = p_student_id;
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.qotd_email_record(
  p_send_id uuid, p_ok boolean, p_provider_message_id text, p_now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.qotd_email_sends
     SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         provider_message_id = p_provider_message_id,
         sent_at = CASE WHEN p_ok THEN p_now END
   WHERE id = p_send_id AND status = 'pending';
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Rate-limit buckets (RateLimitLedger, per profile)
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'qotd_student_read',    jsonb_build_object('limit', 240, 'window_seconds', 3600),
      'qotd_student_answer',  jsonb_build_object('limit', 20,  'window_seconds', 3600),
      'qotd_email_consent',   jsonb_build_object('limit', 20,  'window_seconds', 3600),
      'qotd_unsubscribe_ip',  jsonb_build_object('limit', 30,  'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
     WHERE key = 'bucket_definitions'
       AND value ? 'qotd_student_read' AND value ? 'qotd_student_answer'
       AND value ? 'qotd_email_consent' AND value ? 'qotd_unsubscribe_ip'
  ) THEN
    RAISE EXCEPTION 'home qotd migration: bucket_definitions row missing; the qotd_* student buckets were not seeded';
  END IF;
END
$rl$;

-- ---------------------------------------------------------------------------
-- 11. Privileges: service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.chicago_day(timestamptz),
  public.qotd_student_answer(uuid, uuid, date, text, jsonb, text, boolean, text, timestamptz),
  public.student_answer_days(uuid, date),
  public.student_streak(uuid, timestamptz),
  public.qotd_email_prompt_state(uuid, timestamptz),
  public.qotd_email_record_ask(uuid, timestamptz),
  public.set_qotd_email_consent(uuid, text, text, timestamptz),
  public.qotd_email_unsubscribe(uuid, timestamptz),
  public.qotd_email_resume(uuid, timestamptz),
  public.qotd_email_candidates(timestamptz, integer),
  public.qotd_email_claim(uuid, text, timestamptz),
  public.qotd_email_record(uuid, boolean, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.chicago_day(timestamptz),
  public.qotd_student_answer(uuid, uuid, date, text, jsonb, text, boolean, text, timestamptz),
  public.student_answer_days(uuid, date),
  public.student_streak(uuid, timestamptz),
  public.qotd_email_prompt_state(uuid, timestamptz),
  public.qotd_email_record_ask(uuid, timestamptz),
  public.set_qotd_email_consent(uuid, text, text, timestamptz),
  public.qotd_email_unsubscribe(uuid, timestamptz),
  public.qotd_email_resume(uuid, timestamptz),
  public.qotd_email_candidates(timestamptz, integer),
  public.qotd_email_claim(uuid, text, timestamptz),
  public.qotd_email_record(uuid, boolean, text, timestamptz)
  TO service_role;

-- The functions are SECURITY INVOKER, so service_role writes through its own table rights.
GRANT INSERT ON TABLE public.student_qotd_attempts TO service_role;
GRANT INSERT, UPDATE ON TABLE public.student_qotd_email_prefs TO service_role;
GRANT INSERT, UPDATE ON TABLE public.qotd_email_sends TO service_role;

COMMIT;
