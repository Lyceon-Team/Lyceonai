-- ============================================================================
-- Layer 1 crisis/safeguarding schema extensions
-- @spec [Doc-03_V3 §21.1, LISA_Layer1_Pattern_Set_v1 §Wiring]
-- @implemented 2026-09-17
--
-- plain English: Adds category, version, source, and enabled columns to
-- tutor_injection_signatures for two-lane (crisis/safeguarding) detection.
-- Widens the action CHECK to include stop_and_review and
-- stop_and_safeguarding_review. Category discriminates WHAT was detected
-- (suicide, self_harm, abuse); signature_type is left unchanged to avoid
-- breaking the injection-defense subsystem that reads it differently.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

-- ── 1. Add category column ──────────────────────────────────────────────
-- Discriminates detection type: suicide, self_harm, abuse.
-- Nullable initially so existing rows (if any) are not broken.
-- New rows from the seed migration will always have a value.
ALTER TABLE public.tutor_injection_signatures
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IN ('suicide', 'self_harm', 'abuse'));

-- ── 2. Add version column ───────────────────────────────────────────────
-- Tracks which pattern-set version a row belongs to (e.g. 'v1').
ALTER TABLE public.tutor_injection_signatures
  ADD COLUMN IF NOT EXISTS version TEXT;

-- ── 3. Add source column ────────────────────────────────────────────────
-- Provenance of the pattern (e.g. 'LISA_Layer1_Pattern_Set_v1').
ALTER TABLE public.tutor_injection_signatures
  ADD COLUMN IF NOT EXISTS source TEXT;

-- ── 4. Add enabled column ───────────────────────────────────────────────
-- Toggle patterns on/off without deletion.
ALTER TABLE public.tutor_injection_signatures
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- ── 5. Widen action CHECK ───────────────────────────────────────────────
-- The existing CHECK allows: flag, reject, silent_redirect.
-- Layer 1 v1 needs: stop_and_review (crisis lane) and
-- stop_and_safeguarding_review (safeguarding lane).
-- Drop and recreate since ALTER CHECK is not supported.
ALTER TABLE public.tutor_injection_signatures
  DROP CONSTRAINT IF EXISTS tutor_injection_signatures_action_check;

ALTER TABLE public.tutor_injection_signatures
  ADD CONSTRAINT tutor_injection_signatures_action_check
    CHECK (action IN (
      'flag', 'reject', 'silent_redirect',
      'stop_and_review', 'stop_and_safeguarding_review'
    ));

-- ── 6. Index for crisis/safeguarding queries ────────────────────────────
-- The crisis classifier queries by category + enabled. This index
-- supports both the existing signature_type='crisis' path and the
-- new category-based path.
CREATE INDEX IF NOT EXISTS idx_tutor_injection_signatures_category_enabled
  ON public.tutor_injection_signatures (category)
  WHERE enabled = true;

-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- DROP INDEX IF EXISTS idx_tutor_injection_signatures_category_enabled;
--
-- ALTER TABLE public.tutor_injection_signatures
--   DROP CONSTRAINT IF EXISTS tutor_injection_signatures_action_check;
-- ALTER TABLE public.tutor_injection_signatures
--   ADD CONSTRAINT tutor_injection_signatures_action_check
--     CHECK (action IN ('flag', 'reject', 'silent_redirect'));
--
-- ALTER TABLE public.tutor_injection_signatures DROP COLUMN IF EXISTS enabled;
-- ALTER TABLE public.tutor_injection_signatures DROP COLUMN IF EXISTS source;
-- ALTER TABLE public.tutor_injection_signatures DROP COLUMN IF EXISTS version;
-- ALTER TABLE public.tutor_injection_signatures DROP COLUMN IF EXISTS category;
