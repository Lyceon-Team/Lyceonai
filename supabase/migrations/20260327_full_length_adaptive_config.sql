-- Full-Length Adaptive Config + Module-2 Provenance
-- Additive migration for deferred adaptive materialization

BEGIN;

CREATE TABLE IF NOT EXISTS public.full_length_adaptive_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL CHECK (section IN ('rw', 'math')),
  hard_cutoff INTEGER NOT NULL,
  bucket_mode TEXT NOT NULL DEFAULT 'two_bucket',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_full_length_adaptive_config_active
  ON public.full_length_adaptive_config(section)
  WHERE active = TRUE;

ALTER TABLE public.full_length_adaptive_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Authenticated users can view adaptive config"
  ON public.full_length_adaptive_config
  FOR SELECT USING (auth.role() IS NOT NULL);

CREATE POLICY IF NOT EXISTS "Service role can manage adaptive config"
  ON public.full_length_adaptive_config
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

INSERT INTO public.full_length_adaptive_config (section, hard_cutoff, bucket_mode, active)
SELECT 'rw', 21, 'two_bucket', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.full_length_adaptive_config WHERE section = 'rw' AND active = TRUE
);

INSERT INTO public.full_length_adaptive_config (section, hard_cutoff, bucket_mode, active)
SELECT 'math', 15, 'two_bucket', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.full_length_adaptive_config WHERE section = 'math' AND active = TRUE
);

ALTER TABLE public.full_length_exam_modules
  ADD COLUMN IF NOT EXISTS module1_correct_count INTEGER,
  ADD COLUMN IF NOT EXISTS adaptive_config_id UUID REFERENCES public.full_length_adaptive_config(id),
  ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ;

COMMIT;
