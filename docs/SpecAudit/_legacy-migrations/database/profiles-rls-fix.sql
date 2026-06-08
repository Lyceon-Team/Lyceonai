-- Fix infinite recursion in public.profiles RLS policies
-- Strategy: Use JWT claims ONLY, never query profiles table in policies

-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "read own profile" ON public.profiles;
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
DROP POLICY IF EXISTS "admin all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_any" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- 1) Self read policy - users can read their own profile
-- NO recursion: uses auth.uid() = id (no SELECT from profiles)
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 2) Self update policy - users can update their own profile  
-- NO recursion: uses auth.uid() = id (no SELECT from profiles)
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3) Admin read all profiles - uses JWT claim ONLY
-- NO recursion: checks auth.jwt()->>'role' (no SELECT from profiles)
CREATE POLICY profiles_admin_select_all ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'role'),
      (auth.jwt() ->> 'role'),
      'student'
    ) = 'admin'
  );

-- 4) Admin update all profiles - uses JWT claim ONLY
-- NO recursion: checks auth.jwt()->>'role' (no SELECT from profiles)
CREATE POLICY profiles_admin_update_all ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'role'),
      (auth.jwt() ->> 'role'),
      'student'
    ) = 'admin'
  )
  WITH CHECK (
    COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'role'),
      (auth.jwt() ->> 'role'),
      'student'
    ) = 'admin'
  );

-- Insert is handled by trigger only, no policy needed
-- (The trigger uses SECURITY DEFINER to bypass RLS)
