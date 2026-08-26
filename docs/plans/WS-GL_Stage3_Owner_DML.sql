-- WS-GL Stage 3 — owner DML seeds.
--
-- PRODUCED BY WS-GL, APPLIED BY THE OWNER. Charter §7 reserves every irreversible
-- operation to the owner. Nothing in this file has been executed against production.
-- It was executed against a throwaway local database only, to prove the statements
-- are valid against the real schema; that database is not production.
--
-- Date: 2026-08-25 · Governs: docs/plans/WS-GL_Stage2_Closure_Plan.md §12
--
-- EVERY VALUE CARRIES A CITATION. Where the spec states no value, the entry is
-- withheld and the reason recorded rather than a plausible number being chosen —
-- a seeded constant with no source is one nobody can later defend.
--
-- Column conventions follow the rows already live in these tables, not the
-- appendix's prose capitalisation: `owner` is lowercase ('product'), `environment`
-- is 'all', `value` is jsonb. Verified against the migration-seeded `tutor_*` rows,
-- e.g. ('tutor_burst_5min', 30, 'integer', 'product', 'Doc 03B §15.2: …', 'all').

BEGIN;

-- ===========================================================================
-- 1. rate_limit_runtime_config — gates Phase A's exit
-- ===========================================================================
-- Source: Doc 01A V1.0, Appendix A.3 (heading verified:
--   "## **A.3 `rate_limit_runtime_config`**"), and Doc 01 V8 §36.2 (heading
--   verified: "### **36.2 Rate limiting and abuse controls**").
--
-- Doc 01A §47's blocking condition names the missing key explicitly:
--   "bucket definition missing from `rate_limit_runtime_config.bucket_definitions`".
-- That makes `bucket_definitions` the canonical home, not one row per bucket.

-- 1.1 soft_warning_threshold_pct
--     Value 80, min 50, max 95, owner Product — Appendix A.3 table row, and §43
--     ("## **§43 Soft warning at 80%**") states the same default in prose.
INSERT INTO public.rate_limit_runtime_config
  (key, value, value_type, min_value, max_value, owner, description, environment)
VALUES
  ('soft_warning_threshold_pct', '80'::jsonb, 'integer', '50'::jsonb, '95'::jsonb,
   'product', 'Doc 01A A.3: % of limit triggering soft warning', 'all')
ON CONFLICT (key) DO NOTHING;

-- 1.2 bucket_definitions — the guardian-link entry only.
--     limit 10: Doc 01 V8 §36.2 states "Per-guardian: max 10 link attempts per day"
--       in prose, corroborated by Appendix A.3's launch seed
--       `"guardian_link_attempts_daily": { "limit": 10, "window_seconds": 86400 }`.
--     window_seconds 86400: "per day" (§36.2), same seed entry.
--     bucket key `guardian_link_attempts_daily`: Doc 01A §46 (heading verified:
--       "## **§46 Consumed by**") names it verbatim for
--       "V8 guardian linking (§36.2)".
--
--     SCOPE NOTE: Appendix A.3's launch seed lists nine buckets. Only the guardian
--     entry is seeded here. The other eight belong to auth, tutor, practice, exam,
--     calendar and the API gateway — other surfaces, and A.3 labels the seed
--     "(illustrative)", so adopting all nine is an owner decision this workstream
--     must not make on their behalf. Note also that the live `tutor_turns_daily`
--     row says 120 while A.3's seed says 100; that divergence predates WS-GL and is
--     reported, not resolved.
--
--     This is written as a merge so it neither clobbers nor duplicates an existing
--     map should one be seeded before this is applied.
INSERT INTO public.rate_limit_runtime_config
  (key, value, value_type, owner, description, environment)
VALUES
  ('bucket_definitions',
   '{"guardian_link_attempts_daily": {"limit": 10, "window_seconds": 86400}}'::jsonb,
   'object', 'product',
   'Doc 01A A.3: map of bucket_key -> { limit, window_seconds }', 'all')
ON CONFLICT (key) DO UPDATE
  SET value = public.rate_limit_runtime_config.value || EXCLUDED.value,
      updated_at = now();

-- 1.3 WITHHELD — the per-student-email bucket. TWO reasons, both blocking.
--
--   (a) THE LIMIT IS STATED, THE BUCKET KEY IS NOT. Doc 01 V8 §36.2 states
--       "Per-student-email: max 3 link attempts per day (prevents spam linking to
--       an email)". It gives no bucket name, Doc 01A §46's consumer table lists no
--       such bucket, and Appendix A.3's launch seed contains no such entry. Naming
--       it here would invent the one thing the config is keyed on.
--
--   (b) IT IS NOT EXPRESSIBLE AGAINST §41'S LEDGER, which is the larger problem.
--       Doc 01A §41 (heading verified: "## **§41 Postgres ledger implementation**")
--       declares, and production confirms:
--           profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
--           PRIMARY KEY (profile_id, bucket_key, window_start)
--       Every bucket is keyed on a profile. An email address that has no Lyceon
--       profile cannot be keyed at all — and that is precisely the case the control
--       exists to prevent ("spam linking to an email"). Keying on the student's
--       profile_id instead would silently convert a per-email control into a
--       per-student one, with different coverage, so it is not done here.
--
--   This is the Stage 2 plan's step A3, and the plan's reading of it was wrong:
--   A3 assumed implementability. Recorded as a finding for an owner ruling.

-- ===========================================================================
-- 2. consent_runtime_config — gates Phase D's exit
-- ===========================================================================
-- Source: Doc 01 V8, Appendix A.3 (heading verified:
--   "## **A.3 `consent_runtime_config`**"), which supplies Launch Value, Min, Max
--   and Owner for all four keys. Each is corroborated in prose by the section that
--   reads it, cited per row below.

INSERT INTO public.consent_runtime_config
  (key, value, value_type, min_value, max_value, owner, description, environment)
VALUES
  -- §37.2 step 2 (heading verified: "### **37.2 Consent request flow**"):
  --   "Token TTL: `consent_runtime_config.consent_request_ttl_days` (default 7 days)"
  ('consent_request_ttl_days', '7'::jsonb, 'integer', '3'::jsonb, '30'::jsonb,
   'product', 'Doc 01 V8 A.3: guardian consent request expiration', 'all'),

  -- §37.4 (heading verified: "### **37.4 Consent expiration without action**"):
  --   "After `consent_runtime_config.consent_expiration_deletion_days`
  --    (default 30 days total from signup)"
  ('consent_expiration_deletion_days', '30'::jsonb, 'integer', '14'::jsonb, '90'::jsonb,
   'product', 'Doc 01 V8 A.3: auto-delete unconsented under-13 after', 'all'),

  -- §37.3 (heading verified: "### **37.3 Resend cooldown**"):
  --   "Cooldown: `consent_runtime_config.consent_request_resend_cooldown_minutes`
  --    (default 60)"
  ('consent_request_resend_cooldown_minutes', '60'::jsonb, 'integer', '15'::jsonb, '1440'::jsonb,
   'engineering', 'Doc 01 V8 A.3: min time between consent email resends', 'all'),

  -- §37.3: "Max resends: `consent_runtime_config.consent_request_max_resends_per_day`
  --         (default 3)"
  ('consent_request_max_resends_per_day', '3'::jsonb, 'integer', '1'::jsonb, '10'::jsonb,
   'engineering', 'Doc 01 V8 A.3: max consent email sends per day', 'all')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ===========================================================================
-- Verification the owner can run after applying
-- ===========================================================================
-- SELECT key, value, value_type, owner, environment
--   FROM public.rate_limit_runtime_config
--  WHERE key IN ('bucket_definitions','soft_warning_threshold_pct');
--
-- SELECT value -> 'guardian_link_attempts_daily'
--   FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions';
--   -- expected: {"limit": 10, "window_seconds": 86400}
--
-- SELECT key, value FROM public.consent_runtime_config ORDER BY key;
--   -- expected 4 rows: 30, 3, 60, 7
