-- LYCEON-MIGRATION-REVIEWED
-- UI-08 (4 of 15): hot-path foreign-key index idx_review_schedule_question.
-- @spec [docs/plans/student-ui/student-ui-vertical.md, UI-08] | @implemented [2026-09-29]
-- plain English: one b-tree index leading with the FK column(s). Full notes, the owner
--   apply instructions (OUTSIDE a transaction), the invalid-index recovery and the two
--   verification queries are in 20261014000000_hot_path_fk_index_*.sql (1 of 15).
--   One statement per file: see that file for why.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_schedule_question
  ON public.review_schedule (question_id);
