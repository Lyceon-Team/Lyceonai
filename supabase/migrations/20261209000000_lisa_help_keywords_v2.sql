-- ===========================================================================
-- LISA help keyword map, version 2 (tutor_context_runtime_config.tutor_help_keywords).
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [SCL-275 (the help-level engine; the keyword map is versioned config); Karl's
--       application to production, reported 2026-11-22: "version 2, stuck 33, solve_it 20"]
--       | @implemented [2026-11-22]
--
-- plain English: appends 9 "stuck" phrases and 6 "solve_it" phrases to the version-1 map
-- seeded by 20261201000000_lisa_help_level.sql, and sets version 2. Everything below this
-- header is the SQL Karl applied to production, byte for byte, so the repo matches prod.
--
-- GUARD: it raises unless the row is at version 1. Production is already at version 2, so
-- re-running this against production raises, by design. A fresh database applies the v1 seed
-- first, so the guard passes there.
--
-- OWNER-RUN. Already applied to production (Karl, reported 2026-11-22). DO NOT auto-apply.
--
-- rollback: restore the version-1 value from 20261201000000_lisa_help_level.sql.
-- Pinned by tests/ci/tutor-help-keywords-v2.contract.test.ts.
-- ===========================================================================

BEGIN;

DO $$
BEGIN
  IF (SELECT (value->>'version')::int FROM public.tutor_context_runtime_config
      WHERE key = 'tutor_help_keywords') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'tutor_help_keywords is not at version 1: stop and re-read it';
  END IF;
END $$;

UPDATE public.tutor_context_runtime_config
SET value = jsonb_build_object(
  'version', 2,
  'signals', jsonb_build_object(
    'stuck', (value->'signals'->'stuck') || '["dont know","don t know","do not know","dont remember","don t remember","do not remember","i forgot","not sure","help me"]'::jsonb,
    'solve_it', (value->'signals'->'solve_it') || '["u solve it","you solve it","whats the value","what s the value","what is the value","what is the answer"]'::jsonb
  )
)
WHERE key = 'tutor_help_keywords';

SELECT value->>'version' AS version,
       jsonb_array_length(value->'signals'->'stuck') AS stuck_phrases,
       jsonb_array_length(value->'signals'->'solve_it') AS solve_it_phrases
FROM public.tutor_context_runtime_config WHERE key = 'tutor_help_keywords';

COMMIT;
