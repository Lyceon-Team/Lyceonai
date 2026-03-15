-- (==================================================================
-- Ingestion v2 + RAG v2 Schema Extensions
-- Run this in your Supabase SQL Editor (project database)
-- ============================================================================

-- 1) Extend questions table with canonical fields
-- --------------------------------------------------------------------------

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS canonical_id TEXT UNIQUE;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS test_code TEXT;        -- e.g. 'SAT', 'ACT', 'AP'

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS section_code TEXT;     -- e.g. 'M', 'RW'

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS source_type INTEGER;   -- 1 = parsed PDF, 2 = AI generated

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS competencies JSONB;    -- [{code: 'M.LIN.1', raw: '...'}]

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Optional: index to make canonical lookups fast
CREATE UNIQUE INDEX IF NOT EXISTS questions_canonical_id_idx
  ON public.questions (canonical_id);

-- Optional: index for test/section filtering in RAG
CREATE INDEX IF NOT EXISTS questions_test_section_idx
  ON public.questions (test_code, section_code);


-- 2) Extend Supabase profiles with personalization & RAG metadata
-- --------------------------------------------------------------------------
-- Profiles are defined in database/supabase-profiles-setup.sql as:
--   public.profiles (id UUID PRIMARY KEY REFERENCES auth.users(id), ...)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overall_level TEXT
    CHECK (overall_level IN ('emerging', 'developing', 'proficient', 'advanced'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_style TEXT
    CHECK (primary_style IN ('short', 'medium', 'deep', 'analogy', 'step-by-step'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS secondary_style TEXT
    CHECK (secondary_style IN ('short', 'medium', 'deep', 'analogy', 'step-by-step'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS explanation_level INTEGER
    CHECK (explanation_level BETWEEN 1 AND 3);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS competency_map JSONB;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS persona_tags TEXT[] DEFAULT '{}';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS learning_prefs JSONB;

-- Optional: default explanation level if null
UPDATE public.profiles
SET explanation_level = 1
WHERE explanation_level IS NULL;

-- Optional: basic index on styles for analytics later
CREATE INDEX IF NOT EXISTS profiles_style_idx
  ON public.profiles (primary_style, secondary_style);)


