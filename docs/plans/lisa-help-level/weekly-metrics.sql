-- ===========================================================================
-- LISA help-level engine: the four weekly metrics (owner brief "Help-level engine", Karl
-- 2026-11-05, item 7; SCL-275). READ-ONLY. Run by hand in the SQL editor; nothing here writes.
-- ===========================================================================
-- Source: public.tutor_turn_metrics, one row per turn. The help columns
-- (20261201000000_lisa_help_level.sql) are set on every turn that reached the worker; `intent` is
-- set on every tap. Codes and counts only: no message text, no student id.
--
-- Definitions, shared by the four queries (the CTEs below):
--   episode     — a walkthrough: from a "Walk me through it" (or "Show me on Desmos") tap up to
--                 (not including) the conversation's next one, or its end. Keyed on `intent`, so
--                 the weeks before the engine (no help columns yet) are measured too: the
--                 baseline, where no turn is on the final rung and so no episode resolves.
--   tap         — a "Got it, next step" (`step_understood`) or "I'm stuck" (`step_stuck`) turn.
--   final rung  — the last step allowed: help_level 'full_solution', or worked step 3 (the last
--                 one before submission).
--   resolved    — the episode reaches the final rung, or the student types a correct step
--                 (help_signal 'correct_step').
--   dead end    — the episode's last turn is the conversation's last turn and the episode never
--                 resolved: the student left mid-walkthrough without reaching the answer.
-- Week = the ISO week (Monday start) of the episode's first turn, UTC.
-- ===========================================================================

WITH turns AS (
  SELECT m.conversation_id, m.recorded_at, m.id, m.intent, m.help_level, m.help_worked_step,
         m.help_signal,
         (m.help_level = 'full_solution'
          OR (m.help_level = 'worked_step' AND m.help_worked_step = 3)) AS at_final,
         m.intent IN ('step_understood', 'step_stuck') AS is_tap
  FROM public.tutor_turn_metrics m
  WHERE m.recorded_at >= now() - interval '12 weeks'
),
numbered AS (
  SELECT t.*,
         sum(CASE WHEN t.intent IN ('walkthrough', 'desmos_walkthrough') THEN 1 ELSE 0 END)
           OVER (PARTITION BY t.conversation_id ORDER BY t.recorded_at, t.id) AS episode_no,
         row_number() OVER (PARTITION BY t.conversation_id ORDER BY t.recorded_at DESC, t.id DESC)
           AS from_end
  FROM turns t
),
episode_turns AS (
  SELECT n.*,
         row_number() OVER (PARTITION BY n.conversation_id, n.episode_no
                            ORDER BY n.recorded_at, n.id) AS pos
  FROM numbered n
  WHERE n.episode_no > 0
),
resolution AS (
  -- The first turn of each episode that resolves it.
  SELECT conversation_id, episode_no, min(pos) AS resolved_at_pos
  FROM episode_turns
  WHERE at_final OR help_signal = 'correct_step'
  GROUP BY conversation_id, episode_no
),
episodes AS (
  SELECT e.conversation_id, e.episode_no,
         date_trunc('week', min(e.recorded_at)) AS week,
         r.resolved_at_pos,
         count(*) FILTER (WHERE e.is_tap
                          AND (r.resolved_at_pos IS NULL OR e.pos <= r.resolved_at_pos))
           AS taps_to_resolution,
         bool_or(e.from_end = 1) AS ends_conversation
  FROM episode_turns e
  LEFT JOIN resolution r USING (conversation_id, episode_no)
  GROUP BY e.conversation_id, e.episode_no, r.resolved_at_pos
),
-- Runs of consecutive taps per conversation (gaps-and-islands: a non-tap turn ends a run).
runs AS (
  SELECT conversation_id, date_trunc('week', min(recorded_at)) AS week, count(*) AS streak
  FROM (
    SELECT n.*,
           row_number() OVER (PARTITION BY n.conversation_id ORDER BY n.recorded_at, n.id)
           - row_number() OVER (PARTITION BY n.conversation_id, n.is_tap
                                ORDER BY n.recorded_at, n.id) AS island
    FROM numbered n
  ) x
  WHERE is_tap
  GROUP BY conversation_id, island
)
SELECT w.week,
       -- 1. Median taps to resolution, over resolved episodes.
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY e.taps_to_resolution)
          FROM episodes e WHERE e.week = w.week AND e.resolved_at_pos IS NOT NULL)
         AS median_taps_to_resolution,
       -- 2. Longest tap streak, and how many runs went over 5 (the flag).
       (SELECT max(r.streak) FROM runs r WHERE r.week = w.week) AS longest_tap_streak,
       (SELECT count(*) FROM runs r WHERE r.week = w.week AND r.streak > 5)
         AS streaks_over_5,
       -- 3. Walkthrough completion: the share of episodes that resolved.
       (SELECT round(avg(CASE WHEN e.resolved_at_pos IS NOT NULL THEN 1.0 ELSE 0.0 END), 3)
          FROM episodes e WHERE e.week = w.week) AS walkthrough_completion,
       -- 4. Dead-end rate: the share of episodes abandoned unresolved.
       (SELECT round(avg(CASE WHEN e.resolved_at_pos IS NULL AND e.ends_conversation
                              THEN 1.0 ELSE 0.0 END), 3)
          FROM episodes e WHERE e.week = w.week) AS dead_end_rate,
       (SELECT count(*) FROM episodes e WHERE e.week = w.week) AS episodes
FROM (SELECT DISTINCT week FROM episodes UNION SELECT DISTINCT week FROM runs) w
ORDER BY w.week DESC;
