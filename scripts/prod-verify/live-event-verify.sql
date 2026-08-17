-- ============================================================================
-- PRIORITY 0 — did apply_mastery_event complete for a LIVE answer?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- Run this immediately after answering one practice question through the app.
--
-- ============================================================================
-- WHY THIS FILE EXISTS AND step8-verify.sql DOES NOT COVER IT
-- ============================================================================
-- The backfill proved the COMPUTE chain: skill -> domain -> 4 KPI -> projection
-- all run and produce correct numbers. It did not prove the EVENT chain, because
-- backfill_recompute_student never calls apply_mastery_event. As of 2026-08-15
-- 21:01 (the last of the 84 answered items) that function had never completed in
-- production — mastery_event_audit_log and student_projection_refresh_state were
-- both empty, and those two tables are written ONLY by the event path.
--
-- So this is the outstanding question the whole workstream turns on: does a live
-- answer now produce a mastery event? A green here means the pipeline works for
-- students going forward, not just for history that was replayed.
--
-- ============================================================================
-- THE THREE SIGNALS, AND WHY EACH ONE IS NECESSARY
-- ============================================================================
--   1. audit_rows > 0
--      mastery_event_audit_log's only writer is apply_mastery_event
--      (genesis-schema.expected.sql:269), and the insert sits mid-function. A row
--      proves the function got past validation and compute.
--
--   2. refresh_state_rows > 0
--      bump_projection_refresh_counter is the FINAL statement of
--      apply_mastery_event. Reaching it means the whole body ran, including the
--      refresh_domain_mastery fan-out that used to roll the transaction back. This
--      is the strongest single signal in the system: it is the one that was zero
--      for the entire outage.
--
--   3. event_stamped_rows > 0
--      mastery_domain_refresh_audit_log rows stamped triggered_by = 'event'. The
--      column's CHECK allows only 'event' or 'backfill_recompute'
--      (…:4298), so this distinguishes a live write from the Step 8 replay. Without
--      it, backfill rows alone could make signals 1 and 2 look satisfied on a
--      later re-read.
--
--   Signal 2 without signal 1 would be impossible; signal 1 without signal 2
--   means the function still dies in the fan-out — the original defect, narrowed.
--   The verdict distinguishes those two cases explicitly, because they need very
--   different responses.
--
-- EXPECTED after one answered question
--   audit_rows            >= 1
--   refresh_state_rows    >= 1
--   event_stamped_rows    >= 1
--   latest_event_source_kind = 'practice_attempt'
--   verdict = 'OK — apply_mastery_event completed for a live answer; the event path works'
--
-- HOW TO READ A DEVIATION
--   all three zero            emission never fired. Look for the structured log
--                             line: component 'mastery', the MASTERY_EMISSION_*
--                             codes in packages/shared/src/mastery-emission.ts.
--                             The answer handler swallows emission failures by
--                             design, so the HTTP response was still 200.
--   audit > 0, refresh = 0    apply_mastery_event started and did NOT finish. This
--                             is the original defect shape: the fan-out raised and
--                             rolled back. Read the KPI validators.
--   audit > 0, refresh > 0,
--   event_stamped = 0         rows exist but none stamped 'event' — you are
--                             looking at Step 8's backfill rows, not a live write.
--                             Confirm the question was answered AFTER the backfill.
--
-- NOTE ON step8-verify.sql: once a live event lands, that file will report STOP,
-- because it asserts the event-time tables are EMPTY — which is the correct
-- acceptance signature for a pure backfill and nothing else. That STOP is expected
-- and is not a regression. After the live path is proven, THIS file is the one to
-- run; step8-verify.sql describes a moment that has passed.
-- ============================================================================

WITH census AS (
  SELECT
    (SELECT count(*) FROM public.mastery_event_audit_log)                 AS audit_rows,
    (SELECT count(*) FROM public.student_projection_refresh_state)        AS refresh_state_rows,
    (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
      WHERE triggered_by = 'event')                                       AS event_stamped_rows,
    (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
      WHERE triggered_by = 'backfill_recompute')                          AS backfill_stamped_rows,
    (SELECT max(al.applied_at) FROM public.mastery_event_audit_log al)     AS latest_event_at,
    (SELECT al.event_source_kind FROM public.mastery_event_audit_log al
      ORDER BY al.applied_at DESC LIMIT 1)                                AS latest_event_source_kind,
    (SELECT al.student_id FROM public.mastery_event_audit_log al
      ORDER BY al.applied_at DESC LIMIT 1)                                AS latest_event_student,
    (SELECT max(pi.answered_at) FROM public.practice_session_items pi
      WHERE pi.status = 'answered')                                       AS latest_answer_at,
    (SELECT count(*) FROM public.practice_session_items pi
      WHERE pi.status = 'answered')                                       AS answered_items
)
SELECT
  c.answered_items,
  c.latest_answer_at,
  c.audit_rows,
  c.refresh_state_rows,
  c.event_stamped_rows,
  c.backfill_stamped_rows,
  c.latest_event_at,
  c.latest_event_source_kind,
  c.latest_event_student,
  CASE
    WHEN c.audit_rows = 0 AND c.refresh_state_rows = 0
      THEN 'STOP — no mastery event at all. apply_mastery_event still never completes. Check the structured logs for component=mastery and the MASTERY_EMISSION_* codes; the answer handler swallows emission failures, so a 200 response proves nothing.'
    WHEN c.audit_rows > 0 AND c.refresh_state_rows = 0
      THEN 'STOP — apply_mastery_event STARTED but did not finish: an audit row exists and the projection refresh counter was never bumped. That is the original defect shape, narrowed to the refresh_domain_mastery fan-out.'
    WHEN c.refresh_state_rows > 0 AND c.audit_rows = 0
      THEN 'STOP — refresh counter bumped with no audit row. Inconsistent; the audit insert precedes the counter bump, so this should be impossible. Investigate before trusting anything else.'
    WHEN c.event_stamped_rows = 0
      THEN 'STOP — no mastery_domain_refresh_audit_log row stamped triggered_by=''event''. The rows present came from the Step 8 backfill, not from a live answer. Confirm the question was answered after the backfill ran.'
    WHEN c.latest_event_source_kind IS DISTINCT FROM 'practice_attempt'
      THEN 'CHECK — the most recent event has event_source_kind=' ||
           COALESCE(c.latest_event_source_kind, 'NULL') ||
           ', not practice_attempt. The event path works, but this was not the practice answer you were testing.'
    ELSE 'OK — apply_mastery_event completed for a live answer; the event path works'
  END                                          AS verdict
FROM census c;
