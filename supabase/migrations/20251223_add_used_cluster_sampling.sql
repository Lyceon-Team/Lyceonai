-- Add used_cluster_sampling boolean to ingestion_v4_drafts for explicit provenance tracking
-- This distinguishes whether a draft used cluster-based sampling vs domain-based fallback

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_v4_drafts' AND column_name = 'used_cluster_sampling'
  ) THEN
    ALTER TABLE public.ingestion_v4_drafts
    ADD COLUMN used_cluster_sampling BOOLEAN NOT NULL DEFAULT FALSE;
    
    COMMENT ON COLUMN public.ingestion_v4_drafts.used_cluster_sampling IS 
      'True if this draft was generated using cluster-based style sampling, False for domain-based fallback';
  END IF;
END $$;

-- Update existing drafts: set used_cluster_sampling=true where style_cluster_id is not null
UPDATE public.ingestion_v4_drafts
SET used_cluster_sampling = TRUE
WHERE style_cluster_id IS NOT NULL AND used_cluster_sampling = FALSE;
