-- Compatibility wrapper: creates enqueue_render_pages_if_missing_v2 that calls v1
-- This allows the app to call v2 first without breaking if only v1 exists
-- Idempotent: safe to run multiple times

CREATE OR REPLACE FUNCTION enqueue_render_pages_if_missing_v2(
  p_job_id uuid,
  p_payload jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb AS $$
BEGIN
  -- Simply delegate to the v1 function which has the full implementation
  RETURN enqueue_render_pages_if_missing(p_job_id, p_payload, p_overwrite);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_render_pages_if_missing_v2 IS 'Compatibility wrapper that delegates to enqueue_render_pages_if_missing';
