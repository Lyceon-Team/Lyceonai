-- ---------------------------------------------------------------------------
-- Mastery unblock 2/2: constrain (section, domain) pairs to the canonical eight.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05B_V1.0 §4.2 domain canonicality is BLOCKING in 05B;
--        Doc-05A_V1.0 §4.2 Step 4 (consultative, non-blocking — deliberately skipped)]
-- @implemented 2026-08-16
--
-- plain English: refresh_domain_mastery hard-blocks on eight exact domain
-- strings and raises DOMAIN_SECTION_MISMATCH otherwise, rolling back the whole
-- mastery event. apply_mastery_event deliberately does NOT check domain
-- canonicality (its §4.2 Step 4 is marked consultative and skipped in V1.0), so
-- nothing catches a bad value before the blocking check. Between the question
-- bank and that check there was no enforcement at all: questions.domain and
-- practice_session_items.question_domain were both plain `text NOT NULL` with
-- no CHECK, while their sibling section columns were constrained. One drifted
-- string in one published question — a hyphen, a lowercase seed, a trailing
-- space — would kill every mastery event in that domain, permanently.
--
-- expected outcome: the drift becomes unrepresentable. Verified read-only
-- 2026-08-16: all 441 rows in `questions` and all 84 answered
-- practice_session_items already carry canonical strings, so this adds no
-- migration risk. Note the M list is 'Problem Solving and Data Analysis'
-- WITHOUT a hyphen — matching CANONICAL_DOMAINS in
-- shared/question-bank-contract.ts and both lists inside refresh_domain_mastery.
--
-- CONSTRAIN, DO NOT NORMALIZE: silent repair at the boundary would mask a bad
-- authoring pipeline. A violating row must fail loudly at write time.
--
-- PORTABILITY: statement (0) asserts only that no violating row exists — true
-- on prod (verified) and trivially true on any fresh database. It carries no
-- environment-specific count. Exact-target verification lives in
-- scripts/prod-verify/1.2-pre-apply.sql.
--
-- trade-offs: the pairing is duplicated between SQL and TypeScript
-- (CANONICAL_DOMAINS). That duplication is deliberate and already exists inside
-- refresh_domain_mastery — the DB must be able to refuse a bad row without
-- trusting the application. The TS side is the single source for application
-- code; this is the DB's independent floor.
--
-- rollback:
--   ALTER TABLE public.practice_session_items
--     DROP CONSTRAINT IF EXISTS psi_question_domain_section_canonical;
--   ALTER TABLE public.questions
--     DROP CONSTRAINT IF EXISTS questions_domain_section_canonical;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- (0) Fail loudly, never skip. If any violating row exists the constraint would
--     fail with an opaque 23514 naming no row; this names the table and count.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_bad_questions integer;
  v_bad_items     integer;
BEGIN
  SELECT count(*) INTO v_bad_questions
  FROM public.questions q
  WHERE NOT (
    (q.section = 'M'  AND q.domain IN ('Algebra', 'Advanced Math',
                                       'Problem Solving and Data Analysis',
                                       'Geometry and Trigonometry'))
    OR
    (q.section = 'RW' AND q.domain IN ('Information and Ideas', 'Craft and Structure',
                                       'Expression of Ideas',
                                       'Standard English Conventions'))
  );

  IF v_bad_questions > 0 THEN
    RAISE EXCEPTION
      'CANONICAL_DOMAIN_VIOLATION: % row(s) in public.questions have a non-canonical (section, domain) pair — see scripts/prod-verify/1.2-pre-apply.sql for the offending rows',
      v_bad_questions;
  END IF;

  SELECT count(*) INTO v_bad_items
  FROM public.practice_session_items pi
  WHERE NOT (
    (pi.question_section = 'M'  AND pi.question_domain IN ('Algebra', 'Advanced Math',
                                                           'Problem Solving and Data Analysis',
                                                           'Geometry and Trigonometry'))
    OR
    (pi.question_section = 'RW' AND pi.question_domain IN ('Information and Ideas', 'Craft and Structure',
                                                           'Expression of Ideas',
                                                           'Standard English Conventions'))
  );

  IF v_bad_items > 0 THEN
    RAISE EXCEPTION
      'CANONICAL_DOMAIN_VIOLATION: % row(s) in public.practice_session_items have a non-canonical (section, question_domain) pair — see scripts/prod-verify/1.2-pre-apply.sql for the offending rows',
      v_bad_items;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- (1) Question bank floor. section is already CHECK-constrained to ('M','RW')
--     by questions_section_check, so the pairing below is total.
-- ---------------------------------------------------------------------------
ALTER TABLE public.questions
  ADD CONSTRAINT questions_domain_section_canonical
  CHECK (
    (section = 'M'  AND domain IN ('Algebra', 'Advanced Math',
                                   'Problem Solving and Data Analysis',
                                   'Geometry and Trigonometry'))
    OR
    (section = 'RW' AND domain IN ('Information and Ideas', 'Craft and Structure',
                                   'Expression of Ideas',
                                   'Standard English Conventions'))
  );

-- ---------------------------------------------------------------------------
-- (2) Runtime snapshot floor. This is the column apply_mastery_event actually
--     reads (via practice_session_items.question_domain -> p_domain), so it is
--     the one that decides whether refresh_domain_mastery raises.
-- ---------------------------------------------------------------------------
ALTER TABLE public.practice_session_items
  ADD CONSTRAINT psi_question_domain_section_canonical
  CHECK (
    (question_section = 'M'  AND question_domain IN ('Algebra', 'Advanced Math',
                                                     'Problem Solving and Data Analysis',
                                                     'Geometry and Trigonometry'))
    OR
    (question_section = 'RW' AND question_domain IN ('Information and Ideas', 'Craft and Structure',
                                                     'Expression of Ideas',
                                                     'Standard English Conventions'))
  );

COMMIT;
