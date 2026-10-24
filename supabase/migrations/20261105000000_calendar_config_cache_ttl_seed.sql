-- ===========================================================================
-- CALENDAR CONFIG CACHE LIFETIME IN caching_runtime_config
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [Doc-01A_V1.0 §24 ("Values live per-service in the respective *_runtime_config
--        table"), Appendix A.1 `caching_runtime_config`; owner ruling (Karl) 2026-10-15 on #1238
--        item (b): "a 60-second cache for the two config reads"]
-- @implemented [2026-10-15]
--
-- plain English: one row, the lifetime of the in-process cache in front of
-- `loadCalendarConfig` (server/services/calendar/config.ts) — the `calendar_runtime_config`
-- read plus practice's `target_seconds_per_question`, cached together. The server reads this
-- row on a cache MISS only, through `server/lib/caching-runtime-config.ts`, exactly as the two
-- rows of 20261103000000 are read.
--
--   calendar_config_cache_ttl_seconds   60. An operator's change to a calendar config row (a
--     bound, a preset, the horizon) reaches each instance within this long. min 10 / max 600.
--
-- A missing or unusable row takes the reader's documented fallback (the same 60), the
-- fail-forward convention of 20261103000000. The cache never serves an EXPIRED entry when a
-- refresh fails (its hard-staleness bound equals the TTL), so Doc 05F §18's "loud failure at
-- accessor" for missing calendar config is unchanged.
--
-- IDEMPOTENT: ON CONFLICT (key) DO NOTHING. Creates nothing; the table exists since genesis.
-- ===========================================================================

INSERT INTO public.caching_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('calendar_config_cache_ttl_seconds', '60'::jsonb, 'integer', '10'::jsonb, '600'::jsonb,
   'Engineering',
   'In-process TTL for the calendar config read (calendar_runtime_config + practice target_seconds_per_question). Owner ruling 2026-10-15 on #1238.')
ON CONFLICT (key) DO NOTHING;
