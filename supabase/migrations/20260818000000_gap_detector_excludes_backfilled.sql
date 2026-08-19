-- ---------------------------------------------------------------------------
-- The gap detector must not report the backfill as a gap.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05A_V1.0 §4.8 mastery_event_audit_log is the attribution record;
--        Doc-05D §7.2 backfill_recompute_student; Doc-01A_V1.0 §18 alert routing]
-- @implemented 2026-08-18
--
-- plain English: on its first day in production the detector reported 84 gaps out
-- of 91 answered items. All 84 are items whose mastery was correctly rebuilt by
-- the Step 8 backfill. `backfill_recompute_student` replays history and writes NO
-- per-event row to mastery_event_audit_log, so "rebuilt by backfill" and "never
-- derived at all" look identical to a view that only asks whether an audit row
-- exists.
--
-- A detector that is 100% noise on arrival gets muted, and a muted detector is
-- the precise failure this whole workstream exists to prevent. 84 false positives
-- is not a tuning problem; it is the alert being wrong.
--
-- ============================================================================
-- WHAT CHANGED, AND WHY THIS SHAPE
-- ============================================================================
-- An item is excluded when a backfill covered ITS (student, section, domain) AND
-- the item occurred at or before that backfill ran. Both halves are load-bearing
-- and neither is sufficient:
--
--   scope without time — "this student was backfilled, so skip their items"
--     A new answer in a backfilled domain that never emits is invisible forever.
--     That is the exact event the detector exists to catch, made permanently
--     undetectable for every student who was ever repaired. Repair would blind
--     the alarm.
--
--   time without scope — "skip everything answered before the watermark"
--     This is the alternative considered (owner's option b) and it is rejected.
--     The Step 8 recompute named FOUR profiles. Any answered item belonging to a
--     student outside that set is also pre-watermark and also has no audit row,
--     and a bare watermark hides it forever — a genuine, permanent gap filed
--     under "historical". It is the cheaper predicate and it buys silence rather
--     than accuracy.
--
-- Scope AND time together exclude exactly the set the backfill actually repaired,
-- and nothing else. An item is only forgiven by a backfill that could have
-- covered it.
--
-- ============================================================================
-- THE COLUMN LIST IS UNCHANGED
-- ============================================================================
-- CREATE OR REPLACE VIEW requires it, and mastery_derivation_gap_summary reads
-- this view, so it inherits the fix with no change of its own — the reason the
-- summary is defined over the view rather than restating the anti-join.
--
-- Both source branches get the same exclusion. canonical_mastery_events derives
-- from practice_session_items AND review_error_attempts, and
-- backfill_recompute_student replays both, so exempting only the practice branch
-- would leave review attempts reporting as gaps for the same wrong reason.
--
-- expected outcome: against production's 2026-08-17 shape — 91 answered items, 7
-- with live audit rows, 84 rebuilt by backfill — the view reports 0. A genuinely
-- un-emitted answer still reports as exactly 1.
--
-- trade-offs: one extra anti-join against mastery_domain_refresh_audit_log per
-- row. At current volumes that is free. If it ever is not, the fix is an index on
-- (triggered_by, student_id, section, domain), not a looser predicate.
--
-- rollback:
--   Re-apply 20260816020000's definition of public.mastery_derivation_gaps.
--   (CREATE OR REPLACE VIEW — no data is at risk either way.)
-- ---------------------------------------------------------------------------

BEGIN;

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
  -- Rebuilt by a backfill that covered this student, section and domain, at or
  -- before this item was answered.
  AND NOT EXISTS (
    SELECT 1 FROM public.mastery_domain_refresh_audit_log ral
     WHERE ral.triggered_by = 'backfill_recompute'
       AND ral.student_id   = pi.user_id
       AND ral.section      = pi.question_section
       AND ral.domain       = pi.question_domain
       AND pi.occurred_at  <= ral.applied_at
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
)
AND NOT EXISTS (
  SELECT 1 FROM public.mastery_domain_refresh_audit_log ral
   WHERE ral.triggered_by = 'backfill_recompute'
     AND ral.student_id   = ra.student_id
     AND ral.section      = ra.section
     AND ral.domain       = ra.domain
     AND ra.occurred_at  <= ral.applied_at
);

COMMENT ON VIEW public.mastery_derivation_gaps IS
  'Events derivable by canonical_mastery_events that have no attributable mastery_event_audit_log row AND were not rebuilt by a backfill covering their (student, section, domain) at or before they occurred. Non-empty = mastery emission is failing. Detection only — no writer.';

COMMIT;
