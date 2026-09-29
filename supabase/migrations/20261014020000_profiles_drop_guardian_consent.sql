-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Drop `profiles.guardian_consent`. Nothing reads it: whether an under-13 student may use a
-- learning surface is read from `guardian_links` on every request.
--
-- @spec [Guardian_Closure_Plan G2-04 / G2-05; owner ruling R6 (2026-09-27); SCL-187 rule 1;
--        owner approval 2026-09-29 ("G2-04's migration drops profiles.guardian_consent once no
--        gate reads it")] | @implemented [2026-09-29]
--
-- *** APPLY ONLY AFTER THE WAVE 2 DEPLOY IS LIVE. ***
-- The code in production before Wave 2 selects this column in the session loader
-- (`PROFILE_SELECT`) on every signed-in request; dropping it first would fail every session.
-- Wave 2 code never reads or writes it.
--
-- plain English: the column was the stored "a guardian consented" flag of the email-consent flow,
-- which never worked (KNOWN-GAPS CONSENT-FLOW-SCHEMA-MISMATCH) and was removed in G2-05. G2-04
-- replaced every reader with `requireGuardianLinkForUnder13`, which reads the ACTIVE link on the
-- request itself, so a stored flag could only ever be a second, stale answer.
--
-- Readers, established 2026-09-29 by grep over server/, client/, apps/, packages/, scripts/,
-- supabase/migrations/ and tests/: no SQL function, view, policy or trigger names the column (the
-- only migration that mentions it is genesis, which creates it); no server or client code selects
-- or writes it. A dependent view would make this DROP fail rather than silently cascade: there is
-- deliberately no CASCADE.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets this column (grep, 2026-09-29).
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS guardian_consent;

COMMIT;
