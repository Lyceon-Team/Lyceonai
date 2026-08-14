-- LYCEON-MIGRATION-REVIEWED
-- @spec [Doc-03B_V4.1 §12C — memory_summary_updated channel]
-- @implemented 2026-08-14
--
-- plain English: RPC function for firing the `memory_summary_updated` NOTIFY
-- channel when a memory summary is written or refreshed. Called by the BFF
-- compaction service after writing to tutor_memory_summaries.
--
-- The NOTIFY payload matches Doc 03B §12C:
--   channel: memory_summary_updated
--   payload: {"student_id": "...", "summary_type": "..."}
--
-- Subscribers (per §12C): memory summary in-process cache on BFF instances.
--
-- SECURITY DEFINER: required because pg_notify is a superuser operation
-- in some Supabase configurations. The function is callable by service_role
-- only (the BFF's Supabase client uses service_role).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.pg_notify_memory_summary(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.pg_notify_memory_summary(
  p_student_id UUID,
  p_summary_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_notify(
    'memory_summary_updated',
    json_build_object(
      'student_id', p_student_id,
      'summary_type', p_summary_type
    )::text
  );
END;
$$;

-- Only service_role can call this function
REVOKE EXECUTE ON FUNCTION public.pg_notify_memory_summary(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_notify_memory_summary(UUID, TEXT) TO service_role;
