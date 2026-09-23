-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- SECURITY DEFINER functions: no EXECUTE for PUBLIC / anon.
--
-- @spec [Coding Standards §6.1 (server-authoritative), §17; Doc-01 V8 guardian
--        trust model; CC Brief "SECURITY DEFINER Exposure Audit" A.3, B.2]
-- @implemented [2026-09-23]
--
-- plain English: PostgreSQL grants EXECUTE to PUBLIC on every new function
-- unless something revokes it. A SECURITY DEFINER function runs as its owner,
-- so RLS does not apply inside it, and PostgREST exposes every function the
-- caller can execute at /rest/v1/rpc. The repo's convention is an explicit
-- `REVOKE ALL ON FUNCTION … FROM PUBLIC` next to each SECURITY DEFINER
-- definition (104 of them). Five public SECURITY DEFINER functions were left
-- out. This migration closes those five so a rebuild from migrations produces
-- the same secure state production has.
--
-- MEASURED 2026-09-23 on a fresh apply of every migration (PG 16) and against
-- production (pg_proc.proacl, has_function_privilege). The two agree: of the
-- 82 SECURITY DEFINER functions in `public`, 77 carry an explicit REVOKE in the
-- repo and are service_role-only in both; these five were executable by
-- PUBLIC (hence anon) in both:
--
--   function                                    kind        production before
--   create_active_guardian_link_audited(…)      RPC, write  PUBLIC — REVOKEd by hand 2026-09-23
--   sever_crisis_audit_conversation()           trigger     PUBLIC
--   handle_new_user()                           trigger     PUBLIC
--   capture_mastery_constant_change()           trigger     PUBLIC
--   calendar_viewer_is_admin()                  RLS helper  PUBLIC + authenticated
--
-- WHY EACH IS SAFE TO REVOKE (named caller for every one):
--   create_active_guardian_link_audited — called only by the BFF with the
--     service-role client (server/lib/account.ts:245 createActiveGuardianLink, supabaseServer.rpc).
--     Anonymous callers could create an active guardian link between any two
--     profiles. This is B.2: the repo copy of the production hot-fix.
--   The three trigger functions — invoked only by their triggers. PostgreSQL
--     checks EXECUTE on a trigger function at CREATE TRIGGER time, never when
--     the trigger fires (verified 2026-09-23: after REVOKE ALL FROM PUBLIC, an
--     unprivileged role's INSERT still fires the trigger; a direct call is
--     denied). Revoking changes nothing for handle_new_user's auth.users insert
--     path; it removes a direct /rpc surface (which PostgreSQL already rejects
--     for trigger-returning functions — this is hygiene, not an exploit fix).
--   calendar_viewer_is_admin — an RLS helper referenced by two calendar
--     SELECT policies `TO authenticated`. It reads only the CALLER's own
--     profile via auth.uid(), so `authenticated` keeps EXECUTE; `anon`/PUBLIC
--     have no policy that uses it.
--
-- IDEMPOTENT: REVOKE of an absent privilege and GRANT of a held one are both
-- no-ops. Safe to re-run; safe against production as it stands.
--
-- rollback (re-exposes; do not run without a ruling):
--   GRANT EXECUTE ON FUNCTION <each function below> TO PUBLIC;
-- ---------------------------------------------------------------------------

BEGIN;

-- Group 1 — write-capable RPC: service_role only.
REVOKE ALL ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  TO service_role;

-- Group 2 — trigger functions: no direct callers at all.
REVOKE ALL ON FUNCTION public.sever_crisis_audit_conversation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_mastery_constant_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sever_crisis_audit_conversation() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_mastery_constant_change() TO service_role;

-- Group 3 — RLS helper: authenticated keeps EXECUTE, anonymous does not.
REVOKE ALL ON FUNCTION public.calendar_viewer_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_viewer_is_admin() TO authenticated, service_role;

COMMIT;
