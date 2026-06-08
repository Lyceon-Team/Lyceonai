-- Migration: Add client_attempt_id to answer_attempts for idempotency
-- Adds an optional idempotency key so client can safely retry practice submissions

ALTER TABLE answer_attempts 
ADD COLUMN IF NOT EXISTS client_attempt_id TEXT;

-- For practice sessions/answers, a given client attempt ID should be unique to the user
-- so a single retry doesn't spawn multiple rows. 
-- We allow NULLs for backward compatibility and non-idempotent submissions.

CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_attempts_idempotency 
ON answer_attempts(user_id, client_attempt_id) 
WHERE client_attempt_id IS NOT NULL;

COMMENT ON COLUMN answer_attempts.client_attempt_id IS 'Optional idempotency key for practice submissions';
