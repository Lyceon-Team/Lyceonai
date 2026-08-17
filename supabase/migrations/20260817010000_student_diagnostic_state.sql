-- ---------------------------------------------------------------------------
-- student_diagnostic_state — ONE derivation of "where is this student in the
-- diagnostic lifecycle", consumed by every surface.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05C_V1.0 §7.4 tiered score estimate; Doc-05A_V1.0 §11 diagnostic
--        seeding; owner rulings Q1 + Q2, 2026-08-17]
-- @implemented 2026-08-17
--
-- plain English: today every surface asks a DIFFERENT question and calls the
-- answer "has the student taken the diagnostic". /api/progress/projection asks
-- "does a diagnostic_baseline snapshot exist"; the diagnostic start route asks
-- "is there a completed session". Those two disagree for exactly the students
-- this workstream exists to fix — a student who COMPLETED the diagnostic while
-- the mastery pipeline was down has a completed session and no baseline, so the
-- start route says "already taken" and the dashboard says "take a diagnostic".
-- The student is told both things at once.
--
-- The fix is not to patch the dashboard. It is to have one definition and make
-- both read it.
--
-- WHY THIS IS SQL AND NOT A TypeScript HELPER
--   Three consumers need the same predicate: the projection API, the operator
--   staleness alert (step 8), and any prod-verify file that has to answer "who is
--   stuck". Two of those cannot call TypeScript. A TS helper would have forced the
--   SQL consumers to restate the predicate, and a restated predicate is a
--   divergent predicate — which is the defect this migration removes, reintroduced
--   one layer down.
--
-- THE FOUR STATES
--   not_taken        no diagnostic session that still counts. Includes the student
--                    who abandoned one: per ruling Q1 an abandoned diagnostic does
--                    NOT spend the student's one diagnostic, so they are offered it
--                    again and this is honest.
--   in_progress      a 'created' or 'active' diagnostic exists. Resumable.
--   baseline_pending COMPLETED, but no usable diagnostic_baseline snapshot. The
--                    student did the work; the numbers are not ready. Ruling Q2
--                    gives this its own copy ("Your baseline is being calculated.")
--                    instead of the "take a diagnostic" prompt they see today.
--   baseline_ready   COMPLETED and both sections have a non-NULL baseline mid.
--
-- PRECEDENCE IS NOT ARBITRARY — it matches resolveDiagnosticStartDecision
-- (packages/shared/src/diagnostic-eligibility.ts), which checks 'completed' FIRST
-- and treats it as terminal. Production currently holds a student with both a
-- completed and an in-flight diagnostic, so the two orderings give different
-- answers on real data; they must agree, and scripts/ci/diagnostic-state-gate.sh
-- proves they do rather than trusting this comment.
--
-- "BOTH SECTIONS, NON-NULL MID" is the same rule readDiagnosticBaseline enforces
-- (server/services/canonical-runtime-views.ts:420) — and it is a rule, not a row
-- count: compute_section_projection writes an explicit ALL-NULL row when the Q4
-- evidence gate fails, so counting snapshot rows would call an all-NULL baseline
-- "ready". count(DISTINCT section) FILTER (projected_score_mid IS NOT NULL) is the
-- predicate that survives that.
--
-- expected outcome: student_diagnostic_states has one row per student with any
-- diagnostic session; student_diagnostic_state(uuid) returns one of the four
-- states for ANY uuid, including a student who has never touched the product.
--
-- trade-offs: the view aggregates practice_sessions and the baseline snapshots per
-- call. Both are small and indexed on the grouped column; the projection endpoint
-- already issues two reads, and this replaces one of them.
--
-- rollback:
--   DROP FUNCTION IF EXISTS public.student_diagnostic_state(uuid);
--   DROP VIEW IF EXISTS public.student_diagnostic_states;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW public.student_diagnostic_states AS
WITH diag AS (
  SELECT
    ps.user_id                                                        AS student_id,
    count(*) FILTER (WHERE ps.status = 'completed')                   AS completed_count,
    count(*) FILTER (WHERE ps.status IN ('created', 'active'))        AS in_flight_count,
    max(ps.completed_at) FILTER (WHERE ps.status = 'completed')       AS diagnostic_completed_at,
    max(ps.last_activity_at) FILTER (WHERE ps.status = 'completed')   AS diagnostic_last_activity_at
  FROM public.practice_sessions ps
  WHERE ps.mode = 'diagnostic'
    AND ps.user_id IS NOT NULL
  GROUP BY ps.user_id
),
baseline AS (
  SELECT
    sn.student_id,
    count(DISTINCT sn.section) FILTER (WHERE sn.projected_score_mid IS NOT NULL) AS scored_sections,
    min(sn.snapshot_at)                                               AS baseline_captured_at
  FROM public.student_section_projection_snapshots sn
  WHERE sn.snapshot_kind = 'diagnostic_baseline'
  GROUP BY sn.student_id
)
SELECT
  d.student_id,
  CASE
    WHEN d.completed_count > 0 AND COALESCE(b.scored_sections, 0) >= 2 THEN 'baseline_ready'
    WHEN d.completed_count > 0                                        THEN 'baseline_pending'
    WHEN d.in_flight_count > 0                                        THEN 'in_progress'
    ELSE                                                                   'not_taken'
  END                                                                 AS state,
  d.completed_count::integer                                          AS completed_diagnostic_count,
  d.in_flight_count::integer                                          AS in_flight_diagnostic_count,
  d.diagnostic_completed_at,
  -- The honest "when did this student finish" for a session whose completed_at was
  -- never stamped: last_activity_at is written on every lifecycle update.
  COALESCE(d.diagnostic_completed_at, d.diagnostic_last_activity_at)  AS diagnostic_finished_at,
  b.baseline_captured_at,
  COALESCE(b.scored_sections, 0)::integer                             AS baseline_scored_sections
FROM diag d
LEFT JOIN baseline b ON b.student_id = d.student_id;

COMMENT ON VIEW public.student_diagnostic_states IS
  'One row per student with any diagnostic session. state is the single canonical answer to "where is this student in the diagnostic lifecycle": not_taken | in_progress | baseline_pending | baseline_ready. Precedence matches resolveDiagnosticStartDecision — completed is checked first and is terminal.';

-- ---------------------------------------------------------------------------
-- Scalar accessor. Returns a state for EVERY uuid, including students with no
-- diagnostic session at all — the view has no row for them, and a caller that
-- had to distinguish "no row" from "not_taken" would be re-deriving the rule.
--
-- SECURITY DEFINER + a pinned search_path, matching record_mastery_derivation_gap:
-- the caller needs the answer, not rights on practice_sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_diagnostic_state(p_student_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT s.state FROM public.student_diagnostic_states s
      WHERE s.student_id = p_student_id),
    'not_taken'
  );
$$;

COMMENT ON FUNCTION public.student_diagnostic_state(uuid) IS
  'Diagnostic lifecycle state for one student. Returns not_taken for a student with no diagnostic session, so callers never have to interpret an absent row.';

-- ---------------------------------------------------------------------------
-- Grants — service_role only. The view names students and is read on behalf of a
-- student by the API, never by the student's own JWT. Same posture as every other
-- operator-facing derivation.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.student_diagnostic_states FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_diagnostic_state(uuid) FROM PUBLIC;

GRANT SELECT ON public.student_diagnostic_states TO service_role;
GRANT EXECUTE ON FUNCTION public.student_diagnostic_state(uuid) TO service_role;

COMMIT;
