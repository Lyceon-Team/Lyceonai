-- RLS Policies for questions and related tables
-- Questions are generally public/org-scoped based on their course
-- Document processing tables (documents, chunks, transcripts, embeddings) inherit course RLS

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- QUESTIONS POLICIES
-- ============================================================================

-- Questions readable by authenticated users
CREATE POLICY "questions_select_authenticated"
ON questions FOR SELECT
USING (auth.role() = 'authenticated');

-- Questions writable by admins only
CREATE POLICY "questions_insert_admin"
ON questions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

CREATE POLICY "questions_update_admin"
ON questions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

CREATE POLICY "questions_delete_admin"
ON questions FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

-- ============================================================================
-- DOCUMENTS POLICIES
-- ============================================================================

-- Documents readable by all (or restrict by org if needed)
-- For now, make public for SAT practice materials
CREATE POLICY "documents_select_all"
ON documents FOR SELECT
USING (true);

-- Documents created by admins only (handled at app level)
-- No public insert policy

CREATE POLICY "documents_update_admin"
ON documents FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

-- ============================================================================
-- CHUNKS POLICIES
-- ============================================================================

-- Chunks inherit course visibility
CREATE POLICY "chunks_select_via_course"
ON chunks FOR SELECT
USING (
  course_id IS NULL OR
  EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = chunks.course_id
      AND (
        c.visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
        )
      )
  )
);

-- Chunks created by system/admin (no user insert)

-- ============================================================================
-- TRANSCRIPTS POLICIES
-- ============================================================================

-- Transcripts inherit course visibility
CREATE POLICY "transcripts_select_via_course"
ON transcripts FOR SELECT
USING (
  course_id IS NULL OR
  EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = transcripts.course_id
      AND (
        c.visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
        )
      )
  )
);

-- ============================================================================
-- EMBEDDINGS POLICIES
-- ============================================================================

-- Embeddings publicly readable (used for semantic search)
CREATE POLICY "embeddings_select_all"
ON embeddings FOR SELECT
USING (true);

-- Embeddings created by system only (no user insert)

COMMENT ON TABLE questions IS 'RLS enabled - accessible via course visibility or global bank';
COMMENT ON TABLE documents IS 'RLS enabled - public SAT materials';
COMMENT ON TABLE chunks IS 'RLS enabled - inherits course visibility';
COMMENT ON TABLE transcripts IS 'RLS enabled - inherits course visibility';
COMMENT ON TABLE embeddings IS 'RLS enabled - public for semantic search';

