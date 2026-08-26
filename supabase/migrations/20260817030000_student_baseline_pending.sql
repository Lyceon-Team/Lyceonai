-- ---------------------------------------------------------------------------
-- Who is stuck in baseline_pending, and for how long.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-01A_V1.0 §18 alert routing; Doc-05C_V1.0 §7.4; owner ruling Q2
--        "baseline_pending ... and an operator alert on staleness", 2026-08-17]
-- @implemented 2026-08-17
--
-- plain English: baseline_pending is an honest thing to show a student for a few
-- minutes and a broken thing to show them for a week. The state itself is not the
-- alert — its AGE is. This view is the fact; the threshold and the alert live in
-- GET /api/internal/baseline-pending-sweep (server/routes/internal-cron-routes.ts),
-- because a threshold is policy and policy that lives in a view cannot be changed
-- without a migration.
--
-- WHY AGE AND NOT COUNT. A non-zero count is the NORMAL state: every student who
-- finishes a diagnostic is briefly baseline_pending between the last answer and
-- the projection refresh. An alert on count > 0 would fire on every healthy
-- diagnostic completion and be muted within a week — the classic way a real signal
-- gets trained out of an operator's attention. Age separates the two cases with no
-- ambiguity: minutes is the pipeline working, days is the pipeline not working.
--
-- WHAT MAKES THIS DIFFERENT FROM mastery_derivation_gaps (20260816020000)
--   That view answers "was an answered item ever attributed to mastery" — a
--   question about EVENTS. This one answers "did a student who finished the
--   diagnostic ever get a baseline" — a question about a STUDENT-VISIBLE SURFACE.
--   The outage that motivated both produced a non-empty result in each, but they
--   are not redundant: a baseline can be missing with zero derivation gaps (the
--   evidence gate legitimately not yet cleared), and gaps can exist for a student
--   who has no diagnostic at all. Whether the two alerts should share one cron
--   route once the gap-detection route is built is an open owner question, raised
--   with this step rather than resolved here.
--
-- NO LEDGER. mastery_derivation_gap_ledger exists because its view runs an
-- anti-join over two event tables and the alert should not pay for that per call.
-- This view is an aggregate over two small grouped reads. A time series here would
-- be a table nobody queries.
--
-- expected outcome: one row per student currently in baseline_pending, with the
-- age of that state in seconds. Empty is the healthy steady state.
--
-- rollback:
--   DROP VIEW IF EXISTS public.student_baseline_pending;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW public.student_baseline_pending AS
SELECT
  s.student_id,
  s.diagnostic_finished_at,
  s.baseline_scored_sections,
  -- diagnostic_finished_at is COALESCE(completed_at, last_activity_at) and
  -- last_activity_at is NOT NULL on practice_sessions, so this is never NULL for a
  -- row that reaches this view.
  EXTRACT(EPOCH FROM (now() - s.diagnostic_finished_at))::bigint AS pending_seconds
FROM public.student_diagnostic_states s
WHERE s.state = 'baseline_pending';

COMMENT ON VIEW public.student_baseline_pending IS
  'Students who completed the diagnostic but have no usable diagnostic_baseline snapshot, with the age of that state. Age, not count, is the alert condition — a brief pending state is normal after every completion.';

REVOKE ALL ON public.student_baseline_pending FROM PUBLIC;
GRANT SELECT ON public.student_baseline_pending TO service_role;

COMMIT;
