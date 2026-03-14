-- Canonical question version ledger
-- Source of truth: publish/version lifecycle for question bank content.

CREATE TABLE IF NOT EXISTS public.question_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('qa', 'published')),
  snapshot JSONB NOT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  UNIQUE (question_id, version_number)
);

CREATE INDEX IF NOT EXISTS question_versions_canonical_id_idx
  ON public.question_versions (canonical_id);

CREATE INDEX IF NOT EXISTS question_versions_question_id_idx
  ON public.question_versions (question_id);
