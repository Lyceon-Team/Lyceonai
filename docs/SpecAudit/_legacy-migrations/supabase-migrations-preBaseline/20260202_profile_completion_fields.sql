-- Add profile completion fields to profiles table
-- Sprint 2 PR-4: Make /profile/complete fully functional

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS address JSONB,
ADD COLUMN IF NOT EXISTS time_zone TEXT,
ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en',
ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- Add index for profile_completed_at for quick queries
CREATE INDEX IF NOT EXISTS idx_profiles_completed_at ON public.profiles(profile_completed_at);

-- Verification
SELECT 'Profile completion fields added successfully' AS status;
