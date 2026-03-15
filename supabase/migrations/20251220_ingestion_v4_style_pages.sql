-- Migration: Create ingestion_v4_style_pages table for PDF page rendering
-- Stores rendered PNG pages from style bank PDFs

CREATE TABLE IF NOT EXISTS ingestion_v4_style_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  dpi INTEGER NOT NULL CHECK (dpi >= 72 AND dpi <= 300),
  
  image_path TEXT NOT NULL,
  image_bytes INTEGER NOT NULL CHECK (image_bytes > 0),
  image_sha256 TEXT,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  
  exam TEXT NOT NULL DEFAULT 'SAT',
  section TEXT NOT NULL CHECK (section IN ('math', 'rw')),
  
  tags JSONB DEFAULT '[]'::jsonb,
  inferred_difficulty TEXT CHECK (inferred_difficulty IN ('easy', 'medium', 'hard')),
  inferred_skill TEXT,
  question_score REAL,
  
  rendered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_page_render UNIQUE (bucket, pdf_path, page_number, dpi)
);

CREATE INDEX IF NOT EXISTS idx_style_pages_bucket_path ON ingestion_v4_style_pages(bucket, pdf_path);
CREATE INDEX IF NOT EXISTS idx_style_pages_exam_section ON ingestion_v4_style_pages(exam, section);

COMMENT ON TABLE ingestion_v4_style_pages IS 'Rendered PNG pages from style bank PDFs for AI vision consumption';
