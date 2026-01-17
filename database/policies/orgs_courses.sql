-- RLS Policies for orgs and courses tables
-- Organization-scoped access control

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ORGS POLICIES
-- ============================================================================

-- Orgs visible to members
CREATE POLICY "orgs_select_members"
ON orgs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = orgs.id AND m.user_id = auth.uid()
  )
);

-- Only admins can create orgs (handled at application level)
-- No public insert policy

-- Members with admin role can update their org
CREATE POLICY "orgs_update_admin"
ON orgs FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = orgs.id 
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  )
);

-- ============================================================================
-- MEMBERSHIPS POLICIES
-- ============================================================================

-- Users can view memberships in their orgs
CREATE POLICY "memberships_select_own_orgs"
ON memberships FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id AND m.user_id = auth.uid()
  )
);

-- Org admins can manage memberships
CREATE POLICY "memberships_insert_admin"
ON memberships FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id 
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  )
);

CREATE POLICY "memberships_delete_admin"
ON memberships FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id 
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  )
);

-- ============================================================================
-- COURSES POLICIES
-- ============================================================================

-- Courses readable if public, or user is org member
CREATE POLICY "courses_select_visibility"
ON courses FOR SELECT
USING (
  visibility = 'public' OR
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = courses.org_id AND m.user_id = auth.uid()
  )
);

-- Courses created by org teachers/admins
CREATE POLICY "courses_insert_org_member"
ON courses FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = courses.org_id 
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

-- Updates limited to teachers/admins
CREATE POLICY "courses_update_org_member"
ON courses FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = courses.org_id 
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

-- Delete limited to admins
CREATE POLICY "courses_delete_admin"
ON courses FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = courses.org_id 
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  )
);

-- ============================================================================
-- SECTIONS POLICIES
-- ============================================================================

-- Sections inherit course visibility
CREATE POLICY "sections_select_via_course"
ON sections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = sections.course_id
      AND (
        c.visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
        )
      )
  )
);

-- Sections managed by course org teachers/admins
CREATE POLICY "sections_insert_via_course"
ON sections FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM courses c
    JOIN memberships m ON m.org_id = c.org_id
    WHERE c.id = sections.course_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

CREATE POLICY "sections_update_via_course"
ON sections FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM courses c
    JOIN memberships m ON m.org_id = c.org_id
    WHERE c.id = sections.course_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

CREATE POLICY "sections_delete_via_course"
ON sections FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM courses c
    JOIN memberships m ON m.org_id = c.org_id
    WHERE c.id = sections.course_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

-- ============================================================================
-- ITEMS POLICIES
-- ============================================================================

-- Items inherit section/course visibility
CREATE POLICY "items_select_via_section"
ON items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sections s
    JOIN courses c ON c.id = s.course_id
    WHERE s.id = items.section_id
      AND (
        c.visibility = 'public' OR
        EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
        )
      )
  )
);

-- Items managed by course org teachers/admins
CREATE POLICY "items_insert_via_section"
ON items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sections s
    JOIN courses c ON c.id = s.course_id
    JOIN memberships m ON m.org_id = c.org_id
    WHERE s.id = items.section_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

CREATE POLICY "items_update_via_section"
ON items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM sections s
    JOIN courses c ON c.id = s.course_id
    JOIN memberships m ON m.org_id = c.org_id
    WHERE s.id = items.section_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

CREATE POLICY "items_delete_via_section"
ON items FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM sections s
    JOIN courses c ON c.id = s.course_id
    JOIN memberships m ON m.org_id = c.org_id
    WHERE s.id = items.section_id
      AND m.user_id = auth.uid()
      AND m.role IN ('teacher', 'admin')
  )
);

COMMENT ON TABLE orgs IS 'RLS enabled - visible to members only';
COMMENT ON TABLE memberships IS 'RLS enabled - managed by org admins';
COMMENT ON TABLE courses IS 'RLS enabled - visibility based on public flag or org membership';
COMMENT ON TABLE sections IS 'RLS enabled - inherits course visibility';
COMMENT ON TABLE items IS 'RLS enabled - inherits course visibility';
