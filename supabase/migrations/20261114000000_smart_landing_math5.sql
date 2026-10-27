-- ===========================================================================
-- Smart landing: `set_math_5` replaces the two multi-section sets.
--
-- @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26, the day
--       the rotation went on): (1) a new arm `set_math_5`, a 5-question Math-only set, first 2
--       items easy or medium, already on Q1, replacing `set_mixed` and `set_math_first`, both
--       retired from the arm list, schema and config; (2) "5 more?" is 5 Math, same rules (code
--       only); (3) config: `set_math_5` weight 1, `qotd_then_more` weight back to 1, the retired
--       arms removed, dashboard share unchanged at 1/3] | @implemented [2026-10-26]
--
-- plain English:
--  1. Both tables' arm checks admit `set_math_5`. They still admit the two retired names, ONLY so
--     the windows and shows already stored with them stay valid: the experiment's history is not
--     rewritten. The application never assigns a retired arm again (it is no longer in its arm
--     list or weights); a window that still holds one shows Home with `fallback_reason =
--     'arm_retired'` until its 48 hours end, and the next window draws from the new arms.
--  2. `landing_shows.fallback_reason` admits `arm_retired`.
--  3. `landing_arm_weights` is replaced whole: `set_math_5` 1, `qotd_then_more` 1 (whatever it
--     was set to by hand since), the retired arms gone. `landing_dashboard_share`,
--     `landing_salt` and the kill switch are not touched.
--
-- Deploy order: either, and the rotation is OFF (Home for everyone) in between. The new code
-- reading the old weights row finds `set_mixed`, which its schema no longer knows; the old code
-- reading the new row finds `set_math_5`, which its schema never knew. Either way the config
-- parse fails and `loadLandingConfig` answers OFF, so no student is sent to a set the running
-- code cannot build. Both in place: the rotation resumes within the config cache TTL.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (restores the first migration's checks and weights; run only with the previous code):
--   UPDATE public.practice_runtime_config SET value = '{"qotd_then_more": 1, "set_mixed": 1,
--     "set_math_first": 1, "session_today": 1, "plan_builder": 1, "calendar_today": 0}'::jsonb,
--     updated_at = now() WHERE key = 'landing_arm_weights';
--   then drop and re-add the four constraints below with the first migration's lists
--   (20261113000000_smart_landing.sql), after deleting or re-labelling any `set_math_5` /
--   `arm_retired` rows, which those lists reject.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Arm checks: `set_math_5` in; the retired names kept for the rows already stored
-- ---------------------------------------------------------------------------
ALTER TABLE public.landing_windows DROP CONSTRAINT landing_windows_arm_check;
ALTER TABLE public.landing_windows ADD CONSTRAINT landing_windows_arm_check CHECK (
  arm IN ('dashboard', 'qotd_then_more', 'set_math_5', 'calendar_today', 'session_today',
          'plan_builder',
          -- retired 2026-10-26: stored rows only, never assigned again
          'set_mixed', 'set_math_first')
);

ALTER TABLE public.landing_windows DROP CONSTRAINT landing_windows_eligible_known;
ALTER TABLE public.landing_windows ADD CONSTRAINT landing_windows_eligible_known CHECK (
  eligible_arms <@ ARRAY['dashboard', 'qotd_then_more', 'set_math_5', 'calendar_today',
                         'session_today', 'plan_builder',
                         'set_mixed', 'set_math_first']::text[]
  AND 'dashboard' = ANY (eligible_arms)
);

ALTER TABLE public.landing_shows DROP CONSTRAINT landing_shows_arm_check;
ALTER TABLE public.landing_shows ADD CONSTRAINT landing_shows_arm_check CHECK (
  arm IN ('dashboard', 'qotd_then_more', 'set_math_5', 'calendar_today', 'session_today',
          'plan_builder',
          'set_mixed', 'set_math_first')
);

-- ---------------------------------------------------------------------------
-- 2. Fallback reasons: `arm_retired`
-- ---------------------------------------------------------------------------
ALTER TABLE public.landing_shows DROP CONSTRAINT landing_shows_fallback_reason_check;
ALTER TABLE public.landing_shows ADD CONSTRAINT landing_shows_fallback_reason_check CHECK (
  fallback_reason IN ('quota_exhausted', 'session_limit', 'no_questions', 'qotd_unavailable',
                      'no_block_today', 'not_entitled', 'arm_retired', 'error')
);

-- ---------------------------------------------------------------------------
-- 3. Weights (item 3). Replaced whole, so a hand edit since (qotd_then_more 0) is reset to 1.
-- ---------------------------------------------------------------------------
UPDATE public.practice_runtime_config
SET value = '{"qotd_then_more": 1, "set_math_5": 1, "session_today": 1, "plan_builder": 1, "calendar_today": 0}'::jsonb,
    description = 'Smart landing: relative weights of the non-dashboard arms (ruling C; Karl 2026-10-26: set_math_5 replaces set_mixed and set_math_first). 0 = never eligible; calendar_today is held for round 2.',
    updated_at = now()
WHERE key = 'landing_arm_weights';

DO $w$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.practice_runtime_config
     WHERE key = 'landing_arm_weights'
       AND value = '{"qotd_then_more": 1, "set_math_5": 1, "session_today": 1, "plan_builder": 1, "calendar_today": 0}'::jsonb
  ) THEN
    RAISE EXCEPTION 'smart landing math5 migration: landing_arm_weights row missing; weights not set';
  END IF;
END
$w$;

COMMIT;
