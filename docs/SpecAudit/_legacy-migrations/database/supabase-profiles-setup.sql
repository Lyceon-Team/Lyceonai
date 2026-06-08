-- ============================================================================
-- Supabase Profiles Table Setup
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1) Enable required extensions (no-op if they already exist)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2) Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_under_13 BOOLEAN DEFAULT FALSE,
  guardian_email TEXT,
  guardian_consent BOOLEAN DEFAULT FALSE,
  consent_given_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 3) Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 4) Update trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Read own profile
DROP POLICY IF EXISTS "read own profile" ON public.profiles;
CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Update own profile
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Admin can do anything (checks role claim in JWT)
DROP POLICY IF EXISTS "admin all" ON public.profiles;
CREATE POLICY "admin all" ON public.profiles
  AS PERMISSIVE FOR ALL
  USING (COALESCE(auth.jwt() ->> 'role', 'student') = 'admin')
  WITH CHECK (COALESCE(auth.jwt() ->> 'role', 'student') = 'admin');

-- 6) Auto-insert profile on new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7) Verification query
SELECT 'Profiles table setup complete' AS status;
SELECT COUNT(*) AS profile_count FROM public.profiles;
