-- Ingestion V4 Queue Table
-- Purpose: Enable server-side queueing for batch run requests

CREATE TABLE IF NOT EXISTS ingestion_v4_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ingestion_v4_jobs(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  not_before timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  locked_by text NULL,
  locked_at timestamptz NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_queue_status_not_before_created
  ON ingestion_v4_queue (status, not_before, created_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_queue_job_status
  ON ingestion_v4_queue (job_id, status);

CREATE INDEX IF NOT EXISTS idx_ingestion_v4_queue_locked_by
  ON ingestion_v4_queue (locked_by) WHERE locked_by IS NOT NULL;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_ingestion_v4_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ingestion_v4_queue_updated_at ON ingestion_v4_queue;
CREATE TRIGGER trigger_update_ingestion_v4_queue_updated_at
  BEFORE UPDATE ON ingestion_v4_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_ingestion_v4_queue_updated_at();

-- Atomic dequeue RPC function
CREATE OR REPLACE FUNCTION ingestion_v4_dequeue_next(queue_runner text)
RETURNS ingestion_v4_queue AS $$
DECLARE
  result ingestion_v4_queue;
BEGIN
  UPDATE ingestion_v4_queue
  SET 
    status = 'RUNNING',
    locked_by = queue_runner,
    locked_at = now(),
    started_at = now(),
    attempts = attempts + 1,
    updated_at = now()
  WHERE id = (
    SELECT id 
    FROM ingestion_v4_queue 
    WHERE status = 'QUEUED' 
      AND not_before <= now()
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;
