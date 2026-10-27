-- ===========================================================================
-- tutor_turn_metrics: per-turn token attribution (nullable counts, thinking tokens, budget).
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "Per-turn attribution: tokens, thinking, cache and prompt version" (Karl,
--        2026-10-27) item 2 and rulings 1–2 of 2026-10-27 (table keeps tokens_in/tokens_out, adds
--        thinking_tokens and thinking_budget; drop the 0 default together with NOT NULL; leave
--        cache_hit as it is); Doc 03 §24 (per-student cost); Doc 03A §11.5 (the table); SCL-246]
-- @implemented [2026-10-27]
--
-- plain English: every row so far recorded tokens_in = tokens_out = 0 because the code never read
-- Vertex's usage (179 rows in production on 2026-10-27, owner's read-only check). Those zeros are
-- unknown, not zero, so they become NULL, and a turn with no model call (crisis bypass, Model
-- Armor block, an error before any Vertex response) records NULL from now on. Dropping the
-- DEFAULT 0 with the NOT NULL means a write that forgets a count stores NULL, never a fake 0.
--   thinking_tokens  the summed Vertex thoughtsTokenCount over the turn's billed attempts
--   thinking_budget  the thinking budget the call was made with (recorded, not configured)
-- tokens_in / tokens_out are, from now on, sums over every billed attempt in the turn (retries,
-- the pro→flash fallback, safety-blocked and truncated responses), per the owner's ruling.
--
-- Step 0 (2026-10-27): the repo (20260901000000 + genesis-schema.expected.sql) and production
-- agree on every column, type, nullability and default of this table. No drift.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; DROP NOT NULL / DROP DEFAULT are no-ops when already
-- applied; the UPDATE touches only rows whose two counts are both 0 (re-running it after real
-- counts exist changes nothing, since a real model-call turn reports a non-zero input count).
--
-- OWNER-RUN. Karl applies to prod BEFORE the PR merges. DO NOT auto-apply.
--
-- rollback:
--   UPDATE public.tutor_turn_metrics SET tokens_in = 0 WHERE tokens_in IS NULL;
--   UPDATE public.tutor_turn_metrics SET tokens_out = 0 WHERE tokens_out IS NULL;
--   ALTER TABLE public.tutor_turn_metrics
--     ALTER COLUMN tokens_in SET DEFAULT 0, ALTER COLUMN tokens_in SET NOT NULL,
--     ALTER COLUMN tokens_out SET DEFAULT 0, ALTER COLUMN tokens_out SET NOT NULL,
--     DROP COLUMN IF EXISTS thinking_tokens, DROP COLUMN IF EXISTS thinking_budget;
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_turn_metrics
  ADD COLUMN IF NOT EXISTS thinking_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS thinking_budget INTEGER;

ALTER TABLE public.tutor_turn_metrics
  ALTER COLUMN tokens_in DROP DEFAULT,
  ALTER COLUMN tokens_in DROP NOT NULL,
  ALTER COLUMN tokens_out DROP DEFAULT,
  ALTER COLUMN tokens_out DROP NOT NULL;

-- The recorded zeros were never measured: unknown, not zero.
UPDATE public.tutor_turn_metrics
   SET tokens_in = NULL,
       tokens_out = NULL
 WHERE tokens_in = 0
   AND tokens_out = 0;

COMMENT ON COLUMN public.tutor_turn_metrics.tokens_in IS
  'Sum of Vertex promptTokenCount over every billed attempt in the turn. NULL = no model response (or not reported), never 0 for unknown.';
COMMENT ON COLUMN public.tutor_turn_metrics.tokens_out IS
  'Sum of Vertex candidatesTokenCount over every billed attempt in the turn. NULL = no model response (or not reported).';
COMMENT ON COLUMN public.tutor_turn_metrics.thinking_tokens IS
  'Sum of Vertex thoughtsTokenCount over every billed attempt in the turn. NULL = no model response (or not reported).';
COMMENT ON COLUMN public.tutor_turn_metrics.thinking_budget IS
  'The Vertex thinking budget the turn''s calls were made with. NULL = no model call.';

COMMIT;
