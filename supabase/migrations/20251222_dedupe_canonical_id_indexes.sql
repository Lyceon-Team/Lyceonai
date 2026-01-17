-- Deduplicate canonical_id unique indexes (keep one)
-- We currently have redundant unique indexes: questions_canonical_id_key, questions_canonical_id_idx, questions_canonical_id_unique
-- Keep only questions_canonical_id_unique

DROP INDEX IF EXISTS public.questions_canonical_id_key;
DROP INDEX IF EXISTS public.questions_canonical_id_idx;

-- Ensure the canonical unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS questions_canonical_id_unique
ON public.questions (canonical_id);
