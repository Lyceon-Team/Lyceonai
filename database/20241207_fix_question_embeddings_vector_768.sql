-- Migration: Fix question_embeddings vector dimension for Gemini compatibility
-- Date: 2024-12-07
-- Author: SAT Copilot Team
--
-- IMPORTANT: This is a DEV-ONLY migration that wipes existing embeddings.
-- DO NOT apply to production without proper backup and data migration strategy.
--
-- Purpose: Supabase question_embeddings was configured for OpenAI (1536D),
-- but we use Gemini text-embedding-004 which produces 768D vectors.
--
-- Instructions for Karl:
-- 1. Open Supabase SQL Editor (Dashboard > SQL Editor)
-- 2. Paste this entire file contents
-- 3. Run in the DEV project only
-- 4. After success, re-run: cd apps/api && npm run seed:dev-question

-- Step 1: Drop the existing embedding column (destroys all existing embeddings)
ALTER TABLE public.question_embeddings
  DROP COLUMN IF EXISTS embedding;

-- Step 2: Recreate embedding column with Gemini-compatible 768 dimensions
ALTER TABLE public.question_embeddings
  ADD COLUMN embedding vector(768);

-- Step 3: Recreate the IVFFlat index for efficient similarity search
-- Using cosine distance operator for semantic similarity
DROP INDEX IF EXISTS question_embeddings_embedding_idx;

CREATE INDEX question_embeddings_embedding_idx
  ON public.question_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Step 4: Verify the change
-- Run this to confirm the column type:
-- SELECT column_name, data_type, udt_name 
-- FROM information_schema.columns 
-- WHERE table_name = 'question_embeddings' AND column_name = 'embedding';
-- Expected: udt_name = 'vector'

-- After running this migration:
-- 1. All existing embeddings are deleted (they were incompatible anyway)
-- 2. The embedding column now accepts 768-dimensional vectors
-- 3. New embeddings from Gemini text-embedding-004 will work correctly
-- 4. Re-run seed script to create test embeddings
