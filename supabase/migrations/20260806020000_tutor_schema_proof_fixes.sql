-- ============================================================================
-- Tutor schema-proof fixes
-- LYCEON-MIGRATION-REVIEWED
-- ============================================================================
-- Fixes two gaps caught by the tutor-schema-proof CI gate:
--
--   1. tutor_messages idempotency index: the existing 2-column UNIQUE
--      constraint (conversation_id, client_turn_id) is replaced with a
--      3-column partial unique index (student_id, conversation_id,
--      client_turn_id) WHERE client_turn_id IS NOT NULL, matching the
--      idempotency contract in Doc 03B §8.4 and the schema-proof assertion.
--
--   2. tutor_injection_log student-scoped SELECT policy: the dedicated-roles
--      migration (20260806000000) narrowed service_role→per-role but omitted
--      the student-scoped SELECT policy. Students need read-only visibility
--      into their own injection log entries for transparency (the INV-03-13
--      restriction applies to WRITE access, not read).
--
-- @spec [Doc-03B_V2.0, §8.4] | @spec [Doc-03A_V3.0, §18.7]
-- @implemented [2026-08-06]
--
-- ROLLBACK:
-- BEGIN;
-- DROP POLICY IF EXISTS tutor_injection_log_select_own ON public.tutor_injection_log;
-- DROP INDEX IF EXISTS idx_tutor_messages_client_turn_idempotency;
-- ALTER TABLE public.tutor_messages
--   ADD CONSTRAINT tutor_messages_client_turn_unique UNIQUE (conversation_id, client_turn_id);
-- COMMIT;
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Fix tutor_messages idempotency index
-- --------------------------------------------------------------------------
-- Drop the existing 2-column constraint that lacks student_id scoping and
-- the partial filter for NULL client_turn_id values.
ALTER TABLE public.tutor_messages
  DROP CONSTRAINT IF EXISTS tutor_messages_client_turn_unique;

-- Create the correct partial unique index: student-scoped, only enforced
-- when client_turn_id is provided (NULL values are not idempotency keys).
CREATE UNIQUE INDEX idx_tutor_messages_client_turn_idempotency
  ON public.tutor_messages (student_id, conversation_id, client_turn_id)
  WHERE client_turn_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2. Add student-scoped SELECT policy on tutor_injection_log
-- --------------------------------------------------------------------------
-- Students can read their own injection log entries (transparency).
-- INV-03-13 restricts write access, not read.
CREATE POLICY tutor_injection_log_select_own
  ON public.tutor_injection_log
  FOR SELECT
  USING (student_id = auth.uid());

COMMIT;
