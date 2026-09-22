-- ============================================================================
-- Doc 05F — first real plan in production (OWNER-RUN, read-mostly)
-- ============================================================================
-- @spec [Doc-05F_V1.0 §12.1 setup, §12.3 version allocation, §7.6
--        calendar_current_plan, §10.3 validator, §21 enabled_block_types
--        Doc_05F_formula_sheet.md §2 (the six steps), §4 (constants)]
-- @implemented [2026-09-22]
--
-- WHAT THIS IS. The calendar vertical has never generated a plan for a real
-- student. This writes ONE study profile, generates ONE plan from it, and then
-- checks the result against what Doc 05F says it must be, printing PASS or FAIL
-- per assertion. It is the first end-to-end proof that the formula, the
-- validator and the writers behave in production the way they behave in CI.
--
-- THE AGENT DID NOT RUN THIS. It writes to a real account and must be run by
-- the owner, with eyes on the output.
--
-- HOW TO RUN
--   psql "<production connection string>" -v ON_ERROR_STOP=1 -f scripts/ops/calendar-prod-smoke.sql
--
-- It runs inside ONE transaction that COMMITS. Section 5 is a separate,
-- optional rollback you may run afterwards.
--
-- WHAT IT WRITES
--   1 row in student_study_profile
--   1 row in calendar_plan_versions, plus its plan_dates / blocks / memberships
-- Nothing else. It answers no HTTP, touches no other student, and reads the
-- question bank not at all.
--
-- PRE-FLIGHT. Section 0 refuses to continue unless the target account exists
-- and has no calendar state already, so a second run cannot quietly make a
-- second plan.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

\set student '3f18cbe2-a999-41d4-852b-2af27e19d04e'

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Pre-flight. Refuse rather than make a mess.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  S CONSTANT uuid := '3f18cbe2-a999-41d4-852b-2af27e19d04e';
  v_n integer;
  v_domains integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = S) THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: profile % does not exist on this database', S;
  END IF;

  SELECT count(*) INTO v_n FROM public.student_study_profile WHERE student_id = S;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % already has a study profile. This script creates the FIRST one. Run section 5 first if you are re-running.', S;
  END IF;

  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % already has % plan version(s). Plan rows are append-only and this script is for the FIRST plan.', S, v_n;
  END IF;

  -- The plan is only interesting if there is mastery to weight it by.
  SELECT count(*) INTO v_domains FROM public.student_domain_mastery WHERE student_id = S;
  IF v_domains = 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % has no domain mastery, so the plan would be a cold start and would prove nothing about the weighting', S;
  END IF;

  RAISE NOTICE 'PRE-FLIGHT OK: account exists, no calendar state, % domain(s) of mastery', v_domains;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. The study profile (§8.1). These are the student inputs setup collects.
--
--    Chicago, 60 minutes a day, Monday-Saturday, full-lengths on Saturday,
--    target 1400, exam 2026-11-07.
--
--    study_days_mask bit i = Postgres DOW i, Sunday = 0. Mon..Sat = bits 1..6
--    = 2+4+8+16+32+64 = 126. full_length_weekday 6 = Saturday.
-- ----------------------------------------------------------------------------
INSERT INTO public.student_study_profile
  (student_id, timezone, target_exam_date, target_score,
   study_days_mask, daily_minutes, full_length_weekday, planner_mode, setup_completed_at)
VALUES (:'student', 'America/Chicago', DATE '2026-11-07', 1400,
        126, 60, 6, 'auto', now());

-- ----------------------------------------------------------------------------
-- 2. Generate. `setup`, student-initiated (§12.1), owning the whole horizon.
--    The generator version comes from config, never a literal (§17).
-- ----------------------------------------------------------------------------
SELECT public.calendar_persist_version(
         :'student', 'setup', 'student',
         (SELECT value #>> '{}' FROM public.calendar_runtime_config WHERE key = 'generator_version')
       ) AS persist_result \gset

\echo ''
\echo '=== persist_result ==='
SELECT :'persist_result'::jsonb AS result;

-- ----------------------------------------------------------------------------
-- 3. The assertions. Each prints PASS or FAIL with what it actually saw.
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== assertions ==='

WITH v AS (
  SELECT plan_version_id, version_no, generator, validator_result
  FROM public.calendar_plan_versions
  WHERE student_id = :'student'
  ORDER BY version_no DESC LIMIT 1
),
dates AS (
  SELECT count(*) AS n FROM public.calendar_plan_dates d
  JOIN v ON v.plan_version_id = d.plan_version_id
),
blocks AS (
  SELECT b.* FROM public.calendar_blocks b
  JOIN public.calendar_plan_block_memberships m ON m.block_id = b.block_id
  JOIN v ON v.plan_version_id = m.plan_version_id
),
horizon AS (
  SELECT (value #>> '{}')::integer AS n
  FROM public.calendar_runtime_config WHERE key = 'horizon_days'
),
granularity AS (
  SELECT (value #>> '{}')::integer AS n
  FROM public.calendar_runtime_config WHERE key = 'granularity'
),
maxdom AS (
  SELECT (value #>> '{}')::integer AS n
  FROM public.calendar_runtime_config WHERE key = 'max_domains_per_block'
),
-- One ROW per canonical name, not an aggregated array: `= ANY (subquery)` wants a
-- set, and handing it a text[] is an operator-does-not-exist error at run time.
canon AS (
  SELECT t AS name
  FROM jsonb_array_elements_text(
    (SELECT value FROM public.calendar_runtime_config WHERE key = 'canonical_domain_order')) t
),
-- The first STUDY day the plan owns, and its R&W block.
firstday AS (
  SELECT min(d.scheduled_date) AS d
  FROM public.calendar_plan_dates d
  JOIN v ON v.plan_version_id = d.plan_version_id
  WHERE EXISTS (SELECT 1 FROM blocks b WHERE b.scheduled_date = d.scheduled_date)
),
rw_mix AS (
  SELECT jsonb_array_elements(b.scope -> 'mix') ->> 'domain' AS domain
  FROM blocks b, firstday f
  WHERE b.scheduled_date = f.d AND b.section = 'RW' AND b.scope ->> 'level' = 'domain'
),
-- The LIVE launch set, one row per type. Never a literal list: this script has to keep
-- telling the truth on the day the flag flips, and a hard-coded ["practice"] would start
-- failing the moment review is enabled while claiming the plan was wrong.
enabled AS (
  SELECT t AS block_type
  FROM jsonb_array_elements_text(
    (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types')) t
),
-- Does this account have review work the engine could actually serve? Active queue rows
-- joined to servable_questions, which is the same join the planner makes (addendum 32).
servable_queue AS (
  SELECT count(*)::integer AS n
  FROM public.review_schedule r
  JOIN public.servable_questions sq ON sq.id = r.question_id
  WHERE r.student_id = :'student' AND r.status = 'active'
),
-- The per-unit seconds the GENERATOR budgeted against, read from the same two config
-- rows calendar_build_plan_input snapshots into engine_planning. Never literals: a
-- hard-coded 90 here would keep saying PASS after the constant moved.
secs AS (
  SELECT
    (SELECT (value #>> '{}')::integer FROM public.practice_runtime_config
      WHERE key = 'target_seconds_per_question') AS practice,
    (SELECT (value #>> '{}')::integer FROM public.calendar_runtime_config
      WHERE key = 'review_estimated_seconds_per_item') AS review
),
budget AS (
  SELECT daily_minutes * 60 AS secs, study_days_mask AS mask
  FROM public.student_study_profile WHERE student_id = :'student'
),
-- What each STUDY day in the plan actually holds, in seconds. A day the student
-- overrode is excluded: they own it, and it is not the generator's to fill.
day_secs AS (
  SELECT d.scheduled_date AS d,
         COALESCE(sum(
           b.target_count * CASE b.block_type
             WHEN 'practice' THEN (SELECT practice FROM secs)
             WHEN 'review'   THEN (SELECT review FROM secs)
             ELSE 0 END), 0)::integer AS planned
  FROM public.calendar_plan_dates d
  JOIN v ON v.plan_version_id = d.plan_version_id
  LEFT JOIN blocks b ON b.scheduled_date = d.scheduled_date
  WHERE ((SELECT mask FROM budget) >> EXTRACT(DOW FROM d.scheduled_date)::integer) & 1 = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_current_plan cp
      WHERE cp.student_id = :'student' AND cp.scheduled_date = d.scheduled_date
        AND cp.is_user_override)
    -- A full-length day holds one exam and nothing else, so it has no per-question
    -- budget to compare. Excluded rather than special-cased into the arithmetic.
    AND NOT EXISTS (
      SELECT 1 FROM blocks fb
      WHERE fb.scheduled_date = d.scheduled_date AND fb.block_type = 'full_length')
  GROUP BY 1
),
short_days AS (
  SELECT count(*)::integer AS n, min(d) AS first_short
  FROM day_secs
  -- Within ONE granule: the allocator works in whole 5-question blocks, so a day can
  -- fall short by up to one and still be correctly planned. More than that is the
  -- under-planning 20260925000000 fixed.
  WHERE planned < (SELECT secs FROM budget)
                  - ((SELECT n FROM granularity) * (SELECT practice FROM secs))
),
-- Dates the student BLOCKED OUT, read from HISTORY rather than from the current plan.
--
-- The obvious definition -- "overridden and currently empty" -- cannot fail, and that is
-- not a figure of speech. The regression this assertion exists to catch is a date the
-- student cleared coming back with work on it; the moment it does, it stops being empty,
-- stops matching, and the check SKIPs. A gate that goes quiet exactly when the defect
-- appears is worse than no gate, because it reads as a pass.
--
-- So the block-out is identified by what the STUDENT DID: the most recent accepted
-- `day_edit` version that owned this date owned it with no members at all. That is what
-- §12.4 writes when a day is cleared, and history is append-only (INV-08-05), so it stays
-- true whatever a later version does. A11 then asks whether anything has appeared there
-- since -- which is the actual question.
last_day_edit AS (
  SELECT DISTINCT ON (d.scheduled_date)
         d.scheduled_date AS d, d.plan_version_id AS pv, pv.version_no
  FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions pv ON pv.plan_version_id = d.plan_version_id
  WHERE pv.student_id = :'student'
    AND pv.trigger = 'day_edit'
    AND pv.validator_result = 'accepted'
  ORDER BY d.scheduled_date, pv.version_no DESC
),
blocked_dates AS (
  SELECT e.d
  FROM last_day_edit e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.calendar_plan_block_memberships m
    WHERE m.plan_version_id = e.pv AND m.scheduled_date = e.d)
)
SELECT * FROM (
  SELECT 1 AS ord,
         'A1  exactly one accepted version, generator deterministic_v1' AS assertion,
         CASE WHEN (SELECT validator_result FROM v) = 'accepted'
               AND (SELECT generator FROM v) = 'deterministic_v1'
              THEN 'PASS' ELSE 'FAIL' END AS outcome,
         format('validator=%s generator=%s',
                (SELECT validator_result FROM v), (SELECT generator FROM v)) AS observed
  UNION ALL
  SELECT 2, 'A2  the version owns horizon_days plan dates',
         CASE WHEN (SELECT n FROM dates) = (SELECT n FROM horizon) THEN 'PASS' ELSE 'FAIL' END,
         format('dates=%s horizon_days=%s', (SELECT n FROM dates), (SELECT n FROM horizon))
  UNION ALL
  SELECT 3, 'A3  every block type is in the LIVE enabled_block_types',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM blocks b
                WHERE b.block_type NOT IN (SELECT block_type FROM enabled))
              THEN 'PASS' ELSE 'FAIL' END,
         format('planned = %s | enabled = %s',
                COALESCE((SELECT string_agg(DISTINCT block_type, ',') FROM blocks), '(none)'),
                (SELECT string_agg(block_type, ',' ORDER BY block_type) FROM enabled))
  UNION ALL
  -- A PRACTICE block carries a section; review and full_length carry NULL, and the table
  -- CHECK requires exactly that. Before review was enabled these were the same assertion;
  -- they are not any more, and the looser one would have passed a practice block with no
  -- section on it.
  SELECT 4, 'A4  every practice block has a section, every other type has none',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM blocks
                WHERE (block_type = 'practice' AND section IS NULL)
                   OR (block_type <> 'practice' AND section IS NOT NULL))
              THEN 'PASS' ELSE 'FAIL' END,
         format('%s practice with no section, %s non-practice with one',
                (SELECT count(*) FROM blocks WHERE block_type = 'practice' AND section IS NULL),
                (SELECT count(*) FROM blocks WHERE block_type <> 'practice' AND section IS NOT NULL))
  UNION ALL
  SELECT 5, 'A5  every mix has at most max_domains_per_block entries',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM blocks b
                WHERE b.scope ->> 'level' = 'domain'
                  AND jsonb_array_length(b.scope -> 'mix') > (SELECT n FROM maxdom))
              THEN 'PASS' ELSE 'FAIL' END,
         format('widest mix = %s, cap = %s',
                COALESCE((SELECT max(jsonb_array_length(b.scope -> 'mix')) FROM blocks b
                          WHERE b.scope ->> 'level' = 'domain'), 0),
                (SELECT n FROM maxdom))
  UNION ALL
  SELECT 6, 'A6  every mix domain is one of the canonical eight, in full',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM blocks b,
                     LATERAL jsonb_array_elements(b.scope -> 'mix') e
                WHERE b.scope ->> 'level' = 'domain'
                  AND (e ->> 'domain') NOT IN (SELECT name FROM canon))
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT string_agg(DISTINCT e ->> 'domain', ' | ')
                   FROM blocks b, LATERAL jsonb_array_elements(b.scope -> 'mix') e
                   WHERE b.scope ->> 'level' = 'domain'), '(none)')
  UNION ALL
  SELECT 7, 'A7  every mix count is a multiple of granularity',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM blocks b, LATERAL jsonb_array_elements(b.scope -> 'mix') e
                WHERE b.scope ->> 'level' = 'domain'
                  AND ((e ->> 'count')::integer % (SELECT n FROM granularity)) <> 0)
              THEN 'PASS' ELSE 'FAIL' END,
         format('granularity = %s, counts = %s',
                (SELECT n FROM granularity),
                COALESCE((SELECT string_agg(DISTINCT e ->> 'count', ',')
                          FROM blocks b, LATERAL jsonb_array_elements(b.scope -> 'mix') e
                          WHERE b.scope ->> 'level' = 'domain'), '(none)'))
  UNION ALL
  -- The weighting proof. Expression of Ideas is the student's weakest R&W
  -- domain, so the deficit rule must put it in the first study day's R&W block.
  SELECT 8, 'A8  Expression of Ideas is in the first study day R&W block',
         CASE WHEN EXISTS (SELECT 1 FROM rw_mix WHERE domain = 'Expression of Ideas')
              THEN 'PASS' ELSE 'FAIL' END,
         format('first study day %s, R&W mix = %s',
                (SELECT d FROM firstday),
                COALESCE((SELECT string_agg(domain, ' | ') FROM rw_mix), '(no domain-level R&W block)'))
  UNION ALL
  -- A9 is CONDITIONAL on both facts, and says which one let it off. Asserting a review
  -- block unconditionally would fail for an account with an empty queue, and asserting it
  -- while review is still disabled would fail for a reason that is not a defect.
  SELECT 9, 'A9  with review enabled and servable queue work, the horizon has a review block',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM enabled WHERE block_type = 'review') THEN 'SKIP'
           WHEN (SELECT n FROM servable_queue) = 0 THEN 'SKIP'
           WHEN EXISTS (SELECT 1 FROM blocks WHERE block_type = 'review') THEN 'PASS'
           ELSE 'FAIL'
         END,
         format('review enabled = %s | servable queue rows = %s | review blocks planned = %s',
                EXISTS (SELECT 1 FROM enabled WHERE block_type = 'review'),
                (SELECT n FROM servable_queue),
                (SELECT count(*) FROM blocks WHERE block_type = 'review'))
  UNION ALL
  -- A10 catches 20260925000000 regressing. Before it, the generator reserved budget for
  -- review and full-length blocks that enabled_block_types then filtered out, and days
  -- were served at half their length with nothing anywhere to say so -- 20 questions
  -- where 40 fit, and an empty Saturday. The symptom is arithmetic, so the assertion is.
  SELECT 10, 'A10 every open study day is planned to the daily budget, within one granule',
         CASE WHEN (SELECT n FROM short_days) = 0 THEN 'PASS' ELSE 'FAIL' END,
         format('budget %s s/day | granule %s s | short days = %s%s',
                (SELECT secs FROM budget),
                (SELECT n FROM granularity) * (SELECT practice FROM secs),
                (SELECT n FROM short_days),
                COALESCE(' | first short: ' || (SELECT first_short FROM short_days)::text, ''))
  UNION ALL
  -- A11 is CONDITIONAL: most accounts have blocked out nothing, and asserting a day off
  -- would fail for an account that simply has none. When there IS one, the CURRENT plan
  -- must still hold nothing there -- a blocked day that came back with work is the weekly
  -- job or a profile change taking a date the student owns (§12.1). See `blocked_dates`
  -- for why this is read from history and not from "currently empty".
  SELECT 11, 'A11 a blocked-out date is still empty',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM blocked_dates) THEN 'SKIP'
           WHEN EXISTS (
             SELECT 1 FROM blocked_dates bd
             JOIN blocks b ON b.scheduled_date = bd.d) THEN 'FAIL'
           ELSE 'PASS'
         END,
         format('blocked-out dates = %s%s',
                (SELECT count(*) FROM blocked_dates),
                COALESCE(' | ' || (SELECT string_agg(d::text, ', ') FROM blocked_dates), ''))
) t ORDER BY ord;

\echo ''
\echo '=== the plan, for eyes ==='
SELECT cp.scheduled_date,
       cp.is_user_override,
       b.block_type,
       b.section,
       b.target_count,
       b.scope -> 'mix' AS mix,
       b.explanation_key
FROM public.calendar_current_plan cp
LEFT JOIN public.calendar_blocks b ON b.block_id = cp.block_id
WHERE cp.student_id = :'student'
ORDER BY cp.scheduled_date, cp.display_ordinal;

\echo ''
\echo '=== the mastery this was weighted by ==='
SELECT section, domain, mastery_level, event_count_total
FROM public.student_domain_mastery
WHERE student_id = :'student'
ORDER BY section, mastery_level, domain;

COMMIT;

\echo ''
\echo 'COMMITTED. If any assertion above says FAIL, run section 5 and report it.'

-- ============================================================================
-- 5. ROLLBACK (optional, run separately)
-- ============================================================================
-- Uncomment and run this block to remove the test STUDY PROFILE.
--
-- WHAT IT DOES NOT REMOVE, AND WHY. calendar_plan_versions, calendar_plan_dates,
-- calendar_blocks and calendar_plan_block_memberships are APPEND-ONLY by design
-- (Doc 05F §7.2-§7.5, INV-08-05). They carry no student content beyond the plan
-- shape, they are the audit history of what was generated and when, and the only
-- sanctioned path that removes them is the account-deletion cascade. So this
-- rollback is PROFILE-ONLY and the plan rows remain, deliberately, as history.
--
-- Deleting the profile does NOT orphan them: calendar_plan_versions.student_id
-- references profiles(id), not student_study_profile.
--
-- BEGIN;
--   DELETE FROM public.student_study_profile
--    WHERE student_id = '3f18cbe2-a999-41d4-852b-2af27e19d04e';
--   SELECT count(*) AS plan_versions_left_as_history
--     FROM public.calendar_plan_versions
--    WHERE student_id = '3f18cbe2-a999-41d4-852b-2af27e19d04e';
-- COMMIT;
