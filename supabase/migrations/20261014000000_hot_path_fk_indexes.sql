-- LYCEON-MIGRATION-REVIEWED
-- UI-08: hot-path foreign-key indexes (student-UI vertical, Wave 1).
--
-- @spec [docs/plans/student-ui/student-ui-vertical.md, UI-08; evidence/step2-wave1.md, UI-08]
-- @implemented [2026-09-29]
-- plain English: adds one b-tree index per hot-path foreign key that the Supabase
--   performance advisor flags as unindexed (15 of its 98). Each index leads with the
--   FK column(s), so joins on the FK and the FK check run when a parent row is deleted
--   or re-keyed (questions, profiles, test_forms, review_schedule, calendar_blocks,
--   auth.users) use an index scan instead of scanning the child table. Purely additive:
--   no table, column, constraint, function, grant or policy changes; no data changes.
--   Trade-off: slightly more write cost on these tables; no reader behaviour changes.
--   Edge case: calendar_block_launches already has PK (block_id, launch_sequence), which
--   leads with block_id; the composite (block_id, student_id) index is kept because it is
--   the exact column list of the composite FK to calendar_blocks(block_id, student_id).
--
-- ─── WHY THERE IS NO BEGIN/COMMIT ────────────────────────────────────────────
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. CI applies each
-- migration with `psql -v ON_ERROR_STOP=1 -q -f <file>` and no --single-transaction
-- (scripts/ci/genesis-fresh-apply.sh, .github/workflows/ci.yml), so each statement
-- below runs in its own implicit transaction. Precedent:
-- 20260930000000_tutor_conversation_assignment_key_unique.sql.
--
-- Owner apply (production): run OUTSIDE a transaction. The Supabase SQL editor runs a
-- multi-statement script as one transaction, which makes CONCURRENTLY fail with
-- "cannot run inside a transaction block". Apply with `psql -f` against this file, or
-- run each CREATE INDEX statement on its own in the SQL editor.
--
-- ─── INVALID INDEXES AFTER A FAILED BUILD ────────────────────────────────────
-- If a CONCURRENTLY build fails part-way (cancelled, deadlock, lock timeout), Postgres
-- leaves the index behind marked INVALID. A re-run will NOT repair it: IF NOT EXISTS
-- sees the name and skips it, and an invalid index is never used by the planner. So
-- after applying, check pg_index.indisvalid (query 2 below). For any row that is not
-- valid, drop it and re-run just that statement:
--   DROP INDEX CONCURRENTLY IF EXISTS public.<indexname>;
--   -- then re-run the matching CREATE INDEX CONCURRENTLY statement below.
--
-- ─── OWNER VERIFICATION (paste the output of both as proof) ──────────────────
-- 1. All 15 present, with their definitions (expect 15 rows):
--   SELECT schemaname, tablename, indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname IN (
--       'idx_practice_items_question',
--       'idx_review_items_question',
--       'idx_review_items_queue_entry',
--       'idx_review_schedule_question',
--       'idx_review_attempts_question',
--       'idx_test_session_items_question',
--       'idx_test_form_items_question',
--       'idx_test_sessions_form',
--       'idx_calendar_block_launches_student',
--       'idx_calendar_block_launches_block_student',
--       'idx_usage_rate_limit_ledger_student_user',
--       'idx_notification_events_subject_profile',
--       'idx_account_deletion_profile',
--       'idx_guardian_consent_requests_student_profile',
--       'idx_profiles_guardian_profile')
--   ORDER BY tablename;
--
-- 2. All 15 valid and ready (expect 15 rows, every indisvalid = t and indisready = t):
--   SELECT c.relname AS indexname, i.indisvalid, i.indisready
--   FROM pg_index i
--   JOIN pg_class c ON c.oid = i.indexrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN (
--       'idx_practice_items_question',
--       'idx_review_items_question',
--       'idx_review_items_queue_entry',
--       'idx_review_schedule_question',
--       'idx_review_attempts_question',
--       'idx_test_session_items_question',
--       'idx_test_form_items_question',
--       'idx_test_sessions_form',
--       'idx_calendar_block_launches_student',
--       'idx_calendar_block_launches_block_student',
--       'idx_usage_rate_limit_ledger_student_user',
--       'idx_notification_events_subject_profile',
--       'idx_account_deletion_profile',
--       'idx_guardian_consent_requests_student_profile',
--       'idx_profiles_guardian_profile')
--   ORDER BY c.relname;
--
-- Rollback (each also outside a transaction):
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_practice_items_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_items_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_items_queue_entry;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_schedule_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_attempts_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_test_session_items_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_test_form_items_question;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_test_sessions_form;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_calendar_block_launches_student;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_calendar_block_launches_block_student;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_usage_rate_limit_ledger_student_user;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_notification_events_subject_profile;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_deletion_profile;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_guardian_consent_requests_student_profile;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_profiles_guardian_profile;

-- Practice / review runtime -> questions, review_schedule
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_practice_items_question
  ON public.practice_session_items (question_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_items_question
  ON public.review_session_items (question_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_items_queue_entry
  ON public.review_session_items (queue_entry_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_schedule_question
  ON public.review_schedule (question_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_attempts_question
  ON public.review_error_attempts (question_id);

-- Exam runtime -> questions, test_forms
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_session_items_question
  ON public.test_session_items (question_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_form_items_question
  ON public.test_form_items (question_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_sessions_form
  ON public.test_sessions (test_form_id);

-- Calendar -> profiles, calendar_blocks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_block_launches_student
  ON public.calendar_block_launches (student_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_block_launches_block_student
  ON public.calendar_block_launches (block_id, student_id);

-- Quota ledger -> auth.users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_rate_limit_ledger_student_user
  ON public.usage_rate_limit_ledger (student_user_id);

-- Notifications, deletion, consent, guardian link -> profiles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_events_subject_profile
  ON public.notification_events (subject_profile_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_deletion_profile
  ON public.account_deletion_requests (profile_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardian_consent_requests_student_profile
  ON public.guardian_consent_requests (student_profile_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_guardian_profile
  ON public.profiles (guardian_profile_id);
