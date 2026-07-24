-- ============================================================================
-- servable_questions view: security_invoker + service_role GRANT
-- ============================================================================
-- @spec [Doc-02A_V6 §16; Coding Standards §5/§6; Codex Scope 2 REJECT 2A]
-- @implemented [2026-07-24]
--
-- The view was created without security_invoker, meaning it runs with OWNER
-- (postgres) semantics — any future GRANT on the view would bypass the
-- deliberate default-deny on questions (RLS enabled + zero policies + ACL
-- limited to postgres and service_role). Since the view is SELECT * over an
-- answer-bearing table (correct_answer, explanation, option_metadata),
-- owner semantics plus any inadvertent grant is a full-bank leak.
--
-- security_invoker = true makes the view evaluate with the INVOKER's
-- privileges, so only roles that already have SELECT on questions can
-- read through the view.
--
-- GRANT SELECT to service_role only — the server's service_role needs it
-- for RPC and direct reads. Do NOT grant to authenticated, anon, or PUBLIC:
-- Supabase publishes granted views through PostgREST, so that grant would
-- expose the question bank WITH ANSWER KEYS over REST.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

-- Recreate with security_invoker = true (PG 15+).
-- CREATE OR REPLACE preserves existing GRANTs; we re-GRANT explicitly below.
CREATE OR REPLACE VIEW public.servable_questions
  WITH (security_invoker = true)
AS
  SELECT *
  FROM public.questions
  WHERE status = 'published'
    AND (issue_flags IS NULL OR array_length(issue_flags, 1) IS NULL);

-- service_role needs SELECT for server-side reads.
-- No grant to authenticated, anon, or PUBLIC.
GRANT SELECT ON public.servable_questions TO service_role;

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- ============================================================================
-- BEGIN;
-- REVOKE SELECT ON public.servable_questions FROM service_role;
-- CREATE OR REPLACE VIEW public.servable_questions AS
--   SELECT *
--   FROM public.questions
--   WHERE status = 'published'
--     AND (issue_flags IS NULL OR array_length(issue_flags, 1) IS NULL);
-- COMMIT;
