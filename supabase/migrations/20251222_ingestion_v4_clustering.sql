-- V4 Ingestion: Dynamic Clustering for Style Bank
-- This migration adds clustering infrastructure for coherent pack selection

-- A) Table: ingestion_v4_style_clusters
-- Represents a "question family" that groups similar style pages together
CREATE TABLE IF NOT EXISTS public.ingestion_v4_style_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL CHECK (section IN ('math', 'rw')),
  cluster_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  signature JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC NOT NULL DEFAULT 0.7,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  usage_count BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT ingestion_v4_style_clusters_section_key_unique UNIQUE (section, cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_style_clusters_section_active_usage
ON public.ingestion_v4_style_clusters (section, active, usage_count DESC);

CREATE INDEX IF NOT EXISTS idx_style_clusters_created
ON public.ingestion_v4_style_clusters (created_at DESC);

-- B) Table: ingestion_v4_style_page_cluster_map
-- Maps style pages to clusters (many-to-many, but typically one primary)
CREATE TABLE IF NOT EXISTS public.ingestion_v4_style_page_cluster_map (
  style_page_id UUID NOT NULL REFERENCES public.ingestion_v4_style_pages(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES public.ingestion_v4_style_clusters(id) ON DELETE CASCADE,
  match_confidence NUMERIC NOT NULL,
  match_reason TEXT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'llm' CHECK (assigned_by IN ('llm', 'admin', 'system')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (style_page_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_page_cluster_map_cluster
ON public.ingestion_v4_style_page_cluster_map (cluster_id);

CREATE INDEX IF NOT EXISTS idx_page_cluster_map_page
ON public.ingestion_v4_style_page_cluster_map (style_page_id);

-- C) Add clustering columns to ingestion_v4_style_pages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_style_pages' AND column_name = 'primary_cluster_id'
  ) THEN
    ALTER TABLE public.ingestion_v4_style_pages
    ADD COLUMN primary_cluster_id UUID NULL REFERENCES public.ingestion_v4_style_clusters(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_style_pages' AND column_name = 'cluster_confidence'
  ) THEN
    ALTER TABLE public.ingestion_v4_style_pages
    ADD COLUMN cluster_confidence NUMERIC NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_style_pages' AND column_name = 'structure_signature'
  ) THEN
    ALTER TABLE public.ingestion_v4_style_pages
    ADD COLUMN structure_signature JSONB NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_style_pages' AND column_name = 'last_clustered_at'
  ) THEN
    ALTER TABLE public.ingestion_v4_style_pages
    ADD COLUMN last_clustered_at TIMESTAMPTZ NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_style_pages_section_cluster
ON public.ingestion_v4_style_pages (section, primary_cluster_id);

-- Add clustering columns to ingestion_v4_drafts for provenance tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_drafts' AND column_name = 'style_cluster_id'
  ) THEN
    ALTER TABLE public.ingestion_v4_drafts
    ADD COLUMN style_cluster_id UUID NULL REFERENCES public.ingestion_v4_style_clusters(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_drafts' AND column_name = 'style_cluster_key'
  ) THEN
    ALTER TABLE public.ingestion_v4_drafts
    ADD COLUMN style_cluster_key TEXT NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_drafts' AND column_name = 'style_cluster_confidence'
  ) THEN
    ALTER TABLE public.ingestion_v4_drafts
    ADD COLUMN style_cluster_confidence NUMERIC NULL;
  END IF;
END $$;

-- D) RPC: Increment cluster usage count atomically
CREATE OR REPLACE FUNCTION public.v4_increment_cluster_usage(
  p_cluster_id UUID,
  p_n INT DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.ingestion_v4_style_clusters
  SET 
    usage_count = usage_count + p_n,
    updated_at = NOW()
  WHERE id = p_cluster_id;
END;
$$ LANGUAGE plpgsql;

-- RPC: Set primary cluster for a style page
CREATE OR REPLACE FUNCTION public.v4_set_primary_cluster(
  p_style_page_id UUID,
  p_cluster_id UUID,
  p_confidence NUMERIC
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.ingestion_v4_style_pages
  SET 
    primary_cluster_id = p_cluster_id,
    cluster_confidence = p_confidence,
    last_clustered_at = NOW()
  WHERE id = p_style_page_id;
END;
$$ LANGUAGE plpgsql;

-- Verification queries (run after migration):
-- SELECT COUNT(*) FROM public.ingestion_v4_style_clusters;
-- SELECT COUNT(*) FROM public.ingestion_v4_style_page_cluster_map;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ingestion_v4_style_pages' AND column_name LIKE '%cluster%';
