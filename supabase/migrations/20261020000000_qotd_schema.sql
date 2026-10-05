-- ===========================================================================
-- Question of the Day (QOTD): schedule, daily aggregate stats, and the functions that read
-- and write them.
--
-- @spec [docs/plans/seo/seo-marketing-vertical.md rulings R16 (pool, ungated), R17 (reveal on
--       submit, no quota, aggregate-only stats, "% got this right" only at >= 5 attempts),
--       R18 (one question per America/Chicago day, never repeated, enforced by the schedule
--       table), R20a (public exposure = the dated archive only); rows Q1-Q2; owner Step 0
--       decisions 2026-10-05 (pool excludes questions with assets; stats count the first
--       submit per hashed IP per day)] | @implemented [2026-10-05]
--
-- plain English:
--   * qotd_schedule: one row per Chicago calendar day. qotd_date is the PRIMARY KEY (one
--     question a day) and question_id is UNIQUE (never repeated). Both are the database's
--     guarantee, not the scheduler's.
--   * qotd_daily_stats: two counters per day. No per-person rows, no identifiers.
--   * qotd_schedule_candidates: the eligible pool for one section + domain, in a stable order
--     (canonical id). The TypeScript scheduler picks from it deterministically and screens
--     each candidate against the shared banned-phrase list (shared/seo/banned-phrases.ts).
--   * qotd_schedule_insert: inserts one day, re-checking eligibility in the database (so an
--     ineligible id is refused even if the caller is wrong). ON CONFLICT DO NOTHING makes a
--     rerun or a concurrent run a no-op; it reports 'inserted' | 'exists' | 'taken' |
--     'ineligible'.
--   * qotd_question_for: the question for a date, ONLY when that date is today or earlier in
--     America/Chicago — computed here from now(), never taken from the caller, so a future
--     day is unreadable through this function whatever the API does. Returns the answer
--     columns too: the API projects them out before submit (anti-leak is the serializer's
--     job, Coding Standards §5.2) and the archive build uses them for past days only.
--   * qotd_archive: every scheduled day strictly before today, for the build-time archive.
--   * qotd_record_attempt: one atomic increment of the day's counters.
--
-- Pool (eligibility): status 'published' with no issue flags (the servable_questions
-- predicate), no assets (the shared question renderer draws none), not in any full-length
-- test form (test_form_items), not already scheduled.
--
-- Access: RLS on both tables with NO policies, all privileges revoked from PUBLIC / anon /
-- authenticated; every function is SECURITY DEFINER with a pinned search_path and EXECUTE for
-- service_role only. Nothing here is reachable from a browser; only the server reads it.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qotd_schedule (
  qotd_date   date        PRIMARY KEY,
  question_id text        NOT NULL UNIQUE REFERENCES public.questions(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.qotd_schedule IS
  'QOTD (plan R18): one question per America/Chicago day. qotd_date PK = one a day; question_id UNIQUE = never repeated. Server-only (no grants beyond service_role).';

CREATE TABLE IF NOT EXISTS public.qotd_daily_stats (
  qotd_date date    PRIMARY KEY REFERENCES public.qotd_schedule(qotd_date),
  attempts  integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  correct   integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  CONSTRAINT qotd_daily_stats_correct_le_attempts CHECK (correct <= attempts)
);

COMMENT ON TABLE public.qotd_daily_stats IS
  'QOTD (plan R17): aggregate counters per day, atomic increments, no per-person rows.';

ALTER TABLE public.qotd_schedule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qotd_daily_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.qotd_schedule    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.qotd_daily_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.qotd_schedule            TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.qotd_daily_stats TO service_role;

-- The eligibility predicate, in ONE place, used by both the candidate list and the insert.
CREATE OR REPLACE FUNCTION public.qotd_question_is_eligible(p_question_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.questions q
     WHERE q.id = p_question_id
       AND q.status = 'published'
       AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
       AND (q.assets IS NULL OR q.assets IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb))
       AND NOT EXISTS (SELECT 1 FROM public.test_form_items t WHERE t.question_id = q.id)
       AND NOT EXISTS (SELECT 1 FROM public.qotd_schedule s WHERE s.question_id = q.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.qotd_schedule_candidates(
  p_section text, p_domain text, p_limit integer
)
RETURNS TABLE (question_id text, stem text, passage text, options jsonb, explanation text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.id, q.stem, q.passage, q.options, q.explanation
    FROM public.questions q
   WHERE q.section = p_section
     AND q.domain = p_domain
     AND public.qotd_question_is_eligible(q.id)
   ORDER BY q.id
   LIMIT GREATEST(p_limit, 0)
$$;

CREATE OR REPLACE FUNCTION public.qotd_schedule_insert(p_date date, p_question_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = p_date) THEN
    RETURN 'exists';
  END IF;
  IF NOT public.qotd_question_is_eligible(p_question_id) THEN
    RETURN 'ineligible';
  END IF;
  INSERT INTO public.qotd_schedule (qotd_date, question_id)
  VALUES (p_date, p_question_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'inserted';
  END IF;
  -- A concurrent run took the date or the question between the checks and the insert.
  IF EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = p_date) THEN
    RETURN 'exists';
  END IF;
  RETURN 'taken';
END
$$;

-- America/Chicago "today": the QOTD day boundary (R18). Fixed here rather than read from
-- practice_runtime_config.quota_reset_timezone, which may change independently.
CREATE OR REPLACE FUNCTION public.qotd_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE 'America/Chicago')::date
$$;

CREATE OR REPLACE FUNCTION public.qotd_question_for(p_date date)
RETURNS TABLE (
  qotd_date date,
  question_id text,
  section text,
  domain text,
  skill_codes text[],
  difficulty integer,
  item_type text,
  stem text,
  passage text,
  options jsonb,
  correct_answer text,
  correct_variants text[],
  explanation text,
  attempts integer,
  correct integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.qotd_date, q.id, q.section, q.domain, q.skill_codes, q.difficulty, q.item_type,
         q.stem, q.passage, q.options, q.correct_answer, q.correct_variants, q.explanation,
         COALESCE(st.attempts, 0), COALESCE(st.correct, 0)
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
    LEFT JOIN public.qotd_daily_stats st ON st.qotd_date = s.qotd_date
   WHERE s.qotd_date = COALESCE(p_date, public.qotd_today())
     AND s.qotd_date <= public.qotd_today()
     AND q.status = 'published'
     AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.qotd_archive()
RETURNS TABLE (
  qotd_date date,
  question_id text,
  section text,
  domain text,
  skill_codes text[],
  difficulty integer,
  item_type text,
  stem text,
  passage text,
  options jsonb,
  correct_answer text,
  correct_variants text[],
  explanation text,
  attempts integer,
  correct integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Counts included so an archive page built from this shows the same stat the API does.
  SELECT s.qotd_date, q.id, q.section, q.domain, q.skill_codes, q.difficulty, q.item_type,
         q.stem, q.passage, q.options, q.correct_answer, q.correct_variants, q.explanation,
         COALESCE(st.attempts, 0), COALESCE(st.correct, 0)
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
    LEFT JOIN public.qotd_daily_stats st ON st.qotd_date = s.qotd_date
   WHERE s.qotd_date < public.qotd_today()
     AND q.status = 'published'
     AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
   ORDER BY s.qotd_date
$$;

-- Only a scheduled day that has arrived can be counted (no stats rows for future days).
CREATE OR REPLACE FUNCTION public.qotd_record_attempt(p_date date, p_correct boolean)
RETURNS TABLE (attempts integer, correct integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_date > public.qotd_today()
     OR NOT EXISTS (SELECT 1 FROM public.qotd_schedule s WHERE s.qotd_date = p_date) THEN
    RAISE EXCEPTION 'qotd_record_attempt: % is not a scheduled day that has arrived', p_date
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  INSERT INTO public.qotd_daily_stats AS d (qotd_date, attempts, correct)
  VALUES (p_date, 1, CASE WHEN p_correct THEN 1 ELSE 0 END)
  ON CONFLICT (qotd_date) DO UPDATE
    SET attempts = d.attempts + 1,
        correct  = d.correct + CASE WHEN p_correct THEN 1 ELSE 0 END
  RETURNING d.attempts, d.correct;
END
$$;

REVOKE ALL ON FUNCTION public.qotd_question_is_eligible(text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_schedule_candidates(text, text, integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_schedule_insert(date, text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_today()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_question_for(date)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_archive()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_record_attempt(date, boolean)              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qotd_question_is_eligible(text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_schedule_candidates(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_schedule_insert(date, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_today()                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_question_for(date)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_archive()                                TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_record_attempt(date, boolean)            TO service_role;

COMMIT;
