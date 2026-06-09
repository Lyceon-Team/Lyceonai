-- @spec [GAP-TB-01, GAP-TB-02, GAP-TB-03, GAP-TU-06, GAP-MA-09 | docs/Spec/lyceon-coding-standards.md §5.2, §6.1, §12.1] | @implemented [2026-06-07]
-- plain English: WS-0 "stop the bleed" — close the live DB trust-boundary holes
-- by removing anon/authenticated direct PostgREST access to answer content and to
-- nine RLS-disabled tables, making the tutor memory store server-write-only, and
-- pinning the constants-audit triggers so replica mode cannot bypass them.
-- Expected outcome: no answer/explanation readable pre-submit via PostgREST; no
-- anon/auth writes accepted on the nine tables; tutor memory insert rejected;
-- audit triggers fire ALWAYS. Trade-off: rollback re-opens the vulnerabilities
-- (see ROLLBACK WARNING). Edge cases: service_role is untouched (bypasses_rls +
-- own grants), so every server path keeps working.
-- =============================================================================
-- MIGRATION: WS-0 — Stop the Bleed (DB trust-boundary hardening)
-- =============================================================================
-- Closes (pending owner apply + probe): GAP-TB-01, GAP-TB-02, GAP-TB-03,
--   GAP-TU-06, GAP-MA-09.  (GAP-ID-11 is a route change, not in this file.)
--
-- Workstream: WS-0 per docs/SpecAudit/10-gap-registry/closure-plan.md
-- Contract:   contracts/ws0-stop-the-bleed.contract.md
--
-- DEPLOYED-STATE EVIDENCE: docs/SpecAudit/00-supabase-live-state.csv
--   (capture generated 2026-06-07 03:03:35 UTC). Every object name below is
--   taken VERBATIM from that capture; each statement cites its capture line
--   as "capture:<line>". Repo migrations are NOT deployed-state evidence.
--
-- APPLY: This file is NOT auto-applied. The owner runs it manually in the
--   Supabase SQL editor, then runs the verification block at the bottom, then
--   runs scripts/probe/ws0-probe.ts against production.
--
-- IDEMPOTENT: every statement is guarded (DROP POLICY IF EXISTS / REVOKE is a
--   no-op when the privilege is absent / ENABLE [ALWAYS] is a no-op when already
--   in that state). Safe to re-run top-to-bottom.
--
-- SAFETY NOTE (why revokes do not break the app): service_role has
--   bypasses_rls=true (capture:8357) and KEEPS its own grants — only anon and
--   authenticated (bypasses_rls=false; capture:8335,8336) are touched. The
--   browser has no Supabase data client (client/src/lib/supabase.ts is
--   types-only) and every server read of these tables uses a service-role
--   client. See contract §P0.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- GAP-TB-01 — questions: remove pre-submit answer leak to anon/authenticated
-- -----------------------------------------------------------------------------
-- questions rls_enabled=true (capture:61). Answer-bearing columns:
--   correct_answer NOT NULL (capture:607), explanation (capture:592),
--   answer_text (capture:591).
-- Live SELECT policy is "questions_select_authenticated :: roles={authenticated}
--   :: USING true" (capture:7933). The registry-named "questions_select_accessible"
--   ALSO appears (capture:7930); both are dropped with IF EXISTS.
-- Grants: anon + authenticated hold the full set incl. SELECT (capture:3235-3248).

DROP POLICY IF EXISTS questions_select_authenticated ON public.questions;
DROP POLICY IF EXISTS questions_select_accessible ON public.questions;
REVOKE ALL ON TABLE public.questions FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- GAP-TB-02 — session-item tables: cut PostgREST self-read of denormalized
--             answer columns (a self-cheat vector that bypasses app serializers)
-- -----------------------------------------------------------------------------

-- practice_session_items rls_enabled=true (capture:54). Answer-bearing:
--   question_explanation (capture:501), question_correct_answer (capture:507).
-- Self-SELECT policy "practice_session_items_select_own :: USING (user_id =
--   auth.uid())" (capture:7861). Full anon/auth grants (capture:3039-3052).
DROP POLICY IF EXISTS practice_session_items_select_own ON public.practice_session_items;
REVOKE ALL ON TABLE public.practice_session_items FROM anon, authenticated;

-- review_session_items rls_enabled=true (capture:64). Answer-bearing:
--   question_correct_answer (capture:650), question_explanation (capture:651).
-- Self-SELECT policy "review_session_items_select_own :: USING (student_id =
--   auth.uid())" (capture:7951). Full anon/auth grants (capture:3319-3332).
DROP POLICY IF EXISTS review_session_items_select_own ON public.review_session_items;
REVOKE ALL ON TABLE public.review_session_items FROM anon, authenticated;

-- full_length_exam_questions rls_enabled=true (capture:35). Answer-bearing:
--   question_answer_text (capture:327), question_explanation (capture:328),
--   question_correct_answer (capture:331).
-- TWO public self-SELECT policies: "flx_questions_select" (capture:7625) and
--   "questions_select_own" (capture:7652), both USING (... s.user_id =
--   auth.uid()). Full anon/auth grants (capture:2507-2520).
DROP POLICY IF EXISTS flx_questions_select ON public.full_length_exam_questions;
DROP POLICY IF EXISTS questions_select_own ON public.full_length_exam_questions;
REVOKE ALL ON TABLE public.full_length_exam_questions FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- GAP-TB-03 — nine RLS-disabled tables: enable RLS + default-deny anon/auth
-- -----------------------------------------------------------------------------
-- All nine: rls_enabled=false with full anon/auth grants. No anon/authenticated
-- read path exists for any of them (contract §TB-03 read-need table + §P0), so
-- default-deny is applied to ALL privileges. ENABLE RLS gives row-level deny;
-- REVOKE ALL additionally removes TRUNCATE (not governed by RLS) and SELECT.

-- test_forms: rls_enabled=false (capture:83); grants capture:3851-3864.
--   read path: service-role only (apps/api/src/services/fullLengthExam.ts:741,759).
ALTER TABLE public.test_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.test_forms FROM anon, authenticated;

-- constants_audit_log: rls_enabled=false (capture:21); grants capture:2115-2128.
--   written only by SECURITY-INVOKER audit triggers (capture:4649,4681) running
--   as the privileged constants-updater; never read by anon/auth.
ALTER TABLE public.constants_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.constants_audit_log FROM anon, authenticated;

-- documents: rls_enabled=false (capture:24); grants capture:2199-2212.
--   ingestion/worker (service-role) only; no user-facing read path.
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.documents FROM anon, authenticated;

-- embeddings: rls_enabled=false (capture:25); grants capture:2227-2240.
ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.embeddings FROM anon, authenticated;

-- question_classification_updates: rls_enabled=false (capture:58);
--   grants capture:3151-3164. Offline scripts only.
ALTER TABLE public.question_classification_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_classification_updates FROM anon, authenticated;

-- question_embeddings: rls_enabled=false (capture:59); grants capture:3179-3192.
--   service-role only (apps/api/src/lib/vector.ts:30, apps/api/src/lib/supabase.ts).
ALTER TABLE public.question_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_embeddings FROM anon, authenticated;

-- sat_math_topics_ref: rls_enabled=false (capture:66); grants capture:3375-3388.
--   0-row reference table; no runtime read path.
ALTER TABLE public.sat_math_topics_ref ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sat_math_topics_ref FROM anon, authenticated;

-- sat_rw_skills_ref: rls_enabled=false (capture:67); grants capture:3403-3416.
ALTER TABLE public.sat_rw_skills_ref ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sat_rw_skills_ref FROM anon, authenticated;

-- sat_sections_ref: rls_enabled=false (capture:68); grants capture:3431-3444.
ALTER TABLE public.sat_sections_ref ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sat_sections_ref FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- GAP-TU-06 — tutor_memory_summaries: drop student INSERT, server-write-only
-- -----------------------------------------------------------------------------
-- rls_enabled=true (capture:89). Injection policy:
--   "tutor_memory_summaries_student_insert :: WITH CHECK (student_id =
--   auth.uid())" (capture:8137). Full anon/auth grants (capture:4019-4032).
-- Leave the student SELECT policy "tutor_memory_summaries_student_select"
--   (capture:8140) and the SELECT grant UNTOUCHED (out of WS-0 scope).
-- Runtime read is service-role (server/routes/tutor-runtime.ts:1278-1284).
DROP POLICY IF EXISTS tutor_memory_summaries_student_insert ON public.tutor_memory_summaries;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tutor_memory_summaries FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- GAP-MA-09 — constants-audit triggers fire even under replica mode
-- -----------------------------------------------------------------------------
-- Both currently [ENABLED (origin)] (capture:8225 mastery, capture:8223 kpi),
-- bypassable when session_replication_role='replica'. ENABLE ALWAYS pins them.
ALTER TABLE public.mastery_constants ENABLE ALWAYS TRIGGER trg_audit_mastery_constants_changes;
ALTER TABLE public.kpi_constants ENABLE ALWAYS TRIGGER trg_audit_kpi_constants_changes;

COMMIT;

-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED (INV-06: every-migration-has-rollback)
-- Rollback — restores the EXACT captured prior state (policies/grants/trigger
-- enable-state). Reviewed against docs/SpecAudit/00-supabase-live-state.csv.
--
-- WARNING: This rollback deliberately RE-OPENS the GAP-TB-01/02/03 and GAP-TU-06
-- vulnerabilities (anon/auth answer reads, anon/auth writes on the nine tables,
-- student-injectable tutor memory) and reverts the GAP-MA-09 replica bypass. It
-- exists only for an emergency revert if an unforeseen service-role path breaks;
-- it is NOT a normal operation. Do not run it without owner sign-off.
--
--   BEGIN;
--
--   -- GAP-TB-01 revert
--   GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.questions TO anon, authenticated;
--   CREATE POLICY questions_select_authenticated ON public.questions
--     FOR SELECT TO authenticated USING (true);
--   CREATE POLICY questions_select_accessible ON public.questions
--     FOR SELECT TO anon, authenticated USING (true);
--
--   -- GAP-TB-02 revert
--   GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.practice_session_items TO anon, authenticated;
--   CREATE POLICY practice_session_items_select_own ON public.practice_session_items
--     FOR SELECT TO authenticated USING (user_id = auth.uid());
--   GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.review_session_items TO anon, authenticated;
--   CREATE POLICY review_session_items_select_own ON public.review_session_items
--     FOR SELECT TO authenticated USING (student_id = auth.uid());
--   GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.full_length_exam_questions TO anon, authenticated;
--   CREATE POLICY flx_questions_select ON public.full_length_exam_questions
--     FOR SELECT TO public USING (EXISTS (SELECT 1
--       FROM (full_length_exam_modules m
--         JOIN full_length_exam_sessions s ON ((s.id = m.session_id)))
--       WHERE ((m.id = full_length_exam_questions.module_id) AND (s.user_id = auth.uid()))));
--   CREATE POLICY questions_select_own ON public.full_length_exam_questions
--     FOR SELECT TO public USING (EXISTS (SELECT 1
--       FROM (full_length_exam_modules m
--         JOIN full_length_exam_sessions s ON ((s.id = m.session_id)))
--       WHERE ((m.id = full_length_exam_questions.module_id) AND (s.user_id = auth.uid()))));
--
--   -- GAP-TB-03 revert (disable RLS + restore full grants on all nine)
--   ALTER TABLE public.test_forms                     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.constants_audit_log            DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.documents                      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.embeddings                     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.question_classification_updates DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.question_embeddings            DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sat_math_topics_ref            DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sat_rw_skills_ref              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sat_sections_ref               DISABLE ROW LEVEL SECURITY;
--   GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.test_forms, public.constants_audit_log, public.documents,
--        public.embeddings, public.question_classification_updates,
--        public.question_embeddings, public.sat_math_topics_ref,
--        public.sat_rw_skills_ref, public.sat_sections_ref
--     TO anon, authenticated;
--
--   -- GAP-TU-06 revert
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLE public.tutor_memory_summaries TO anon, authenticated;
--   CREATE POLICY tutor_memory_summaries_student_insert ON public.tutor_memory_summaries
--     FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
--
--   -- GAP-MA-09 revert (ENABLE TRIGGER => tgenabled 'O' = origin-enabled)
--   ALTER TABLE public.mastery_constants ENABLE TRIGGER trg_audit_mastery_constants_changes;
--   ALTER TABLE public.kpi_constants     ENABLE TRIGGER trg_audit_kpi_constants_changes;
--
--   COMMIT;
-- ============================================================================

-- =============================================================================
-- VERIFICATION BLOCK (read-only) — owner runs AFTER apply. Expected output is
-- stated in comments beside each query. Anything else = investigate before
-- flipping the registry.
-- =============================================================================

-- V1 — dropped policies are gone (TB-01, TB-02, TU-06).
--   EXPECT: 0 rows.
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'questions_select_authenticated',
    'questions_select_accessible',
    'practice_session_items_select_own',
    'review_session_items_select_own',
    'flx_questions_select',
    'questions_select_own',
    'tutor_memory_summaries_student_insert'
  );

-- V2 — student SELECT policy on tutor_memory_summaries is RETAINED (TU-06.4).
--   EXPECT: exactly 1 row (tutor_memory_summaries_student_select).
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'tutor_memory_summaries';

-- V3 — RLS now enabled on the nine TB-03 tables.
--   EXPECT: all 9 rows show relrowsecurity = true.
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'test_forms','constants_audit_log','documents','embeddings',
    'question_classification_updates','question_embeddings',
    'sat_math_topics_ref','sat_rw_skills_ref','sat_sections_ref'
  )
ORDER BY c.relname;

-- V4 — anon/authenticated hold NO INSERT/UPDATE/DELETE/TRUNCATE on any hardened
--   table, and NO SELECT except tutor_memory_summaries (intentionally retained).
--   EXPECT: only rows of the form (tutor_memory_summaries, anon|authenticated,
--   SELECT). No INSERT/UPDATE/DELETE/TRUNCATE rows at all. No other SELECT rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND table_name IN (
    'questions','practice_session_items','review_session_items',
    'full_length_exam_questions','tutor_memory_summaries',
    'test_forms','constants_audit_log','documents','embeddings',
    'question_classification_updates','question_embeddings',
    'sat_math_topics_ref','sat_rw_skills_ref','sat_sections_ref'
  )
ORDER BY table_name, grantee, privilege_type;

-- V5 — constants-audit triggers are ENABLE ALWAYS (MA-09.1).
--   EXPECT: both rows show tgenabled = 'A'.
SELECT t.tgname, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname IN ('mastery_constants','kpi_constants')
  AND t.tgname IN (
    'trg_audit_mastery_constants_changes',
    'trg_audit_kpi_constants_changes'
  )
ORDER BY t.tgname;
