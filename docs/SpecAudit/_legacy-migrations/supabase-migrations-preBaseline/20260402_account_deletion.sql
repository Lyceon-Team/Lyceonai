-- Create a table to track account deletion requests
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('pending', 'cancelled', 'completed')) DEFAULT 'pending'
);

-- Index for quick lookups of pending requests
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status ON public.account_deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_id ON public.account_deletion_requests(user_id);
-- De-identification function
CREATE OR REPLACE FUNCTION deidentify_user(target_user_id UUID)
RETURNS void AS $$
BEGIN
    -- Remove direct PII from profile
    UPDATE public.profiles
    SET 
        first_name = NULL,
        last_name = NULL,
        phone_number = NULL,
        date_of_birth = NULL,
        address = NULL,
        display_name = 'De-identified User',
        email = CONCAT('deleted_', gen_random_uuid(), '@deleted.lyceon.ai')
    WHERE id = target_user_id;

    -- Note: we keep internal IDs everywhere to maintain aggregation continuity, 
    -- as requested by the compliance requirements.
    
    -- Anonymize financial/stripe metadata if needed in entitlements
    UPDATE public.entitlements
    SET stripe_customer_id = NULL
    WHERE account_id IN (
        SELECT account_id FROM public.lyceon_account_members WHERE user_id = target_user_id
    );

END;
$$ LANGUAGE plpgsql;
