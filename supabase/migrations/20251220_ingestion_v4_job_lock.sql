-- Ingestion V4 Job Locking
-- Purpose: Add concurrency safety via DB-level locking columns

ALTER TABLE ingestion_v4_jobs 
ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS locked_by text NULL,
ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_jobs_locked_at 
  ON ingestion_v4_jobs (locked_at) WHERE locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_jobs_heartbeat_at 
  ON ingestion_v4_jobs (heartbeat_at) WHERE heartbeat_at IS NOT NULL;
