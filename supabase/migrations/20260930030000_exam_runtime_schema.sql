-- ============================================================================
-- E3 — Full-length exam runtime schema (Doc 04A V2.2 §5) + form publish gate
-- ============================================================================
-- @spec [Doc-04A_V2.2, §4 (#3 routing lock, #4 published items immutable,
--        #5 idempotent submission, #13 missing rows are blanks, #15 publish
--        gate), §5.1-§5.7 (the seven tables, verbatim column lists), §5.1.1
--        (score_table_version FK), §6.1 (lifecycle), §6.2 (DB-enforced gate
--        checks (a)+(b)), §6.3 (composition check (c)), §9.1-§9.2 (routing
--        immutability trigger), §11.2 step 7 (answer upsert key)]
--       [Doc-04B_V4.3, §13.1 (locked difficulty composition), §13.2
--        (validate_form_composition — AMENDED by owner ruling 2026-09-24, see
--        below and SCL-121), §10 (question-type naming — see SCL-121)]
-- @implemented [2026-09-24]
--
-- plain English: creates the seven Doc 04A runtime tables with their §5 column
--   lists, the three §5/§6/§9 triggers (published-form immutability, routing
--   path immutability, form-publish gate) plus the item-level half of
--   invariant #4, and validate_form_composition(). No API, no RLS policies,
--   no scoring functions (E4), no writer for any runtime table.
--
-- expected outcome: after apply the tables exist, empty, with RLS enabled and
--   no policies (deny-all to anon/authenticated), service_role-only grants.
--   Every form publish is REJECTED while scoring_model_versions v1.0 is
--   'candidate' (gate check (a)); that is the intended fail-closed state until
--   E4 attests v1.0.
--
-- ---------------------------------------------------------------------------
-- DEVIATIONS FROM THE SPEC DDL (each in the PR decision log; spec is not edited)
-- ---------------------------------------------------------------------------
--  D1 validate_form_composition (OWNER RULING 2026-09-24, SCL-121): integer
--     difficulty 1/2/3 (Doc 02A INV-02A-05; questions.difficulty is INTEGER
--     CHECK 1..3), questions.item_type ('mcq'|'grid_in') instead of 04B §10's
--     question_type/multiple_choice/student_produced_response, three separate
--     per-module tallies (difficulty, grid-in, domain) plus the module total,
--     RAISES on the first deficient cell instead of RETURNS TABLE. Domain
--     strings are the bank's: 'Problem Solving and Data Analysis' (no hyphen).
--  D2 routing_override_approved_by: plain uuid, NO REFERENCES admins(id) — no
--     admins table exists in any locked doc or in production (gate G-EX-04).
--     A CHECK pins it NULL until G-EX-04 lands, so gate (b)'s override path is
--     closed rather than open to an unverified identity (SCL-122).
--  D3 test_sessions.student_id REFERENCES profiles(id) ON DELETE CASCADE, and
--     the three session children ON DELETE CASCADE from test_sessions (spec
--     declares no identity FK and NO ACTION children). Required by
--     scripts/ci/fk-delete-action-guard.sql and account deletion (SCL-123).
--  D4 test_form_items.question_id REFERENCES questions(id) (spec: bare text).
--  D5 published-form immutability ALSO covers archived forms, blocks DELETE
--     of non-draft forms, and enforces the §6.1 one-way status machine.
--  D6 publish gate ALSO runs on INSERT (a row may not be born non-draft) and
--     ALSO calls validate_form_composition() as check (c) — 04A §6.2/§6.3 make
--     (c) handler-enforced; the handler must still call it (§6.3 step 4).
--  D7 item-level immutability trigger on test_form_items (invariant #4 — the
--     spec states it, §5.1's trigger only covers the form row).
--
-- trade-offs / edge cases:
--  * Trigger firing order on test_forms (same timing -> alphabetical):
--    trg_form_publish_gate, then trg_published_form_immutability. The gate
--    only acts on INSERT and on draft->published, where the immutability
--    trigger is a no-op, so the two never both raise on one statement.
--  * The item trigger locks the parent form row FOR SHARE. A publish UPDATE
--    therefore waits for any in-flight item write on that form to commit, and
--    the composition check it runs (a fresh statement snapshot inside the
--    volatile trigger) sees the committed item set. An item write that
--    arrives after the publish commits sees 'published' and is refused.
--  * No writer for exam_runtime_outbox / answers exists yet; the answer upsert
--    key is the PRIMARY KEY (§11.2 step 7), proven by the E3 gate (U1).
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
--   Genesis-extending; genesis-fresh-apply covers it. NOT APPLIED TO PROD BY
--   THIS CHANGE.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Purely additive: nothing
--   outside this file references these objects. Exact inverse, in order:
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP TABLE public.exam_runtime_outbox;
--   DROP TABLE public.test_session_answers;
--   DROP TABLE public.test_answer_submissions;
--   DROP TABLE public.test_session_sections;
--   DROP TABLE public.test_sessions;
--   DROP TABLE public.test_form_items;
--   DROP TABLE public.test_forms;
--   DROP FUNCTION public.validate_form_composition(uuid);
--   DROP FUNCTION public.enforce_form_publish_gate();
--   DROP FUNCTION public.enforce_published_form_immutability();
--   DROP FUNCTION public.enforce_published_form_items_immutability();
--   DROP FUNCTION public.enforce_module2_path_immutability();
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- §5.1 — test_forms
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_forms (
  id                    uuid PRIMARY KEY,
  name                  text NOT NULL,
  test_kind             text NOT NULL CHECK (test_kind IN ('full_length')),
  status                text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  is_selectable         boolean NOT NULL DEFAULT true,
  retired_for_new_sessions_at  timestamptz NULL,
  score_table_version   text NOT NULL REFERENCES public.scoring_model_versions(version),
  routing_threshold_rw  int  NOT NULL CHECK (routing_threshold_rw BETWEEN 0 AND 27),
  routing_threshold_m   int  NOT NULL CHECK (routing_threshold_m BETWEEN 0 AND 22),
  -- D2: spec says `REFERENCES admins(id)`; no admins table exists (G-EX-04).
  routing_override_approved_by  uuid NULL,
  routing_override_reason       text NULL,
  routing_override_ticket_id    text NULL,
  break_duration_ms     int  NOT NULL,
  rw_module1_ms         int  NOT NULL,
  rw_module2_ms         int  NOT NULL,
  m_module1_ms          int  NOT NULL,
  m_module2_ms          int  NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  published_at          timestamptz,
  archived_at           timestamptz,

  CONSTRAINT published_has_publish_time CHECK (
    (status = 'published' AND published_at IS NOT NULL) OR
    (status <> 'published')
  ),
  CONSTRAINT archived_has_archive_time CHECK (
    (status = 'archived' AND archived_at IS NOT NULL) OR
    (status <> 'archived')
  ),
  CONSTRAINT override_pair_both_or_neither CHECK (
    (routing_override_approved_by IS NULL
       AND routing_override_reason IS NULL
       AND routing_override_ticket_id IS NULL) OR
    (routing_override_approved_by IS NOT NULL
       AND routing_override_reason IS NOT NULL
       AND routing_override_ticket_id IS NOT NULL)
  ),
  CONSTRAINT retired_only_when_published CHECK (
    retired_for_new_sessions_at IS NULL OR status IN ('published', 'archived')
  ),
  CONSTRAINT retired_implies_not_selectable CHECK (
    retired_for_new_sessions_at IS NULL OR is_selectable = false
  ),
  -- D2: until an admins table exists (G-EX-04) no approver identity can be
  -- verified, so none may be recorded; with override_pair_both_or_neither this
  -- keeps all three override columns NULL and gate (b)'s override path closed.
  -- Drop this CHECK in the same migration that adds REFERENCES admins(id).
  CONSTRAINT routing_override_pending_admins_g_ex_04 CHECK (
    routing_override_approved_by IS NULL
  )
);

-- ---------------------------------------------------------------------------
-- §5.2 — test_form_items
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_form_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_form_id    uuid NOT NULL REFERENCES public.test_forms(id),
  section         text NOT NULL CHECK (section IN ('RW', 'M')),
  module          text NOT NULL CHECK (module IN ('1', '2A', '2B')),
  ordinal         int  NOT NULL,
  question_id     text NOT NULL REFERENCES public.questions(id),  -- D4; canonical question ID from Doc 02

  UNIQUE (test_form_id, section, module, ordinal),
  UNIQUE (test_form_id, question_id)        -- a question appears at most once per form
);

CREATE INDEX idx_test_form_items_lookup
  ON public.test_form_items (test_form_id, section, module, ordinal);

-- ---------------------------------------------------------------------------
-- §5.3 — test_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_sessions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- D3: spec declares no FK. CASCADE per the deletion doctrine (see header).
  student_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_form_id             uuid NOT NULL REFERENCES public.test_forms(id),
  state                    text NOT NULL CHECK (state IN (
    'created', 'active', 'section_break', 'completed',
    'abandoned_final', 'partial_scored_abandoned'
  )),
  mode                     text NOT NULL CHECK (mode IN ('strict', 'lenient')),
  active_section           text CHECK (active_section IN ('RW', 'M')),
  started_at               timestamptz,
  completed_at             timestamptz,
  abandoned_at             timestamptz,
  grace_expires_at         timestamptz NOT NULL,
  attempt_number_for_form  int  NOT NULL,
  is_first_seen_form_attempt boolean NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT started_state_has_started_at CHECK (
    (state IN ('active', 'section_break') AND started_at IS NOT NULL) OR
    (state NOT IN ('active', 'section_break'))
  ),
  CONSTRAINT active_has_active_section CHECK (
    (state = 'active' AND active_section IS NOT NULL) OR
    (state <> 'active')
  ),
  CONSTRAINT break_has_no_active_section CHECK (
    (state = 'section_break' AND active_section IS NULL) OR
    (state <> 'section_break')
  ),
  CONSTRAINT completed_has_completion_time CHECK (
    (state = 'completed' AND completed_at IS NOT NULL) OR
    (state <> 'completed')
  ),
  CONSTRAINT abandoned_has_abandon_time CHECK (
    (state IN ('abandoned_final', 'partial_scored_abandoned') AND abandoned_at IS NOT NULL) OR
    (state NOT IN ('abandoned_final', 'partial_scored_abandoned'))
  )
);

-- Enforce one active session per student (§5.3, invariant #2)
CREATE UNIQUE INDEX one_active_session_per_student
  ON public.test_sessions (student_id)
  WHERE state IN ('created', 'active', 'section_break');

-- Not named by the spec: serves the §5.3 attempt_number_for_form count
-- (student + form) and the ON DELETE CASCADE lookup by student_id, which the
-- partial index above cannot (it excludes terminal sessions).
CREATE INDEX idx_test_sessions_student_form
  ON public.test_sessions (student_id, test_form_id);

-- ---------------------------------------------------------------------------
-- §5.4 — test_session_sections
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_session_sections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id       uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,  -- D3
  section               text NOT NULL CHECK (section IN ('RW', 'M')),
  state                 text NOT NULL CHECK (state IN (
    'not_started', 'module1_active', 'module1_submitted',
    'module2_active', 'submitted'
  )),
  module2_path          text CHECK (module2_path IN ('A', 'B')),
  module1_started_at    timestamptz,
  module1_submitted_at  timestamptz,
  module1_submitted_by  text CHECK (module1_submitted_by IN ('student', 'timeout')),
  module2_started_at    timestamptz,
  module2_submitted_at  timestamptz,
  module2_submitted_by  text CHECK (module2_submitted_by IN ('student', 'timeout')),
  module1_expires_at    timestamptz,
  module2_expires_at    timestamptz,
  active_paused_ms      bigint NOT NULL DEFAULT 0,
  last_active_at        timestamptz,

  UNIQUE (test_session_id, section),

  CONSTRAINT module1_submission_metadata CHECK (
    (state IN ('module1_submitted', 'module2_active', 'submitted')
     AND module1_submitted_at IS NOT NULL
     AND module1_submitted_by IS NOT NULL)
    OR
    (state NOT IN ('module1_submitted', 'module2_active', 'submitted'))
  ),
  CONSTRAINT module2_path_after_module1_submit CHECK (
    (state IN ('module2_active', 'submitted') AND module2_path IS NOT NULL) OR
    (state NOT IN ('module2_active', 'submitted'))
  ),
  CONSTRAINT module2_submission_metadata CHECK (
    (state = 'submitted'
     AND module2_submitted_at IS NOT NULL
     AND module2_submitted_by IS NOT NULL)
    OR
    (state <> 'submitted')
  )
);

CREATE INDEX idx_test_session_sections_lookup
  ON public.test_session_sections (test_session_id, section);

-- ---------------------------------------------------------------------------
-- §5.5 — test_answer_submissions (append-only ledger; defined before
-- test_session_answers so its FK can be inline)
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_answer_submissions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id          uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,  -- D3
  idempotency_key          text NOT NULL,
  section                  text NOT NULL CHECK (section IN ('RW', 'M')),
  module                   text NOT NULL CHECK (module IN ('1', '2A', '2B')),
  ordinal                  int  NOT NULL,
  question_id              text NOT NULL,
  answer                   text,                       -- value submitted; NULL = explicit omit
  client_latency_ms        int,
  response_json            jsonb NOT NULL,             -- full response returned to client
  response_schema_version  text NOT NULL,              -- e.g., 'tests-answer-v1'; pins replay shape
  was_canonical_update     boolean NOT NULL,           -- true if this submission updated test_session_answers
  created_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (test_session_id, idempotency_key)
);

CREATE INDEX idx_test_answer_submissions_lookup
  ON public.test_answer_submissions (test_session_id, section, module, ordinal, created_at);

-- ---------------------------------------------------------------------------
-- §5.6 — test_session_answers (canonical answer state; missing row = blank)
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_session_answers (
  test_session_id       uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,  -- D3
  section               text NOT NULL CHECK (section IN ('RW', 'M')),
  module                text NOT NULL CHECK (module IN ('1', '2A', '2B')),
  ordinal               int  NOT NULL,
  question_id           text NOT NULL,
  answer                text,                       -- NULL = explicit omit; absent row = never submitted
  client_latency_ms     int,                        -- informational; not used in scoring
  last_submission_id    uuid NOT NULL REFERENCES public.test_answer_submissions(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (test_session_id, section, module, ordinal)
);

CREATE INDEX idx_test_session_answers_session
  ON public.test_session_answers (test_session_id, section, module);

-- ---------------------------------------------------------------------------
-- §5.7 — exam_runtime_outbox
-- ---------------------------------------------------------------------------
CREATE TABLE public.exam_runtime_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type            text NOT NULL CHECK (event_type IN (
    'test_session_completed',
    'test_session_partial_scored_abandoned'
  )),
  aggregate_id          uuid NOT NULL,                 -- typically test_session_id
  payload               jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'published', 'failed')),
  attempts              int  NOT NULL DEFAULT 0,
  last_attempt_at       timestamptz,
  published_at          timestamptz,
  failure_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_exam_runtime_outbox_pending
  ON public.exam_runtime_outbox (created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Doc 04B §13 as AMENDED by owner ruling 2026-09-24 (SCL-121) —
-- validate_form_composition(p_test_form_id)
-- @spec [Doc-04B_V4.3, §13.1, §13.2 (amended); Doc-04A_V2.2, §6.3 step 4,
--        §6.4; Doc-02A INV-02A-05 (difficulty ∈ {1,2,3})]
-- @implemented [2026-09-24]
-- plain English: returns normally when the form's composition is exactly the
--   locked blueprint; otherwise RAISES check_violation (23514) naming the FIRST
--   deficient cell: section, module, dimension, value, expected, actual.
--   Difficulty codes: 1 = easy, 2 = medium, 3 = hard.
--
-- DETERMINISTIC CHECK ORDER (the first failure in this order is the one raised):
--   0. the form exists                         (else no_data_found, P0002)
--   1. item integrity, items walked in (section RW then M, module 1/2A/2B,
--      ordinal) order:
--        dimension 'question_status'  — every question is status='published'
--        dimension 'question_section' — question.section = the item's section
--   2. tallies, cells walked in (section RW then M) x (module 1, 2A, 2B) x
--      (dimension total, difficulty, item_type, domain) x (value in the
--      blueprint order below):
--        total      value '*'        27 per RW module, 22 per Math module
--        difficulty value 1,2,3      04B §13.1 (RW M1 8/11/8 ...)
--        item_type  value grid_in    Math M1 3, M2A 8, M2B 8; RW 0
--        domain     value <bank string>
--      A (section, module) missing from the form fails its 'total' cell with
--      actual 0. A cell present in the form but absent from the blueprint
--      (e.g. a grid_in in RW) is compared against expected 0 and sorts last
--      within its (section, module, dimension).
--
-- trade-offs / edge cases:
--   * Quotas are literals in this body (as in 04B §13.2's own reference body),
--     not a table: scripts/ci/no-hardcoded-constants.mjs denylists none of
--     them, and a table would be a second, mutable home for locked numbers.
--   * A future joint-cell rule (e.g. domain x difficulty) is one more
--     dimension in the blueprint + actual CTEs; the signature does not change.
--   * mcq is not tallied: mcq = total - grid_in, so checking total and grid_in
--     fixes it.
--   * SECURITY DEFINER (as 04B §13.2) so a caller without questions access can
--     still validate; it reads only section/domain/difficulty/item_type/status
--     and returns nothing but an error, so no answer data can leave it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.validate_form_composition(p_test_form_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM test_forms WHERE id = p_test_form_id) THEN
    RAISE EXCEPTION 'validate_form_composition: test_form % does not exist', p_test_form_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. Item integrity.
  SELECT i.section, i.module, i.ordinal, i.question_id,
         q.status AS q_status, q.section AS q_section
    INTO r
    FROM test_form_items i
    JOIN questions q ON q.id = i.question_id
   WHERE i.test_form_id = p_test_form_id
     AND (q.status <> 'published' OR q.section <> i.section)
   ORDER BY CASE i.section WHEN 'RW' THEN 1 ELSE 2 END,
            CASE i.module WHEN '1' THEN 1 WHEN '2A' THEN 2 ELSE 3 END,
            i.ordinal
   LIMIT 1;
  IF FOUND THEN
    IF r.q_status <> 'published' THEN
      RAISE EXCEPTION 'validate_form_composition: form % section=% module=% dimension=question_status value=% ordinal=% expected=published actual=%',
        p_test_form_id, r.section, r.module, r.question_id, r.ordinal, r.q_status
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'validate_form_composition: form % section=% module=% dimension=question_section value=% ordinal=% expected=% actual=%',
      p_test_form_id, r.section, r.module, r.question_id, r.ordinal, r.section, r.q_section
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. Tallies: first mismatching cell in the stated order.
  WITH blueprint(section, module, dimension, value, expected, value_ord) AS (
    VALUES
      -- ---------------- Reading & Writing ----------------
      ('RW', '1',  'total',      '*', 27, 1),
      ('RW', '1',  'difficulty', '1',  8, 1), ('RW', '1',  'difficulty', '2', 11, 2), ('RW', '1',  'difficulty', '3',  8, 3),
      ('RW', '1',  'item_type',  'grid_in', 0, 1),
      ('RW', '1',  'domain', 'Information and Ideas',         7, 1),
      ('RW', '1',  'domain', 'Craft and Structure',           8, 2),
      ('RW', '1',  'domain', 'Expression of Ideas',           5, 3),
      ('RW', '1',  'domain', 'Standard English Conventions',  7, 4),

      ('RW', '2A', 'total',      '*', 27, 1),
      ('RW', '2A', 'difficulty', '1', 14, 1), ('RW', '2A', 'difficulty', '2',  9, 2), ('RW', '2A', 'difficulty', '3',  4, 3),
      ('RW', '2A', 'item_type',  'grid_in', 0, 1),
      ('RW', '2A', 'domain', 'Information and Ideas',         7, 1),
      ('RW', '2A', 'domain', 'Craft and Structure',           7, 2),
      ('RW', '2A', 'domain', 'Expression of Ideas',           6, 3),
      ('RW', '2A', 'domain', 'Standard English Conventions',  7, 4),

      ('RW', '2B', 'total',      '*', 27, 1),
      ('RW', '2B', 'difficulty', '1',  4, 1), ('RW', '2B', 'difficulty', '2',  9, 2), ('RW', '2B', 'difficulty', '3', 14, 3),
      ('RW', '2B', 'item_type',  'grid_in', 0, 1),
      ('RW', '2B', 'domain', 'Information and Ideas',         7, 1),
      ('RW', '2B', 'domain', 'Craft and Structure',           7, 2),
      ('RW', '2B', 'domain', 'Expression of Ideas',           6, 3),
      ('RW', '2B', 'domain', 'Standard English Conventions',  7, 4),

      -- ---------------- Math ----------------
      ('M',  '1',  'total',      '*', 22, 1),
      ('M',  '1',  'difficulty', '1',  7, 1), ('M',  '1',  'difficulty', '2',  9, 2), ('M',  '1',  'difficulty', '3',  6, 3),
      ('M',  '1',  'item_type',  'grid_in', 3, 1),
      ('M',  '1',  'domain', 'Algebra',                            8, 1),
      ('M',  '1',  'domain', 'Advanced Math',                      7, 2),
      ('M',  '1',  'domain', 'Problem Solving and Data Analysis',  4, 3),
      ('M',  '1',  'domain', 'Geometry and Trigonometry',          3, 4),

      ('M',  '2A', 'total',      '*', 22, 1),
      ('M',  '2A', 'difficulty', '1', 11, 1), ('M',  '2A', 'difficulty', '2',  8, 2), ('M',  '2A', 'difficulty', '3',  3, 3),
      ('M',  '2A', 'item_type',  'grid_in', 8, 1),
      ('M',  '2A', 'domain', 'Algebra',                            7, 1),
      ('M',  '2A', 'domain', 'Advanced Math',                      8, 2),
      ('M',  '2A', 'domain', 'Problem Solving and Data Analysis',  3, 3),
      ('M',  '2A', 'domain', 'Geometry and Trigonometry',          4, 4),

      ('M',  '2B', 'total',      '*', 22, 1),
      ('M',  '2B', 'difficulty', '1',  3, 1), ('M',  '2B', 'difficulty', '2',  8, 2), ('M',  '2B', 'difficulty', '3', 11, 3),
      ('M',  '2B', 'item_type',  'grid_in', 8, 1),
      ('M',  '2B', 'domain', 'Algebra',                            7, 1),
      ('M',  '2B', 'domain', 'Advanced Math',                      8, 2),
      ('M',  '2B', 'domain', 'Problem Solving and Data Analysis',  3, 3),
      ('M',  '2B', 'domain', 'Geometry and Trigonometry',          4, 4)
  ),
  items AS (
    SELECT i.section, i.module, q.difficulty, q.item_type, q.domain
      FROM test_form_items i
      JOIN questions q ON q.id = i.question_id
     WHERE i.test_form_id = p_test_form_id
  ),
  actual(section, module, dimension, value, cnt) AS (
    SELECT section, module, 'total', '*', count(*) FROM items GROUP BY section, module
    UNION ALL
    SELECT section, module, 'difficulty', difficulty::text, count(*) FROM items GROUP BY section, module, difficulty
    UNION ALL
    SELECT section, module, 'item_type', item_type, count(*) FROM items WHERE item_type = 'grid_in' GROUP BY section, module, item_type
    UNION ALL
    SELECT section, module, 'domain', domain, count(*) FROM items GROUP BY section, module, domain
  )
  SELECT COALESCE(b.section, a.section)     AS section,
         COALESCE(b.module, a.module)       AS module,
         COALESCE(b.dimension, a.dimension) AS dimension,
         COALESCE(b.value, a.value)         AS value,
         COALESCE(b.expected, 0)            AS expected,
         COALESCE(a.cnt, 0)                 AS actual
    INTO r
    FROM blueprint b
    FULL JOIN actual a
      ON a.section = b.section AND a.module = b.module
     AND a.dimension = b.dimension AND a.value = b.value
   WHERE COALESCE(b.expected, 0) <> COALESCE(a.cnt, 0)
   ORDER BY CASE COALESCE(b.section, a.section) WHEN 'RW' THEN 1 ELSE 2 END,
            CASE COALESCE(b.module, a.module) WHEN '1' THEN 1 WHEN '2A' THEN 2 ELSE 3 END,
            CASE COALESCE(b.dimension, a.dimension)
              WHEN 'total' THEN 1 WHEN 'difficulty' THEN 2 WHEN 'item_type' THEN 3 ELSE 4 END,
            COALESCE(b.value_ord, 1000),
            COALESCE(b.value, a.value)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'validate_form_composition: form % section=% module=% dimension=% value=% expected=% actual=%',
      p_test_form_id, r.section, r.module, r.dimension, r.value, r.expected, r.actual
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- §5.1 — published-form immutability (spec body) + D5 extensions
-- @spec [Doc-04A_V2.2, §5.1 trigger, §6.1 one-way lifecycle, §6.5]
-- @implemented [2026-09-24]
-- plain English: once a form leaves draft its content-bearing columns are
--   frozen (the spec's list, verbatim; is_selectable and
--   retired_for_new_sessions_at stay mutable as §6.5 requires); status moves
--   only draft->published->archived; a non-draft form cannot be deleted.
-- edge cases: the spec guards OLD.status = 'published' only; archived is
--   added because §6.1 keeps archived forms scoring for bound sessions, so
--   their thresholds/version must stay what those sessions were scored under.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enforce_published_form_immutability() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Cannot delete test_form %: % forms are retained for historical scoring and audit.',
        OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'draft' AND NEW.status = 'published')
           OR (OLD.status = 'published' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'Illegal test_forms status transition % -> % (lifecycle is draft -> published -> archived, one-way).',
      OLD.status, NEW.status;
  END IF;

  IF OLD.status IN ('published', 'archived') AND (
    NEW.score_table_version IS DISTINCT FROM OLD.score_table_version OR
    NEW.routing_threshold_rw IS DISTINCT FROM OLD.routing_threshold_rw OR
    NEW.routing_threshold_m IS DISTINCT FROM OLD.routing_threshold_m OR
    NEW.routing_override_approved_by IS DISTINCT FROM OLD.routing_override_approved_by OR
    NEW.routing_override_reason IS DISTINCT FROM OLD.routing_override_reason OR
    NEW.routing_override_ticket_id IS DISTINCT FROM OLD.routing_override_ticket_id OR
    NEW.break_duration_ms IS DISTINCT FROM OLD.break_duration_ms OR
    NEW.rw_module1_ms IS DISTINCT FROM OLD.rw_module1_ms OR
    NEW.rw_module2_ms IS DISTINCT FROM OLD.rw_module2_ms OR
    NEW.m_module1_ms IS DISTINCT FROM OLD.m_module1_ms OR
    NEW.m_module2_ms IS DISTINCT FROM OLD.m_module2_ms
  ) THEN
    RAISE EXCEPTION 'Published forms are immutable. Archive and republish.';
  END IF;
  -- is_selectable and retired_for_new_sessions_at are intentionally mutable post-publish.
  -- They are operational toggles for retiring a form from new selection without
  -- archiving (which would also break historical reproducibility on running sessions).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_published_form_immutability
  BEFORE UPDATE OR DELETE ON public.test_forms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_published_form_immutability();

-- ---------------------------------------------------------------------------
-- Invariant §4 #4 — published form ITEMS are immutable (D7)
-- @spec [Doc-04A_V2.2, §4 #4, §5.2, §6.5; Doc-04B_V4.3 §13.3 ("Published forms
--        cannot have their composition changed")]
-- @implemented [2026-09-24]
-- plain English: an item may be inserted, changed or removed only while its
--   form (both the old and the new form, for an UPDATE that moves it) is draft.
-- edge cases: FOR SHARE on the parent row serialises item writes against a
--   concurrent publish (see header).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enforce_published_form_items_immutability() RETURNS trigger AS $$
DECLARE
  v_form   uuid;
  v_status text;
BEGIN
  FOREACH v_form IN ARRAY (
    CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.test_form_id]
      WHEN 'DELETE' THEN ARRAY[OLD.test_form_id]
      ELSE ARRAY[OLD.test_form_id, NEW.test_form_id]
    END)
  LOOP
    SELECT status INTO v_status FROM test_forms WHERE id = v_form FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' AND v_status IS NOT NULL THEN
      RAISE EXCEPTION 'test_form_items of % form % are immutable (% refused). Archive and republish.',
        v_status, v_form, TG_OP;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_published_form_items_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.test_form_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_published_form_items_immutability();

-- ---------------------------------------------------------------------------
-- §6.2 — form publish gate: checks (a) and (b) verbatim, + D6
-- @spec [Doc-04A_V2.2, §4 #15, §6.2, §6.3; Doc-04B_V4.3 §13.3]
-- @implemented [2026-09-24]
-- plain English: a form is born draft; the draft->published UPDATE fails
--   unless (a) its score_table_version is 'active', (b) its routing
--   thresholds are in range (the override path is closed by D2), and (c) its
--   composition validates. Checks run in that order.
-- edge cases: while v1.0 is 'candidate' (E2 owner ruling) check (a) refuses
--   EVERY publish. That is intended until E4 activates v1.0.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enforce_form_publish_gate() RETURNS trigger AS $$
DECLARE
  v_version_status text;
  v_within_range   boolean;
  v_override_set   boolean;
BEGIN
  -- D6: a row may not be born past draft (would bypass the whole gate).
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Cannot insert test_form % with status %: forms are created as draft and published through the gate',
        NEW.id, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Only fire on the draft → published transition
  IF NOT (OLD.status = 'draft' AND NEW.status = 'published') THEN
    RETURN NEW;
  END IF;

  -- Gate check (a): score_table_version exists and is currently active
  SELECT status INTO v_version_status
    FROM scoring_model_versions
    WHERE version = NEW.score_table_version;

  IF v_version_status IS NULL THEN
    RAISE EXCEPTION 'Cannot publish: score_table_version % does not exist in scoring_model_versions',
      NEW.score_table_version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_version_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot publish: score_table_version % is in status % (must be active)',
      NEW.score_table_version, v_version_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Gate check (b): routing thresholds in expected range OR override recorded
  v_within_range :=
    NEW.routing_threshold_rw BETWEEN 18 AND 21
    AND NEW.routing_threshold_m BETWEEN 13 AND 16;

  v_override_set :=
    NEW.routing_override_approved_by IS NOT NULL
    AND NEW.routing_override_reason IS NOT NULL;

  IF NOT (v_within_range OR v_override_set) THEN
    RAISE EXCEPTION 'Cannot publish: routing thresholds (RW=%, M=%) outside expected range (RW 18-21, M 13-16) and no override recorded',
      NEW.routing_threshold_rw, NEW.routing_threshold_m
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Gate check (c) (D6): composition. The §6.3 handler still calls this first.
  PERFORM validate_form_composition(NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_form_publish_gate
  BEFORE INSERT OR UPDATE ON public.test_forms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_form_publish_gate();

-- ---------------------------------------------------------------------------
-- §9.2 — routing immutability (verbatim)
-- @spec [Doc-04A_V2.2, §4 #3, §9.2] | @implemented [2026-09-24]
-- plain English: the first write of module2_path (NULL -> 'A'|'B') is the
--   lock; any later change, including back to NULL, raises.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enforce_module2_path_immutability() RETURNS trigger AS $$
BEGIN
  IF OLD.module2_path IS NOT NULL
     AND NEW.module2_path IS DISTINCT FROM OLD.module2_path THEN
    RAISE EXCEPTION 'module2_path is immutable once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_module2_path_immutability
  BEFORE UPDATE ON public.test_session_sections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module2_path_immutability();

-- ---------------------------------------------------------------------------
-- Repo conventions: RLS on every table, NO policies (current_student_id() does
-- not exist yet — gate G-EX-01), explicit least-privilege service_role grants.
-- Policy readiness: test_sessions carries student_id; sections, submissions
-- and answers reach it by one FK hop (test_session_id); forms/items are
-- catalogue rows with no student scope; the outbox is service-internal.
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_forms              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_form_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_session_sections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_answer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_session_answers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_runtime_outbox     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.test_forms              FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_form_items         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_sessions           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_session_sections   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_answer_submissions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.test_session_answers    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.exam_runtime_outbox     FROM PUBLIC, anon, authenticated, service_role;

-- Content tooling authors drafts and publishes (triggers police the rest).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.test_forms      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.test_form_items TO service_role;
-- Runtime state: no DELETE (sessions end in terminal states; removal is the
-- account-deletion FK cascade, which runs as the table owner).
GRANT SELECT, INSERT, UPDATE ON TABLE public.test_sessions         TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.test_session_sections TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.test_session_answers  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.exam_runtime_outbox   TO service_role;
-- §5.5: append-only ledger — no UPDATE, no DELETE.
GRANT SELECT, INSERT ON TABLE public.test_answer_submissions TO service_role;

REVOKE ALL ON FUNCTION public.validate_form_composition(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_published_form_immutability()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_published_form_items_immutability()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_form_publish_gate()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_module2_path_immutability()           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_form_composition(uuid)            TO service_role;

COMMIT;
