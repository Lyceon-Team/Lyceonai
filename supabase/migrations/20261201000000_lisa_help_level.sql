-- ===========================================================================
-- LISA help-level engine: the level on each turn's metrics row, and the keyword map.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "Help-level engine" (Karl, 2026-11-05), rules 4 and 5: "a versioned keyword
--        map in runtime config, as with `video_method_keywords`" and "Record the level on each
--        turn's metrics row"; Doc-03B_V4.1 §22.9 (tutor_turn_metrics) as amended by SCL-255,
--        extended by SCL-275] | @implemented [2026-11-05]
--
-- plain English: the server now decides how much help each LISA turn gives (ask, hint, worked
-- step, full solution) and records it on the turn's `tutor_turn_metrics` row. The next turn reads
-- the last recorded level from there, so these columns are the engine's only memory. Three
-- additive, nullable columns, each with a CHECK listing exactly the values in
-- packages/shared/src/tutor-help-level.ts (`HELP_LEVELS`, `MAX_WORKED_STEPS`, `HELP_SIGNALS`;
-- tests/ci/tutor-help-level.contract.test.ts asserts the lists match), plus version 1 of the
-- `tutor_help_keywords` map. Codes only: no message text, no answer.
--
-- Each CHECK spells out IS NOT NULL: a comparison with NULL is NULL, and a NULL CHECK passes.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; each CHECK is dropped if present and re-added; the seed is
-- ON CONFLICT DO NOTHING.
--
-- DEPLOY ORDER: (1) apply this (the BFF writes these columns on every model turn; an insert naming
-- a missing column fails and loses that turn's whole metrics row); (2) deploy the worker from
-- `lisa` (its request schema must accept `help_level`, `submit_state`, `worked_step`, and it
-- carries prompt lisa-default-v7); (3) merge to `main` (the BFF).
--
-- OWNER-RUN. Karl applies to prod BEFORE the PR merges. DO NOT auto-apply.
--
-- rollback (after the BFF that writes them is rolled back):
--   ALTER TABLE public.tutor_turn_metrics DROP COLUMN IF EXISTS help_signal,
--     DROP COLUMN IF EXISTS help_worked_step, DROP COLUMN IF EXISTS help_level;
--   DELETE FROM public.tutor_context_runtime_config WHERE key = 'tutor_help_keywords';
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS help_level TEXT,
  ADD COLUMN IF NOT EXISTS help_worked_step SMALLINT,
  ADD COLUMN IF NOT EXISTS help_signal TEXT;

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_help_level_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_help_level_check CHECK (
    help_level IS NULL OR help_level IN ('ask', 'hint', 'worked_step', 'full_solution')
  );

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_help_worked_step_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_help_worked_step_check CHECK (
    (help_worked_step IS NULL AND help_level IS DISTINCT FROM 'worked_step')
    OR (help_level = 'worked_step' AND help_worked_step IS NOT NULL
        AND help_worked_step BETWEEN 1 AND 3)
  );

ALTER TABLE public.tutor_turn_metrics
  DROP CONSTRAINT IF EXISTS tutor_turn_metrics_help_signal_check;
ALTER TABLE public.tutor_turn_metrics
  ADD CONSTRAINT tutor_turn_metrics_help_signal_check CHECK (
    (help_level IS NULL AND help_signal IS NULL)
    OR (help_level IS NOT NULL AND help_signal IS NOT NULL AND help_signal IN (
      'walkthrough', 'step_understood', 'stuck', 'skipped', 'solve_it', 'correct_step', 'none'
    ))
  );

COMMENT ON COLUMN public.tutor_turn_metrics.help_level IS
  'The help level the turn was given (ask, hint, worked_step, full_solution), decided by the BFF; NULL when the turn reached no worker. The next turn starts from the latest non-NULL row.';
COMMENT ON COLUMN public.tutor_turn_metrics.help_worked_step IS
  'At help_level worked_step, which worked step (1-3; 3 is the last allowed before submission); NULL otherwise.';
COMMENT ON COLUMN public.tutor_turn_metrics.help_signal IS
  'What moved the level this turn (HELP_SIGNALS); a code, never message text.';

-- The keyword map, version 1. Phrases are normalised (lowercase words, single spaces, no
-- punctuation: "I'm" is "i m"); matched whole-word against the student's typed message; the
-- longest matching phrase wins. "solve it" alone is left out: "how do I solve it?" asks for help,
-- not for the answer.
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES (
  'tutor_help_keywords',
  $json${
    "version": 1,
    "signals": {
      "stuck": ["idk", "i dunno", "dunno", "i don t know", "i dont know", "no idea", "i have no idea",
                "no clue", "i have no clue", "i m stuck", "im stuck", "i am stuck", "stuck",
                "i give up", "i m lost", "im lost", "i am lost", "i m confused", "im confused",
                "i am confused", "i don t get it", "i dont get it", "i don t understand",
                "i dont understand"],
      "solve_it": ["just solve it", "solve it for me", "can you solve it", "just solve", "show me",
                   "just show me", "show me the answer", "just tell me", "tell me the answer",
                   "what s the answer", "whats the answer", "give me the answer",
                   "just give me the answer", "do it for me"]
    }
  }$json$::jsonb,
  'object',
  'engineering',
  'Help-level engine (owner brief 2026-11-05): phrases in a typed message that mean "I am stuck" (up one level; two in a row, up two) or "just solve it" (the highest level allowed). Matched whole-word, longest phrase wins. Versioned.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
