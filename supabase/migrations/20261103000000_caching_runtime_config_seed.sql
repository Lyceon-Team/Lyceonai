-- ===========================================================================
-- CACHE LIFETIMES IN caching_runtime_config
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [Doc-01A_V1.0 §24 ("Values live per-service in the respective *_runtime_config
--        table"), Appendix A.1 `caching_runtime_config`; owner ruling (Karl) 2026-10-13 on #1232
--        item 2: "Seed caching_runtime_config with the two lifetimes (timezone 24h, skill catalog
--        10 min) and read them from there"]
-- @implemented [2026-10-13]
--
-- plain English: two rows, one per in-process cache built in #1232. The server reads them on a
-- cache MISS (never on a hit), through `server/lib/caching-runtime-config.ts`, so an operator can
-- change how long an instance trusts its copy without a deploy. A changed value takes effect on
-- each instance's next refresh of that cache.
--
--   known_timezone_cache_ttl_seconds   86400 (24 h). The answer of
--     `calendar_is_known_timezone` per zone: a fact about the Postgres build that nothing in the
--     application writes.
--   skill_catalog_cache_ttl_seconds      600 (10 min). The `canonical_skill_catalog` read: changes
--     only when the question pipeline publishes a new (section, domain, skill). Owner ruling
--     2026-10-13 on #1232: a 10-minute delay before a new skill appears is accepted.
--
-- min/max are the bounds the reader enforces: a value outside them, a malformed value, an absent
-- row or a failed read all take the reader's documented fallback (the same two numbers), which is
-- the fail-forward convention of `getExamRenewalConfig` in entitlement-runtime-config.ts — a
-- missing row must not turn the cache off and put every request back on the database.
--
-- IDEMPOTENT: ON CONFLICT (key) DO NOTHING, so a re-run neither duplicates nor overwrites a value
-- an operator has since tuned. The table and its notify/history triggers exist since genesis
-- (section 4, config family); this migration creates nothing.
-- ===========================================================================

INSERT INTO public.caching_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('known_timezone_cache_ttl_seconds', '86400'::jsonb, 'integer', '60'::jsonb, '604800'::jsonb,
   'Engineering',
   'In-process TTL for calendar_is_known_timezone answers, per zone. The zone list changes only with a Postgres upgrade. #1232.'),
  ('skill_catalog_cache_ttl_seconds', '600'::jsonb, 'integer', '10'::jsonb, '3600'::jsonb,
   'Engineering',
   'In-process TTL for the canonical_skill_catalog read. A newly published skill can take this long to appear (owner ruling 2026-10-13, #1232). #1232.')
ON CONFLICT (key) DO NOTHING;
