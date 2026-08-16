-- ---------------------------------------------------------------------------
-- Mastery derivation gap detection (audit M-05 / owner Amendment 2).
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05A_V1.0 §4.8 mastery_event_audit_log is the attribution record;
--        Doc-01A_V1.0 §18 alert routing, §19.1 observability deviation box]
-- @implemented 2026-08-16
--
-- plain English: log volume is a proxy; the invariant is the thing. The property
-- that matters is that EVERY event which canonical_mastery_events can derive has
-- exactly one attributable row in mastery_event_audit_log. That is a set
-- difference — hosting-agnostic, backend-agnostic, and the number that would have
-- made this outage visible on day one: 84 answered items, 0 audit rows.
--
-- A log-based alert could not have done this. The failures were logged, but the
-- structured logger was miscalled (the data object landed in `event`), so no log
-- filter could match them. The set difference does not care how anything was
-- logged.
--
-- expected outcome: mastery_derivation_gaps lists every underived event;
-- mastery_derivation_gap_summary aggregates it per student and in total;
-- record_mastery_derivation_gap() persists one snapshot row into
-- mastery_derivation_gap_ledger. A non-zero total_gap_count is the alert
-- condition.
--
-- SCOPE — DETECTION ONLY. This migration adds no writer to any mastery table.
-- The obvious next move is a sweeper that re-drives apply_mastery_event for gap
-- rows, and it would be safe by construction: mastery_event_audit_log_dedup_uq on
-- (event_source_kind, event_id) plus the §4.3 Step 2 early-return make it
-- idempotent, and mastery is a pure function of the durable answer row so
-- re-derivation is exact rather than approximate. It is deliberately NOT built
-- here: it is a NEW WRITER, and Doc 05D scopes backfill_recompute_student to
-- never-computed students only. Repair goes through the spec cycle.
--
-- NO SCHEDULER IS BOUND HERE. genesis excludes pg_cron as platform-managed
-- ("Only PLATFORM-managed extensions (pg_cron, pg_net, …) are excluded",
-- 00000000000000_genesis.sql:80), so a cron.schedule() call in this file would
-- fail every fresh apply — genesis-fresh-apply, every throwaway rehearsal DB, and
-- the transport-test substrate — which is the same class of defect as embedding a
-- production row count in a migration. The repo's canonical scheduled-job pattern
-- is Vercel cron -> GET /api/internal/* (vercel.json + server/routes/internal-cron-routes.ts).
-- Which scheduler drives record_mastery_derivation_gap() is an open owner
-- question; the function is callable by hand, by cron, or by a route in the
-- meantime, and the views work with no scheduler at all.
--
-- trade-offs: the views scan practice_session_items and review_error_attempts
-- with an anti-join per call. At current volumes (154 rows) that is free. The
-- ledger exists so the alert reads one small table instead of re-running the
-- anti-join.
--
-- rollback:
--   DROP FUNCTION IF EXISTS public.record_mastery_derivation_gap();
--   DROP VIEW IF EXISTS public.mastery_derivation_gap_summary;
--   DROP VIEW IF EXISTS public.mastery_derivation_gaps;
--   DROP INDEX IF EXISTS public.idx_mastery_gap_ledger_observed_at;
--   DROP TABLE IF EXISTS public.mastery_derivation_gap_ledger;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-event gap view.
--
-- Mirrors canonical_mastery_events' TWO source branches exactly — practice_session_items
-- (practice_attempt / diagnostic_attempt via practice_session_mode_to_event_kind)
-- and review_error_attempts (review_error_attempt). A gap detector that covered
-- only one branch would report "no gaps" while half the sources silently failed.
--
-- full_length_answer is deliberately absent: canonical_mastery_events has no
-- branch that can produce it, so a full-length event is not derivable at all.
-- That is a separate defect (audit M-03) pending the 04B/05A seam ruling, and
-- surfacing it here as a "gap" would imply this view knows how to close it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.mastery_derivation_gaps AS
SELECT
  pi.user_id                                             AS student_id,
  public.practice_session_mode_to_event_kind(ps.mode)    AS event_source_kind,
  pi.id                                                  AS event_id,
  pi.question_section                                    AS section,
  pi.question_domain                                     AS domain,
  pi.question_skill                                      AS skill,
  pi.question_id                                         AS question_id,
  pi.occurred_at                                         AS occurred_at
FROM public.practice_session_items pi
JOIN public.practice_sessions ps ON ps.id = pi.session_id
WHERE pi.status = 'answered'
  AND pi.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.mastery_event_audit_log al
     WHERE al.event_id = pi.id
       AND al.event_source_kind = public.practice_session_mode_to_event_kind(ps.mode)
  )

UNION ALL

SELECT
  ra.student_id,
  'review_error_attempt'::text,
  ra.id,
  ra.section,
  ra.domain,
  ra.skill,
  ra.question_id,
  ra.occurred_at
FROM public.review_error_attempts ra
WHERE NOT EXISTS (
  SELECT 1 FROM public.mastery_event_audit_log al
   WHERE al.event_id = ra.id
     AND al.event_source_kind = 'review_error_attempt'
);

COMMENT ON VIEW public.mastery_derivation_gaps IS
  'Events derivable by canonical_mastery_events that have no attributable mastery_event_audit_log row. Non-empty = mastery emission is failing. Detection only — no writer.';

-- ---------------------------------------------------------------------------
-- 2. Per-student and total summary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.mastery_derivation_gap_summary AS
SELECT
  g.student_id,
  count(*)::integer AS gap_count,
  min(g.occurred_at) AS oldest_gap_at,
  max(g.occurred_at) AS newest_gap_at
FROM public.mastery_derivation_gaps g
GROUP BY g.student_id;

COMMENT ON VIEW public.mastery_derivation_gap_summary IS
  'Per-student rollup of mastery_derivation_gaps. Total across the platform = sum(gap_count).';

-- ---------------------------------------------------------------------------
-- 3. Ledger. One row per observation, append-only in practice.
-- ---------------------------------------------------------------------------
-- observation_id is a surrogate key on purpose. observed_at cannot be the PK:
-- now() is the TRANSACTION timestamp, so two observations inside one transaction
-- carry an identical value and collide. clock_timestamp() gives each observation a
-- distinct wall-clock reading while the surrogate key keeps uniqueness independent
-- of timing altogether.
CREATE TABLE IF NOT EXISTS public.mastery_derivation_gap_ledger (
  observation_id     uuid        NOT NULL DEFAULT gen_random_uuid(),
  observed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  total_gap_count    integer     NOT NULL,
  students_affected  integer     NOT NULL,
  oldest_gap_at      timestamptz,
  detector_version   text        NOT NULL DEFAULT 'v1.0',
  CONSTRAINT mastery_derivation_gap_ledger_pkey PRIMARY KEY (observation_id),
  CONSTRAINT mastery_derivation_gap_ledger_total_nonneg CHECK (total_gap_count >= 0),
  CONSTRAINT mastery_derivation_gap_ledger_students_nonneg CHECK (students_affected >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mastery_gap_ledger_observed_at
  ON public.mastery_derivation_gap_ledger (observed_at DESC);

-- RLS with NO policy — deny-all to anon/authenticated; service_role bypasses.
-- Same posture as mastery_event_audit_log (20260610010000_ws3_mastery_formula.sql:294):
-- an operator-facing table that names students gets no student-readable surface.
-- genesis enforces RLS on EVERY public table (genesis-fresh-apply gate A.4), so a new
-- table without this line fails that gate. Rollback is the DROP TABLE in the header
-- block, which removes the policy-less RLS state with it. LYCEON-MIGRATION-REVIEWED
ALTER TABLE public.mastery_derivation_gap_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mastery_derivation_gap_ledger IS
  'Time series of mastery derivation gap observations. total_gap_count > 0 on the latest row is the alert condition.';

-- ---------------------------------------------------------------------------
-- 4. Recorder. SECURITY DEFINER so a scheduler can call it without holding
--    direct rights on the mastery tables. Reads mastery tables; writes only its
--    own ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_mastery_derivation_gap()
RETURNS public.mastery_derivation_gap_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total    integer;
  v_students integer;
  v_oldest   timestamptz;
  v_row      public.mastery_derivation_gap_ledger;
BEGIN
  SELECT
    COALESCE(sum(s.gap_count), 0)::integer,
    count(*)::integer,
    min(s.oldest_gap_at)
  INTO v_total, v_students, v_oldest
  FROM public.mastery_derivation_gap_summary s;

  INSERT INTO public.mastery_derivation_gap_ledger
    (observed_at, total_gap_count, students_affected, oldest_gap_at, detector_version)
  VALUES (clock_timestamp(), v_total, v_students, v_oldest, 'v1.0')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.record_mastery_derivation_gap() IS
  'Snapshots mastery_derivation_gap_summary into mastery_derivation_gap_ledger. Detection only — writes no mastery table.';

-- ---------------------------------------------------------------------------
-- 5. Grants — service_role only, matching every other mastery object.
--    No authenticated/anon grant: gap data is operator-facing and names students.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.mastery_derivation_gaps FROM PUBLIC;
REVOKE ALL ON public.mastery_derivation_gap_summary FROM PUBLIC;
REVOKE ALL ON public.mastery_derivation_gap_ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_mastery_derivation_gap() FROM PUBLIC;

GRANT SELECT ON public.mastery_derivation_gaps TO service_role;
GRANT SELECT ON public.mastery_derivation_gap_summary TO service_role;
GRANT SELECT, INSERT ON public.mastery_derivation_gap_ledger TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mastery_derivation_gap() TO service_role;

COMMIT;
