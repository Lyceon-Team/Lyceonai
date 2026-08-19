-- ============================================================================
-- Fix tutor_messages idempotency index to include role
-- LYCEON-MIGRATION-REVIEWED
-- ============================================================================
-- The idempotency model (Doc 03B §6.5 step 8, §9, §13.3) requires two
-- tutor_messages rows per client_turn_id per turn: one role='student'
-- (step 11) and one role='tutor' (step 16). The existing partial unique
-- index on (student_id, conversation_id, client_turn_id) blocks the second
-- insert because both rows share the same student_id, conversation_id, and
-- client_turn_id. Every non-crisis turn fails at step 16 with a uniqueness
-- violation — the turn cannot complete.
--
-- Fix: include role in the uniqueness key so each role can have exactly one
-- row per (student, conversation, client_turn_id) combination.
--
-- Doc 03A §18.2 defines the constraint as UNIQUE (conversation_id,
-- client_turn_id), which is a spec defect — it does not account for the
-- two-row model described in §9 and §13.3. See SCL-028 (PROPOSED).
--
-- @spec [Doc-03A_V3.0 §18.2, Doc-03B_V4.1 §9, §13.3]
-- @implemented [2026-08-12]
--
-- ROLLBACK:
-- BEGIN;
-- DROP INDEX IF EXISTS idx_tutor_messages_client_turn_idempotency;
-- CREATE UNIQUE INDEX idx_tutor_messages_client_turn_idempotency
--   ON public.tutor_messages (student_id, conversation_id, client_turn_id)
--   WHERE client_turn_id IS NOT NULL;
-- COMMIT;
-- ============================================================================

BEGIN;

-- Drop the current 3-column partial unique index (student_id, conversation_id,
-- client_turn_id) that blocks the two-row model.
DROP INDEX IF EXISTS idx_tutor_messages_client_turn_idempotency;

-- Recreate with role included: permits exactly one student row and one tutor
-- row per (student_id, conversation_id, client_turn_id). Still partial —
-- NULL client_turn_id values are not idempotency keys.
CREATE UNIQUE INDEX idx_tutor_messages_client_turn_idempotency
  ON public.tutor_messages (student_id, conversation_id, client_turn_id, role)
  WHERE client_turn_id IS NOT NULL;

COMMIT;
