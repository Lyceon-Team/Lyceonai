-- ===========================================================================
-- DATA FIX TEMPLATE: College Board moved an SAT test date → move every student who picked it
-- ===========================================================================
-- @spec [owner ruling on #1166 (Karl, 2026-10-09) item 3: "If College Board later moves an
--        anticipated date, update the config and move any student who picked the old date to
--        the new one (a small data fix, with counts before and after)"; SCL-223]
--        | @implemented [2026-10-09]
--
-- plain English: when an entry in shared/sat-test-dates.ts changes from OLD to NEW, this
-- replaces OLD with NEW in every `student_study_profile.target_exam_dates`. The row trigger
-- `study_profile_exam_dates_sync` re-normalises the list (sorted, de-duplicated) and
-- re-derives the effective `target_exam_date`, so nothing else is written by hand.
--
-- Counts: prints how many profiles hold OLD and NEW before, and after. After the run OLD must be
-- 0; if it is not, the transaction raises and rolls back.
-- Idempotent: a second run finds no OLD and changes 0.
--
-- Order: ship the config change (shared/sat-test-dates.ts entry + verified_on) first, then run
-- this with the same two dates.
--
-- OWNER-RUN. Karl applies to production. DO NOT auto-apply.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v old_date=2027-10-09 -v new_date=2027-10-16 -f scripts/ops/sat-test-date-move.sql
-- ===========================================================================
\set ON_ERROR_STOP on

BEGIN;

-- psql variables do not reach inside DO $$ … $$; carry OLD in a transaction-local setting.
SELECT set_config('sat_move.old_date', :'old_date', true);

SELECT
  count(*) FILTER (WHERE :'old_date'::date = ANY (target_exam_dates)) AS before_old_date,
  count(*) FILTER (WHERE :'new_date'::date = ANY (target_exam_dates)) AS before_new_date
FROM public.student_study_profile;

UPDATE public.student_study_profile
   SET target_exam_dates = array_replace(target_exam_dates, :'old_date'::date, :'new_date'::date)
 WHERE :'old_date'::date = ANY (target_exam_dates);

SELECT
  count(*) FILTER (WHERE :'old_date'::date = ANY (target_exam_dates)) AS after_old_date,
  count(*) FILTER (WHERE :'new_date'::date = ANY (target_exam_dates)) AS after_new_date
FROM public.student_study_profile;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_study_profile
     WHERE current_setting('sat_move.old_date')::date = ANY (target_exam_dates)
  ) THEN
    RAISE EXCEPTION 'sat-test-date-move: the old date is still held; rolled back';
  END IF;
END $$;

COMMIT;
