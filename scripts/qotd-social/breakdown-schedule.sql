-- QOTD breakdown: the next 7 scheduled QOTD days, as JSON, for the weekly script-authoring session.
--
-- @spec [SCL-266 as ruled by Karl 2026-11-02 on #1398: Claude Code writes breakdown scripts for
--   the next 7 scheduled QOTD dates "using each date's stored order and letter"; Claude Code never
--   reads production, so the owner runs this read-only export and hands the result over]
--   | @implemented [2026-11-02]
--
-- OWNER-RUN, READ-ONLY: one SELECT, no writes, no functions with side effects. Run it against
-- production yourself, e.g. in the Supabase SQL editor (copy the one cell it returns), or:
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -At \
--     -f scripts/qotd-social/breakdown-schedule.sql > ~/qotd-breakdown-schedule.json
-- and give the file to the authoring session. Keep it OUTSIDE every repository checkout.
--
-- ANTI-LEAK: the result holds the answers (correct_display_letter) of QOTDs that have NOT been
-- published yet. Never commit it, post it to Slack, paste it into a pull request or issue, or log
-- it. The authoring session reads it from a path outside the repository
-- (scripts/qotd-social/check-breakdown-scripts.ts --schedule refuses one inside a checkout).
--
-- Output: one JSON array, a row per scheduled day after today (the 04:00 UTC QOTD day,
-- qotd_today()) up to today + 7, in date order (the scheduler fills 7 days ahead,
-- server/services/qotd/schedule-job.ts QOTD_DAYS_AHEAD), each
--   { "qotd_date", "question_id", "option_order", "correct_display_letter", "section" }
-- exactly as qotd_schedule stored them at scheduling (write-once, SCL-258). A grid-in day has
-- "option_order": [] and "correct_display_letter": null. The shape is
-- packages/shared/src/qotd-breakdown-schema.ts qotdBreakdownScheduleSchema; gate Q-11 in
-- scripts/ci/qotd-schema-gates.sql runs this file against the migration pipeline.
-- (One statement, every comment line starting "--": the gate strips those and reads the rest.)
SELECT coalesce(
         json_agg(
           json_build_object(
             'qotd_date', s.qotd_date::text,
             'question_id', s.question_id,
             'option_order', s.option_order,
             'correct_display_letter', s.correct_display_letter,
             'section', q.section
           )
           ORDER BY s.qotd_date
         ),
         '[]'::json
       ) AS schedule
  FROM public.qotd_schedule s
  JOIN public.questions q ON q.id = s.question_id
 WHERE s.qotd_date > public.qotd_today()
   AND s.qotd_date <= public.qotd_today() + 7;
