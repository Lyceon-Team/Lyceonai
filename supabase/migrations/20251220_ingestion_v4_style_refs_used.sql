-- Milestone 5: Add style_refs_used column to ingestion_v4_drafts
-- Tracks which style references were used to generate each draft

ALTER TABLE ingestion_v4_drafts
  ADD COLUMN IF NOT EXISTS style_refs_used jsonb NULL;

COMMENT ON COLUMN ingestion_v4_drafts.style_refs_used IS 'Array of PdfStyleRef objects used during generation';
