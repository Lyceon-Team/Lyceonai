-- Patch enqueue_render_pages_if_missing to support overwrite parameter
-- Idempotent: safe to run multiple times
-- Adds p_overwrite boolean parameter that marks existing QUEUED rows as FAILED before inserting

CREATE OR REPLACE FUNCTION enqueue_render_pages_if_missing(
  p_job_id uuid,
  p_payload jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_pdf_path text;
  v_type text;
  v_bucket text;
  v_section text;
  v_new_id uuid;
  v_existing_id uuid;
  v_did_overwrite boolean := false;
BEGIN
  v_type := p_payload->>'type';
  v_pdf_path := p_payload->>'pdfPath';
  v_bucket := p_payload->>'bucket';
  v_section := p_payload->>'section';
  
  IF v_type IS NULL OR v_type != 'render_pages' THEN
    RETURN jsonb_build_object('inserted', false, 'queue_id', null, 'reason', 'invalid_type');
  END IF;
  
  IF v_pdf_path IS NULL OR v_pdf_path = '' THEN
    RETURN jsonb_build_object('inserted', false, 'queue_id', null, 'reason', 'missing_pdfPath');
  END IF;
  
  IF v_bucket IS NULL OR v_bucket != 'lyceon-style-bank' THEN
    RETURN jsonb_build_object('inserted', false, 'queue_id', null, 'reason', 'invalid_bucket');
  END IF;
  
  IF v_section IS NULL OR v_section NOT IN ('math', 'rw') THEN
    RETURN jsonb_build_object('inserted', false, 'queue_id', null, 'reason', 'invalid_section');
  END IF;
  
  -- Check if there's a RUNNING job first - never touch those or insert alongside them
  SELECT id INTO v_existing_id
  FROM ingestion_v4_queue
  WHERE payload->>'type' = 'render_pages'
    AND payload->>'pdfPath' = v_pdf_path
    AND payload->>'bucket' = v_bucket
    AND status = 'RUNNING'
  LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    -- RUNNING job exists - do not insert, do not overwrite, just return
    RETURN jsonb_build_object('inserted', false, 'queue_id', v_existing_id, 'reason', 'already_running');
  END IF;
  
  -- If overwrite=true, mark existing QUEUED rows as FAILED (RUNNING already handled above)
  IF p_overwrite THEN
    UPDATE ingestion_v4_queue
    SET 
      status = 'FAILED',
      last_error = 'overwritten',
      completed_at = now(),
      updated_at = now()
    WHERE payload->>'type' = 'render_pages'
      AND payload->>'pdfPath' = v_pdf_path
      AND payload->>'bucket' = v_bucket
      AND status = 'QUEUED'
    RETURNING id INTO v_existing_id;
    
    IF v_existing_id IS NOT NULL THEN
      v_did_overwrite := true;
    END IF;
  END IF;
  
  -- Now attempt insert
  INSERT INTO ingestion_v4_queue (job_id, payload, status, not_before)
  VALUES (p_job_id, p_payload, 'QUEUED', now())
  ON CONFLICT ((payload->>'bucket'), (payload->>'pdfPath'))
    WHERE payload->>'type' = 'render_pages' AND status IN ('QUEUED', 'RUNNING')
  DO NOTHING
  RETURNING id INTO v_new_id;
  
  IF v_new_id IS NOT NULL THEN
    IF v_did_overwrite THEN
      RETURN jsonb_build_object('inserted', true, 'queue_id', v_new_id, 'reason', 'overwritten');
    ELSE
      RETURN jsonb_build_object('inserted', true, 'queue_id', v_new_id, 'reason', null);
    END IF;
  ELSE
    -- Conflict occurred, find existing row
    SELECT id INTO v_new_id
    FROM ingestion_v4_queue
    WHERE payload->>'type' = 'render_pages'
      AND payload->>'pdfPath' = v_pdf_path
      AND payload->>'bucket' = v_bucket
      AND status IN ('QUEUED', 'RUNNING')
    LIMIT 1;
    
    RETURN jsonb_build_object('inserted', false, 'queue_id', v_new_id, 'reason', 'already_queued');
  END IF;
END;
$$ LANGUAGE plpgsql;
