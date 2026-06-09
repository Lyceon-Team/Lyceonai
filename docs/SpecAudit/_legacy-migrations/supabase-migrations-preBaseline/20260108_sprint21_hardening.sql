-- Sprint 2.1 Production Hardening Migration
-- Idempotent: safe to run multiple times

-- 1. Create stripe_webhook_events table for idempotency
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create guardian_preferences table for multi-student guardians
CREATE TABLE IF NOT EXISTS public.guardian_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_account_id UUID REFERENCES public.lyceon_accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ensure entitlements has UNIQUE constraint on account_id (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'entitlements_account_id_unique'
  ) THEN
    ALTER TABLE public.entitlements 
    ADD CONSTRAINT entitlements_account_id_unique UNIQUE (account_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Create or replace ensure_account_for_user function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.ensure_account_for_user(
  p_user_id UUID,
  p_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_existing_account_id UUID;
BEGIN
  -- Check if user already has an account membership
  SELECT account_id INTO v_existing_account_id
  FROM lyceon_account_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_account_id IS NOT NULL THEN
    RETURN v_existing_account_id;
  END IF;

  -- Create new account
  INSERT INTO lyceon_accounts (id, created_at)
  VALUES (gen_random_uuid(), NOW())
  RETURNING id INTO v_account_id;

  -- Create membership
  INSERT INTO lyceon_account_members (account_id, user_id, role)
  VALUES (v_account_id, p_user_id, p_role);

  -- Create free entitlement using ON CONFLICT
  INSERT INTO entitlements (account_id, plan, status)
  VALUES (v_account_id, 'free', 'inactive')
  ON CONFLICT ON CONSTRAINT entitlements_account_id_unique DO NOTHING;

  RETURN v_account_id;
END;
$$;

-- 5. Grant execute permission
GRANT EXECUTE ON FUNCTION public.ensure_account_for_user(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_account_for_user(UUID, TEXT) TO service_role;

-- 6. Add index for webhook events lookup
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created_at 
ON public.stripe_webhook_events(created_at);

-- 7. Add RLS policies for guardian_preferences
ALTER TABLE public.guardian_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardian_preferences_select_own ON public.guardian_preferences;
CREATE POLICY guardian_preferences_select_own ON public.guardian_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS guardian_preferences_insert_own ON public.guardian_preferences;
CREATE POLICY guardian_preferences_insert_own ON public.guardian_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS guardian_preferences_update_own ON public.guardian_preferences;
CREATE POLICY guardian_preferences_update_own ON public.guardian_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role bypass for guardian_preferences
DROP POLICY IF EXISTS guardian_preferences_service_role ON public.guardian_preferences;
CREATE POLICY guardian_preferences_service_role ON public.guardian_preferences
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
