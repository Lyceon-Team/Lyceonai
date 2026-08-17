-- ============================================================================
-- 3.2 POST-APPLY — 20260817010000 (student_diagnostic_state)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- Objects, grants, and — the part that matters — the ANSWER. An existence check
-- would pass over a view whose CASE returns the wrong arm for every student.
--
-- The behavioural assertion is on 3f18cbe2: production's one student with a
-- completed diagnostic. Before scripts/prod-verify/baseline-repair.sql runs, their
-- state must be 'baseline_pending' — the whole point of the state existing. After
-- the repair it becomes 'baseline_ready'. Either is a pass here; 'not_taken' and
-- 'in_progress' are not, because both mean the derivation has lost the completed
-- session and the student is about to be told to take a diagnostic again.
--
-- EXPECTED
--   view_present = 1, function_present = 1
--   service_role_can_read = true
--   pinned_student_state IN ('baseline_pending','baseline_ready')
--   unknown_state_rows = 0
--   verdict = 'OK — 20260817010000 applied; the derivation answers for the pinned student'
--
-- Companion listing: 3.2-post-apply-detail.sql
-- ============================================================================

SELECT
  (SELECT count(*) FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'student_diagnostic_states')  AS view_present,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'student_diagnostic_state')   AS function_present,
  (SELECT has_table_privilege('service_role', 'public.student_diagnostic_states', 'SELECT'))
                                                                            AS service_role_can_read,
  (SELECT count(*) FROM public.student_diagnostic_states)                    AS students_with_a_diagnostic,
  (SELECT count(*) FROM public.student_diagnostic_states
    WHERE state NOT IN ('not_taken','in_progress','baseline_pending','baseline_ready'))
                                                                            AS unknown_state_rows,
  (SELECT public.student_diagnostic_state('3f18cbe2-a999-41d4-852b-2af27e19d04e'::uuid))
                                                                            AS pinned_student_state,
  (SELECT count(*) FROM public.student_diagnostic_states WHERE state = 'baseline_pending')
                                                                            AS pending_students,
  (SELECT count(*) FROM public.student_diagnostic_states WHERE state = 'baseline_ready')
                                                                            AS ready_students,
  CASE
    WHEN (SELECT count(*) FROM pg_views
           WHERE schemaname = 'public' AND viewname = 'student_diagnostic_states') = 0
      THEN 'STOP — student_diagnostic_states is absent; 20260817010000 did not apply'
    WHEN (SELECT count(*) FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'student_diagnostic_state') = 0
      THEN 'STOP — student_diagnostic_state() is absent'
    WHEN NOT (SELECT has_table_privilege('service_role', 'public.student_diagnostic_states', 'SELECT'))
      THEN 'STOP — service_role cannot read the view; the API will fall back to the pre-step-1 behaviour on every request'
    WHEN (SELECT count(*) FROM public.student_diagnostic_states
           WHERE state NOT IN ('not_taken','in_progress','baseline_pending','baseline_ready')) > 0
      THEN 'STOP — the view emits a state outside the declared set; the server narrows it away and degrades silently'
    WHEN (SELECT public.student_diagnostic_state('3f18cbe2-a999-41d4-852b-2af27e19d04e'::uuid))
         NOT IN ('baseline_pending','baseline_ready')
      THEN 'STOP — the pinned student with a COMPLETED diagnostic does not read as completed. The derivation has lost their session.'
    ELSE 'OK — 20260817010000 applied; the derivation answers for the pinned student'
  END                                                                        AS verdict;
