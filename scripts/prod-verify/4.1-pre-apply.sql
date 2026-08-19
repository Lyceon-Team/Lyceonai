-- ============================================================================
-- 4.1 PRE-APPLY — the negative control for the gap-detector noise fix
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- WHY THIS FILE EXISTS
--   4.1-post-apply.sql asserts open_gaps = 0. On its own that number proves
--   nothing: a view over an empty history also reports 0, and so does a view
--   that is broken in a way that returns no rows. This file records the count
--   BEFORE the change, so the 0 afterwards measures the fix rather than an
--   absence. Run it first, keep the output, and compare.
--
-- WHAT IT EXPECTS TO SEE (prod, verified read-only 2026-08-19)
--   answered_items        = 91
--   live_audit_rows       =  7   mastery_event_audit_log, the 2026-08-17 events
--   backfill_audit_rows   > 0    mastery_domain_refresh_audit_log rows stamped
--                                triggered_by = 'backfill_recompute'
--   open_gaps             = 84   the whole defect: 91 - 7 = 84 items whose
--                                mastery came from the Step 8 backfill and which
--                                the detector therefore calls "missing"
--   ledger_rows           =  0   nothing has swept yet
--
-- WHY 84 IS NOT HARDCODED INTO THE VERDICT
--   The verdict asks a question the number cannot answer on its own: is the live
--   view still the pre-fix definition, and does the history have the shape the
--   fix targets? A count of 84 with the NEW view already live would mean 84
--   genuinely un-emitted events, which is a different and much worse finding
--   than the one this migration addresses. So the verdict keys on the view
--   DEFINITION and reports the counts beside it.
--
-- THE DISCRIMINATOR, STATED ONCE
--   mastery_domain_refresh_audit_log.triggered_by is CHECK-constrained to
--   ('event','backfill_recompute'). That column is the only place in the schema
--   that distinguishes a live derivation from a replayed one.
--   student_skill_mastery has NO triggered_by column — do not look for one there.
--
-- USAGE: paste the CONTENTS of this file into the Supabase SQL editor.
-- ============================================================================

SELECT
  (SELECT count(*) FROM public.practice_session_items WHERE status = 'answered')
                                                                    AS answered_items,
  (SELECT count(*) FROM public.mastery_event_audit_log)              AS live_audit_rows,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
    WHERE triggered_by = 'backfill_recompute')                       AS backfill_audit_rows,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
    WHERE triggered_by = 'event')                                    AS live_refresh_rows,
  (SELECT count(*) FROM public.mastery_derivation_gaps)              AS open_gaps,
  (SELECT count(*) FROM public.mastery_derivation_gap_ledger)        AS ledger_rows,
  CASE
    WHEN (SELECT count(*) FROM pg_views
           WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gaps') = 0
      THEN 'STOP — mastery_derivation_gaps does not exist; 20260816020000 is not deployed, so there is nothing to fix yet'
    WHEN (SELECT (pg_get_viewdef('public.mastery_derivation_gaps'::regclass)
                  LIKE '%pi.occurred_at <= ral.applied_at%'))
      THEN 'STOP — the fix is ALREADY live; this file is the pre-apply control and must run BEFORE 20260818000000. Any gaps reported now are genuinely un-emitted events, not backfill noise'
    WHEN (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
           WHERE triggered_by = 'backfill_recompute') = 0
      THEN 'STOP — no backfill_recompute rows exist, so the exclusion this migration adds would match nothing. Either Step 8 never ran or this is the wrong database'
    WHEN (SELECT count(*) FROM public.mastery_derivation_gaps) = 0
      THEN 'STOP — the detector already reports 0 with the OLD definition. Nothing to fix, and the post-apply 0 would prove nothing. Investigate before applying'
    ELSE 'PROCEED — the shape matches what the fix targets; apply 20260818000000'
  END                                                               AS verdict;
