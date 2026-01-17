-- Storage Policies for Supabase Storage Buckets
-- These policies control access to files stored in Supabase Storage buckets
-- Assumes buckets: raw_uploads, transcripts, artifacts

-- Enable RLS on storage.objects table
ALTER TABLE IF EXISTS storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own uploaded files
-- Bucket: raw_uploads
-- Pattern: raw_uploads/{user_id}/*
CREATE POLICY IF NOT EXISTS "raw_uploads_read_own"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'raw_uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can upload to their own folder
-- Bucket: raw_uploads
CREATE POLICY IF NOT EXISTS "raw_uploads_write_own"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'raw_uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can delete their own files
-- Bucket: raw_uploads
CREATE POLICY IF NOT EXISTS "raw_uploads_delete_own"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'raw_uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Read transcripts for courses you have access to
-- Bucket: transcripts
-- Pattern: transcripts/{course_id}/*
CREATE POLICY IF NOT EXISTS "transcripts_read_accessible"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'transcripts'
  AND EXISTS (
    SELECT 1
    FROM courses c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND (
        c.visibility = 'public'
        OR (
          c.visibility = 'org'
          AND c.org_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
          )
        )
      )
  )
);

-- Policy: Only teachers/admins can upload transcripts
-- Bucket: transcripts
CREATE POLICY IF NOT EXISTS "transcripts_write_teachers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'transcripts'
  AND EXISTS (
    SELECT 1
    FROM courses c
    JOIN memberships m ON m.org_id = c.org_id 
    WHERE c.id::text = (storage.foldername(name))[1]
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

-- Policy: Read artifacts for courses you have access to
-- Bucket: artifacts
-- Pattern: artifacts/{course_id}/*
CREATE POLICY IF NOT EXISTS "artifacts_read_accessible"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'artifacts'
  AND EXISTS (
    SELECT 1
    FROM courses c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND (
        c.visibility = 'public'
        OR (
          c.visibility = 'org'
          AND c.org_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
          )
        )
      )
  )
);

-- Policy: Teachers/admins can upload artifacts
-- Bucket: artifacts
CREATE POLICY IF NOT EXISTS "artifacts_write_teachers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'artifacts'
  AND EXISTS (
    SELECT 1
    FROM courses c
    JOIN memberships m ON m.org_id = c.org_id
    WHERE c.id::text = (storage.foldername(name))[1]
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

-- Comments for documentation
COMMENT ON TABLE storage.objects IS 'RLS enabled - file access based on bucket and user permissions';
