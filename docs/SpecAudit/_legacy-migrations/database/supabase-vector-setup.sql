-- Supabase Vector Database Setup
-- Required for Task 3: Vector Search Integration with OpenAI Embeddings
-- Execute this SQL in your Supabase database

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create vectors table for question embeddings (Gemini - 768 dimensions)
CREATE TABLE IF NOT EXISTS vectors (
  id text PRIMARY KEY,
  content text NOT NULL,
  embedding vector(768) NOT NULL, -- Google Gemini text-embedding-004 dimensions
  metadata jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Create index for vector similarity search (Gemini)
CREATE INDEX IF NOT EXISTS vectors_embedding_idx ON vectors 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create match_vectors RPC function for similarity search (Gemini)
CREATE OR REPLACE FUNCTION match_vectors(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id text,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vectors.id,
    vectors.content,
    vectors.metadata,
    1 - (vectors.embedding <=> query_embedding) AS similarity
  FROM vectors
  WHERE 1 - (vectors.embedding <=> query_embedding) > match_threshold
  ORDER BY vectors.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create question_embeddings table for OpenAI embeddings (1536 dimensions)
CREATE TABLE IF NOT EXISTS question_embeddings (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimensions
  stem TEXT,
  section TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search (OpenAI)
CREATE INDEX IF NOT EXISTS question_embeddings_embedding_idx 
ON question_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index on question_id for fast lookups
CREATE INDEX IF NOT EXISTS question_embeddings_question_id_idx 
ON question_embeddings (question_id);

-- Create match_questions RPC function for similarity search (OpenAI)
CREATE OR REPLACE FUNCTION match_questions(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id text,
  question_id text,
  embedding vector(1536),
  stem text,
  section text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    question_embeddings.id,
    question_embeddings.question_id,
    question_embeddings.embedding,
    question_embeddings.stem,
    question_embeddings.section,
    question_embeddings.metadata,
    question_embeddings.created_at,
    1 - (question_embeddings.embedding <=> query_embedding) as similarity
  FROM question_embeddings
  WHERE 1 - (question_embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY question_embeddings.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create table creation RPC (for ensureVectorTable)
CREATE OR REPLACE FUNCTION create_vectors_table_if_not_exists()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Table creation logic already handled above
  -- This function exists for compatibility with the client code
  NULL;
END;
$$;

-- Enable Row Level Security (RLS) for production safety
ALTER TABLE vectors ENABLE ROW LEVEL SECURITY;

-- Create policies for secure access
-- SELECT policy
CREATE POLICY "Enable select for all users" ON vectors
  FOR SELECT USING (true);

-- INSERT policy with proper WITH CHECK
CREATE POLICY "Enable insert for all users" ON vectors
  FOR INSERT WITH CHECK (true);

-- UPDATE policy with proper WITH CHECK  
CREATE POLICY "Enable update for all users" ON vectors
  FOR UPDATE USING (true) WITH CHECK (true);

-- DELETE policy
CREATE POLICY "Enable delete for all users" ON vectors
  FOR DELETE USING (true);

-- For production, use service role instead:
-- CREATE POLICY "Service role access" ON vectors
--   FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');