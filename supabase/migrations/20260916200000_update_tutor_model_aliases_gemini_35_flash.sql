-- @spec [Doc-03C_V3 §5.2, §30.1]
-- @implemented 2026-09-16
--
-- Migrates tutor model aliases from retiring gemini-2.5 series to
-- gemini-3.5-flash (GA). Google shuts down gemini-2.5-pro, gemini-2.5-flash,
-- and gemini-2.5-flash-lite on 2026-10-16. Google names gemini-3.5-flash as
-- the replacement for both 2.5 Pro and 2.5 Flash.
--
-- Both tiers resolve to the same provider model: there is no GA Pro
-- successor (gemini-3.1-pro-preview is preview-only, unacceptable for a
-- minors-facing production path).
--
-- The original seeds (20260901000000) used ON CONFLICT DO NOTHING, so
-- editing that file would not update already-applied rows. This migration
-- performs an explicit UPDATE.
--
-- ROLLBACK:
--   UPDATE public.tutor_context_runtime_config
--   SET value = '"gemini-2.5-flash"'
--   WHERE key = 'vertex.model.flash_class_alias'
--     AND value = '"gemini-3.5-flash"';
--
--   UPDATE public.tutor_context_runtime_config
--   SET value = '"gemini-2.5-pro"'
--   WHERE key = 'vertex.model.pro_class_alias'
--     AND value = '"gemini-3.5-flash"';
--
-- LYCEON-MIGRATION-REVIEWED

UPDATE public.tutor_context_runtime_config
SET value = '"gemini-3.5-flash"'
WHERE key = 'vertex.model.flash_class_alias'
  AND value = '"gemini-2.5-flash"';

UPDATE public.tutor_context_runtime_config
SET value = '"gemini-3.5-flash"'
WHERE key = 'vertex.model.pro_class_alias'
  AND value = '"gemini-2.5-pro"';
