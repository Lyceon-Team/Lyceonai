-- Guardian Profile Feature Migration
-- Adds support for parent/guardian accounts linking to student accounts
-- IDEMPOTENT: Safe to run on fresh DB or existing DB with partial schema
-- ENUM-SAFE: Works whether profiles.role is TEXT or ENUM (profile_role)
-- UUID-SAFE: Works whether profiles.id is TEXT or UUID

-- ============================================================================
-- STEP 0: Detect schema types at runtime
-- ============================================================================
DO $$
DECLARE
  id_type TEXT;
  role_type TEXT;
BEGIN
  SELECT udt_name INTO id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';
  
  SELECT udt_name INTO role_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
  
  RAISE NOTICE 'Schema detection: profiles.id type=%, profiles.role type=%', id_type, role_type;
END $$;

-- ============================================================================
-- STEP 1: Add student_link_code column (if not exists)
-- ============================================================================
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS student_link_code TEXT;

-- ============================================================================
-- STEP 2: Add guardian_profile_id column (dynamic type matching profiles.id)
-- ============================================================================
DO $$
DECLARE
  id_udt_name TEXT;
  col_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'guardian_profile_id'
  ) INTO col_exists;
  
  IF col_exists THEN
    RAISE NOTICE 'guardian_profile_id column already exists, skipping creation';
  ELSE
    SELECT udt_name INTO id_udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';
    
    IF id_udt_name = 'uuid' THEN
      EXECUTE 'ALTER TABLE public.profiles ADD COLUMN guardian_profile_id UUID REFERENCES public.profiles(id)';
      RAISE NOTICE 'Added guardian_profile_id as UUID to match profiles.id';
    ELSE
      EXECUTE 'ALTER TABLE public.profiles ADD COLUMN guardian_profile_id TEXT REFERENCES public.profiles(id)';
      RAISE NOTICE 'Added guardian_profile_id as TEXT to match profiles.id';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- STEP 2B: Ensure FK constraint exists on guardian_profile_id (idempotent)
-- ============================================================================
DO $$
DECLARE
  fk_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = 'profiles' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name = 'guardian_profile_id'
  ) INTO fk_exists;
  
  IF fk_exists THEN
    RAISE NOTICE 'FK constraint on guardian_profile_id already exists';
  ELSE
    EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_guardian_profile_id_fkey FOREIGN KEY (guardian_profile_id) REFERENCES public.profiles(id)';
    RAISE NOTICE 'Added FK constraint on guardian_profile_id';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'FK constraint already exists (caught duplicate_object)';
END $$;

-- ============================================================================
-- STEP 2C: Add self-reference prevention constraint (guardian cannot be self)
-- ============================================================================
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND constraint_name = 'profiles_guardian_not_self'
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    RAISE NOTICE 'profiles_guardian_not_self constraint already exists';
  ELSE
    EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_guardian_not_self CHECK (guardian_profile_id IS NULL OR guardian_profile_id <> id)';
    RAISE NOTICE 'Added profiles_guardian_not_self constraint';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'profiles_guardian_not_self constraint already exists (caught duplicate_object)';
END $$;

-- ============================================================================
-- STEP 3: Handle role constraint/enum
-- ============================================================================
DO $$
DECLARE
  role_udt_name TEXT;
BEGIN
  SELECT udt_name INTO role_udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
  
  IF role_udt_name = 'text' THEN
    EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check';
    EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY[''student''::text, ''admin''::text, ''guardian''::text]))';
    RAISE NOTICE 'Updated TEXT role CHECK constraint to include guardian';
  ELSE
    BEGIN
      EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS ''guardian''', role_udt_name);
      RAISE NOTICE 'Added guardian to enum type %', role_udt_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add guardian to enum (may already exist): %', SQLERRM;
    END;
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Create unique partial index on student_link_code
-- ============================================================================
DROP INDEX IF EXISTS idx_profiles_student_link_code;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_link_code_key 
ON public.profiles(student_link_code) WHERE student_link_code IS NOT NULL;

-- ============================================================================
-- STEP 5: Create/update link code trigger function (ENUM-SAFE)
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_student_link_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  max_attempts INT := 10;
  attempt INT := 0;
  is_student BOOLEAN;
BEGIN
  is_student := (NEW.role::text = 'student');
  
  IF is_student AND (NEW.student_link_code IS NULL OR NEW.student_link_code = '') THEN
    LOOP
      new_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
      BEGIN
        NEW.student_link_code := new_code;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempt := attempt + 1;
        IF attempt >= max_attempts THEN
          RAISE EXCEPTION 'Could not generate unique student link code after % attempts', max_attempts;
        END IF;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 6: Create triggers for auto-generating link codes (INSERT + UPDATE)
-- ============================================================================
DROP TRIGGER IF EXISTS set_student_link_code ON public.profiles;
CREATE TRIGGER set_student_link_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_student_link_code();

DROP TRIGGER IF EXISTS set_student_link_code_update ON public.profiles;
CREATE TRIGGER set_student_link_code_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role::text IS DISTINCT FROM NEW.role::text OR OLD.student_link_code IS DISTINCT FROM NEW.student_link_code)
  EXECUTE FUNCTION generate_student_link_code();

-- ============================================================================
-- STEP 7: Generate link codes for existing students (ENUM-SAFE)
-- ============================================================================
UPDATE public.profiles
SET student_link_code = upper(substring(md5(random()::text || id::text || clock_timestamp()::text) from 1 for 8))
WHERE role::text = 'student' AND (student_link_code IS NULL OR student_link_code = '');

-- ============================================================================
-- STEP 8: Create guardian_link_audit table (dynamic type matching profiles.id)
-- ============================================================================
DO $$
DECLARE
  id_udt_name TEXT;
  table_exists BOOLEAN;
  audit_gpid_type TEXT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'guardian_link_audit'
  ) INTO table_exists;
  
  SELECT udt_name INTO id_udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';
  
  IF table_exists THEN
    RAISE NOTICE 'guardian_link_audit table already exists, checking columns...';
    
    SELECT udt_name INTO audit_gpid_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'guardian_profile_id';
    
    IF audit_gpid_type IS NOT NULL AND audit_gpid_type <> id_udt_name THEN
      RAISE NOTICE '⚠️  TYPE MISMATCH: guardian_link_audit.guardian_profile_id is % but profiles.id is %. Manual remediation required - see docs/qa/release-gates.md', audit_gpid_type, id_udt_name;
    ELSE
      RAISE NOTICE 'guardian_link_audit types match profiles.id (%)' , id_udt_name;
    END IF;
    
    -- Add canonical columns (production schema) if missing
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'outcome') THEN
      EXECUTE 'ALTER TABLE public.guardian_link_audit ADD COLUMN outcome TEXT';
      RAISE NOTICE 'Added outcome column to guardian_link_audit';
    END IF;
    
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'student_code_prefix') THEN
      EXECUTE 'ALTER TABLE public.guardian_link_audit ADD COLUMN student_code_prefix TEXT';
      RAISE NOTICE 'Added student_code_prefix column to guardian_link_audit';
    END IF;
    
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'request_id') THEN
      EXECUTE 'ALTER TABLE public.guardian_link_audit ADD COLUMN request_id TEXT';
      RAISE NOTICE 'Added request_id column to guardian_link_audit';
    END IF;
    
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'metadata') THEN
      EXECUTE 'ALTER TABLE public.guardian_link_audit ADD COLUMN metadata JSONB';
      RAISE NOTICE 'Added metadata column to guardian_link_audit';
    END IF;
  ELSE
    IF id_udt_name = 'uuid' THEN
      EXECUTE '
        CREATE TABLE public.guardian_link_audit (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          occurred_at TIMESTAMPTZ DEFAULT NOW(),
          guardian_profile_id UUID NOT NULL REFERENCES public.profiles(id),
          student_profile_id UUID REFERENCES public.profiles(id),
          action TEXT NOT NULL,
          outcome TEXT,
          student_code_prefix TEXT,
          request_id TEXT,
          metadata JSONB
        )
      ';
      RAISE NOTICE 'Created guardian_link_audit table with UUID profile references';
    ELSE
      EXECUTE '
        CREATE TABLE public.guardian_link_audit (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          occurred_at TIMESTAMPTZ DEFAULT NOW(),
          guardian_profile_id TEXT NOT NULL REFERENCES public.profiles(id),
          student_profile_id TEXT REFERENCES public.profiles(id),
          action TEXT NOT NULL,
          outcome TEXT,
          student_code_prefix TEXT,
          request_id TEXT,
          metadata JSONB
        )
      ';
      RAISE NOTICE 'Created guardian_link_audit table with TEXT profile references';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- STEP 9: Create indexes for query performance (idempotent)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_guardian_link_audit_guardian 
ON public.guardian_link_audit(guardian_profile_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_link_audit_student 
ON public.guardian_link_audit(student_profile_id) 
WHERE student_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_link_audit_occurred_desc
ON public.guardian_link_audit(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_link_audit_request_id
ON public.guardian_link_audit(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_guardian_profile_id 
ON public.profiles(guardian_profile_id) 
WHERE guardian_profile_id IS NOT NULL;

-- ============================================================================
-- STEP 10: Final verification output
-- ============================================================================
DO $$
DECLARE
  id_type TEXT;
  role_type TEXT;
  gpid_type TEXT;
  audit_gpid_type TEXT;
  fk_exists BOOLEAN;
  self_constraint_exists BOOLEAN;
  insert_trigger_exists BOOLEAN;
  update_trigger_exists BOOLEAN;
BEGIN
  SELECT udt_name INTO id_type FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';
  
  SELECT udt_name INTO role_type FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
  
  SELECT udt_name INTO gpid_type FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'guardian_profile_id';
  
  SELECT udt_name INTO audit_gpid_type FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'guardian_link_audit' AND column_name = 'guardian_profile_id';
  
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'profiles' 
      AND tc.constraint_type = 'FOREIGN KEY' AND ccu.column_name = 'guardian_profile_id'
  ) INTO fk_exists;
  
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'profiles' AND constraint_name = 'profiles_guardian_not_self'
  ) INTO self_constraint_exists;
  
  SELECT EXISTS(
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'profiles' AND trigger_name = 'set_student_link_code' AND event_manipulation = 'INSERT'
  ) INTO insert_trigger_exists;
  
  SELECT EXISTS(
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'profiles' AND trigger_name = 'set_student_link_code_update' AND event_manipulation = 'UPDATE'
  ) INTO update_trigger_exists;
  
  RAISE NOTICE '=== MIGRATION VERIFICATION ===';
  RAISE NOTICE 'profiles.id type: %', id_type;
  RAISE NOTICE 'profiles.role type: %', role_type;
  RAISE NOTICE 'profiles.guardian_profile_id type: %', gpid_type;
  RAISE NOTICE 'guardian_link_audit.guardian_profile_id type: %', audit_gpid_type;
  RAISE NOTICE 'Type consistency: %', CASE WHEN id_type = gpid_type AND id_type = audit_gpid_type THEN 'OK' ELSE 'MISMATCH' END;
  RAISE NOTICE 'FK constraint exists: %', fk_exists;
  RAISE NOTICE 'Self-reference constraint exists: %', self_constraint_exists;
  RAISE NOTICE 'INSERT trigger exists: %', insert_trigger_exists;
  RAISE NOTICE 'UPDATE trigger exists: %', update_trigger_exists;
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
