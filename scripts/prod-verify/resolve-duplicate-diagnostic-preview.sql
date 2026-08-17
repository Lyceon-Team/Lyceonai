-- ============================================================================
-- PREVIEW — the two diagnostic sessions, before resolving the duplicate
-- ============================================================================
-- READ-ONLY. One statement. Run BEFORE resolve-duplicate-diagnostic.sql and keep
-- the output.
--
-- EXPECT exactly two rows, both belonging to the same student:
--   86b0dc8f…  completed  40 answered  disposition 'KEEP — the baseline'
--   18187611…  active      7 answered  disposition 'ABANDON — the surplus'
--
-- If you see any other shape — a third diagnostic, a different owner on either
-- row, the target already abandoned — STOP. resolve-duplicate-diagnostic.sql is
-- pinned to these two ids and will refuse, but read the rows first and understand
-- what changed.
--
-- `answered` is shown per session because those events are the thing that must
-- NOT move. 40 + 7 = 47 across both, and the resolution asserts that total is
-- unchanged.
-- ============================================================================

SELECT
  ps.id                                                               AS session_id,
  ps.user_id                                                          AS student_id,
  ps.status,
  ps.created_at,
  ps.last_activity_at,
  ps.completed_at,
  (SELECT count(*) FROM public.practice_session_items pi
    WHERE pi.session_id = ps.id AND pi.status = 'answered')           AS answered,
  (SELECT count(*) FROM public.practice_session_items pi
    WHERE pi.session_id = ps.id
      AND pi.status IN ('pending', 'served'))                         AS unanswered,
  CASE
    WHEN ps.id = '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff'
      THEN 'KEEP — the baseline'
    WHEN ps.id = '18187611-6dd2-4947-a35e-935874f83096'
      THEN 'ABANDON — the surplus'
    ELSE 'UNEXPECTED — not one of the two pinned sessions; STOP and read this row'
  END                                                                 AS disposition
FROM public.practice_sessions ps
WHERE ps.mode = 'diagnostic'
ORDER BY ps.created_at;
