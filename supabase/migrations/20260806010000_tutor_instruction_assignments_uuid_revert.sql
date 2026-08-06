-- ============================================================================
-- AUD-519-002: Revert tutor_instruction_assignments.source_question_row_id
-- from TEXT to UUID per Doc 03A §18.4
-- ============================================================================
-- @spec  [Doc-03A_V3.0, §18.4]
-- @implemented [2026-08-06]
--
-- Doc 03A §18.4 defines source_question_row_id as UUID with no FK to
-- questions(id). SCL-024 covers four TEXT→UUID departures across three tables
-- (tutor_conversations, tutor_messages, tutor_question_links) — all of which
-- have FKs to questions(id) whose PK is TEXT, making UUID structurally invalid.
--
-- tutor_instruction_assignments.source_question_row_id has NO FK to
-- questions(id) per §18.4, so the FK-type-compatibility rationale does not
-- apply. Reverting to the spec-literal UUID type.
--
-- Decision: revert to UUID (not SCL entry). Reason: no FK exists to justify
-- the TEXT departure, and SCL-024 explicitly does not list this column.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

ALTER TABLE public.tutor_instruction_assignments
  ALTER COLUMN source_question_row_id TYPE UUID USING source_question_row_id::UUID;

COMMIT;


-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- To reverse this migration:
--
-- BEGIN;
-- ALTER TABLE public.tutor_instruction_assignments
--   ALTER COLUMN source_question_row_id TYPE TEXT;
-- COMMIT;
