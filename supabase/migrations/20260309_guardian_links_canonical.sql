-- =============================================================================
-- MIGRATION: Guardian Links Canonical Table (Source of Truth Unification)
-- Wave 1.1 — guardian_links becomes the single source of truth for guardian↔student
-- 
-- BEFORE: profiles.guardian_profile_id was used everywhere (conflicting with
--         the declared-canonical guardian_links table that didn't even exist).
-- AFTER:  guardian_links table exists and is the canonical relationship store.
--         profiles.guardian_profile_id is deprecated and will be kept in sync
--         during transition, then removed in a future migration.
--
-- IDEMPOTENT: Safe to re-run.
-- =============================================================================

-- STEP 1: Create guardian_links table (the canonical guardian↔student relationship)
DO $$
DECLARE
  id_udt_name TEXT;
  table_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guardian_links'
  ) INTO table_exists;

  SELECT udt_name INTO id_udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';

  IF table_exists THEN
    RAISE NOTICE 'guardian_links table already exists, skipping creation';
  ELSE
    IF id_udt_name = 'uuid' THEN
      EXECUTE '
        CREATE TABLE public.guardian_links (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guardian_profile_id UUID NOT NULL REFERENCES public.profiles(id),
          student_user_id UUID NOT NULL REFERENCES public.profiles(id),
          account_id UUID,
          status TEXT NOT NULL DEFAULT ''active'' CHECK (status IN (''active'', ''revoked'')),
          linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          UNIQUE(guardian_profile_id, student_user_id)
        )
      ';
    ELSE
      EXECUTE '
        CREATE TABLE public.guardian_links (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guardian_profile_id TEXT NOT NULL REFERENCES public.profiles(id),
          student_user_id TEXT NOT NULL REFERENCES public.profiles(id),
          account_id TEXT,
          status TEXT NOT NULL DEFAULT ''active'' CHECK (status IN (''active'', ''revoked'')),
          linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          UNIQUE(guardian_profile_id, student_user_id)
        )
      ';
    END IF;
    RAISE NOTICE 'Created guardian_links table';
  END IF;
END $$;

-- STEP 2: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_guardian_links_guardian
  ON public.guardian_links(guardian_profile_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guardian_links_student
  ON public.guardian_links(student_user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guardian_links_account
  ON public.guardian_links(account_id) WHERE account_id IS NOT NULL;

-- STEP 3: Self-reference prevention
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' 
      AND table_name = 'guardian_links' 
      AND constraint_name = 'guardian_links_no_self_link'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RAISE NOTICE 'guardian_links_no_self_link constraint already exists';
  ELSE
    EXECUTE 'ALTER TABLE public.guardian_links ADD CONSTRAINT guardian_links_no_self_link CHECK (guardian_profile_id <> student_user_id)';
    RAISE NOTICE 'Added guardian_links_no_self_link constraint';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'guardian_links_no_self_link constraint already exists (caught duplicate_object)';
END $$;

-- STEP 4: Seed guardian_links from existing profiles.guardian_profile_id data
-- This ensures any existing linkages are migrated to the canonical table
INSERT INTO public.guardian_links (guardian_profile_id, student_user_id, status, linked_at)
SELECT 
  guardian_profile_id,
  id,
  'active',
  NOW()
FROM public.profiles
WHERE guardian_profile_id IS NOT NULL
  AND role::text = 'student'
ON CONFLICT (guardian_profile_id, student_user_id) DO NOTHING;

-- STEP 5: Enable RLS
ALTER TABLE public.guardian_links ENABLE ROW LEVEL SECURITY;

-- STEP 6: RLS policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'guardian_links_service') THEN
    CREATE POLICY guardian_links_service ON public.guardian_links FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'guardian_links_guardian_read') THEN
    CREATE POLICY guardian_links_guardian_read ON public.guardian_links FOR SELECT
    USING (auth.uid() = guardian_profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'guardian_links_student_read') THEN
    CREATE POLICY guardian_links_student_read ON public.guardian_links FOR SELECT
    USING (auth.uid() = student_user_id);
  END IF;
END $$;

-- STEP 7: Verification
DO $$
DECLARE
  table_exists BOOLEAN;
  link_count BIGINT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guardian_links'
  ) INTO table_exists;

  SELECT count(*) INTO link_count FROM public.guardian_links;

  RAISE NOTICE '=== GUARDIAN_LINKS MIGRATION VERIFICATION ===';
  RAISE NOTICE 'guardian_links table exists: %', table_exists;
  RAISE NOTICE 'guardian_links row count: %', link_count;
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
