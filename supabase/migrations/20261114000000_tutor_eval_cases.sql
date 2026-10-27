-- ===========================================================================
-- G0-2 teaching-quality evaluation set: the server-only case and run tables.
--
-- @spec [Doc-03D_V1.2 §5.1 (golden set: a fixed corpus of conversation prefixes, replaced with
--       real conversations once production traffic exists), §5.3 (judge calibration: agreement
--       with human raters measured and reported), §3.2.1 (baseline and variance band);
--       docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §3; Karl's ruling 2026-10-27: no
--       student transcript text in the repo, de-identified or not; student cases live in a
--       server-only table, RLS on, no client policies, service role only]
--       | @implemented [2026-10-27]
--
-- plain English:
--  1. `tutor_eval_cases`: one row per evaluation case. For a student case it holds the request
--     the replay sends (the conversation prefix up to and including the turn under test, built by
--     the BFF's own envelope builder), LISA's production reply to that turn, and where it came
--     from. The repository refers to a case only by `case_id`; its text never leaves this table.
--     `scan_correct_answer` is the display letter the BFF keeps locally for its output scan (it
--     is never on the wire before submit); the harness's leak scanner needs it.
--  2. `tutor_eval_runs`: one row per replay of a case: the full run record (replayed reply,
--     checks, judge response, model, thinking budget, prompt version, context hash, cost), the
--     code's verdict, and Karl's own grade for calibration. A replay or a judge quote can echo
--     the student, so runs are as private as cases.
--
-- Deletion: a case cascades from the student's profile (the account-deletion cascade deletes the
--   profiles row in both of its modes); runs cascade from their case. `source_conversation_id` has
--   no foreign key on purpose: the eval copy is not swept with the live conversation.
-- Retention: NOT YET RULED. Doc 03 §14.2 has no row for these tables, and INV-03-19 says "no
--   indefinite retention of student conversation data". Until the §14.2 row is ruled (SCL
--   pending), DO NOT APPLY THIS MIGRATION TO PRODUCTION.
-- Grants: service_role only; RLS on with no policies, so no client can read or write a row.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP TABLE IF EXISTS public.tutor_eval_runs;
--   DROP TABLE IF EXISTS public.tutor_eval_cases;
-- ===========================================================================

BEGIN;

CREATE TABLE public.tutor_eval_cases (
  case_id                 text        PRIMARY KEY CHECK (case_id ~ '^[A-Z0-9][A-Z0-9-]*$'),
  set_version             text        NOT NULL CHECK (set_version <> ''),
  -- The student whose conversation this is; deleting the student deletes the case.
  student_id              uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Karl's own test conversation (may be committed to the repo); every other case is a student's.
  is_owner_case           boolean     NOT NULL DEFAULT false,
  source_conversation_id  uuid,
  source_message_id       uuid,
  item_canonical_id       text,
  request                 jsonb       NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  scan_correct_answer     text,
  production_reply        text        NOT NULL,
  captured_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tutor_eval_runs (
  run_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          text        NOT NULL REFERENCES public.tutor_eval_cases(case_id) ON DELETE CASCADE,
  -- One harness invocation; (batch, case, run) is unique, so a re-run of the same batch is a no-op.
  batch_id         uuid        NOT NULL,
  run_index        integer     NOT NULL CHECK (run_index >= 1),
  record           jsonb       NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  -- The code's verdict; 'unscored' until the case has a gold response and a rubric.
  verdict          text        NOT NULL CHECK (verdict IN ('pass', 'fail', 'review_needed', 'unscored')),
  -- Karl's own grade, for judge calibration (Doc 03D §5.3).
  owner_grade      text        CHECK (owner_grade IN ('pass', 'fail', 'review_needed')),
  owner_graded_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, case_id, run_index),
  CHECK ((owner_grade IS NULL) = (owner_graded_at IS NULL))
);

CREATE INDEX tutor_eval_runs_case_idx ON public.tutor_eval_runs (case_id, created_at);

ALTER TABLE public.tutor_eval_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_eval_runs  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tutor_eval_cases, public.tutor_eval_runs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_eval_cases TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tutor_eval_runs TO service_role;

COMMENT ON TABLE public.tutor_eval_cases IS
  'G0-2 evaluation cases. Holds student conversation text: service role only, RLS on, no policies. Never copied to the repository (Karl, 2026-10-27).';
COMMENT ON TABLE public.tutor_eval_runs IS
  'G0-2 evaluation runs. Replies and judge quotes can echo the student: service role only, RLS on, no policies.';

COMMIT;
