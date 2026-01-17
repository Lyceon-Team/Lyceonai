-- Ingestion V4 Style Bank Enhancement
-- Adds exam/section columns to style library for filtering by SAT section

-- Add columns if they don't exist
ALTER TABLE ingestion_v4_style_library 
  ADD COLUMN IF NOT EXISTS exam text DEFAULT 'SAT',
  ADD COLUMN IF NOT EXISTS section text DEFAULT NULL;

-- Add index for section-based queries
CREATE INDEX IF NOT EXISTS idx_style_library_exam_section 
  ON ingestion_v4_style_library (exam, section);

-- Update constraint to allow same path with different sections
-- First drop existing constraint if it exists (idempotent)
ALTER TABLE ingestion_v4_style_library 
  DROP CONSTRAINT IF EXISTS unique_bucket_path_page;

ALTER TABLE ingestion_v4_style_library 
  ADD CONSTRAINT unique_bucket_path_section UNIQUE (bucket, path, section);
