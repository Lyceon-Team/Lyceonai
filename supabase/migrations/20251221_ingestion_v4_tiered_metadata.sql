-- Migration: Tiered metadata + usage counters for style pages + draft provenance
-- Milestone A: Add columns for domain-aware sampling and usage tracking

-- A1) Add usage counter and metadata columns to ingestion_v4_style_pages
ALTER TABLE ingestion_v4_style_pages
  ADD COLUMN IF NOT EXISTS teacher_used_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qa_used_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_teacher_used_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_qa_used_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS domain TEXT NULL,
  ADD COLUMN IF NOT EXISTS difficulty TEXT NULL CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard', 'unknown')),
  ADD COLUMN IF NOT EXISTS skill TEXT NULL,
  ADD COLUMN IF NOT EXISTS tag_confidence REAL NULL CHECK (tag_confidence IS NULL OR (tag_confidence >= 0 AND tag_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS diagram_present BOOLEAN NULL;

COMMENT ON COLUMN ingestion_v4_style_pages.teacher_used_count IS 'Number of times this page was used as style anchor for teacher';
COMMENT ON COLUMN ingestion_v4_style_pages.qa_used_count IS 'Number of times this page was used for QA verification';
COMMENT ON COLUMN ingestion_v4_style_pages.domain IS 'Math domain: Algebra, Advanced Math, Problem Solving & Data Analysis, Geometry & Trigonometry';
COMMENT ON COLUMN ingestion_v4_style_pages.difficulty IS 'Inferred difficulty: easy, medium, hard, unknown';
COMMENT ON COLUMN ingestion_v4_style_pages.skill IS 'Specific skill tag (Tier 2 optional)';
COMMENT ON COLUMN ingestion_v4_style_pages.tag_confidence IS 'Confidence score 0-1 for inferred tags';
COMMENT ON COLUMN ingestion_v4_style_pages.diagram_present IS 'Whether page contains a diagram';

-- Indexes for domain-aware sampling
CREATE INDEX IF NOT EXISTS idx_style_pages_exam_section_domain_difficulty 
  ON ingestion_v4_style_pages(exam, section, domain, difficulty);
CREATE INDEX IF NOT EXISTS idx_style_pages_domain 
  ON ingestion_v4_style_pages(domain) WHERE domain IS NOT NULL;

-- A2) Add provenance columns to ingestion_v4_drafts
ALTER TABLE ingestion_v4_drafts
  ADD COLUMN IF NOT EXISTS style_page_ids UUID[] NULL,
  ADD COLUMN IF NOT EXISTS style_domain_mix_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS style_tag_confidence_avg REAL NULL;

COMMENT ON COLUMN ingestion_v4_drafts.style_page_ids IS 'Array of style page IDs (UUIDs) used for this draft';
COMMENT ON COLUMN ingestion_v4_drafts.style_domain_mix_score IS '0=clean (single domain), >0=mixed domains count minus 1';
COMMENT ON COLUMN ingestion_v4_drafts.style_tag_confidence_avg IS 'Average tag confidence of style pages used';

-- Index for provenance queries
CREATE INDEX IF NOT EXISTS idx_drafts_style_mix_score 
  ON ingestion_v4_drafts(style_domain_mix_score) WHERE style_domain_mix_score > 0;

-- A3) RPC functions for atomic counter increments
CREATE OR REPLACE FUNCTION increment_style_page_teacher_usage(page_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE ingestion_v4_style_pages
  SET 
    teacher_used_count = teacher_used_count + 1,
    last_teacher_used_at = NOW()
  WHERE id = ANY(page_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_style_page_qa_usage(page_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE ingestion_v4_style_pages
  SET 
    qa_used_count = qa_used_count + 1,
    last_qa_used_at = NOW()
  WHERE id = ANY(page_ids);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_style_page_teacher_usage IS 'Atomically increment teacher usage count for style pages';
COMMENT ON FUNCTION increment_style_page_qa_usage IS 'Atomically increment QA usage count for style pages';
