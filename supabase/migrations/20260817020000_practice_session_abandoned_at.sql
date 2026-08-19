-- ---------------------------------------------------------------------------
-- An abandoned practice session is abandoned, not completed. (BUG-4)
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-02B_V4 §14 session lifecycle: created -> active -> completed |
--        abandoned; owner ruling "completion signal is a session fact", 2026-08-17]
-- @implemented 2026-08-17
--
-- plain English: the abandon endpoint stamped completed_at while setting
-- status='abandoned' (server/routes/practice-canonical.ts, POST
-- /sessions/:sessionId/abandon). completed_at is the completion signal. Writing it
-- on abandonment means any reader that inspects the column — a report, an export,
-- a future query written by someone who reasonably assumes the column means what
-- it is named — counts abandoned work as finished work.
--
-- review_sessions already got this right: it carries BOTH completed_at and
-- abandoned_at and writes the matching one (20260610020000_ws2_practice_review_runtime.sql;
-- server/routes/review-session-routes.ts:684). This migration brings
-- practice_sessions to the same shape rather than inventing a third convention.
--
-- THREE STATEMENTS, ONE FILE, NO PARTIAL CREDIT
--   (1) add the column
--   (2) repair the existing rows
--   (3) seal, so the defect cannot come back
--   Statement (3) fails on its own if (2) left anything behind, so repair and seal
--   cannot ship apart. This is the shape 20260816000000 used for the occurred_at
--   backfill and it is deliberate reuse.
--
-- WHERE THE BACKFILL VALUE COMES FROM
--   For a row the buggy path wrote, completed_at IS the moment of abandonment —
--   wrong column, right timestamp. So abandoned_at takes completed_at when present
--   and last_activity_at otherwise, and completed_at is then cleared. Nothing is
--   invented and nothing is lost.
--
--   One production row is deliberately in the second case: the surplus diagnostic
--   resolved by scripts/prod-verify/resolve-duplicate-diagnostic.sql, which
--   refuses to stamp completed_at precisely because doing so is this bug. Its
--   abandoned_at comes from last_activity_at — when the student actually stopped,
--   which is a better value than the wall-clock time any repair happens to run at.
--
-- DOWNSTREAM READERS — CHECKED, NOT ASSUMED
--   apps/api/src/routes/calendar.ts:1900 computes study minutes as
--   `completed_at ?? last_activity_at`. On an abandoned row the backfill sets
--   abandoned_at from completed_at and clears completed_at, so the expression falls
--   through to last_activity_at — the same instant. Minutes are unchanged.
--   Every other reference to practice_sessions.completed_at in the codebase is a
--   SELECT column list or a write; none uses it as a completion predicate
--   (verified 2026-08-17 across server/ and apps/).
--
-- expected outcome: abandoned_at exists; no row has status='abandoned' with a
-- non-NULL completed_at; every abandoned row has an abandoned_at; the constraint
-- rejects any future attempt to stamp completed_at on abandonment.
--
-- trade-offs: the CHECK requires abandoned_at on every abandoned row, so a writer
-- that sets status='abandoned' without it now fails loudly. That is the point —
-- there is exactly one such writer in the application and step 9 updates it, and
-- the sweep added in step 10 writes both.
--
-- rollback:
--   ALTER TABLE public.practice_sessions DROP CONSTRAINT IF EXISTS practice_sessions_abandoned_not_completed;
--   ALTER TABLE public.practice_sessions DROP COLUMN IF EXISTS abandoned_at;
--   (completed_at values cleared by statement (2) are NOT restorable — they are
--    preserved in abandoned_at, which the DROP COLUMN would discard. Take a copy
--    of (id, abandoned_at) first if a rollback is ever actually contemplated.)
-- ---------------------------------------------------------------------------

BEGIN;

-- (1) the column
ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;

COMMENT ON COLUMN public.practice_sessions.abandoned_at IS
  'When the session was abandoned. Mutually exclusive with completed_at — enforced by practice_sessions_abandoned_not_completed.';

-- (2) repair: move the misplaced timestamp, then clear the column it was in.
UPDATE public.practice_sessions
   SET abandoned_at = COALESCE(completed_at, last_activity_at),
       completed_at = NULL
 WHERE status = 'abandoned'
   AND (abandoned_at IS NULL OR completed_at IS NOT NULL);

-- (3) seal
ALTER TABLE public.practice_sessions
  ADD CONSTRAINT practice_sessions_abandoned_not_completed
  CHECK (
    status <> 'abandoned'
    OR (completed_at IS NULL AND abandoned_at IS NOT NULL)
  );

COMMIT;
