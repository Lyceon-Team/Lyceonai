-- ============================================================================
-- AUD-519-001: Narrow broad service_role policies to five dedicated roles
-- ============================================================================
-- @spec  [Doc-03A_V3.0, §17.4 — Dedicated service role narrowing]
-- @implemented [2026-08-06]
--
-- Doc 03A §17.4: "V1 schemas in §18 show RLS policies using a generic
-- service_role for broad operator access. Production deployment must narrow
-- this to dedicated service roles."
--
-- This migration:
--   1. Creates 5 dedicated roles per §17.4
--   2. Drops every FOR ALL TO service_role policy on tutor tables
--   3. Creates narrowed INSERT/UPDATE/DELETE policies per the §17.4 table
--   4. Grants tutor_context_reader SELECT on all tutor tables
--
-- Role mapping (from §17.4):
--   tutor_runtime_writer  — runtime API writes (conversations, messages,
--                           assignments, question_links, exposures)
--   tutor_memory_writer   — memory refresh service writes (memory_summaries)
--   tutor_archival_writer — scheduled cleanup/archival deletes
--   tutor_injection_writer — injection detection writes (injection_log)
--   tutor_context_reader  — context resolution reads (all tutor tables)
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Create dedicated roles (idempotent — DO NOTHING on conflict)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tutor_runtime_writer') THEN
    CREATE ROLE tutor_runtime_writer;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tutor_memory_writer') THEN
    CREATE ROLE tutor_memory_writer;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tutor_archival_writer') THEN
    CREATE ROLE tutor_archival_writer;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tutor_injection_writer') THEN
    CREATE ROLE tutor_injection_writer;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tutor_context_reader') THEN
    CREATE ROLE tutor_context_reader;
  END IF;
END
$$;


-- ============================================================================
-- 2. Drop broad service_role policies on all tutor tables
-- ============================================================================

DROP POLICY IF EXISTS tutor_conversations_service_role ON public.tutor_conversations;
DROP POLICY IF EXISTS tutor_messages_service_role ON public.tutor_messages;
DROP POLICY IF EXISTS tutor_memory_summaries_service_role ON public.tutor_memory_summaries;
DROP POLICY IF EXISTS tutor_instruction_assignments_service_role ON public.tutor_instruction_assignments;
DROP POLICY IF EXISTS tutor_question_links_service_role ON public.tutor_question_links;
DROP POLICY IF EXISTS tutor_instruction_exposures_service_role ON public.tutor_instruction_exposures;
DROP POLICY IF EXISTS tutor_injection_log_service_role ON public.tutor_injection_log;
DROP POLICY IF EXISTS tutor_injection_signatures_service_role ON public.tutor_injection_signatures;


-- ============================================================================
-- 3. tutor_conversations — tutor_runtime_writer + tutor_archival_writer
--    @spec [Doc-03A_V3.0, §17.4 table row 1]
-- ============================================================================

-- Runtime writer: INSERT + UPDATE (new conversations, status transitions)
CREATE POLICY tutor_conversations_runtime_insert ON public.tutor_conversations
  FOR INSERT TO tutor_runtime_writer WITH CHECK (true);

CREATE POLICY tutor_conversations_runtime_update ON public.tutor_conversations
  FOR UPDATE TO tutor_runtime_writer USING (true);

-- Archival writer: soft-delete (set deleted_at) + hard-delete (after 7-day window)
CREATE POLICY tutor_conversations_archival_softdelete ON public.tutor_conversations
  FOR UPDATE TO tutor_archival_writer USING (true)
  WITH CHECK (deleted_at IS NOT NULL);

CREATE POLICY tutor_conversations_archival_harddelete ON public.tutor_conversations
  FOR DELETE TO tutor_archival_writer
  USING (deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days');

-- Context reader: SELECT
CREATE POLICY tutor_conversations_context_read ON public.tutor_conversations
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 4. tutor_messages — tutor_runtime_writer (no delete; cascade only)
--    @spec [Doc-03A_V3.0, §17.4 table row 2]
-- ============================================================================

CREATE POLICY tutor_messages_runtime_insert ON public.tutor_messages
  FOR INSERT TO tutor_runtime_writer WITH CHECK (true);

CREATE POLICY tutor_messages_runtime_update ON public.tutor_messages
  FOR UPDATE TO tutor_runtime_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_messages_context_read ON public.tutor_messages
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 5. tutor_memory_summaries — tutor_memory_writer + tutor_archival_writer
--    @spec [Doc-03A_V3.0, §17.4 table row 3]
-- ============================================================================

CREATE POLICY tutor_memory_summaries_memory_insert ON public.tutor_memory_summaries
  FOR INSERT TO tutor_memory_writer WITH CHECK (true);

CREATE POLICY tutor_memory_summaries_memory_update ON public.tutor_memory_summaries
  FOR UPDATE TO tutor_memory_writer USING (true);

CREATE POLICY tutor_memory_summaries_archival_delete ON public.tutor_memory_summaries
  FOR DELETE TO tutor_archival_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_memory_summaries_context_read ON public.tutor_memory_summaries
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 6. tutor_instruction_assignments — tutor_runtime_writer + tutor_archival_writer
--    @spec [Doc-03A_V3.0, §17.4 table row 4]
-- ============================================================================

CREATE POLICY tutor_instruction_assignments_runtime_insert ON public.tutor_instruction_assignments
  FOR INSERT TO tutor_runtime_writer WITH CHECK (true);

CREATE POLICY tutor_instruction_assignments_runtime_update ON public.tutor_instruction_assignments
  FOR UPDATE TO tutor_runtime_writer USING (true);

CREATE POLICY tutor_instruction_assignments_archival_delete ON public.tutor_instruction_assignments
  FOR DELETE TO tutor_archival_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_instruction_assignments_context_read ON public.tutor_instruction_assignments
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 7. tutor_question_links — tutor_runtime_writer (no delete; cascade only)
--    @spec [Doc-03A_V3.0, §17.4 table row 5]
-- ============================================================================

CREATE POLICY tutor_question_links_runtime_insert ON public.tutor_question_links
  FOR INSERT TO tutor_runtime_writer WITH CHECK (true);

CREATE POLICY tutor_question_links_runtime_update ON public.tutor_question_links
  FOR UPDATE TO tutor_runtime_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_question_links_context_read ON public.tutor_question_links
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 8. tutor_instruction_exposures — tutor_runtime_writer + tutor_archival_writer
--    @spec [Doc-03A_V3.0, §17.4 table row 6]
-- ============================================================================

CREATE POLICY tutor_instruction_exposures_runtime_insert ON public.tutor_instruction_exposures
  FOR INSERT TO tutor_runtime_writer WITH CHECK (true);

CREATE POLICY tutor_instruction_exposures_runtime_update ON public.tutor_instruction_exposures
  FOR UPDATE TO tutor_runtime_writer USING (true);

CREATE POLICY tutor_instruction_exposures_archival_delete ON public.tutor_instruction_exposures
  FOR DELETE TO tutor_archival_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_instruction_exposures_context_read ON public.tutor_instruction_exposures
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 9. tutor_injection_log — tutor_injection_writer + tutor_archival_writer
--    @spec [Doc-03A_V3.0, §17.4 table row 7]
-- ============================================================================

CREATE POLICY tutor_injection_log_injection_insert ON public.tutor_injection_log
  FOR INSERT TO tutor_injection_writer WITH CHECK (true);

CREATE POLICY tutor_injection_log_injection_update ON public.tutor_injection_log
  FOR UPDATE TO tutor_injection_writer USING (true);

CREATE POLICY tutor_injection_log_archival_delete ON public.tutor_injection_log
  FOR DELETE TO tutor_archival_writer USING (true);

-- Context reader: SELECT
CREATE POLICY tutor_injection_log_context_read ON public.tutor_injection_log
  FOR SELECT TO tutor_context_reader USING (true);


-- ============================================================================
-- 10. tutor_context_runtime_config — manual admin only (no dedicated role policies)
--     tutor_injection_signatures  — manual admin only (no dedicated role policies)
--     @spec [Doc-03A_V3.0, §17.4 table rows 8–9]
--
--     These tables are admin-managed. service_role policies are dropped above.
--     Context reader gets SELECT for resolution reads.
-- ============================================================================

CREATE POLICY tutor_context_runtime_config_context_read ON public.tutor_context_runtime_config
  FOR SELECT TO tutor_context_reader USING (true);

CREATE POLICY tutor_injection_signatures_context_read ON public.tutor_injection_signatures
  FOR SELECT TO tutor_context_reader USING (true);


COMMIT;


-- ============================================================================
-- DOWN MIGRATION (rollback)
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed.
-- ============================================================================
-- To reverse this migration, run the following statements in order.
-- This restores the broad service_role FOR ALL policies and drops the dedicated roles.
--
-- BEGIN;
--
-- -- Drop all dedicated-role policies
-- DROP POLICY IF EXISTS tutor_conversations_runtime_insert ON public.tutor_conversations;
-- DROP POLICY IF EXISTS tutor_conversations_runtime_update ON public.tutor_conversations;
-- DROP POLICY IF EXISTS tutor_conversations_archival_softdelete ON public.tutor_conversations;
-- DROP POLICY IF EXISTS tutor_conversations_archival_harddelete ON public.tutor_conversations;
-- DROP POLICY IF EXISTS tutor_conversations_context_read ON public.tutor_conversations;
-- DROP POLICY IF EXISTS tutor_messages_runtime_insert ON public.tutor_messages;
-- DROP POLICY IF EXISTS tutor_messages_runtime_update ON public.tutor_messages;
-- DROP POLICY IF EXISTS tutor_messages_context_read ON public.tutor_messages;
-- DROP POLICY IF EXISTS tutor_memory_summaries_memory_insert ON public.tutor_memory_summaries;
-- DROP POLICY IF EXISTS tutor_memory_summaries_memory_update ON public.tutor_memory_summaries;
-- DROP POLICY IF EXISTS tutor_memory_summaries_archival_delete ON public.tutor_memory_summaries;
-- DROP POLICY IF EXISTS tutor_memory_summaries_context_read ON public.tutor_memory_summaries;
-- DROP POLICY IF EXISTS tutor_instruction_assignments_runtime_insert ON public.tutor_instruction_assignments;
-- DROP POLICY IF EXISTS tutor_instruction_assignments_runtime_update ON public.tutor_instruction_assignments;
-- DROP POLICY IF EXISTS tutor_instruction_assignments_archival_delete ON public.tutor_instruction_assignments;
-- DROP POLICY IF EXISTS tutor_instruction_assignments_context_read ON public.tutor_instruction_assignments;
-- DROP POLICY IF EXISTS tutor_question_links_runtime_insert ON public.tutor_question_links;
-- DROP POLICY IF EXISTS tutor_question_links_runtime_update ON public.tutor_question_links;
-- DROP POLICY IF EXISTS tutor_question_links_context_read ON public.tutor_question_links;
-- DROP POLICY IF EXISTS tutor_instruction_exposures_runtime_insert ON public.tutor_instruction_exposures;
-- DROP POLICY IF EXISTS tutor_instruction_exposures_runtime_update ON public.tutor_instruction_exposures;
-- DROP POLICY IF EXISTS tutor_instruction_exposures_archival_delete ON public.tutor_instruction_exposures;
-- DROP POLICY IF EXISTS tutor_instruction_exposures_context_read ON public.tutor_instruction_exposures;
-- DROP POLICY IF EXISTS tutor_injection_log_injection_insert ON public.tutor_injection_log;
-- DROP POLICY IF EXISTS tutor_injection_log_injection_update ON public.tutor_injection_log;
-- DROP POLICY IF EXISTS tutor_injection_log_archival_delete ON public.tutor_injection_log;
-- DROP POLICY IF EXISTS tutor_injection_log_context_read ON public.tutor_injection_log;
-- DROP POLICY IF EXISTS tutor_context_runtime_config_context_read ON public.tutor_context_runtime_config;
-- DROP POLICY IF EXISTS tutor_injection_signatures_context_read ON public.tutor_injection_signatures;
--
-- -- Restore broad service_role policies
-- CREATE POLICY tutor_conversations_service_role ON public.tutor_conversations FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_messages_service_role ON public.tutor_messages FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_memory_summaries_service_role ON public.tutor_memory_summaries FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_instruction_assignments_service_role ON public.tutor_instruction_assignments FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_question_links_service_role ON public.tutor_question_links FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_instruction_exposures_service_role ON public.tutor_instruction_exposures FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_injection_log_service_role ON public.tutor_injection_log FOR ALL TO service_role USING (true);
-- CREATE POLICY tutor_injection_signatures_service_role ON public.tutor_injection_signatures FOR ALL TO service_role USING (true);
--
-- -- Drop dedicated roles
-- DROP ROLE IF EXISTS tutor_runtime_writer;
-- DROP ROLE IF EXISTS tutor_memory_writer;
-- DROP ROLE IF EXISTS tutor_archival_writer;
-- DROP ROLE IF EXISTS tutor_injection_writer;
-- DROP ROLE IF EXISTS tutor_context_reader;
--
-- COMMIT;
