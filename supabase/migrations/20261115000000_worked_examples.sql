-- ===========================================================================
-- Worked examples: the approved breakdown of one bank question, its manual social metrics,
-- the question-usage view, and the leak rule in both directions.
--
-- @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27; replaces the pilot
--       brief of the same day): data model (worked_examples + post_on, hook_type, hook_line),
--       hook library (five hook types), measurement (worked_example_metrics, manual entry,
--       monthly readout); Step 0 rulings (Karl, 2026-10-27): 1 no future-QOTD or full-length
--       questions, and the QOTD scheduler skips approved worked-example questions; 3 post_on +
--       a daily job; 4 render from the merged content file, rows from generated seed SQL;
--       7 questions stay in practice] | @implemented [2026-10-27]
--
-- plain English:
--   * worked_examples: one row per question (question_id UNIQUE; id is 'we-' || lower(question_id)
--     so a person typing metrics can read it). steps is a JSON array of 3 to 6
--     {notepad, voice} pairs. status is draft | approved | retired; an approved row carries who
--     approved it, when, and the day it posts (post_on), and two approved rows never share a
--     post_on. hook_type is one of the five in the hook library. The rows are written by the
--     seed SQL the batch tooling generates from the merged content file
--     (scripts/worked-examples/seed-sql.ts), which Karl applies; nothing in the app writes them.
--     The column the brief calls `check` is check_step here: CHECK is a reserved word.
--   * The leak rule, enforced here so no caller can skip it: a row cannot BECOME or STAY approved
--     while its question is in any full-length form (test_form_items) or has a QOTD day today or
--     later (qotd_schedule; past QOTD days are already public in the archive). The other
--     direction: qotd_question_is_eligible now also refuses a question with an approved worked
--     example, so the scheduler's candidate list and its insert both skip it.
--   * worked_example_metrics: one manual reading per (example, platform, captured_at). The
--     brief's 3s_retention_pct is retention_3s_pct here (an identifier cannot start with a digit
--     unquoted). Percentages are 0..100; counts are >= 0.
--   * worked_example_metrics_monthly: the monthly readout, latest reading per example and
--     platform within each month.
--   * questions_with_usage: every question with usage_tags derived on read, in a fixed order
--     (qotd, full_length, worked_example), never stored. It exposes every question column,
--     answers included, so it is security_invoker and service_role only, exactly like the table.
--
-- Access: RLS on both tables with NO policies; all privileges revoked from PUBLIC / anon /
-- authenticated; service_role reads and writes. The trigger function is SECURITY INVOKER (it runs
-- as the writer, who must already be service_role). Nothing here is reachable from a browser.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.worked_examples (
  id               text        PRIMARY KEY,
  question_id      text        NOT NULL UNIQUE REFERENCES public.questions(id),
  skill_code       text        NOT NULL CHECK (length(btrim(skill_code)) > 0),
  signature_move   text        NOT NULL CHECK (length(btrim(signature_move)) > 0),
  steps            jsonb       NOT NULL,
  trap             text        NOT NULL CHECK (length(btrim(trap)) > 0),
  check_step       text        NOT NULL CHECK (length(btrim(check_step)) > 0),
  takeaway         text        NOT NULL CHECK (length(btrim(takeaway)) > 0),
  video_script     text        NOT NULL CHECK (length(btrim(video_script)) > 0),
  hook_type        text        NOT NULL,
  hook_line        text        NOT NULL CHECK (length(btrim(hook_line)) > 0),
  post_on          date,
  status           text        NOT NULL DEFAULT 'draft',
  approved_by      text,
  approved_at      timestamptz,
  video_asset_path text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worked_examples_id_from_question CHECK (id = 'we-' || lower(question_id)),
  CONSTRAINT worked_examples_status_check CHECK (status IN ('draft', 'approved', 'retired')),
  CONSTRAINT worked_examples_hook_type_check CHECK (
    hook_type IN ('puzzle', 'obvious_answer_trap', 'speed', 'challenge', 'contrarian')),
  CONSTRAINT worked_examples_steps_shape CHECK (
    jsonb_typeof(steps) = 'array'
    AND jsonb_array_length(steps) BETWEEN 3 AND 6
    AND NOT jsonb_path_exists(steps,
      '$[*] ? (!(@.type() == "object"
                 && exists(@.notepad ? (@.type() == "string" && @ != ""))
                 && exists(@.voice ? (@.type() == "string" && @ != ""))))')),
  CONSTRAINT worked_examples_approval_complete CHECK (
    status <> 'approved'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND post_on IS NOT NULL))
);

COMMENT ON TABLE public.worked_examples IS
  'Worked examples (Karl, 2026-10-27): one approved breakdown per bank question, posted on post_on. Leak rule enforced by trigger; QOTD eligibility skips approved rows. Server-only.';
COMMENT ON COLUMN public.worked_examples.check_step IS
  'The brief''s `check` (how to confirm the answer). Renamed: CHECK is a reserved word.';

-- Two approved examples never post on the same day.
CREATE UNIQUE INDEX IF NOT EXISTS worked_examples_one_per_post_day
  ON public.worked_examples (post_on) WHERE status = 'approved';

-- The leak rule, worked-example side. Runs on every write that leaves a row approved, so an
-- update of an approved row re-checks it too.
CREATE OR REPLACE FUNCTION public.worked_examples_leak_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'approved' THEN
    IF EXISTS (SELECT 1 FROM public.test_form_items t WHERE t.question_id = NEW.question_id) THEN
      RAISE EXCEPTION 'worked_example_leak: % is in a full-length test form', NEW.question_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.qotd_schedule s
                WHERE s.question_id = NEW.question_id
                  AND s.qotd_date >= public.qotd_today()) THEN
      RAISE EXCEPTION 'worked_example_leak: % is a QOTD today or later', NEW.question_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS worked_examples_leak_guard ON public.worked_examples;
CREATE TRIGGER worked_examples_leak_guard
  BEFORE INSERT OR UPDATE ON public.worked_examples
  FOR EACH ROW EXECUTE FUNCTION public.worked_examples_leak_guard();

CREATE TABLE IF NOT EXISTS public.worked_example_metrics (
  id                    bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worked_example_id     text         NOT NULL REFERENCES public.worked_examples(id),
  platform              text         NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube')),
  captured_at           timestamptz  NOT NULL,
  views                 integer      NOT NULL CHECK (views >= 0),
  retention_3s_pct      numeric(5,2) NOT NULL CHECK (retention_3s_pct BETWEEN 0 AND 100),
  avg_watch_seconds     numeric(6,2) NOT NULL CHECK (avg_watch_seconds >= 0),
  completion_pct        numeric(5,2) NOT NULL CHECK (completion_pct BETWEEN 0 AND 100),
  non_follower_view_pct numeric(5,2) NOT NULL CHECK (non_follower_view_pct BETWEEN 0 AND 100),
  follows               integer      NOT NULL CHECK (follows >= 0),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT worked_example_metrics_one_reading UNIQUE (worked_example_id, platform, captured_at)
);

COMMENT ON TABLE public.worked_example_metrics IS
  'Worked-example social metrics, entered by hand from each platform''s analytics (Karl, 2026-10-27). retention_3s_pct is the brief''s 3s_retention_pct. Server-only.';

ALTER TABLE public.worked_examples        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worked_example_metrics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worked_examples        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.worked_example_metrics FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worked_examples        TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worked_example_metrics TO service_role;

REVOKE ALL ON FUNCTION public.worked_examples_leak_guard() FROM PUBLIC, anon, authenticated;

-- The monthly readout: per month, the latest reading of each example on each platform.
CREATE OR REPLACE VIEW public.worked_example_metrics_monthly
WITH (security_invoker = true) AS
SELECT DISTINCT ON (date_trunc('month', m.captured_at), m.worked_example_id, m.platform)
       date_trunc('month', m.captured_at)::date AS month,
       m.worked_example_id,
       w.skill_code,
       w.hook_type,
       m.platform,
       m.captured_at,
       m.views,
       m.retention_3s_pct,
       m.avg_watch_seconds,
       m.completion_pct,
       m.non_follower_view_pct,
       m.follows
  FROM public.worked_example_metrics m
  JOIN public.worked_examples w ON w.id = m.worked_example_id
 ORDER BY date_trunc('month', m.captured_at), m.worked_example_id, m.platform, m.captured_at DESC;

REVOKE ALL ON public.worked_example_metrics_monthly FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.worked_example_metrics_monthly TO service_role;

-- usage_tags is derived on every read, so it cannot drift. A new surface that publishes or
-- reserves questions EXTENDS this view with one more row in the VALUES list.
CREATE OR REPLACE VIEW public.questions_with_usage
WITH (security_invoker = true) AS
SELECT q.*,
       ARRAY(
         SELECT t.tag
           FROM (VALUES
             (1, 'qotd',           EXISTS (SELECT 1 FROM public.qotd_schedule s   WHERE s.question_id = q.id)),
             (2, 'full_length',    EXISTS (SELECT 1 FROM public.test_form_items f WHERE f.question_id = q.id)),
             (3, 'worked_example', EXISTS (SELECT 1 FROM public.worked_examples w WHERE w.question_id = q.id
                                                                                  AND w.status = 'approved'))
           ) AS t(ord, tag, present)
          WHERE t.present
          ORDER BY t.ord
       )::text[] AS usage_tags
  FROM public.questions q;

REVOKE ALL ON public.questions_with_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.questions_with_usage TO service_role;

-- The leak rule, QOTD side: the one eligibility predicate (used by the candidate lists and by
-- qotd_schedule_insert) now also refuses a question with an approved worked example. Body
-- otherwise identical to 20261020000000_qotd_schema.sql.
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
       AND NOT EXISTS (SELECT 1 FROM public.worked_examples w
                        WHERE w.question_id = q.id AND w.status = 'approved')
  )
$$;

REVOKE ALL ON FUNCTION public.qotd_question_is_eligible(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qotd_question_is_eligible(text) TO service_role;

COMMIT;
