-- Ingestion V4 Tables
-- Purpose: Support AI-generated SAT question pipeline with job tracking and style library

-- 1) ingestion_v4_jobs: Track each generation job
CREATE TABLE IF NOT EXISTS ingestion_v4_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_code text NOT NULL DEFAULT 'SAT',
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  target_count int NOT NULL CHECK (target_count >= 1 AND target_count <= 5000),
  style_refs jsonb NOT NULL,
  stats jsonb NOT NULL DEFAULT '{"generated":0,"qa_passed":0,"qa_failed":0}'::jsonb,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_jobs_status_created 
  ON ingestion_v4_jobs (status, created_at);

-- 2) ingestion_v4_drafts: Store generated drafts + QA results
CREATE TABLE IF NOT EXISTS ingestion_v4_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ingestion_v4_jobs(id) ON DELETE CASCADE,
  draft jsonb NOT NULL,
  qa jsonb NULL,
  qa_ok boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_drafts_job_created 
  ON ingestion_v4_drafts (job_id, created_at);

-- 3) ingestion_v4_style_library: Style reference index
CREATE TABLE IF NOT EXISTS ingestion_v4_style_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  page_hint int NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_bucket_path_page UNIQUE (bucket, path, page_hint)
);

-- Trigger to auto-update updated_at on jobs table
CREATE OR REPLACE FUNCTION update_ingestion_v4_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ingestion_v4_jobs_updated_at ON ingestion_v4_jobs;
CREATE TRIGGER trigger_update_ingestion_v4_jobs_updated_at
  BEFORE UPDATE ON ingestion_v4_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_ingestion_v4_jobs_updated_at();
