-- ===========================================================================
-- LISA turn attribution: a turn outcome column, and nullable turn ordinals.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [Doc-03A_V3 §11.3, §11.5 (the two logs), §18.6; Doc-03D_V1.2 §8.1; LISA closure plan
--        W4-12 (model_name mixes model identity with turn outcome); owner brief "attribution",
--        Karl 2026-11-22: "turnOrdinal is hardcoded 0 … Make it the real turn count per
--        conversation … Close W4-12/13/14 in the same PR"]
-- @implemented [2026-11-22]
--
-- plain English:
--  1. tutor_turn_metrics.turn_outcome: how the turn ended, as a code (the CHECK lists exactly
--     server/services/tutor-attribution.ts TURN_OUTCOMES). Until now the outcome was written into
--     model_name, so "turns per model" counted crisis bypasses and errors as models (W4-12).
--     model_name becomes nullable and holds a provider model only.
--     Backfill: a row whose model_name is a known outcome code moves it to turn_outcome and
--     model_name becomes NULL; any other row that is not an error:* code was a delivered model
--     turn ('completed'). An error code not in the list stays as it was, with turn_outcome NULL
--     (unknown), rather than be guessed.
--  2. turn_ordinal is nullable in both logs: the route now writes the real 0-based ordinal, and
--     NULL when it cannot be counted, never a guessed 0. Every metrics row written before this
--     migration carries a constant 0 that was never measured; those become NULL (unknown), as the
--     token zeros did in 20261115000000. Context-resolution rows are left as they are (no column
--     tells the old rows apart).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; the CHECK is dropped and re-added; DROP NOT NULL is a
-- no-op when applied; the ordinal UPDATE runs only on rows with no turn_outcome yet (the rows
-- written before this migration), and the outcome UPDATEs only on rows with no turn_outcome.
--
-- DEPLOY ORDER (owner-run): apply BEFORE the BFF deploy. The new BFF writes turn_outcome and
-- NULL model_name / turn_ordinal, which the old schema refuses (an unknown column; NOT NULL).
-- The old BFF keeps working against the new schema (it writes every column it did before).
-- RE-RUN this file once AFTER the BFF deploy: rows the old BFF wrote between the apply and the
-- deploy carry turn_outcome NULL and a constant 0 ordinal; the idempotent UPDATEs fix exactly
-- those and touch nothing the new BFF wrote.
--
-- rollback:
--   UPDATE public.tutor_turn_metrics SET model_name = turn_outcome
--    WHERE model_name IS NULL AND turn_outcome IS NOT NULL;
--   UPDATE public.tutor_turn_metrics SET turn_ordinal = 0 WHERE turn_ordinal IS NULL;
--   UPDATE public.tutor_context_resolution_log SET turn_ordinal = 0 WHERE turn_ordinal IS NULL;
--   ALTER TABLE public.tutor_turn_metrics
--     DROP CONSTRAINT IF EXISTS tutor_turn_metrics_turn_outcome_check,
--     DROP COLUMN IF EXISTS turn_outcome,
--     ALTER COLUMN model_name SET NOT NULL,
--     ALTER COLUMN turn_ordinal SET NOT NULL;
--   ALTER TABLE public.tutor_context_resolution_log ALTER COLUMN turn_ordinal SET NOT NULL;
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS turn_outcome TEXT;

ALTER TABLE public.tutor_turn_metrics
  ALTER COLUMN turn_ordinal DROP NOT NULL,
  ALTER COLUMN model_name DROP NOT NULL;

ALTER TABLE public.tutor_context_resolution_log
  ALTER COLUMN turn_ordinal DROP NOT NULL;

-- Rows written before this migration: their ordinal was the constant 0, never measured.
UPDATE public.tutor_turn_metrics
   SET turn_ordinal = NULL
 WHERE turn_outcome IS NULL
   AND turn_ordinal = 0;

-- W4-12 backfill: an outcome code written as the model moves to its own column.
UPDATE public.tutor_turn_metrics
   SET turn_outcome = model_name,
       model_name = NULL
 WHERE turn_outcome IS NULL
   AND model_name IN (
     'model_armor_input_blocked',
     'crisis_bypass',
     'guided_choice_video',
     'idempotency_replay',
     'idempotency_conflict',
     'idempotency_lookup_error',
     'error:student_message_write_failed',
     'error:crisis_message_write_failed',
     'error:tutor_message_write_failed',
     'error:instruction_assignment_failed',
     'error:orchestration_failed',
     'error:unexpected'
   );

-- A row carrying a provider model was a delivered model turn.
UPDATE public.tutor_turn_metrics
   SET turn_outcome = 'completed'
 WHERE turn_outcome IS NULL
   AND model_name IS NOT NULL
   AND model_name NOT LIKE 'error:%';

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_turn_outcome_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_turn_outcome_check CHECK (
    turn_outcome IS NULL OR turn_outcome IN (
      'completed',
      'model_armor_input_blocked',
      'crisis_bypass',
      'guided_choice_video',
      'idempotency_replay',
      'idempotency_conflict',
      'idempotency_lookup_error',
      'error:student_message_write_failed',
      'error:crisis_message_write_failed',
      'error:tutor_message_write_failed',
      'error:instruction_assignment_failed',
      'error:orchestration_failed',
      'error:unexpected'
    )
  );

COMMENT ON COLUMN public.tutor_turn_metrics.turn_outcome IS
  'How the turn ended (W4-12): completed (a delivered reply), model_armor_input_blocked, crisis_bypass, guided_choice_video, idempotency_*, or error:*. NULL only on a pre-2026-11-22 row whose code was not recognised.';
COMMENT ON COLUMN public.tutor_turn_metrics.model_name IS
  'The provider model the worker answered with. NULL when no model answered; never an outcome code (see turn_outcome).';
COMMENT ON COLUMN public.tutor_turn_metrics.turn_ordinal IS
  '0-based turn of the conversation: the number of earlier student turns. NULL = not known (never a guessed 0; every row before 2026-11-22).';
COMMENT ON COLUMN public.tutor_context_resolution_log.turn_ordinal IS
  '0-based turn of the conversation. NULL = not known. Rows before 2026-11-22 carry a constant 0 (not measured).';

COMMIT;
