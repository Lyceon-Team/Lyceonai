-- ============================================================================
-- WS-2/WS-3 — Config-constants foundation (operational config; SP-05 resolution)
-- ============================================================================
-- @spec [Doc-02B_V4 §16/§17/§18/§41] [Doc-03 §13/§24] [Doc-01A_V1 §2/§4/§5 config doctrine]
-- @implemented [2026-06-10]
-- plain English: seeds every OPERATIONAL engine constant the WS-2 (practice/review/exam)
--   and WS-5 (tutor) engines read, into DB *_runtime_config tables, with the EXACT values
--   the locked spec specifies — so engines read change-by-data, never hardcoded literals.
--   FORMULA-class constants (mastery source weights / level boundaries / scoring) are NOT
--   here — they live in mastery_constants/kpi_constants (B-W3-1) under no-recompute-on-change
--   governance (Doc 05D INV-05D-13); the two classes are kept strictly separate.
--   Config doctrine reused from genesis 01A (§2 template + per-table _history append-only +
--   notify_config_change). Doc 02B §41's single `constants_audit_log` is superseded by the
--   01A per-table-history pattern (Doc 00 §3 — 01A owns config doctrine) → SP-13.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`); agents hold no
--   service_role. Genesis-extending; the genesis-fresh-apply gate covers it.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Revert = the matching DOWN
--   (DROP the 5 tables + their _history + DELETE the seeded rate_limit_runtime_config
--   tutor-bucket keys); no forward-data destruction (CREATE/seed only).
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — DROP TABLE the 5 new config
--   tables + _history; DELETE tutor-bucket keys from rate_limit_runtime_config. CREATE/seed only.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create the 5 domain config tables (genesis 01A §2 template + _history + triggers)
-- ----------------------------------------------------------------------------
DO $cfg$
DECLARE
  cfg_names TEXT[] := ARRAY[
    'practice_runtime_config',        -- Doc 02B §41 (practice quota / sessions / freshness)
    'review_runtime_config',          -- Doc 02B §16/§41 (SM-2 review parameters)
    'exam_runtime_config',            -- Doc 02B §17/§41 (full-length timings)
    'full_length_adaptive_config',    -- Doc 02B §18/§41 (Module-2 routing)
    'tutor_context_runtime_config'    -- Doc 03 §13/§24 (tutor cost / cooldown / timeout)
  ];
  n TEXT;
BEGIN
  FOREACH n IN ARRAY cfg_names LOOP
    EXECUTE format($t$
      CREATE TABLE public.%I (
        key            TEXT PRIMARY KEY,
        value          JSONB NOT NULL,
        value_type     TEXT NOT NULL CHECK (value_type IN ('integer','string','boolean','array','object','float')),
        min_value      JSONB,
        max_value      JSONB,
        allowed_values JSONB,
        owner          TEXT NOT NULL,
        description    TEXT NOT NULL,
        environment    TEXT NOT NULL DEFAULT 'all' CHECK (environment IN ('all','development','staging','production')),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by_profile_id UUID REFERENCES public.profiles(id)
      );$t$, n);
    EXECUTE format($t$
      CREATE TABLE public.%I (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name           TEXT NOT NULL,
        key                  TEXT NOT NULL,
        old_value            JSONB,
        new_value            JSONB NOT NULL,
        changed_by_profile_id UUID REFERENCES public.profiles(id),
        change_reason        TEXT,
        changed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );$t$, n || '_history');
    EXECUTE format($t$CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();$t$, n || '_notify', n);
    EXECUTE format($t$CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();$t$, n || '_history_no_mutate', n || '_history');
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', n);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', n || '_history');
  END LOOP;
END;
$cfg$;

-- ----------------------------------------------------------------------------
-- 2. Seed — practice_runtime_config (Doc 02B §41; quota 40/day America/Chicago = GAP-ID-06)
-- ----------------------------------------------------------------------------
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description) VALUES
  ('daily_quota_free',             '40',                 'integer', 'product',     'Doc 02B §41: practice questions/day, free tier'),
  ('quota_reset_timezone',         '"America/Chicago"',  'string',  'product',     'Doc 02B §41: daily quota reset timezone'),
  ('default_session_count_web',    '20',                 'integer', 'product',     'Doc 02B §41: default session target (web)'),
  ('default_session_count_mobile', '10',                 'integer', 'product',     'Doc 02B §41: default session target (mobile)'),
  ('max_session_count_premium',    '60',                 'integer', 'product',     'Doc 02B §41: max session target (premium)'),
  ('inactivity_timeout_hours',     '24',                 'integer', 'engineering', 'Doc 02B §41: hours before practice session timeout'),
  ('recency_window_days',          '14',                 'integer', 'product',     'Doc 02B §41: recent-seen freshness window'),
  ('session_presets',              '[5,10,15,20]',       'array',   'product',     'Doc 02B §41: preset session-count buttons');

-- ----------------------------------------------------------------------------
-- 3. Seed — review_runtime_config (Doc 02B §16; SM-2; launch graduation = 1)
-- ----------------------------------------------------------------------------
INSERT INTO public.review_runtime_config (key, value, value_type, owner, description) VALUES
  ('sm2_initial_interval_days',       '1',    'integer', 'product',     'Doc 02B §16: interval after 1st successful retrieval'),
  ('sm2_second_interval_days',        '6',    'integer', 'product',     'Doc 02B §16: interval after 2nd successful retrieval'),
  ('sm2_initial_ease_factor',         '2.5',  'float',   'product',     'Doc 02B §16: SM-2 starting ease factor'),
  ('sm2_ease_factor_min',             '1.3',  'float',   'product',     'Doc 02B §16: SM-2 ease-factor floor'),
  ('sm2_ease_factor_max',             '2.5',  'float',   'product',     'Doc 02B §16: SM-2 ease-factor ceiling'),
  ('sm2_graduation_repetition_count', '1',    'integer', 'product',     'Doc 02B §16: consecutive successes to graduate (launch=1; target=5)'),
  ('tutor_assisted_equivalence',      'true', 'boolean', 'product',     'Doc 02B §16/CR-02B-16: tutor-assisted correct = unaided for SM-2');

-- ----------------------------------------------------------------------------
-- 4. Seed — exam_runtime_config (Doc 02B §17; reconnect grace LOCKED 0)
-- ----------------------------------------------------------------------------
INSERT INTO public.exam_runtime_config (key, value, value_type, owner, description) VALUES
  ('rw_section_duration_seconds',   '3840', 'integer', 'product',     'Doc 02B §17: Reading & Writing duration (64 min)'),
  ('math_section_duration_seconds', '4200', 'integer', 'product',     'Doc 02B §17: Math duration (70 min)'),
  ('break_duration_seconds',        '600',  'integer', 'product',     'Doc 02B §17: between-section break (10 min)'),
  ('reconnect_grace_seconds',       '0',    'integer', 'engineering', 'Doc 02B §17: reconnect grace (integrity LOCKED at 0)'),
  ('exam_session_abandon_hours',    '24',   'integer', 'engineering', 'Doc 02B §17: hours before auto-abandon if unstarted');

-- ----------------------------------------------------------------------------
-- 5. Seed — full_length_adaptive_config (Doc 02B §18; Module-2 thresholds PENDING)
--    rw_m1_threshold_raw_score / math_m1_threshold_raw_score are PENDING a product
--    decision in the spec → NOT seeded (do not invent). Tracked: full-length build wave.
-- ----------------------------------------------------------------------------
INSERT INTO public.full_length_adaptive_config (key, value, value_type, owner, description) VALUES
  ('tie_break_rule',         '"route_easier"',        'string', 'product', 'Doc 02B §18: tie-break at exact M1 threshold'),
  ('module_2_variant_labels','["easier","harder"]',   'array',  'product', 'Doc 02B §18: Module-2 variant labels (never disclosed to client)'),
  ('config_version',         '"v1"',                  'string', 'product', 'Doc 02B §18: adaptive config version (audit trail)');

-- ----------------------------------------------------------------------------
-- 6. Seed — tutor_context_runtime_config (Doc 03 §24 cost; §13.6 cooldown; §21 timeout)
-- ----------------------------------------------------------------------------
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description) VALUES
  ('cost_soft_alert_usd_month',                  '10',   'integer', 'product',     'Doc 03 §24.2: per-student/month soft cost alert'),
  ('cost_hard_alert_usd_month',                  '18',   'integer', 'product',     'Doc 03 §24.2: per-student/month hard cost alert'),
  ('cost_hard_cap_usd_month',                    '20',   'integer', 'product',     'Doc 03 §24.2: per-student/month enforced ceiling'),
  ('vertex_pro_daily_budget_usd',                '200',  'integer', 'engineering', 'Doc 03C §5.3.3: Vertex Pro daily budget ceiling (USD)'),
  ('vertex_pro_budget_circuit_breaker_enabled',  'true', 'boolean', 'engineering', 'Doc 03C §5.3.3: Pro budget circuit breaker'),
  ('vertex_pro_budget_circuit_breaker_warning_pct','80', 'integer', 'engineering', 'Doc 03C §5.3.3: circuit-breaker warning at % of daily budget'),
  ('per_question_cooldown_minutes',              '5',    'integer', 'product',     'Doc 03 §13.6: per-question cooldown after 3 LISA-assisted fails'),
  ('tutor_request_timeout_seconds',              '30',   'integer', 'engineering', 'Doc 03 §21: max wait for a tutor response'),
  ('conversation_reuse_days',                    '7',    'integer', 'product',     'Doc 03B: tutor conversation freshness/reuse window');

-- ----------------------------------------------------------------------------
-- 7. Seed — tutor turn/burst caps into the EXISTING genesis rate_limit_runtime_config
--    (Doc 03 §13.1 V1-locked hard limits; the rate-limit ledger reads these).
--    NOTE: Doc 03 Main §13.1 lists a per-hour=60 hard cap; Doc 03B §15.2's bucket table
--    enumerates 60s/5min/day/week/month but not an explicit hourly bucket → SP-14.
-- ----------------------------------------------------------------------------
INSERT INTO public.rate_limit_runtime_config (key, value, value_type, owner, description) VALUES
  ('tutor_burst_60s',                 '12',    'integer', 'product', 'Doc 03 §13.1: tutor messages / 60s (hard; soft 10)'),
  ('tutor_burst_5min',                '30',    'integer', 'product', 'Doc 03B §15.2: tutor messages / 5min'),
  ('tutor_turns_hourly',              '60',    'integer', 'product', 'Doc 03 §13.1: tutor messages / hour (hard; soft 48) — see SP-14'),
  ('tutor_turns_daily',               '120',   'integer', 'product', 'Doc 03 §13.1: tutor messages / day (hard; soft 96)'),
  ('tutor_turns_weekly',              '2500',  'integer', 'product', 'Doc 03 §13.1: tutor messages / week (hard; soft 2000)'),
  ('tutor_turns_monthly',             '10000', 'integer', 'product', 'Doc 03 §13.1: tutor messages / month (hard; soft 8000)'),
  ('tutor_quota_warning_threshold_pct','80',   'integer', 'product', 'Doc 03B §15.3: soft-warning at % of a hard cap');

-- ----------------------------------------------------------------------------
-- 8. Grants — service-role only (config is admin/ops-mutable; no anon/authenticated)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.practice_runtime_config, public.review_runtime_config, public.exam_runtime_config,
  public.full_length_adaptive_config, public.tutor_context_runtime_config
  TO service_role;

COMMIT;
