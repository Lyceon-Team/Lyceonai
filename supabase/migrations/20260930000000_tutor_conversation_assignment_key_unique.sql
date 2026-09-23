-- LYCEON-MIGRATION-REVIEWED
-- §4: Unique index on (student_id, assignment_key) WHERE assignment_key IS NOT NULL
-- Enforces create-conversation idempotency. The client sends an idempotency_key
-- which lands in assignment_key; this index prevents two fast clicks from creating
-- duplicate conversations.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_tutor_conversations_student_assignment_key;
--
-- WARNING: This migration will FAIL if duplicate (student_id, assignment_key)
-- rows already exist. Check before applying:
--   SELECT student_id, assignment_key, count(*)
--   FROM tutor_conversations
--   WHERE assignment_key IS NOT NULL
--   GROUP BY student_id, assignment_key
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  idx_tutor_conversations_student_assignment_key
  ON tutor_conversations (student_id, assignment_key)
  WHERE assignment_key IS NOT NULL;
