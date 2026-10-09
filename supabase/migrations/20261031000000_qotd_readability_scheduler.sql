-- ===========================================================================
-- QOTD readability filter (Karl's option B): the scheduler's reads, paged, and a guarded release
-- of an upcoming day.
--
-- @spec [owner brief "QOTD — readability filter (Karl's option B)" (Karl, 2026-10-09): quick-to-
--       read questions only; the rules live in the scheduler's filter beside stemRepeatsPassage
--       (shared/qotd/readability.ts holds the thresholds); "if the scheduler's domain rotation
--       reaches a domain with no eligible question left, it moves to the next domain"; "replace
--       already-scheduled future days (after today in Chicago) whose question fails the new
--       rules ... Never change today or past days"; docs/plans/seo/seo-marketing-vertical.md R18,
--       Q1] | @implemented [2026-10-09]
--
-- plain English: NO table, column, constraint or grant on a table changes. Three functions:
--  1. `qotd_schedule_candidate_page(section, domain, after_id, limit)`: the existing candidate
--     read (same eligibility predicate, same canonical-id order) plus `item_type`, paged by
--     keyset on the id. The readability rules are applied in TypeScript, and a domain can hold
--     many eligible-but-unreadable questions at the head of its order; without paging the first
--     page could be all of them and the domain would look empty when it is not.
--  2. `qotd_schedule_upcoming(after)`: the scheduled days strictly after `after`, with the text
--     the readability rules need. Read only.
--  3. `qotd_schedule_release(date, question_id)`: deletes that one row, and ONLY when the date is
--     strictly after today in America/Chicago (`qotd_today()`, the database's own clock, not a
--     caller's). Today and past days can never be released, whatever the caller passes, so a
--     published archive day can never change. Returns whether a row was deleted.
-- The old `qotd_schedule_candidates` stays (the schema gates call it); the job no longer does.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qotd_schedule_candidate_page(
  p_section text, p_domain text, p_after_id text, p_limit integer
)
RETURNS TABLE (
  question_id text, item_type text, stem text, passage text, options jsonb, explanation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT q.id, q.item_type, q.stem, q.passage, q.options, q.explanation
    FROM public.questions q
   WHERE q.section = p_section
     AND q.domain = p_domain
     AND public.qotd_question_is_eligible(q.id)
     AND (p_after_id IS NULL OR q.id > p_after_id)
   ORDER BY q.id
   LIMIT GREATEST(p_limit, 0)
$fn$;

CREATE OR REPLACE FUNCTION public.qotd_schedule_upcoming(p_after date)
RETURNS TABLE (
  qotd_date date, question_id text, section text, item_type text,
  stem text, passage text, options jsonb, explanation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT s.qotd_date, q.id, q.section, q.item_type, q.stem, q.passage, q.options, q.explanation
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
   WHERE s.qotd_date > p_after
   ORDER BY s.qotd_date
$fn$;

CREATE OR REPLACE FUNCTION public.qotd_schedule_release(p_date date, p_question_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_date <= public.qotd_today() THEN
    -- Today and the past are published (Home, the homepage, the archive): never released.
    RETURN false;
  END IF;
  DELETE FROM public.qotd_schedule
   WHERE qotd_date = p_date AND question_id = p_question_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION
  public.qotd_schedule_candidate_page(text, text, text, integer),
  public.qotd_schedule_upcoming(date),
  public.qotd_schedule_release(date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.qotd_schedule_candidate_page(text, text, text, integer),
  public.qotd_schedule_upcoming(date),
  public.qotd_schedule_release(date, text)
  TO service_role;

COMMIT;
