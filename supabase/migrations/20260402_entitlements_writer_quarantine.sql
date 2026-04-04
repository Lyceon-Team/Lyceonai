-- Quarantine entitlement premium writes to webhook handlers only.
-- Ensure account creation does not explicitly set plan/status in runtime code.

DO $$
BEGIN
  IF to_regclass('public.entitlements') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.entitlements ALTER COLUMN plan SET DEFAULT ''free''';
    EXECUTE 'ALTER TABLE public.entitlements ALTER COLUMN status SET DEFAULT ''inactive''';
  END IF;
END $$;

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

  -- Create entitlement row without explicit plan/status writes
  INSERT INTO entitlements (account_id)
  VALUES (v_account_id)
  ON CONFLICT ON CONSTRAINT entitlements_account_id_unique DO NOTHING;

  RETURN v_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_account_for_user(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_account_for_user(UUID, TEXT) TO service_role;

