-- ===========================================================================
-- LISA guided choices (review, Phase A): the `intent` a turn came from.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27) build 4 and
--        ruling 5 of 2026-10-27; Doc-03A_V3.0 §18.2 (tutor_messages) and §11.5
--        (tutor_turn_metrics) as amended by SCL-254] | @implemented [2026-10-27]
--
-- plain English: when a student taps a guided choice in the review LISA panel, the turn carries
-- an intent from a closed list (packages/shared/src/tutor-guided-choices.ts REVIEW_INTENTS). It
-- is recorded on the turn's student message row and on its turn-metrics row, and nowhere else:
--   tutor_messages.intent      on the student row of a tapped turn; NULL on a typed message and
--                              on every tutor row
--   tutor_turn_metrics.intent  on the turn's metrics row; NULL for a typed turn
-- The code only: no message text is stored anywhere new (the tapped label is already the
-- student row's `message`, as before). Nothing reads it into memory, the teaching profile,
-- `preferred_explanation_style`, `explanation_form` or mastery (ruling 5).
-- Each CHECK lists exactly REVIEW_INTENTS; tests/ci/guided-choices.contract.test.ts asserts that.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; each CHECK is dropped if present and re-added.
-- Nullable with no default: existing rows are untouched (no rewrite).
--
-- DEPLOY ORDER: (1) apply this; (2) deploy the worker from `lisa` (its request schema accepts
-- the optional `intent`); (3) merge to `main` (the BFF writes the columns, on guided-choice
-- turns only).
--
-- OWNER-RUN. Karl applies to prod BEFORE the PR merges. DO NOT auto-apply.
--
-- rollback:
--   ALTER TABLE public.tutor_messages DROP COLUMN IF EXISTS intent;
--   ALTER TABLE public.tutor_turn_metrics DROP COLUMN IF EXISTS intent;
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_messages
  ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE public.tutor_messages
  DROP CONSTRAINT IF EXISTS tutor_messages_intent_check;
ALTER TABLE public.tutor_messages
  ADD CONSTRAINT tutor_messages_intent_check CHECK (
    intent IS NULL OR intent IN (
      'walkthrough', 'desmos_walkthrough', 'explain_rule', 'video_desmos', 'video_explanation'
    )
  );

ALTER TABLE public.tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_intent_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_intent_check CHECK (
    intent IS NULL OR intent IN (
      'walkthrough', 'desmos_walkthrough', 'explain_rule', 'video_desmos', 'video_explanation'
    )
  );

COMMENT ON COLUMN public.tutor_messages.intent IS
  'The review guided choice this student message came from (REVIEW_INTENTS); NULL for a typed message and for tutor rows. The code only; never read into memory or mastery.';
COMMENT ON COLUMN public.tutor_turn_metrics.intent IS
  'The review guided choice the turn came from (REVIEW_INTENTS); NULL for a typed turn.';

COMMIT;
