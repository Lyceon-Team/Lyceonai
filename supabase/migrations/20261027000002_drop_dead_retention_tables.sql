-- ===========================================================================
-- Drop dead retention objects: idempotency tables, service_auth_secrets, profiles.last_login_at
--
-- @spec [owner ruling 2026-10-05 C-03 (Q16: retire idempotency_records and its config table —
--        no writer; Stripe webhook records stay at 7 years. Q17: retire service_auth_secrets — no
--        route uses HMAC; every internal route authenticates by OIDC (Doc 03C §9.3). Drop
--        profiles.last_login_at — never written; the inactivity signal is auth.users.last_sign_in_at
--        per the recorded ruling)] | @implemented 2026-10-05
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: four tables and one column that nothing reads or writes.
--   idempotency_records, idempotency_runtime_config (+ its _history and two triggers, created by
--     genesis's config loop): Doc 01A Part IV's IdempotencyService was never built. Real
--     idempotency lives in domain columns (tutor_messages.client_turn_id,
--     test_answer_submissions.idempotency_key, ...) and stripe_webhook_events, untouched here.
--   service_auth_secrets: read only by packages/shared/internal-auth/{load-secrets,sign-request,
--     verify-middleware}.ts, which no route imported; removed in the same change.
--   profiles.last_login_at: no writer anywhere (genesis.sql:160 only); the client type field was
--     never sent by /api/profile.
--
-- expected outcome: the objects are gone; nothing else changes. No CASCADE: a dependency nobody
-- found makes this file fail rather than taking something with it.
--
-- edge cases: the drops do not check for rows. Run the read-only pre-apply counts in the PR first;
-- a non-zero count on a table nothing writes is a finding to report, not something to drop blind.
--
-- rollback (structure only; data, if any, is not recoverable): recreate from
-- 00000000000000_genesis.sql:160 (column), :331-344 (idempotency_records), :416-427
-- (service_auth_secrets), and the cfg_names loop at :449 for idempotency_runtime_config.
-- ===========================================================================

BEGIN;

DROP TRIGGER IF EXISTS idempotency_runtime_config_history_no_mutate ON public.idempotency_runtime_config_history;
DROP TRIGGER IF EXISTS idempotency_runtime_config_notify ON public.idempotency_runtime_config;
DROP TABLE public.idempotency_runtime_config_history;
DROP TABLE public.idempotency_runtime_config;
DROP TABLE public.idempotency_records;

DROP TABLE public.service_auth_secrets;

ALTER TABLE public.profiles DROP COLUMN last_login_at;

COMMIT;
