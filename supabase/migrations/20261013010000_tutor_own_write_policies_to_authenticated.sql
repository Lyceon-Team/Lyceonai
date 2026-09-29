-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Tutor self-write policies: scoped to `authenticated`, not PUBLIC.
--
-- @spec [Guardian_Closure_Plan G1-09; audit G-AUD-12; Doc 03 INV-03-05 (zero
--        guardian LISA access); Doc 03A §16 (tutor RLS `student_id = auth.uid()`)]
-- @implemented [2026-09-29]
--
-- plain English: three policies in 20260805000000_ws_l0_3_tutor_runtime_schema.sql
-- were created with no TO clause, so they apply to PUBLIC (anon included):
--   tutor_conversations_insert_own   INSERT  WITH CHECK (student_id = auth.uid())
--   tutor_conversations_update_own   UPDATE  USING      (student_id = auth.uid())
--   tutor_messages_insert_own        INSERT  WITH CHECK (student_id = auth.uid())
-- They are inert today because no client role holds INSERT/UPDATE on either table
-- (owner check: production grants no writes to authenticated). This is hardening
-- only: ALTER POLICY ... TO authenticated changes the role list and nothing else.
-- The predicates are untouched, and every other tutor write policy already names
-- a dedicated role (20260806010000_tutor_dedicated_roles.sql).
--
-- The tutor routes themselves are student-only in the application
-- (`requireStudentOnly`, server/index.ts), which is what keeps a guardian out of
-- LISA; this migration removes a latent second path at the database layer.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER POLICY tutor_conversations_insert_own ON public.tutor_conversations TO authenticated;
ALTER POLICY tutor_conversations_update_own ON public.tutor_conversations TO authenticated;
ALTER POLICY tutor_messages_insert_own      ON public.tutor_messages      TO authenticated;

COMMIT;
