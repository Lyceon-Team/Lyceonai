-- Replace legacy guardian RLS policy that depended on profiles.guardian_profile_id
-- Canonical guardian visibility must derive from guardian_links with active status.

DO $$
BEGIN
  IF to_regclass('public.user_competencies') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS user_competencies_guardian_read ON public.user_competencies';
    EXECUTE '
      CREATE POLICY user_competencies_guardian_read ON public.user_competencies
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.guardian_links gl
          WHERE gl.student_user_id = user_competencies.user_id
            AND gl.guardian_profile_id = auth.uid()
            AND gl.status = ''active''
        )
      )
    ';
  END IF;
END $$;
