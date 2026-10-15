-- ============================================================================
-- Home "Getting started" checklist — service_role may write its state table
-- ============================================================================
-- @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
--        brief v2, Karl, 2026-10-13) §8 storage; hotfix brief "#1230 follow-up" (Karl,
--        2026-10-15)] | @implemented [2026-10-15]
--
-- plain English: production failed GET /api/home/getting-started with 42501. The four
-- getting_started_* functions (20261102000000) are SECURITY INVOKER and the route calls them as
-- service_role, so they write through service_role's own table rights, but that migration granted
-- it SELECT only on student_getting_started_state. `getting_started_observe` inserts the row on
-- first read and updates it every read, and the three POST functions insert or update it, so
-- every call failed. This grants INSERT and UPDATE, the same rights product_review_prompt_state
-- has for the same reason (20261027000000 §7). No DELETE: rows go only by ON DELETE CASCADE from
-- profiles, which the table's owner performs.
--
-- Checked with it: every other object the functions touch already grants service_role what
-- they use (SELECT on student_study_profile, student_qotd_attempts, practice_session_items,
-- review_sessions, calendar_current_plan, tutor_messages, guardian_links; EXECUTE on
-- qotd_daily_email_preference and on the four functions). #1230 created no other table.
--
-- Idempotent: GRANT of a privilege already held is a no-op, so if this grant was applied by hand
-- in production first, this brings the repo in line and changes nothing there.
--
-- Mutations: none target an existing function body here.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (restores the broken state; only to back this migration out):
--   REVOKE INSERT, UPDATE ON TABLE public.student_getting_started_state FROM service_role;
-- ============================================================================

BEGIN;

GRANT INSERT, UPDATE ON TABLE public.student_getting_started_state TO service_role;

COMMIT;
