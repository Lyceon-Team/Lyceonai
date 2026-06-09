-- ============================================================================
-- B-WS2-1 — WS-2 practice/review runtime tables (Doc 02B V4 §8/§14/§16)
-- ============================================================================
-- @spec [Doc-02B_V4 §8 Canonical Tables + Writer Map] [Doc-02B_V4 §14 Practice Engine]
--       [Doc-02B_V4 §16 Review Engine + SM-2 + Review Schedule] [Doc-02B_V4 §20 Reveal Matrix]
--       [Doc-02B_V4 §10 INV-02B-01/02/06/13/15] [Doc-02 Preamble_V3 §12 reveal matrix]
--       [contracts/ws2-ws3-mastery-seam.contract.md §2 R1 / §4 G1-G2 / §7 H6/H7]
--       [contracts/ws2-practice-review-runtime.contract.md]
-- @implemented [2026-06-10]
-- plain English: the SCHEMA layer (DDL only) for the WS-2 practice + review runtime —
--   the canonical envelope + snapshot-bearing answer tables that downstream WS-3 mastery
--   reads through the FROZEN seam. Practice prefills all session items at creation with an
--   immutable question snapshot (Doc 02B §14 line 611-620, INV-02B-13); the answer columns
--   are populated on submission. Review mirrors the snapshot pattern and adds the per-attempt
--   outcome table (review_error_attempts — fires on correct AND incorrect retries per seam H7)
--   plus the SM-2 per-(profile,question) review_schedule (Doc 02B §16 line 754-760, CR-02B-23).
--   The two answer tables (practice_session_items, review_error_attempts) are the SEAM-BEARING
--   tables: each row PK is the seam event_id (seam §7 H6); the denormalized
--   section/domain/skill/difficulty/correct/occurred_at columns are the seam §2 R1 read-contract.
--   This item is SCHEMA ONLY — the serving-path TS + routes are B-WS2-2; the mastery RPC wiring
--   (canonical_mastery_events / apply_mastery_event) is Lane C. No engine logic here.
--
-- NON-NEGOTIABLES enforced at the schema layer:
--   • Anti-leak (INV-02B-01 / §20 / Doc 02 Preamble §12): the column-level GRANT SELECT to
--     `authenticated` on the snapshot tables EXCLUDES question_correct_answer, question_explanation,
--     question_option_metadata. RLS-enabled, student own-row read only. The post-submit reveal is
--     the route's job (B-WS2-2), projecting from the snapshot — not a broad table grant.
--   • Single-writer (Doc 02B §8 Writer Map line 321-322 / seam G1): each table names ONE canonical
--     writer; writes are service_role only (the writer runs as service_role).
--   • Idempotency (INV-02B-02 / §14 line 646 / seam R2): partial UNIQUE (user/student_id,
--     client_attempt_id) WHERE client_attempt_id IS NOT NULL on each answer table.
--   • Determinism / no magic numbers (INV-02B-15 / seam G4): NO tuned SM-2 constant is a column
--     DEFAULT — ease_factor has NO numeric default; the engine seeds it from
--     review_runtime_config.sm2_initial_ease_factor at insert. interval_days/repetition_count
--     default 0 (structural zero, not a tuned constant).
--
-- @adaptation B-WS2-1/A (SEAM MISMATCH — REPORTED, not silently resolved): question_id is TEXT
--   here, FK to genesis public.questions.id (the canonical SAT id, TEXT:
--   `^SAT(M|RW)[12][A-Z0-9]{6}$`, genesis line 466). The FROZEN seam §2 R1 (contract line 75) and
--   Doc 05A apply_mastery_event (p_question_id uuid) + B-WS3-1 mastery_event_audit_log.question_id
--   are uuid. We hold the CANONICAL truth (questions.id is TEXT). The seam's uuid typing of
--   question_id must be reconciled BEFORE Lane C wires the RPC call → candidate new SP item
--   (see contract §"Findings"). event_id remains uuid (the answer-row PK), unaffected.
-- @adaptation B-WS2-1/B (SP-17): the single canonical skill denormalized into
--   question_skill/skill is questions.skill_codes[1] (1-indexed primary). This is an ORDERING
--   GUARANTEE the engine (B-WS2-2) must honor at write time, not rubber-stamped here — the
--   schema only provides the single-skill column the seam's single-skill mastery PK requires.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Revert = DROP the 6 tables (FK CASCADE
--   children first or all-at-once in one DROP); no forward-data destruction (CREATE only,
--   no seed). Genesis-extending; the genesis-fresh-apply gate covers it.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — DROP TABLE
--   review_schedule, review_error_attempts, review_session_items, review_sessions,
--   practice_session_items, practice_sessions (children before parents); CREATE only, no seed.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PRACTICE RUNTIME (Doc 02B §14) — envelope + seam-bearing snapshot/answer table
--    Single canonical writer: practice-canonical.ts (Doc 02B §8 Writer Map line 321; seam G1)
-- ============================================================================

-- @spec [Doc-02B_V4 §14 Session Creation / Lifecycle] practice_sessions — the session envelope.
--   Lifecycle: created -> active -> completed | abandoned (server-only transitions, §14 line 599).
--   SINGLE CANONICAL WRITER: practice-canonical.ts.
CREATE TABLE public.practice_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id),
  mode               text NOT NULL CHECK (mode IN ('flow','structured')),          -- §14 line 603: flow adaptive | structured filtered
  filters            jsonb NOT NULL DEFAULT '{}'::jsonb,                            -- §14 line 603: section/domain/skill/difficulty
  target_count       int  NOT NULL CHECK (target_count > 0),                        -- §14 line 605: full target count
  platform           text NOT NULL CHECK (platform IN ('web','mobile')),           -- §14 line 603: platform indicator
  client_instance_id text NOT NULL,                                                 -- §14 line 603: multi-tab safety
  status             text NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created','active','completed','abandoned')), -- §14 line 599 lifecycle
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now(),                            -- §14 line 642: inactivity timeout basis
  completed_at       timestamptz
);
CREATE INDEX idx_practice_sessions_user   ON public.practice_sessions (user_id, created_at DESC);
CREATE INDEX idx_practice_sessions_active ON public.practice_sessions (user_id) WHERE status = 'active';

-- @spec [Doc-02B_V4 §14 Session Items Prefill Pattern, line 609-620] practice_session_items —
--   THE seam-bearing answer table. All target_count rows are materialized at session creation
--   with an IMMUTABLE denormalized question snapshot (INV-02B-13); answer columns are populated
--   on submission (§14 line 618). SINGLE CANONICAL WRITER: practice-canonical.ts.
--
--   SEAM (contract §2 R1 / §7 H6) — Lane C's canonical_mastery_events reads these without join.
--   The seam's canonical column names MAP onto this table as:
--     seam event_id    -> id                       (this row PK IS the upstream event_id, H6)
--     seam question_id -> question_id              (TEXT; @adaptation A — seam types it uuid, REPORTED)
--     seam correct     -> is_correct
--     seam section     -> question_section
--     seam domain      -> question_domain
--     seam skill       -> question_skill           (= questions.skill_codes[1], SP-17 single skill)
--     seam difficulty  -> question_difficulty      (canonical 1-3, seam R3)
--     seam occurred_at -> occurred_at              (no snapshot equivalent — added here; = answered_at)
--   Seam R1 falsifier: a NULL in any seam column on a MASTERY-BEARING (answered) row. The snapshot
--   section/domain/skill/difficulty are NOT NULL structurally; correct/occurred_at are populated on
--   submission by the writer (NULL only on pending/served/skipped, which are not mastery-bearing).
CREATE TABLE public.practice_session_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- SEAM event_id (H6: answer-row PK = event_id)
  session_id               uuid NOT NULL REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES public.profiles(id),  -- denormalized for idempotency UNIQUE + RLS own-row
  ordinal                  int  NOT NULL,                                 -- §14 line 614: position within session
  question_id              text NOT NULL REFERENCES public.questions(id), -- §14 line 615 (TEXT canonical SAT id; @adaptation A)

  -- Denormalized immutable snapshot (§14 line 616; INV-02B-13 — does not propagate from questions)
  question_stem            text NOT NULL,
  question_passage         text,
  question_options         jsonb NOT NULL,                               -- student-visible [{key,text}] (anti-leak safe)
  question_correct_answer  text NOT NULL,                                -- INTERNAL: pre-submit never served (§20 / INV-02B-01)
  question_explanation     text NOT NULL,                                -- INTERNAL: post-submit only (§20)
  question_option_metadata jsonb,                                        -- INTERNAL: never to clients (§7 line 195 / §20)
  question_domain          text NOT NULL,                                -- snapshot + seam domain
  question_skill           text NOT NULL,                                -- snapshot + seam skill (skill_codes[1], SP-17)
  question_difficulty      smallint NOT NULL CHECK (question_difficulty BETWEEN 1 AND 3), -- seam difficulty (1-3, R3)
  question_section         text NOT NULL CHECK (question_section IN ('M','RW')),          -- snapshot + seam section

  -- Item status (§14 line 617)
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','served','answered','skipped')),

  -- Populated on submission (§14 line 618)
  selected_answer          text,
  is_correct               boolean,                                      -- SEAM correct (NULL until answered)
  outcome                  text CHECK (outcome IS NULL OR outcome IN ('correct','incorrect','skipped')),
  time_spent_ms            int,                                          -- client-reported latency (telemetry only, §14 line 630)
  client_attempt_id        text,                                         -- idempotency key (§14 line 646)
  answered_at              timestamptz,
  served_at                timestamptz,

  -- SEAM occurred_at (contract §2 R1) — the mastery event time; set to answered_at at write.
  -- No snapshot equivalent exists, so it is added here (per task spec). The writer sets it = answered_at.
  occurred_at              timestamptz
);
CREATE INDEX idx_practice_items_session ON public.practice_session_items (session_id, ordinal);
CREATE INDEX idx_practice_items_user    ON public.practice_session_items (user_id, answered_at DESC);
-- Idempotency (INV-02B-02 / §14 line 646 / seam R2): per (user, client_attempt_id), partial.
CREATE UNIQUE INDEX uq_practice_items_idem
  ON public.practice_session_items (user_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL;

-- ============================================================================
-- 2. REVIEW RUNTIME (Doc 02B §16) — envelope + snapshot + seam-bearing attempt table + SM-2 schedule
--    Single canonical writer: review-session-routes.ts (Doc 02B §8 Writer Map line 322; seam G1)
-- ============================================================================

-- @spec [Doc-02B_V4 §16 Review Engine] review_sessions — the review session envelope (session-bound UX).
--   SINGLE CANONICAL WRITER: review-session-routes.ts.
CREATE TABLE public.review_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.profiles(id),
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','abandoned')),
  source_origin      text NOT NULL CHECK (source_origin IN ('practice','full_test')), -- §16 line 706: missed in practice OR exam
  client_instance_id text NOT NULL,                                                    -- multi-tab safety (parity with practice)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_sessions_student ON public.review_sessions (student_id, created_at DESC);

-- @spec [Doc-02B_V4 §16 Original-item replay] review_session_items — review snapshot row (mirrors
--   the practice snapshot, INV-02B-13). retry_mode is the §16 launch decision: original-item replay
--   (same_question) is the launch behavior; similar_question is the (target-state) variant slot.
--   SINGLE CANONICAL WRITER: review-session-routes.ts.
CREATE TABLE public.review_session_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               uuid NOT NULL REFERENCES public.review_sessions(id) ON DELETE CASCADE,
  student_id               uuid NOT NULL REFERENCES public.profiles(id),
  ordinal                  int  NOT NULL,
  question_id              text NOT NULL REFERENCES public.questions(id),  -- TEXT canonical SAT id (@adaptation A)

  -- Denormalized immutable snapshot (same shape as practice_session_items; §16 / INV-02B-13)
  question_stem            text NOT NULL,
  question_passage         text,
  question_options         jsonb NOT NULL,                               -- student-visible [{key,text}]
  question_correct_answer  text NOT NULL,                                -- INTERNAL: tutor-in-review never sees it (§16 line 774 / §20)
  question_explanation     text NOT NULL,                                -- INTERNAL: post-submit only (§20)
  question_option_metadata jsonb,                                        -- INTERNAL: never to clients (§20)
  question_domain          text NOT NULL,
  question_skill           text NOT NULL,                                -- skill_codes[1] (SP-17)
  question_difficulty      smallint NOT NULL CHECK (question_difficulty BETWEEN 1 AND 3),
  question_section         text NOT NULL CHECK (question_section IN ('M','RW')),

  retry_mode               text NOT NULL DEFAULT 'same_question'
                             CHECK (retry_mode IN ('same_question','similar_question')), -- §16 line 708: original-item replay at launch
  status                   text NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','served','answered','skipped')),
  served_at                timestamptz,
  answered_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_items_session ON public.review_session_items (session_id, ordinal);
CREATE INDEX idx_review_items_student ON public.review_session_items (student_id);

-- @spec [Doc-02B_V4 §8 line 268 / §16 Tutor-Assisted Correctness] review_error_attempts —
--   THE review seam-bearing answer table. Per-attempt outcome linked to a review session item.
--   FIRES ON CORRECT AND INCORRECT retries (seam §2 R1 / §7 H7); used_tutor is TELEMETRY-ONLY,
--   NEVER formula-facing (Doc 02B §16 line 784, CR-02B-16; seam G2). SINGLE CANONICAL WRITER:
--   review-session-routes.ts.
--
--   SEAM (contract §2 R1 / §7 H6) — Lane C reads these WITHOUT joining. Unlike the practice
--   snapshot, the seam columns are FIRST-CLASS here (the attempt table carries no question snapshot),
--   denormalized at write time and NOT NULL (R1 falsifier: a NULL in any of these on a mastery-bearing
--   row). Mapping: seam event_id -> id; seam correct -> is_correct; section/domain/skill/difficulty/
--   occurred_at are the like-named columns; seam question_id -> question_id (TEXT; @adaptation A).
CREATE TABLE public.review_error_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- SEAM event_id (H6)
  session_item_id   uuid REFERENCES public.review_session_items(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.profiles(id),
  question_id       text NOT NULL REFERENCES public.questions(id),  -- TEXT canonical SAT id (@adaptation A)
  selected_answer   text,
  is_correct        boolean NOT NULL,                            -- SEAM correct (fires on correct AND incorrect, H7)
  seconds_spent     int,
  client_attempt_id text,                                        -- idempotency key (parity with practice; INV-02B-02)
  used_tutor        boolean NOT NULL DEFAULT false,              -- TELEMETRY-ONLY, never formula-facing (§16 line 784, CR-02B-16; G2)

  -- SEAM read-contract columns (contract §2 R1) — denormalized at write, NOT NULL on every row
  section           text NOT NULL CHECK (section IN ('M','RW')),
  domain            text NOT NULL,
  skill             text NOT NULL,                               -- skill_codes[1] (SP-17)
  difficulty        smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 3),  -- canonical 1-3 (seam R3)
  occurred_at       timestamptz NOT NULL DEFAULT now()           -- mastery event time
);
CREATE INDEX idx_review_attempts_item    ON public.review_error_attempts (session_item_id);
CREATE INDEX idx_review_attempts_student ON public.review_error_attempts (student_id, occurred_at DESC);
-- Idempotency (INV-02B-02 / seam R2): per (student, client_attempt_id), partial.
CREATE UNIQUE INDEX uq_review_attempts_idem
  ON public.review_error_attempts (student_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL;

-- @spec [Doc-02B_V4 §16 Review Schedule Table, line 750-760; CR-02B-23] review_schedule —
--   per-(profile, question) SM-2 state persisting beyond any session. Lifecycle: active ->
--   graduated | retired. SINGLE CANONICAL WRITER: review-session-routes.ts.
--   NO HARDCODED SM-2 CONSTANTS (INV-02B-15 / seam G4): ease_factor has NO numeric DEFAULT — the
--   engine (B-WS2-2) sets it from review_runtime_config.sm2_initial_ease_factor at insert.
--   interval_days/repetition_count default 0 (structural zero — the pre-first-success state — not a
--   tuned constant; the first-success interval comes from sm2_initial_interval_days at runtime).
CREATE TABLE public.review_schedule (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               uuid NOT NULL REFERENCES public.profiles(id),
  question_id              text NOT NULL REFERENCES public.questions(id),  -- TEXT canonical SAT id (@adaptation A)
  repetition_count         int NOT NULL DEFAULT 0,                          -- §16 line 741 (structural zero)
  interval_days            int NOT NULL DEFAULT 0,                          -- §16 line 742 (structural zero)
  ease_factor              numeric NOT NULL,                                -- §16 line 743: NO default; from sm2_initial_ease_factor
  next_review_at           timestamptz,                                     -- §16 line 744
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','graduated','retired')), -- §16 line 759 lifecycle
  first_missed_session_id  uuid,                                            -- §16 line 760: first-missed context
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_review_schedule_profile_question UNIQUE (student_id, question_id)  -- per-(profile,question)
);
CREATE INDEX idx_review_schedule_due ON public.review_schedule (student_id, next_review_at) WHERE status = 'active';

-- ============================================================================
-- 3. RLS — every new table ENABLE ROW LEVEL SECURITY (deny-all baseline; INV-02B-01/06; seam G1/G3)
-- ============================================================================
ALTER TABLE public.practice_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_session_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_error_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_schedule        ENABLE ROW LEVEL SECURITY;

-- Student own-row read (server-authoritative; writes never trusted from client).
-- practice keyed on user_id; review keyed on student_id.
CREATE POLICY practice_sessions_select_self      ON public.practice_sessions      FOR SELECT TO authenticated USING (user_id   = auth.uid());
CREATE POLICY practice_session_items_select_self ON public.practice_session_items FOR SELECT TO authenticated USING (user_id   = auth.uid());
CREATE POLICY review_sessions_select_self        ON public.review_sessions        FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY review_session_items_select_self   ON public.review_session_items   FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY review_error_attempts_select_self  ON public.review_error_attempts  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY review_schedule_select_self        ON public.review_schedule        FOR SELECT TO authenticated USING (student_id = auth.uid());

-- ============================================================================
-- 4. GRANTS — service_role owns ALL writes (single canonical writer runs as service_role).
--    Students get NO write grant; reads are anti-leak-restricted on the snapshot tables.
-- ============================================================================
-- Defense-in-depth (parity with the mastery tables' §7.4 treatment): REVOKE the implicit PUBLIC
-- privileges first, then grant only explicit roles. Keeps the lockdown posture uniform across the
-- runtime + mastery schema so no table relies on Postgres PUBLIC defaults. LYCEON-MIGRATION-REVIEWED
REVOKE ALL ON
  public.practice_sessions, public.practice_session_items,
  public.review_sessions, public.review_session_items,
  public.review_error_attempts, public.review_schedule
  FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.practice_sessions, public.practice_session_items,
  public.review_sessions, public.review_session_items,
  public.review_error_attempts, public.review_schedule
  TO service_role;

-- Envelope + schedule tables: full-row SELECT to authenticated is safe (no answer/explanation columns).
-- RLS (own-row policies above) limits which rows; the grant limits which columns.
GRANT SELECT ON public.practice_sessions  TO authenticated;
GRANT SELECT ON public.review_sessions    TO authenticated;
GRANT SELECT ON public.review_schedule    TO authenticated;

-- ANTI-LEAK column-level GRANT (defense-in-depth, mirrors genesis questions posture A4 / §20 / INV-02B-01):
--   on the SNAPSHOT tables, authenticated SELECT is restricted to student-safe columns and EXCLUDES
--   question_correct_answer, question_explanation, question_option_metadata. These are pre-submit-internal;
--   the route projects the post-submit reveal (B-WS2-2). A NULL/absent column-grant on the answer columns
--   means even with the own-row RLS policy, `authenticated` cannot SELECT them — the schema-level gate.
GRANT SELECT (
  id, session_id, user_id, ordinal, question_id,
  question_stem, question_passage, question_options,
  question_domain, question_skill, question_difficulty, question_section,
  status, selected_answer, is_correct, outcome, time_spent_ms, client_attempt_id,
  answered_at, served_at, occurred_at
) ON public.practice_session_items TO authenticated;

GRANT SELECT (
  id, session_id, student_id, ordinal, question_id,
  question_stem, question_passage, question_options,
  question_domain, question_skill, question_difficulty, question_section,
  retry_mode, status, served_at, answered_at, created_at
) ON public.review_session_items TO authenticated;

-- review_error_attempts: per-attempt outcomes. The student-safe outcome columns are grantable; there is
-- no answer/explanation column on this table (it carries no question snapshot), so a full-row SELECT
-- exposes no reveal-matrix content. Grant the explicit column set for parity / future-proofing.
GRANT SELECT (
  id, session_item_id, student_id, question_id, selected_answer, is_correct,
  seconds_spent, client_attempt_id, used_tutor, section, domain, skill, difficulty, occurred_at
) ON public.review_error_attempts TO authenticated;

COMMIT;
