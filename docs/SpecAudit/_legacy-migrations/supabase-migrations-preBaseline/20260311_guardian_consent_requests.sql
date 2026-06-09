-- =============================================================================
-- MIGRATION: Guardian Consent Requests Table
-- Adds the guardian_consent_requests table for COPPA compliance.
-- Tracks pending/approved/expired parental consent requests for under-13 users.
--
-- IDEMPOTENT: Safe to re-run.
-- =============================================================================

-- STEP 1: Create guardian_consent_requests table
CREATE TABLE IF NOT EXISTS public.guardian_consent_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guardian_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired', 'revoked')),
  verification_method TEXT DEFAULT 'stripe_auth',
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- STEP 2: Indexes
CREATE INDEX IF NOT EXISTS idx_guardian_consent_requests_child
  ON public.guardian_consent_requests(child_id);

CREATE INDEX IF NOT EXISTS idx_guardian_consent_requests_status
  ON public.guardian_consent_requests(status)
  WHERE status = 'pending';

-- STEP 3: Enable RLS
ALTER TABLE public.guardian_consent_requests ENABLE ROW LEVEL SECURITY;

-- STEP 4: RLS Policies
-- Service role can do everything (used by backend)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'guardian_consent_requests_service'
      AND tablename = 'guardian_consent_requests'
  ) THEN
    CREATE POLICY guardian_consent_requests_service
      ON public.guardian_consent_requests
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Students can read their own consent request status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'guardian_consent_requests_child_read'
      AND tablename = 'guardian_consent_requests'
  ) THEN
    CREATE POLICY guardian_consent_requests_child_read
      ON public.guardian_consent_requests
      FOR SELECT
      USING (auth.uid() = child_id);
  END IF;
END $$;

-- STEP 5: Verification
DO $$
DECLARE
  table_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'guardian_consent_requests'
  ) INTO table_exists;

  RAISE NOTICE '=== GUARDIAN_CONSENT_REQUESTS MIGRATION ===';
  RAISE NOTICE 'Table exists: %', table_exists;
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
