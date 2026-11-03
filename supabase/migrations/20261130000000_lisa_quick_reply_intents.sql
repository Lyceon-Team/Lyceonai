-- ===========================================================================
-- LISA quick replies in walkthroughs: two more `intent` values.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "Quick replies in walkthroughs" (Karl, 2026-11-02): "New intents in the same
--        closed enum: step_understood and step_stuck … Recording: the intent on the turn rows.
--        Never mastery, never memory"; Doc-03A_V3.0 §18.2 (tutor_messages) and Doc-03B_V4.1
--        §22.9 (tutor_turn_metrics) as amended by SCL-255, extended by SCL-268]
--       | @implemented [2026-11-02]
--
-- plain English: after a LISA reply in a walkthrough the review panel shows two taps, "Got it,
-- next step" (`step_understood`) and "I'm stuck" (`step_stuck`). Like every guided choice, a tap
-- is recorded as its intent code on the turn's student message row and its turn-metrics row,
-- and nowhere else. This widens the two CHECKs from 20261119000000_lisa_guided_choice_intent.sql
-- to the seven values of REVIEW_INTENTS (packages/shared/src/tutor-guided-choices.ts);
-- tests/ci/guided-choices.contract.test.ts asserts the last migration defining each CHECK lists
-- exactly REVIEW_INTENTS. No column, no data, no rewrite: existing rows already satisfy the
-- narrower list.
--
-- IDEMPOTENT: each CHECK is dropped if present and re-added.
--
-- RENUMBERED 2026-11-03 from 20261129000000: `20261129000000_growth_report_study_time.sql` took
-- that version one minute earlier (the later allocation renumbers; caught by
-- tests/ci/migration-duplicate-version.contract.test.ts). The SQL is unchanged and idempotent,
-- so a database that already ran it under the old name is unaffected by running it again.
--
-- DEPLOY ORDER: (1) apply this; (2) deploy the worker from `lisa` (its request schema must know
-- the two values, or a quick-reply turn fails its parse); (3) merge to `main` (the BFF and the
-- panel).
--
-- OWNER-RUN. Karl applies to prod BEFORE the PR merges. DO NOT auto-apply.
--
-- rollback (only once no row holds a quick-reply intent; a row that does fails the narrower
-- CHECK, so check first: SELECT count(*) FROM tutor_messages WHERE intent IN ('step_understood',
-- 'step_stuck')):
--   re-run the two CHECK blocks of 20261119000000_lisa_guided_choice_intent.sql
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_messages
  DROP CONSTRAINT IF EXISTS tutor_messages_intent_check;
ALTER TABLE public.tutor_messages
  ADD CONSTRAINT tutor_messages_intent_check CHECK (
    intent IS NULL OR intent IN (
      'walkthrough', 'desmos_walkthrough', 'explain_rule', 'video_desmos', 'video_explanation',
      'step_understood', 'step_stuck'
    )
  );

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_intent_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_intent_check CHECK (
    intent IS NULL OR intent IN (
      'walkthrough', 'desmos_walkthrough', 'explain_rule', 'video_desmos', 'video_explanation',
      'step_understood', 'step_stuck'
    )
  );

COMMENT ON COLUMN public.tutor_messages.intent IS
  'The review guided choice or walkthrough quick reply this student message came from (REVIEW_INTENTS); NULL for a typed message and for tutor rows. The code only; never read into memory or mastery.';
COMMENT ON COLUMN public.tutor_turn_metrics.intent IS
  'The review guided choice or walkthrough quick reply the turn came from (REVIEW_INTENTS); NULL for a typed turn.';

COMMIT;
