-- Audit current RLS policies and functions on public.profiles
-- This helps identify infinite recursion caused by policies querying profiles

-- 1) List all policies on profiles table
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd, 
  qual, 
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- 2) List all functions that reference public.profiles
SELECT 
  n.nspname AS schema, 
  p.proname AS function, 
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%public.profiles%'
ORDER BY n.nspname, p.proname;

-- 3) Check if handle_new_user trigger exists and has SECURITY DEFINER
SELECT 
  n.nspname AS schema,
  p.proname AS function_name,
  CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'handle_new_user'
ORDER BY n.nspname;
