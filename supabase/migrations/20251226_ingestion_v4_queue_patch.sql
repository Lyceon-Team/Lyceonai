-- Ingestion V4 Queue Patch Migration
-- Purpose: Ensure queue table has all required columns and status values
-- SAFE/IDEMPOTENT - can be run multiple times without errors

-- Add PENDING to status check if not already present
-- First drop the old constraint, then add new one with all values
DO $$
BEGIN
  -- Drop existing constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'ingestion_v4_queue_status_check'
  ) THEN
    ALTER TABLE ingestion_v4_queue DROP CONSTRAINT ingestion_v4_queue_status_check;
  END IF;
  
  -- Add new constraint with all status values
  ALTER TABLE ingestion_v4_queue 
    ADD CONSTRAINT ingestion_v4_queue_status_check 
    CHECK (status IN ('QUEUED', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add attempts column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'attempts'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN attempts int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add started_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN started_at timestamptz NULL;
  END IF;
END $$;

-- Add completed_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN completed_at timestamptz NULL;
  END IF;
END $$;

-- Add last_error column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN last_error text NULL;
  END IF;
END $$;

-- Add locked_by column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'locked_by'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN locked_by text NULL;
  END IF;
END $$;

-- Add locked_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ingestion_v4_queue' AND column_name = 'locked_at'
  ) THEN
    ALTER TABLE ingestion_v4_queue ADD COLUMN locked_at timestamptz NULL;
  END IF;
END $$;
