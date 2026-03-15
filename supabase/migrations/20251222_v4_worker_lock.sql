-- Migration: V4 Worker Lock for always-on queue worker
-- Date: 2024-12-22
-- Purpose: Prevent multiple workers from running concurrently

-- Create worker lock table
CREATE TABLE IF NOT EXISTS public.ingestion_v4_worker_locks (
  worker_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  lock_expiry TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (admin only via service role)
ALTER TABLE public.ingestion_v4_worker_locks ENABLE ROW LEVEL SECURITY;

-- Function to acquire worker lock (returns true if acquired)
CREATE OR REPLACE FUNCTION v4_acquire_worker_lock(
  p_worker_name TEXT,
  p_lock_expiry TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  SELECT * INTO v_existing
  FROM public.ingestion_v4_worker_locks
  WHERE worker_name = p_worker_name;
  
  IF v_existing IS NULL THEN
    INSERT INTO public.ingestion_v4_worker_locks (worker_name, lock_expiry)
    VALUES (p_worker_name, p_lock_expiry);
    RETURN TRUE;
  END IF;
  
  IF v_existing.lock_expiry < NOW() THEN
    UPDATE public.ingestion_v4_worker_locks
    SET locked_at = NOW(),
        lock_expiry = p_lock_expiry,
        heartbeat_at = NOW()
    WHERE worker_name = p_worker_name;
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$;

-- Function to release worker lock
CREATE OR REPLACE FUNCTION v4_release_worker_lock(
  p_worker_name TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.ingestion_v4_worker_locks
  WHERE worker_name = p_worker_name;
END;
$$;

-- Function to renew worker lock (heartbeat)
CREATE OR REPLACE FUNCTION v4_renew_worker_lock(
  p_worker_name TEXT,
  p_lock_expiry TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected INT;
BEGIN
  UPDATE public.ingestion_v4_worker_locks
  SET lock_expiry = p_lock_expiry,
      heartbeat_at = NOW()
  WHERE worker_name = p_worker_name;
  
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
END;
$$;
