-- Add consent_source audit field for traceable consent actions.
-- This supports explicit signup/Google flow consent provenance.

ALTER TABLE public.legal_acceptances
ADD COLUMN IF NOT EXISTS consent_source TEXT;

COMMENT ON COLUMN public.legal_acceptances.consent_source IS
  'Origin of the legal acceptance action (email_signup_form, google_continue_pre_oauth, etc).';
