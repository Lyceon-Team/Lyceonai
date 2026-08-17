-- ============================================================================
-- PRE-APPLY DETAIL — the exact rows 20260816000000 will repair
-- ============================================================================
-- READ-ONLY. One statement. Run alongside 1.1-pre-apply.sql.
--
-- RECORD THIS OUTPUT. It is the audited row list. 1.1-post-apply-detail.sql
-- prints the rows the migration actually touched; the two must be identical, and
-- the hash comparison in the verdict files asserts that mechanically.
--
-- Expect 42 rows. will_become_occurred_at is the value the backfill will write
-- into occurred_at for that row — it is answered_at, never now().
-- ============================================================================

SELECT
  pi.id,
  pi.user_id,
  pi.status,
  pi.question_section AS section,
  pi.question_domain  AS domain,
  pi.question_skill   AS skill,
  pi.answered_at      AS will_become_occurred_at
FROM public.practice_session_items pi
WHERE pi.status IN ('answered', 'skipped')
  AND pi.occurred_at IS NULL
  AND pi.answered_at IS NOT NULL
ORDER BY pi.id;
