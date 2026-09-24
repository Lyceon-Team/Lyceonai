-- SECURITY DEFINER exposure gate — lists every violation, one row each.
--
-- @spec [Coding Standards §6.1, §17; CC Brief "SECURITY DEFINER Exposure Audit" A.3]
-- @implemented 2026-09-23
--
-- plain English: a SECURITY DEFINER function runs as its owner (RLS does not
-- apply) and PostgREST exposes every function the caller may EXECUTE at
-- /rest/v1/rpc. PostgreSQL grants EXECUTE to PUBLIC on creation unless a
-- migration revokes it. Run against a FRESH apply of supabase/migrations —
-- where no platform default privileges hide a missing REVOKE — this returns
-- one row per public SECURITY DEFINER function that is:
--   (a) executable by anon (directly or via PUBLIC) — never allowed; or
--   (b) executable by authenticated with no caller check in its body
--       (auth.uid / auth.jwt / auth.role) — an RLS helper that reads the
--       caller's own identity is the only legitimate authenticated grant.
-- Zero rows = pass. Fix a row by adding, next to the CREATE FUNCTION:
--   REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO service_role;
SELECT p.oid::regprocedure::text AS function,
       CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
            THEN 'anon can EXECUTE (missing REVOKE ... FROM PUBLIC, anon)'
            ELSE 'authenticated can EXECUTE with no auth.uid()/jwt()/role() caller check'
       END AS violation
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.prosrc !~* 'auth\.(uid|jwt|role)\s*\(')
  )
ORDER BY 1;
