-- ============================================================================
-- DIAGNOSTIC PROJECTION — PREFLIGHT (read-only). Run BEFORE applying
-- supabase/migrations/20261106010000_diagnostic_projection.sql.
-- ============================================================================
-- @spec [SCL-236; owner ruling 2026-10-17 constraint 7 ("add the partial index to prevent two
--        diagnostics in progress at once")] | @implemented [2026-10-17]
--
-- That migration creates practice_sessions_one_inflight_diagnostic_uq: at most ONE
-- created/active diagnostic per student. If production already holds a student with two, the
-- CREATE UNIQUE INDEX fails and the whole migration rolls back. This reads whether it will.
--
-- HOW TO RUN: paste the whole file into the SQL console. One statement; it writes nothing.
--   verdict 'OK ...'   -> the migration can apply.
--   verdict 'STOP ...' -> the listed students each hold more than one in-flight diagnostic.
--                         Do not apply; resolve them first (terminate all but the newest) and
--                         re-run this file.
-- ============================================================================
SELECT
  CASE WHEN count(*) = 0
       THEN 'OK: no student holds two in-flight diagnostics; 20261106010000 can apply'
       ELSE 'STOP: ' || count(*) || ' student(s) hold more than one in-flight diagnostic'
  END                                                    AS verdict,
  COALESCE(string_agg(d.user_id::text || ' (' || d.n || ')', ', '), '') AS students
FROM (
  SELECT ps.user_id, count(*) AS n
  FROM   public.practice_sessions ps
  WHERE  ps.mode = 'diagnostic'
    AND  ps.status IN ('created', 'active')
    AND  ps.user_id IS NOT NULL
  GROUP BY ps.user_id
  HAVING count(*) > 1
) d;
