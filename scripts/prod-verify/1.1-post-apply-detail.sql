-- ============================================================================
-- POST-APPLY DETAIL — the exact rows the backfill touched
-- ============================================================================
-- READ-ONLY. One statement. Run alongside 1.1-post-apply.sql.
--
-- Compare this row list against the one 1.1-pre-apply-detail.sql printed. They
-- must be identical. The hash comparison in the verdict files already asserts
-- that mechanically; this is the human-readable corroboration, and the artifact
-- worth keeping with the change record.
--
-- Expect 42 rows, value_intact = true on every one.
--   value_intact = false means something modified occurred_at after the backfill
--   wrote it — the log says one thing and the row says another.
--   A NULL status means the item row is GONE while its log row survives; the log
--   deliberately carries no FK, so this shows up here rather than as a cascade.
-- ============================================================================

SELECT
  l.item_id,
  l.occurred_at_applied,
  pi.status,
  pi.question_section AS section,
  pi.question_domain  AS domain,
  (pi.occurred_at = l.occurred_at_applied) AS value_intact
FROM public.psi_occurred_at_backfill_log l
LEFT JOIN public.practice_session_items pi ON pi.id = l.item_id
ORDER BY l.item_id;
