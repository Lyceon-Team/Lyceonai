-- ===========================================================================
-- Q5 / Q6 migration checks — OWNER-RUN (Karl), read-only.
--
-- Migration: supabase/migrations/20261027000000_marketing_consent_and_product_reviews.sql
-- @spec [docs/plans/seo/seo-marketing-vertical.md R26, R28, R30, rows Q5/Q6 ("DB check");
--       CLAUDE.md "Is it deployed? — ask the catalog, never the ledger"] | @implemented [2026-10-05]
--
-- How to use: run PART A in the SQL editor BEFORE applying the migration and keep the output.
-- Apply the migration. Run PART B. Every query here only reads; none returns a name, an email or
-- a date of birth — counts only.
--
-- What to expect (from the brief: 6 students and 1 guardian opted in):
--   A1 shows the opt-ins split into "eligible" (13+ by date of birth) and "cleared" (under 13 or
--   no date of birth). After the migration, B1's opted-in count per role equals A1's "eligible"
--   count, and B2 shows one `age_clear` row per A1 "cleared" account and one `backfill` row per
--   A1 "eligible" account. A guardian created before dates of birth were collected has none, so
--   they are cleared — they can turn it back on in Settings once they add their date of birth.
-- ===========================================================================


-- ── PART A — BEFORE the migration ──────────────────────────────────────────

-- A1. Opted-in accounts by role and by what the migration will do to them.
SELECT role,
       CASE
         WHEN date_of_birth IS NULL THEN 'cleared (no date of birth)'
         WHEN date_of_birth > (current_date - interval '13 years')::date THEN 'cleared (under 13)'
         ELSE 'eligible (13+, kept)'
       END AS outcome,
       count(*) AS accounts
  FROM public.profiles
 WHERE marketing_opt_in
 GROUP BY 1, 2
 ORDER BY 1, 2;


-- ── PART B — AFTER the migration ───────────────────────────────────────────

-- B1. Opted-in accounts by role. No row may be under 13 or have no date of birth.
SELECT role,
       count(*) AS opted_in,
       count(*) FILTER (
         WHERE date_of_birth IS NULL
            OR date_of_birth > (current_date - interval '13 years')::date
       ) AS ineligible_must_be_0
  FROM public.profiles
 WHERE marketing_opt_in
 GROUP BY role
 ORDER BY role;

-- B2. The consent log the migration wrote: age_clear = A1 "cleared"; backfill = A1 "eligible".
SELECT source, granted, count(*) AS rows
  FROM public.marketing_consent_log
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- B3. Every opted-in account has a log row (proof of consent): must be 0.
SELECT count(*) AS opted_in_without_log_row_must_be_0
  FROM public.profiles p
 WHERE p.marketing_opt_in
   AND NOT EXISTS (SELECT 1 FROM public.marketing_consent_log l WHERE l.profile_id = p.id);

-- B4. The catalog: the four tables exist with RLS on.
SELECT c.relname, c.relrowsecurity AS rls_on
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('marketing_consent_log', 'product_reviews', 'product_feedback',
                     'product_review_prompt_state')
 ORDER BY 1;   -- expect 4 rows, all true

-- B5. The two triggers on profiles are live.
SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgrelid = 'public.profiles'::regclass
   AND tgname IN ('profiles_marketing_consent_guard', 'profiles_marketing_consent_log')
 ORDER BY 1;   -- expect 2 rows, tgenabled = 'O'

-- B6. The functions are live (names only).
SELECT proname
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('marketing_opt_in_age_eligible', 'set_marketing_consent',
                   'product_review_prompt_state_for', 'product_review_prompt_claim',
                   'product_review_prompt_dismiss', 'product_review_submit',
                   'product_review_mark_external', 'product_feedback_submit')
 ORDER BY 1;   -- expect 8 rows

-- B7. No anon / authenticated access to any of the four tables: must return 0 rows.
SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('marketing_consent_log', 'product_reviews', 'product_feedback',
                      'product_review_prompt_state')
   AND grantee IN ('anon', 'authenticated', 'PUBLIC');

-- B8. The feedback rate-limit bucket is seeded: expect {"limit": 10, "window_seconds": 86400}.
SELECT value -> 'product_feedback' AS product_feedback_bucket
  FROM public.rate_limit_runtime_config
 WHERE key = 'bucket_definitions';
