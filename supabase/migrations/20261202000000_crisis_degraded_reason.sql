-- ===========================================================================
-- Crisis classifier: why Layer 2 could not answer, on the review case and the turn row.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "Crisis classifier: record the failure reason, and look at the timeout"
--        (Karl, 2026-11-08); CR-03C-V3-01 §3.4 (the Layer 2 failure classes) and §3.6; Doc-03_V3
--        §21.3 (the review queue); Doc-03B_V4.1 §22.9 (tutor_turn_metrics) as extended by
--        SCL-276] | @implemented [2026-11-08]
--
-- plain English: on 2026-11-05 a turn went `classifier_degraded` after about 6 s and failed closed
-- into the review queue, correctly, but the reason (timeout, 429 or 5xx) was lost when Vercel's
-- logs expired an hour later. This records it where it lasts. Codes and counts only: no message
-- text.
--  - crisis_review_cases.degraded_reason / classifier_attempts: why Layer 2 failed, and how many
--    model attempts it made (0: setup failed, no attempt; 1 or 2 with the one retry). Only a
--    degraded case (`classifier_degraded`, `classifier_degraded_no_floor`) may carry them, and
--    they come together.
--  - tutor_turn_metrics.crisis_classifier_ms / crisis_classifier_attempts /
--    crisis_degraded_reason: Layer 2's wall time across attempts, its attempts, and the reason on
--    a failed turn. The source of the latency percentiles the timeout recommendation needs (until
--    now only the outcome was stored; per-attempt times lived in logs that expire in an hour).
-- The reason values are packages/shared/src/crisis-flag-schema.ts `crisisDegradedReasonSchema`;
-- tests/ci/crisis-degraded-reason.contract.test.ts asserts the CHECK lists match it.
--
-- No function is redefined: the BFF writes the case's reason with a separate, guarded update after
-- `flag_conversation_for_crisis_review` returns, so that function and the mutations aimed at it
-- (scripts/ci/crisis-flag-atomic.mutations.sh) are untouched, and the fail-closed path is exactly
-- as before.
--
-- Each CHECK spells out IS NOT NULL where a NULL comparison would otherwise pass.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; each CHECK is dropped if present and re-added.
--
-- DEPLOY ORDER: (1) apply this (the BFF writes these columns on every turn that runs Layer 2, and
-- an insert naming a missing column loses that turn's metrics row); (2) merge to `main` (the BFF).
-- No worker change.
--
-- OWNER-RUN. Karl applies to prod BEFORE the PR merges. DO NOT auto-apply.
--
-- rollback (after the BFF that writes them is rolled back):
--   ALTER TABLE public.tutor_turn_metrics DROP COLUMN IF EXISTS crisis_degraded_reason,
--     DROP COLUMN IF EXISTS crisis_classifier_attempts, DROP COLUMN IF EXISTS crisis_classifier_ms;
--   ALTER TABLE public.crisis_review_cases DROP COLUMN IF EXISTS classifier_attempts,
--     DROP COLUMN IF EXISTS degraded_reason;
-- ===========================================================================

BEGIN;

-- ── The review case ─────────────────────────────────────────────────────────

ALTER TABLE public.crisis_review_cases
  ADD COLUMN IF NOT EXISTS degraded_reason TEXT,
  ADD COLUMN IF NOT EXISTS classifier_attempts SMALLINT;

ALTER TABLE public.crisis_review_cases
  DROP CONSTRAINT IF EXISTS crisis_review_cases_degraded_reason_check;
ALTER TABLE public.crisis_review_cases
  ADD CONSTRAINT crisis_review_cases_degraded_reason_check CHECK (
    (degraded_reason IS NULL AND classifier_attempts IS NULL)
    OR (
      degraded_reason IS NOT NULL
      AND degraded_reason IN ('timeout', 'rate_limited', 'upstream_error', 'config_error')
      AND classifier_attempts IS NOT NULL
      AND classifier_attempts BETWEEN 0 AND 2
      AND source IN ('classifier_degraded', 'classifier_degraded_no_floor')
    )
  );

COMMENT ON COLUMN public.crisis_review_cases.degraded_reason IS
  'Why Layer 2 (the model classifier) could not answer on the degraded turn that opened this case: timeout, rate_limited, upstream_error or config_error. Degraded cases only; a code, never message text.';
COMMENT ON COLUMN public.crisis_review_cases.classifier_attempts IS
  'Layer 2 model attempts on that turn: 0 (setup failed, no attempt), 1 or 2 (with the one retry).';

-- ── The turn row ────────────────────────────────────────────────────────────

ALTER TABLE public.tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS crisis_classifier_ms INTEGER,
  ADD COLUMN IF NOT EXISTS crisis_classifier_attempts SMALLINT,
  ADD COLUMN IF NOT EXISTS crisis_degraded_reason TEXT;

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_crisis_layer2_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_crisis_layer2_check CHECK (
    (crisis_classifier_ms IS NULL AND crisis_classifier_attempts IS NULL
       AND crisis_degraded_reason IS NULL)
    OR (
      crisis_classifier_ms IS NOT NULL AND crisis_classifier_ms >= 0
      AND crisis_classifier_attempts IS NOT NULL
      AND crisis_classifier_attempts BETWEEN 0 AND 2
      AND (crisis_degraded_reason IS NULL
           OR crisis_degraded_reason IN ('timeout', 'rate_limited', 'upstream_error', 'config_error'))
    )
  );

COMMENT ON COLUMN public.tutor_turn_metrics.crisis_classifier_ms IS
  'Layer 2 wall time on this turn in ms, across attempts and setup; NULL when Layer 2 did not run.';
COMMENT ON COLUMN public.tutor_turn_metrics.crisis_classifier_attempts IS
  'Layer 2 model attempts on this turn (0-2); NULL when Layer 2 did not run.';
COMMENT ON COLUMN public.tutor_turn_metrics.crisis_degraded_reason IS
  'Why Layer 2 could not answer (timeout, rate_limited, upstream_error, config_error); NULL when it answered or did not run. A code, never message text.';

COMMIT;
