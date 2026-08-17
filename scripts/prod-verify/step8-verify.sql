-- ============================================================================
-- STEP 8 ACCEPTANCE — did the BACKFILL rebuild mastery?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console. See README.md for the rules
--   every file in this directory follows.
--
-- ============================================================================
-- WHY THIS FILE ASSERTS THAT TWO TABLES ARE **EMPTY**
-- ============================================================================
-- DO NOT "CORRECT" THESE TO non-zero. An earlier revision asserted
-- student_projection_refresh_state > 0 and reported STOP on a completely
-- successful backfill. That was wrong, and the reason is structural:
--
--   student_projection_refresh_state is the EVENT-TIME THROTTLE COUNTER. Its
--   only writer is bump_projection_refresh_counter, and that function has
--   exactly two callers:
--     * apply_mastery_event                     (genesis-schema.expected.sql:295)
--     * recompute_skill_mastery, but ONLY inside its
--       `IF p_chain_downstream THEN` block      (…:2355-2361)
--
--   backfill_recompute_student calls recompute_skill_mastery with
--   p_chain_downstream := FALSE — deliberately, because the backfill drives
--   domain → KPI → projection itself in strict lock order (Doc 05D §7.2). So on
--   the backfill path the counter is never bumped and the table stays EMPTY.
--   That is correct behaviour, not a failure.
--
--   mastery_event_audit_log is the same story. Its only writer is
--   apply_mastery_event (…:269). The backfill replays history through
--   recompute_skill_mastery instead of emitting events, so it writes no audit
--   rows. Zero is correct.
--
--   Projections still materialize because backfill_recompute_student step 4
--   calls compute_section_projection UNCONDITIONALLY. That is why a healthy
--   post-backfill state looks like: projections present, refresh counter empty.
--
-- The positive provenance signal is mastery_domain_refresh_audit_log stamped
-- triggered_by = 'backfill_recompute'. The backfill DOES call
-- refresh_domain_mastery, which writes there, so that count must be > 0.
--
-- ============================================================================
-- THE REAL ACCEPTANCE TEST
-- ============================================================================
-- Non-zero row counts are necessary but not sufficient: compute_section_projection
-- emits an explicit ALL-NULL projection row when the Q4 evidence gate fails
-- (§5.5 / INV-05C-14), so student_section_projections is non-empty even for a
-- student with almost no evidence.
--
-- The acceptance test is therefore a NON-NULL projected_score_mid for profile
-- 3f18cbe2 in BOTH sections. That profile clears Doc 05C's Q4 gate, which
-- requires every one of the canonical EIGHT (section, domain) pairs — across
-- both sections — to carry at least mastery_min_events() events. A non-NULL mid
-- is proof the entire chain ran: skill → domain → 4 KPI → projection.
--
-- The other profiles are expected to show NULL mids. They are below the gate.
-- That is the system working, and this file does not assert on them.
--
-- EXPECTED (production reference, 2026-08-17 — counts are NOT asserted exactly,
-- only as non-zero, so this file stays portable across environments)
--   skill_mastery_rows        45      > 0 asserted
--   domain_mastery_rows       18      > 0 asserted
--   projection_rows            8      > 0 asserted
--   backfill_stamped_rows    > 0      provenance
--   audit_rows                 0      MUST be 0 — see above
--   projection_refresh_rows    0      MUST be 0 — see above
--   q4_m_mid                 470      MUST be NOT NULL
--   q4_rw_mid                400      MUST be NOT NULL
--   verdict = 'OK — backfill rebuilt mastery end to end; 3f18cbe2 projects in both sections'
--
-- gap_detector_deployed reports whether migration 20260816020000 has been
-- applied. This file deliberately does NOT query mastery_derivation_gaps: a
-- missing view fails at PARSE time, which would make the whole file unrunnable
-- rather than reporting a missing detector. Gap counts live in the follow-up
-- file, which is only meaningful once the detector exists.
--
-- SCOPE — THIS FILE DESCRIBES A MOMENT, NOT A STEADY STATE
--   It is the acceptance check for a pure backfill, and it stops being applicable
--   the instant a live answer is submitted, because that writes the two event-time
--   tables this file asserts are empty. That STOP is expected and is not a
--   regression. Once the live path is exercised, live-event-verify.sql is the file
--   to run.
--
-- Per-student breakdown: run step8-verify-detail.sql.
-- ============================================================================

WITH census AS (
  SELECT
    (SELECT count(*) FROM public.student_skill_mastery)              AS skill_mastery_rows,
    (SELECT count(*) FROM public.student_domain_mastery)             AS domain_mastery_rows,
    (SELECT count(*) FROM public.student_section_projections)        AS projection_rows,
    (SELECT count(*) FROM public.student_projection_refresh_state)   AS projection_refresh_rows,
    (SELECT count(*) FROM public.mastery_event_audit_log)            AS audit_rows,
    (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
      WHERE triggered_by = 'backfill_recompute')                     AS backfill_stamped_rows,
    (SELECT count(*) FROM public.psi_occurred_at_backfill_log)       AS backfill_log_rows,
    -- the load-bearing pair, scoped to the profile that clears the Q4 gate
    (SELECT max(sp.projected_score_mid) FROM public.student_section_projections sp
       JOIN public.profiles p ON p.id = sp.student_id
      WHERE p.id::text LIKE '3f18cbe2%' AND sp.section = 'M')        AS q4_m_mid,
    (SELECT max(sp.projected_score_mid) FROM public.student_section_projections sp
       JOIN public.profiles p ON p.id = sp.student_id
      WHERE p.id::text LIKE '3f18cbe2%' AND sp.section = 'RW')       AS q4_rw_mid,
    (SELECT max(sp.mastery_term) FROM public.student_section_projections sp
       JOIN public.profiles p ON p.id = sp.student_id
      WHERE p.id::text LIKE '3f18cbe2%' AND sp.section = 'M')        AS q4_m_mastery_term,
    (SELECT max(sp.mastery_term) FROM public.student_section_projections sp
       JOIN public.profiles p ON p.id = sp.student_id
      WHERE p.id::text LIKE '3f18cbe2%' AND sp.section = 'RW')       AS q4_rw_mastery_term,
    -- presence probe, not a query against the view — see the header
    (to_regclass('public.mastery_derivation_gaps') IS NOT NULL)      AS gap_detector_deployed
)
SELECT
  c.skill_mastery_rows,
  c.domain_mastery_rows,
  c.projection_rows,
  c.backfill_stamped_rows,
  c.backfill_log_rows,
  c.audit_rows,
  0                                   AS audit_rows_expected,
  c.projection_refresh_rows,
  0                                   AS projection_refresh_rows_expected,
  c.q4_m_mid,
  c.q4_rw_mid,
  c.q4_m_mastery_term,
  c.q4_rw_mastery_term,
  c.gap_detector_deployed,
  CASE
    WHEN c.skill_mastery_rows = 0
      THEN 'STOP — no skill mastery; recompute_skill_mastery produced nothing'
    WHEN c.domain_mastery_rows = 0
      THEN 'STOP — no domain mastery; refresh_domain_mastery is still failing'
    WHEN c.projection_rows = 0
      THEN 'STOP — no projection rows at all; compute_section_projection never ran'
    WHEN c.backfill_stamped_rows = 0
      THEN 'STOP — no audit row stamped backfill_recompute; the rows present did not come from the backfill'
    -- THE REAL ACCEPTANCE TEST
    WHEN c.q4_m_mid IS NULL OR c.q4_rw_mid IS NULL
      THEN 'STOP — 3f18cbe2 has a NULL projected_score_mid in ' ||
           CASE WHEN c.q4_m_mid IS NULL AND c.q4_rw_mid IS NULL THEN 'BOTH sections'
                WHEN c.q4_m_mid IS NULL THEN 'section M'
                ELSE 'section RW' END ||
           '; the Q4 evidence gate did not pass, so the chain did not complete'
    -- Event-time tables. Empty is CORRECT after a pure backfill; read the header
    -- before changing these.
    WHEN c.audit_rows > 0
      THEN 'STOP — mastery_event_audit_log is non-empty (' || c.audit_rows::text ||
           '). Only apply_mastery_event writes it, and the backfill does not call it. If a live answer has been submitted since the backfill this is EXPECTED — run live-event-verify.sql instead, which is the file for that state. Otherwise something else wrote.'
    WHEN c.projection_refresh_rows > 0
      THEN 'STOP — student_projection_refresh_state is non-empty (' || c.projection_refresh_rows::text ||
           '). It is the event-time throttle counter and the backfill never bumps it. Same reading as above: if a live answer has landed, run live-event-verify.sql instead.'
    ELSE 'OK — backfill rebuilt mastery end to end; 3f18cbe2 projects in both sections'
  END                                 AS verdict
FROM census c;
