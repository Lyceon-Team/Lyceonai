-- @spec [Lyceon_Coding_Standards, §12.2] [Privacy_Policy_V1.0, §3.4] | @implemented [2026-06-06]
-- plain English: tutor_interactions is a non-canonical audit/correlation side-table
-- (it is NOT in Doc 03 §14.2's LISA retention matrix). Per Coding Standards §12.2 an
-- audit table must never hold verbatim tutor exchanges. The verbatim `message` /
-- `answer` columns were already gated to NULL on write by the TUTOR_VERBATIM_PERSIST
-- stop-the-bleed flag (PR #335); this migration removes the columns outright.
--
-- Backfill model (KNOWN-GAPS TUTOR-VERBATIM-PERSIST item 1, Karl ruling Q4=b —
-- redact-in-place): DROP COLUMN removes the verbatim payload from every historical
-- row (including any rows that persisted content before the stop-the-bleed flag)
-- while preserving the row and its non-verbatim metadata (mode, canonical_ids_used,
-- styles, explanation_level) for historical correlation.
--
-- The canonical verbatim conversation store (tutor_messages) is intentionally NOT
-- touched here — it retains verbatim content under the 7-day retention model of
-- Doc 03 §14.2 / Privacy Policy §9.7 (handled by PR2 of the tutor-runtime unit).
--
-- Idempotent / safe to re-run.

ALTER TABLE public.tutor_interactions
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS answer;

-- ----------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED (INV-06: every-migration-has-rollback)
-- Rollback (schema-shape only — see WARNING):
--
--   ALTER TABLE public.tutor_interactions
--     ADD COLUMN IF NOT EXISTS message text,
--     ADD COLUMN IF NOT EXISTS answer text;
--
-- WARNING: This rollback restores the COLUMNS (nullable) but CANNOT restore the
-- dropped verbatim data — destruction of that data is the intended, irreversible
-- effect of this migration per Privacy Policy §3.4 / Coding Standards §12.2. The
-- original create migration (database/20241207_add_tutor_interactions.sql) declared
-- these columns NOT NULL; the rollback intentionally re-adds them as NULLABLE so the
-- now-verbatim-free historical rows remain valid. Do not restore the NOT NULL
-- constraint without re-establishing a writer, which this unit has removed by design.
-- ----------------------------------------------------------------------------
