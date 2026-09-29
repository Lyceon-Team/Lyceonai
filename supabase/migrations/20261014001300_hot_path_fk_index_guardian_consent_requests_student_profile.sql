-- LYCEON-MIGRATION-REVIEWED
-- UI-08 (14 of 15): hot-path foreign-key index idx_guardian_consent_requests_student_profile.
-- @spec [docs/plans/student-ui/student-ui-vertical.md, UI-08] | @implemented [2026-09-29]
-- plain English: one b-tree index leading with the FK column(s). Full notes, the owner
--   apply instructions (OUTSIDE a transaction), the invalid-index recovery and the two
--   verification queries are in 20261014000000_hot_path_fk_index_*.sql (1 of 15).
--   One statement per file: see that file for why.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardian_consent_requests_student_profile
  ON public.guardian_consent_requests (student_profile_id);
