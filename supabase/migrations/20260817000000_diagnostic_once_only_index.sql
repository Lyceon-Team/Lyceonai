-- ---------------------------------------------------------------------------
-- A student holds at most ONE completed diagnostic — enforced in the database.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05A_V1.0 §11 diagnostic seeding contract; Doc-02B_V4 §14 session
--        lifecycle; owner rulings Q1 + Q8, 2026-08-17]
-- @implemented 2026-08-17
--
-- plain English: the diagnostic is taken once. Step 4 closed the application
-- route (server/routes/diagnostic-routes.ts refuses when a completed diagnostic
-- exists) and step 3 closed the bypass (the practice route no longer accepts
-- mode='diagnostic'). This index is the layer underneath both: it makes the
-- second completed diagnostic unrepresentable rather than merely un-createable.
--
-- WHY BOTH. The application guard is a read-then-write with a gap between the
-- read and the insert; two requests racing through it both see zero completed
-- diagnostics and both proceed. The index closes that gap. Conversely the index
-- alone would surface as an opaque 23505 on the student's fortieth answer, which
-- is why the friendly 409 in the route is not redundant with it.
--
-- WHY 'completed' AND NOT 'any diagnostic' (owner ruling Q1)
--   An abandoned diagnostic does NOT spend the student's one diagnostic. A
--   student who closed their laptop at question 3 must be able to take it again.
--   Only a COMPLETED diagnostic is terminal. 'created' and 'active' are excluded
--   too: the route's anti-concurrency guard owns those, and putting them in the
--   index would make a resumable in-flight session collide with itself.
--
-- ORDERING IS LOAD-BEARING
--   BEFORE this is applied, scripts/prod-verify/resolve-duplicate-diagnostic.sql
--   must have been RUN against production. Production holds one student with a
--   completed diagnostic and a second in-flight one; that second session would
--   complete into a collision. The preamble below refuses to apply if any student
--   already holds two completed diagnostics, but it cannot see the in-flight case
--   — scripts/prod-verify/3.1-pre-apply.sql is the file that checks that, and it
--   must pass first. See docs/runbooks/migration-deploy.md.
--
-- WHY THE PREAMBLE IS A PREDICATE AND NOT A COUNT
--   "no student holds two completed diagnostics" is true in every environment —
--   fresh CI, rehearsal DB, production. A hardcoded row count would not be, and
--   an environment-specific fact does not belong in an artifact that runs
--   everywhere. The index build would fail on its own anyway; the preamble exists
--   so the failure names the students rather than printing a duplicate key.
--
-- expected outcome: practice_sessions_one_completed_diagnostic_uq exists; a
-- second completed diagnostic for the same user raises 23505; abandoned and
-- in-flight diagnostics are unaffected.
--
-- trade-offs: a partial unique index cannot be referenced by ON CONFLICT in
-- PostgreSQL, so callers that need idempotency must catch 23505 — the same
-- pattern captureDiagnosticBaseline already uses for the baseline snapshot index.
--
-- rollback:
--   DROP INDEX IF EXISTS public.practice_sessions_one_completed_diagnostic_uq;
-- ---------------------------------------------------------------------------

BEGIN;

DO $preflight$
DECLARE
  v_offenders integer;
  v_sample    text;
BEGIN
  SELECT count(*), coalesce(string_agg(t.user_id::text, ', '), '(none)')
    INTO v_offenders, v_sample
    FROM (
      SELECT user_id
        FROM public.practice_sessions
       WHERE mode = 'diagnostic'
         AND status = 'completed'
         AND user_id IS NOT NULL
       GROUP BY user_id
      HAVING count(*) > 1
    ) t;

  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'DIAGNOSTIC_ONCE_ONLY: % student(s) already hold more than one COMPLETED diagnostic (%). The index cannot be built over that data. Resolve the surplus sessions first — see scripts/prod-verify/resolve-duplicate-diagnostic.sql — then re-apply.',
      v_offenders, v_sample;
  END IF;
END $preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_one_completed_diagnostic_uq
  ON public.practice_sessions (user_id)
  WHERE (mode = 'diagnostic' AND status = 'completed');

COMMENT ON INDEX public.practice_sessions_one_completed_diagnostic_uq IS
  'Owner ruling Q1 2026-08-17: a diagnostic is taken once. Uniqueness is on COMPLETED only — an abandoned diagnostic does not spend the student''s one diagnostic, and in-flight sessions are owned by the route''s anti-concurrency guard.';

COMMIT;
