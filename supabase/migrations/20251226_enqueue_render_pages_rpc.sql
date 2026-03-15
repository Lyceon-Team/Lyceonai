-- RPC function to enqueue render_pages job if not already queued for the same pdfPath
-- Returns: { inserted: boolean, queue_id: uuid or null }
-- Idempotent: skips if a QUEUED or RUNNING render_pages exists for this (bucket, pdfPath)
-- Uses INSERT ... ON CONFLICT with unique partial index for atomic upsert

-- Drop old index if exists (was only on pdfPath)
DROP INDEX IF EXISTS idx_ingestion_v4_queue_render_pages_dedup;

-- Create partial unique index for deduplication (bucket + pdfPath + pending status)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_v4_queue_render_pages_dedup
  ON ingestion_v4_queue ((payload->>'bucket'), (payload->>'pdfPath'))
  WHERE payload->>'type' = 'render_pages' AND status IN ('QUEUED', 'RUNNING');

CREATE OR REPLACE FUNCTION enqueue_render_pages_if_missing(
  p_job_id uuid,
  p_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_pdf_path text;
  v_type text;
  v_bucket text;
  v_section text;
  v_new_id uuid;
  v_did_insert boolean := false;
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
  
  INSERT INTO ingestion_v4_queue (job_id, payload, status, not_before)
  VALUES (p_job_id, p_payload, 'QUEUED', now())
  ON CONFLICT ((payload->>'bucket'), (payload->>'pdfPath'))
    WHERE payload->>'type' = 'render_pages' AND status IN ('QUEUED', 'RUNNING')
  DO NOTHING
  RETURNING id INTO v_new_id;
  
  IF v_new_id IS NOT NULL THEN
    RETURN jsonb_build_object('inserted', true, 'queue_id', v_new_id, 'reason', null);
  ELSE
    SELECT id INTO v_new_id
    FROM ingestion_v4_queue
    WHERE payload->>'type' = 'render_pages'
      AND payload->>'pdfPath' = v_pdf_path
      AND status IN ('QUEUED', 'RUNNING')
    LIMIT 1;
    
    RETURN jsonb_build_object('inserted', false, 'queue_id', v_new_id, 'reason', 'already_queued');
  END IF;
END;
$$ LANGUAGE plpgsql;
