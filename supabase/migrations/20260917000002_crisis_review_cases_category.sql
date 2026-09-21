-- @spec [Layer1 PR 2 brief §4]
-- Adds the `category` column to crisis_review_cases to distinguish
-- crisis (suicide/self-harm) from safeguarding (abuse) lanes.
-- The lane comes from `category`, never from `source` (which means
-- "detection method") — reusing `source` would repeat the
-- signature_type collision from the injection-defense subsystem.
--
-- LYCEON-MIGRATION-REVIEWED
-- Rollback: ALTER TABLE public.crisis_review_cases DROP COLUMN IF EXISTS category;
--           DROP INDEX IF EXISTS idx_crisis_review_cases_category_active;

ALTER TABLE public.crisis_review_cases
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'crisis'
  CHECK (category IN ('crisis', 'safeguarding'));

-- Partial index for fast filtering by category on active cases.
CREATE INDEX IF NOT EXISTS idx_crisis_review_cases_category_active
  ON public.crisis_review_cases (category)
  WHERE status IN ('open', 'in_review');
