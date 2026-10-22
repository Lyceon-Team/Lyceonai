-- ===========================================================================
-- review_runtime_config.session_size applies to STUDENT-INITIATED review starts only.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner ruling (Karl, 2026-10-22), correcting #1277's ruling 1 of 2026-10-21:
--        "review_runtime_config.session_size caps ONLY student-initiated review starts (Review
--        page, Home). Calendar-launched review sessions take the block's requested size,
--        uncapped by session_size."; SCL-242 withdrawn the same day (calendar review blocks keep
--        the planner's time-based sizing)]
-- @implemented [2026-10-22]
--
-- plain English: the row seeded by 20261109000001_review_open_session_admission.sql said every
-- start, the calendar's included, was capped by it. The server now applies the cap only to a
-- start made through POST /api/review/sessions (`startOrReplayReviewSession`, origin
-- "student"); a calendar launch (origin "calendar", sized from the server's own block record)
-- takes its block's size. This migration changes the row's DESCRIPTION only, so an operator
-- reading the table sees the rule the code applies. Value and bounds (10, 5..20) unchanged; no
-- function body changes, so no mutation plant moves.
--
-- IDEMPOTENT: a plain UPDATE of one text column. The applied migration that seeded the row is not
-- edited.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
--
-- rollback: UPDATE public.review_runtime_config SET description = <the 20261109000001 text>
--           WHERE key = 'session_size';
-- ===========================================================================

BEGIN;

UPDATE public.review_runtime_config
   SET description = 'The most questions one STUDENT-INITIATED review session takes (Review page, Home: POST /api/review/sessions): min(requested or this, this). Calendar-launched sessions take their block''s requested size and are NOT capped by this key (owner ruling, Karl, 2026-10-22, correcting #1277''s ruling 1 of 2026-10-21). Default 10; lower to 5 here, no deploy. A value outside min..max is refused by the server (a 500), never clamped.',
       updated_at  = now()
 WHERE key = 'session_size';

COMMIT;
