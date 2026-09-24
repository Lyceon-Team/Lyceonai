-- ============================================================================
-- E4 — Full-length scoring engine: score_runs, ledger, comparator, formula,
--      section scorer, orchestrator (Doc 04B V4.3 §9-§12)
-- ============================================================================
-- @spec [Doc-04B_V4.3, §5.16 (insert-once), §5.17 (ledger idempotency), §6.1-
--        §6.4 (the locked v1.0 formula), §9.1 (score_runs), §9.2 (ledger),
--        §9.4 (three-layer insert-once), §10.1 (comparator, as amended by
--        SCL-122), §11.1-§11.2 (section scorer, difficulty per the owner
--        ruling 2026-09-24 and SCL-128), §12.1 (orchestrator + version gate),
--        §12.3 (constants snapshot), §15.2 (partial scoring), §16 (no mastery
--        emission), §19.1-§19.7 (failure modes), §20.1 (structured log)]
--       [Doc-02A INV-02A-05 (difficulty ∈ {1,2,3}: 1 = easy, 2 = medium,
--        3 = hard)]
-- @implemented [2026-09-24]
--
-- plain English: builds the canonical scoring path. The exam consumer calls
--   score_test_session_from_outbox(outbox_event_id); it checks the ledger
--   (a replayed event returns the existing score_run_id, no second row, no
--   error), refuses to score against a version that is not attested (§12.1 /
--   §19.6), scores every section whose state is 'submitted' through
--   compute_section_scaled_score() — which counts presented items from
--   test_form_items LEFT JOIN test_session_answers (a blank is wrong) and
--   hands the counts to the pure §6 formula — and inserts exactly one
--   score_runs row plus one ledger row in the caller's transaction.
--
-- expected outcome: after apply, scoring works for any form bound to an
--   active or superseded, fully attested version. v1.0 is still 'candidate'
--   at this point in the pipeline; 20260930050000_activate_scoring_v1.sql
--   activates it. Until then every scoring call raises 23000 (intended).
--
-- ---------------------------------------------------------------------------
-- DEVIATIONS FROM THE SPEC DDL (each in the PR decision log; spec not edited)
-- ---------------------------------------------------------------------------
--  D1 difficulty (OWNER RULING 2026-09-24; SCL-121 for §13, SCL-128 for §11):
--     §11.2 compares questions.difficulty to 'easy'/'medium'/'hard'. The bank
--     stores INTEGER 1/2/3 (genesis questions_difficulty_check; Doc 02A
--     INV-02A-05). Verified on PG16: `integer = 'easy'` is a parse-time 22P02,
--     so the verbatim §11.2 body RAISES on every scoring call. Here 1 = easy,
--     2 = medium, 3 = hard. Schema adaptation (§23.2), not a formula change.
--  D2 comparator (OWNER RULING 2026-09-24; SCL-122): questions.item_type with
--     'mcq' / 'grid_in' replaces question_type / 'multiple_choice' /
--     'student_produced_response'.
--  D3 the §6 arithmetic is factored out of compute_section_scaled_score into
--     compute_scaled_score_from_counts(), which the section scorer calls. The
--     §11.1 signature of compute_section_scaled_score is unchanged; the extra
--     function exists so the parity gate can drive all 1,373 reference
--     scenarios without building 1,373 sessions (it ALSO builds them — see
--     scripts/ci/scoring-parity.sh).
--  D4 round-half-up adds c_round/2, not the literal 5 of §6.3/§11.2, so the
--     formula body carries no numeric literal (scripts/ci/
--     no-hardcoded-constants.mjs). For v1.0 (round_to_nearest = 10) the value
--     added is 5.0 exactly; output is bit-identical (parity gate).
--  D5 score_runs.test_session_id ON DELETE CASCADE; student_id REFERENCES
--     profiles(id) ON DELETE CASCADE; ledger.score_run_id ON DELETE CASCADE
--     (spec: no FK on student_id, NO ACTION elsewhere). Follows SCL-124's
--     "deleted with the account"; the §9.4 trigger permits exactly that
--     cascade (D6). Recorded as SCL-129.
--  D6 prevent_score_runs_mutation() lets a DELETE through only when the row's
--     test_sessions or profiles parent no longer exists (i.e. the delete IS
--     the account-deletion cascade). Every other DELETE and every UPDATE
--     raises the §9.4 message. SECURITY DEFINER (owner = table owner) so the
--     parent-existence probe cannot be fooled by RLS hiding the parent.
--  D7 lyceon_scoring_owner is not BYPASSRLS, so it gets explicit per-table
--     policies: SELECT (USING true) on the nine tables it reads, INSERT/SELECT
--     on score_runs and the ledger. Column-level SELECT grants limit what it
--     can read to the columns the scoring path uses.
--  D8 §9.5's student read policy is NOT created: current_student_id() does not
--     exist (gate G-EX-01, as E3). No SELECT for anon/authenticated at all;
--     service_role (BYPASSRLS in Supabase) gets SELECT for the API.
--  D9 score_runs_admin_recompute (§9.3) is NOT created: it has no writer, and
--     its RLS policy calls is_admin(), which does not exist (§22.1).
--  D10 orchestrator: raises when the outbox event's session is missing
--     (§21.1 "Outbox event for missing session: raises") instead of failing
--     on the NOT NULL; the version gate also requires validation_packet_url
--     (§19.6 lists it; §12.1's query omits it); emits the §20.1 structured
--     log via RAISE LOG; calls emit_score_run_side_effects() (E9 seam, no-op).
--  D11 scoring_constants gains two CHECKs (owner-accepted hardening, BEFORE
--     activation — the seal makes it impossible after): value finite (numeric
--     admits NaN and, on PG14+, ±Infinity; NaN >= 0 is TRUE) and key charset
--     ^[a-z0-9_]+$ (scoring_constants_sha256 joins fields with '|' and LF).
--     All 13 v1.0 rows satisfy both (ALTER ... ADD CONSTRAINT validates them).
--  D12 idx_score_run_event_ledger_run (score_run_id) is added: the D5 cascade
--     from score_runs looks ledger rows up by score_run_id.
--
-- trade-offs / edge cases:
--  * Superseded versions SCORE (§12.1, §19.6 "explicitly allowed" — historical
--    reproducibility). Only candidate / missing / partially attested versions
--    are blocked.
--  * A second, DIFFERENT outbox event for an already-scored session raises
--    23505 on score_runs_test_session_id_key (the spec keys idempotency on
--    outbox_event_id, §9.2/§12.1); a replay of the SAME event is a no-op.
--  * Floor selection uses r1 >= routing threshold (§6.1 / §11.2), not the
--    recorded module2_path (which only selects the M2 item set).
--  * Constants are read through scoring_constant() (13 reads per section, as
--    §11.2). §21.1's "< 20 constant reads per run" cannot hold for a two-
--    section run under §11.2's own body (26); not optimised here.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
--   Genesis-extending; genesis-fresh-apply covers it. NOT APPLIED TO PROD BY
--   THIS CHANGE. Requires the migrating role to hold CREATEROLE (it creates
--   lyceon_scoring_owner) — verified by the owner for production `postgres`.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Additive. Exact inverse:
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP FUNCTION public.score_test_session_from_outbox(uuid);
--   DROP FUNCTION public.emit_score_run_side_effects(uuid);
--   DROP FUNCTION public.scoring_constants_snapshot_jsonb(text);
--   DROP FUNCTION public.compute_section_scaled_score(uuid, text);
--   DROP FUNCTION public.compute_scaled_score_from_counts(text, int, int, int, int, int, int, int, int);
--   DROP FUNCTION public.is_answer_correct(text, text);
--   DROP TABLE public.score_run_event_ledger;
--   DROP TABLE public.score_runs;
--   DROP FUNCTION public.prevent_score_runs_mutation();
--   DROP POLICY <table>_scoring_owner_read ON <each of the nine read tables>;
--   REVOKE ALL ON <the nine read tables> FROM lyceon_scoring_owner;
--   REVOKE EXECUTE ON FUNCTION public.scoring_constant(text, text, text) FROM lyceon_scoring_owner;
--   REVOKE USAGE, CREATE ON SCHEMA public FROM lyceon_scoring_owner;
--   ALTER TABLE public.scoring_constants DROP CONSTRAINT scoring_constants_value_finite,
--     DROP CONSTRAINT scoring_constants_key_charset;
--   (the role is cluster-global; DROP ROLE lyceon_scoring_owner only once no
--    database in the cluster references it)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- D11 — scoring_constants hardening (before v1.0 is sealed by activation).
-- ---------------------------------------------------------------------------
ALTER TABLE public.scoring_constants
  ADD CONSTRAINT scoring_constants_value_finite
    CHECK (value <> 'NaN'::numeric AND value < 'Infinity'::numeric),
  ADD CONSTRAINT scoring_constants_key_charset
    CHECK (key ~ '^[a-z0-9_]+$');

-- ---------------------------------------------------------------------------
-- §11.1 — dedicated owner role for the SECURITY DEFINER scoring functions.
-- Roles are cluster-global: guarded so a second database in the same cluster
-- (genesis-fresh-apply builds two) does not collide.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lyceon_scoring_owner') THEN
    CREATE ROLE lyceon_scoring_owner NOLOGIN;
  END IF;
END
$$;

-- PG16+: ALTER ... OWNER TO a role requires SET on it (a CREATEROLE creator
-- gets ADMIN, not SET). INHERIT stays default so the migrating role can
-- CREATE OR REPLACE / ALTER these functions in later migrations.
GRANT lyceon_scoring_owner TO CURRENT_USER WITH SET TRUE;
GRANT USAGE, CREATE ON SCHEMA public TO lyceon_scoring_owner;

-- ---------------------------------------------------------------------------
-- §9.1 — score_runs (spec columns verbatim; D5 FK actions)
-- ---------------------------------------------------------------------------
CREATE TABLE public.score_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id          uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,  -- D5
  student_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,       -- D5; denormalized from test_sessions for index efficiency
  test_form_id             uuid NOT NULL REFERENCES public.test_forms(id),
  scoring_model_version    text NOT NULL REFERENCES public.scoring_model_versions(version),

  -- Outbox event that triggered this scoring (idempotency anchor)
  source_outbox_event_id   uuid NOT NULL REFERENCES public.exam_runtime_outbox(id),
  source_event_type        text NOT NULL CHECK (source_event_type IN (
    'test_session_completed',
    'test_session_partial_scored_abandoned'
  )),

  -- Reading & Writing (nullable for partial-scored sessions where RW was not submitted)
  rw_scored                boolean NOT NULL,
  rw_module1_correct       int NULL,
  rw_module2_correct       int NULL,
  rw_module2_path          text NULL CHECK (rw_module2_path IS NULL OR rw_module2_path IN ('A','B')),
  rw_m2_easy_wrong         int NULL,
  rw_m2_medium_wrong       int NULL,
  rw_m2_hard_wrong         int NULL,
  rw_ceiling               numeric NULL,
  rw_deduction             numeric NULL,
  rw_raw_floor             numeric NULL,
  rw_path_floor            numeric NULL,
  rw_effective_floor       numeric NULL,
  rw_s_raw                 numeric NULL,
  rw_scaled                int NULL CHECK (rw_scaled IS NULL OR (rw_scaled BETWEEN 200 AND 800 AND rw_scaled % 10 = 0)),

  -- Math (nullable for partial-scored sessions where Math was not submitted)
  math_scored              boolean NOT NULL,
  math_module1_correct     int NULL,
  math_module2_correct     int NULL,
  math_module2_path        text NULL CHECK (math_module2_path IS NULL OR math_module2_path IN ('A','B')),
  math_m2_easy_wrong       int NULL,
  math_m2_medium_wrong     int NULL,
  math_m2_hard_wrong       int NULL,
  math_ceiling             numeric NULL,
  math_deduction           numeric NULL,
  math_raw_floor           numeric NULL,
  math_path_floor          numeric NULL,
  math_effective_floor     numeric NULL,
  math_s_raw               numeric NULL,
  math_scaled              int NULL CHECK (math_scaled IS NULL OR (math_scaled BETWEEN 200 AND 800 AND math_scaled % 10 = 0)),

  -- Total scaled score: ONLY populated when both sections are scored (§9.1, §15.2).
  total_scaled             int NULL CHECK (total_scaled IS NULL OR (total_scaled BETWEEN 400 AND 1600 AND total_scaled % 10 = 0)),
  partial_display_scaled   int NULL CHECK (partial_display_scaled IS NULL OR (partial_display_scaled BETWEEN 200 AND 800 AND partial_display_scaled % 10 = 0)),

  -- Defense-in-depth snapshot
  constants_snapshot       jsonb NOT NULL,

  -- Audit
  computed_at              timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  UNIQUE (test_session_id),
  CHECK (rw_scored OR math_scored),
  CHECK (
    (rw_scored AND rw_scaled IS NOT NULL AND rw_module1_correct IS NOT NULL)
    OR (NOT rw_scored AND rw_scaled IS NULL AND rw_module1_correct IS NULL)
  ),
  CHECK (
    (math_scored AND math_scaled IS NOT NULL AND math_module1_correct IS NOT NULL)
    OR (NOT math_scored AND math_scaled IS NULL AND math_module1_correct IS NULL)
  ),
  CHECK (
    (rw_scored AND math_scored
       AND total_scaled = rw_scaled + math_scaled
       AND partial_display_scaled IS NULL)
    OR
    (rw_scored AND NOT math_scored
       AND total_scaled IS NULL
       AND partial_display_scaled = rw_scaled)
    OR
    (math_scored AND NOT rw_scored
       AND total_scaled IS NULL
       AND partial_display_scaled = math_scaled)
  )
);

CREATE INDEX idx_score_runs_student ON public.score_runs (student_id, computed_at DESC);
CREATE INDEX idx_score_runs_form ON public.score_runs (test_form_id, computed_at DESC);
CREATE INDEX idx_score_runs_event ON public.score_runs (source_outbox_event_id);

-- ---------------------------------------------------------------------------
-- §9.2 — score_run_event_ledger (D5 on score_run_id; D12 index)
-- ---------------------------------------------------------------------------
CREATE TABLE public.score_run_event_ledger (
  outbox_event_id   uuid PRIMARY KEY REFERENCES public.exam_runtime_outbox(id),
  score_run_id      uuid NOT NULL REFERENCES public.score_runs(id) ON DELETE CASCADE,  -- D5
  test_session_id   uuid NOT NULL,
  processed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_score_run_event_ledger_session ON public.score_run_event_ledger (test_session_id);
CREATE INDEX idx_score_run_event_ledger_run ON public.score_run_event_ledger (score_run_id);  -- D12

-- ---------------------------------------------------------------------------
-- §9.4 Layer 2 — insert-once trigger (message verbatim; D6 cascade carve-out)
-- @spec [Doc-04B_V4.3, §5.16, §9.4 Layer 2] | @implemented [2026-09-24]
-- plain English: any UPDATE of a score_runs row raises; any DELETE raises
--   unless the row's session or student profile is already gone in this
--   transaction — which is only true while the account-deletion cascade
--   (profiles -> test_sessions -> score_runs) is running.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.prevent_score_runs_mutation() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND (NOT EXISTS (SELECT 1 FROM test_sessions WHERE id = OLD.test_session_id)
          OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.student_id)) THEN
    RETURN OLD;  -- D6: the FK cascade of an account / session deletion
  END IF;
  RAISE EXCEPTION 'score_runs is insert-once. UPDATE and DELETE are forbidden. Use score_runs_admin_recompute for post-launch calibration audit.';
END;
$$;

CREATE TRIGGER trg_prevent_score_runs_update
  BEFORE UPDATE ON public.score_runs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_score_runs_mutation();

CREATE TRIGGER trg_prevent_score_runs_delete
  BEFORE DELETE ON public.score_runs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_score_runs_mutation();

-- ---------------------------------------------------------------------------
-- §10.1 as amended by SCL-122 — is_answer_correct
-- @spec [Doc-04B_V4.3, §5.7, §10.1-§10.4; SCL-122] | @implemented [2026-09-24]
-- plain English: true iff the submitted string equals the mcq letter, or is
--   one of the grid-in variants. NULL (blank) is false. A missing question
--   raises with its id only; the correct answer never leaves this body.
-- edge cases: item_type is CHECK-bound to mcq|grid_in and grid_in carries a
--   non-empty correct_variants (questions_item_shape_chk), so the "unknown
--   type" branch is unreachable; kept because §10.1 specifies it. COALESCE
--   pins the result to a boolean even on a hypothetical NULL variant array.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.is_answer_correct(
  p_submitted   text,
  p_question_id text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_type        text;
  v_correct_answer   text;
  v_correct_variants text[];
BEGIN
  -- p_submitted = NULL means no answer / blank; always false
  IF p_submitted IS NULL THEN
    RETURN false;
  END IF;

  SELECT item_type, correct_answer, correct_variants
    INTO v_item_type, v_correct_answer, v_correct_variants
  FROM questions
  WHERE id = p_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found: %', p_question_id;
  END IF;

  -- Multiple choice: exact letter match
  IF v_item_type = 'mcq' THEN
    RETURN COALESCE(p_submitted = v_correct_answer, false);
  END IF;

  -- Student-produced response: variant array match
  IF v_item_type = 'grid_in' THEN
    RETURN COALESCE(p_submitted = ANY(v_correct_variants), false);
  END IF;

  -- Unknown question type: explicitly false rather than ambiguous
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- §6.1 / §6.3 — the locked v1.0 formula over counts (D3, D4)
-- @spec [Doc-04B_V4.3, §6.1, §6.3, §6.4, §8.2, §11.2 "APPLY THE CANONICAL
--        FORMULA"] | @implemented [2026-09-24]
-- plain English: ceiling = max(C_floor, C_max·(r1/N1)^α); deductions =
--   D_e·n_e + D_m·n_m + D_h·n_h; raw floor = R_base + R_mult·(r1+r2)/N_total;
--   path floor = min(F_B_cap, F_B_base + F_B_bonus·(r1−T)) when r1 ≥ T, else
--   F_A; clamp to [max(floors), C_max]; round half up to R_round. Every
--   constant is read through scoring_constant() for p_version; the body has
--   no numeric literal.
-- edge cases: N1 or N_total of 0 raises (a section with no presented items is
--   a broken form, not a score). The statement order and numeric types match
--   §11.2 line for line, so the result is bit-identical to it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.compute_scaled_score_from_counts(
  p_version           text,
  p_r1                int,
  p_r2                int,
  p_m2_easy_wrong     int,
  p_m2_medium_wrong   int,
  p_m2_hard_wrong     int,
  p_n1                int,
  p_n_total           int,
  p_routing_threshold int
) RETURNS TABLE (
  scaled int, ceiling numeric, deduction numeric, raw_floor numeric,
  path_floor numeric, effective_floor numeric, s_raw numeric
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  c_alpha       numeric;
  c_ceil_floor  numeric;
  c_ceil_max    numeric;
  c_d_easy      numeric;
  c_d_med       numeric;
  c_d_hard      numeric;
  c_raw_base    numeric;
  c_raw_mult    numeric;
  c_path_a_fl   numeric;
  c_path_b_base numeric;
  c_path_b_bon  numeric;
  c_path_b_cap  numeric;
  c_round       int;

  v_ceiling      numeric;
  v_deduction    numeric;
  v_raw_floor    numeric;
  v_path_floor   numeric;
  v_floor        numeric;
  v_s_raw        numeric;
  v_s_clamped    numeric;
  v_scaled       int;
BEGIN
  IF p_n1 IS NULL OR p_n_total IS NULL OR p_n1 <= 0 OR p_n_total <= 0 THEN
    RAISE EXCEPTION 'compute_scaled_score_from_counts: presented item counts must be positive (N1=%, N_total=%)',
      p_n1, p_n_total;
  END IF;

  c_alpha       := scoring_constant(p_version, 'alpha_ceiling_exponent');
  c_ceil_floor  := scoring_constant(p_version, 'ceiling_floor');
  c_ceil_max    := scoring_constant(p_version, 'ceiling_max');
  c_d_easy      := scoring_constant(p_version, 'deduction_easy');
  c_d_med       := scoring_constant(p_version, 'deduction_medium');
  c_d_hard      := scoring_constant(p_version, 'deduction_hard');
  c_raw_base    := scoring_constant(p_version, 'raw_floor_base');
  c_raw_mult    := scoring_constant(p_version, 'raw_floor_multiplier');
  c_path_a_fl   := scoring_constant(p_version, 'path_a_floor');
  c_path_b_base := scoring_constant(p_version, 'path_b_floor_base');
  c_path_b_bon  := scoring_constant(p_version, 'path_b_floor_bonus_per_m1_point');
  c_path_b_cap  := scoring_constant(p_version, 'path_b_floor_cap');
  c_round       := scoring_constant(p_version, 'round_to_nearest')::int;

  v_ceiling := GREATEST(c_ceil_floor, c_ceil_max * (p_r1::numeric / p_n1) ^ c_alpha);
  v_deduction := c_d_easy * p_m2_easy_wrong + c_d_med * p_m2_medium_wrong + c_d_hard * p_m2_hard_wrong;
  v_raw_floor := c_raw_base + c_raw_mult * ((p_r1 + p_r2)::numeric / p_n_total);

  IF p_r1 >= p_routing_threshold THEN
    v_path_floor := LEAST(c_path_b_cap, c_path_b_base + c_path_b_bon * (p_r1 - p_routing_threshold));
  ELSE
    v_path_floor := c_path_a_fl;
  END IF;

  v_floor := GREATEST(v_raw_floor, v_path_floor);
  v_s_raw := v_ceiling - v_deduction;
  v_s_clamped := GREATEST(v_floor, LEAST(c_ceil_max, v_s_raw));

  -- §6.3 round half up to R_round. D4: half of R_round, not a literal.
  -- MUST match Python reference: int(math.floor((s_clamped + 5) / 10) * 10)
  v_scaled := (floor((v_s_clamped + c_round::numeric / 2) / c_round) * c_round)::int;

  scaled          := v_scaled;
  ceiling         := v_ceiling;
  deduction       := v_deduction;
  raw_floor       := v_raw_floor;
  path_floor      := v_path_floor;
  effective_floor := v_floor;
  s_raw           := v_s_raw;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- §11.1 / §11.2 — compute_section_scaled_score (D1 difficulty codes, D3)
-- @spec [Doc-04B_V4.3, §11.1, §11.2, §11.4, §14.4, §19.1, §19.2, §19.4;
--        owner ruling 2026-09-24; SCL-128] | @implemented [2026-09-24]
-- plain English: for one section of one session: the section must be
--   'submitted' with a locked module2_path; N1 and N_total are counted from
--   test_form_items (module '1' and the routed M2 module); r1, r2 and the M2
--   wrong counts by difficulty (1 easy, 2 medium, 3 hard) are counted with
--   test_form_items as the BASE and test_session_answers LEFT JOINed on
--   (session, section, module, ordinal, question_id) — so a blank or a row
--   for a different question is wrong, and an answer row for a slot that was
--   never presented (another M2 path, an ordinal the form does not have) is
--   never seen. The counts go to compute_scaled_score_from_counts().
-- edge cases: is_answer_correct() is evaluated once per presented item (the
--   §11.2 body evaluates it up to four times; the result is the same — it is
--   STABLE). A wrong item whose difficulty is outside {1,2,3} is in no bucket
--   and raises a WARNING (§19.4); the column CHECK makes that unreachable.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.compute_section_scaled_score(
  p_test_session_id  uuid,
  p_section          text
) RETURNS TABLE (
  scaled int, module1_correct int, module2_correct int, module2_path text,
  m2_easy_wrong int, m2_medium_wrong int, m2_hard_wrong int,
  ceiling numeric, deduction numeric, raw_floor numeric,
  path_floor numeric, effective_floor numeric, s_raw numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section_code        text;        -- 04A section code: 'RW' or 'M'
  v_m2_module           text;        -- '2A' or '2B' for the routed path
  v_test_form_id        uuid;
  v_score_table_version text;
  v_routing_threshold   int;
  v_n1                  int;
  v_n_total             int;
  v_module2_path        text;
  v_section_state       text;

  v_r1           int;
  v_r2           int;
  v_n_e_m2       int;
  v_n_m_m2       int;
  v_n_h_m2       int;
  v_n_unbucketed int;
  f              record;
BEGIN
  -- SECTION-CODE MAPPING (§11.2 / §11.4 — derived once, used everywhere)
  v_section_code := CASE
    WHEN p_section = 'rw'   THEN 'RW'
    WHEN p_section = 'math' THEN 'M'
    ELSE NULL
  END;
  IF v_section_code IS NULL THEN
    RAISE EXCEPTION 'Unknown section: %. Expected ''rw'' or ''math''.', p_section;
  END IF;

  -- LOAD FORM AND SECTION CONTEXT (from 04A's canonical schema)
  SELECT ts.test_form_id, tf.score_table_version,
         CASE WHEN p_section = 'rw' THEN tf.routing_threshold_rw
              ELSE tf.routing_threshold_m END
  INTO v_test_form_id, v_score_table_version, v_routing_threshold
  FROM test_sessions ts
  JOIN test_forms tf ON tf.id = ts.test_form_id
  WHERE ts.id = p_test_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session or form not found: session_id=%', p_test_session_id;
  END IF;

  SELECT tss.state, tss.module2_path
  INTO v_section_state, v_module2_path
  FROM test_session_sections tss
  WHERE tss.test_session_id = p_test_session_id
    AND tss.section = v_section_code;

  IF v_section_state IS NULL THEN
    RAISE EXCEPTION 'Section state not found: session=%, section=%',
                    p_test_session_id, p_section;
  END IF;

  -- Section must be in 'submitted' state to be scored (§19.1)
  IF v_section_state <> 'submitted' THEN
    RAISE EXCEPTION 'Section not scoreable: state=%, expected=submitted', v_section_state;
  END IF;

  -- module2_path MUST be locked at this point (04A invariant §2.3)
  IF v_module2_path IS NULL THEN
    RAISE EXCEPTION 'Module 2 path not locked for scoreable section';
  END IF;

  v_m2_module := '2' || v_module2_path;  -- '2A' or '2B'

  -- N1 and N_total from the canonical form items (the only source, SCL-127)
  SELECT
    COUNT(*) FILTER (WHERE i.module = '1'),
    COUNT(*)
  INTO v_n1, v_n_total
  FROM test_form_items i
  WHERE i.test_form_id = v_test_form_id
    AND i.section = v_section_code
    AND i.module IN ('1', v_m2_module);

  -- M1 CORRECT (LEFT JOIN from presented items — missing answers are wrong)
  SELECT COUNT(*) FILTER (WHERE is_answer_correct(a.answer, i.question_id))
  INTO v_r1
  FROM test_form_items i
  LEFT JOIN test_session_answers a
    ON a.test_session_id = p_test_session_id
   AND a.section         = i.section
   AND a.module          = i.module
   AND a.ordinal         = i.ordinal
   AND a.question_id     = i.question_id
  WHERE i.test_form_id = v_test_form_id
    AND i.section      = v_section_code
    AND i.module       = '1';

  -- M2 CORRECT AND M2 WRONG BY DIFFICULTY (routed path only; LEFT JOIN).
  -- D1 (owner ruling 2026-09-24, Doc 02A INV-02A-05): 1 = easy, 2 = medium, 3 = hard.
  SELECT
    COUNT(*) FILTER (WHERE c.is_correct),
    COUNT(*) FILTER (WHERE NOT c.is_correct AND c.difficulty = 1),
    COUNT(*) FILTER (WHERE NOT c.is_correct AND c.difficulty = 2),
    COUNT(*) FILTER (WHERE NOT c.is_correct AND c.difficulty = 3),
    COUNT(*) FILTER (WHERE NOT c.is_correct AND c.difficulty IS DISTINCT FROM 1
                                            AND c.difficulty IS DISTINCT FROM 2
                                            AND c.difficulty IS DISTINCT FROM 3)
  INTO v_r2, v_n_e_m2, v_n_m_m2, v_n_h_m2, v_n_unbucketed
  FROM (
    SELECT q.difficulty, is_answer_correct(a.answer, i.question_id) AS is_correct
    FROM test_form_items i
    JOIN questions q ON q.id = i.question_id
    LEFT JOIN test_session_answers a
      ON a.test_session_id = p_test_session_id
     AND a.section         = i.section
     AND a.module          = i.module
     AND a.ordinal         = i.ordinal
     AND a.question_id     = i.question_id
    WHERE i.test_form_id = v_test_form_id
      AND i.section      = v_section_code
      AND i.module       = v_m2_module
  ) c;

  IF v_n_unbucketed > 0 THEN
    RAISE WARNING 'compute_section_scaled_score: % wrong M2 item(s) with a difficulty outside the bucket codes (session=%, section=%)',
      v_n_unbucketed, p_test_session_id, p_section;
  END IF;

  -- APPLY THE CANONICAL FORMULA (locked v1.0) — D3
  SELECT * INTO f
  FROM compute_scaled_score_from_counts(
    v_score_table_version, v_r1, v_r2, v_n_e_m2, v_n_m_m2, v_n_h_m2,
    v_n1, v_n_total, v_routing_threshold);

  scaled          := f.scaled;
  module1_correct := v_r1;
  module2_correct := v_r2;
  module2_path    := v_module2_path;
  m2_easy_wrong   := v_n_e_m2;
  m2_medium_wrong := v_n_m_m2;
  m2_hard_wrong   := v_n_h_m2;
  ceiling         := f.ceiling;
  deduction       := f.deduction;
  raw_floor       := f.raw_floor;
  path_floor      := f.path_floor;
  effective_floor := f.effective_floor;
  s_raw           := f.s_raw;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- §12.3 — scoring_constants_snapshot_jsonb (verbatim)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.scoring_constants_snapshot_jsonb(p_version text)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE SQL STABLE
AS $$
  SELECT jsonb_object_agg(
    key || COALESCE(':' || section, ''),
    value
  )
  FROM scoring_constants
  WHERE scoring_model_version = p_version;
$$;

-- ---------------------------------------------------------------------------
-- E9 seam — emit_score_run_side_effects
-- @spec [Doc-04B_V4.3, §5.18, §12.2, §16.1 (no mastery emission)]
--       | @implemented [2026-09-24]
-- plain English: the single place the scoring transaction will fan out, once
--   E9 attaches consumers. Called exactly once per NEW score_runs row, after
--   the ledger insert, inside the orchestrator's transaction; never on an
--   idempotent replay. Today it only asserts the run exists: the transaction
--   commits exactly score_runs + score_run_event_ledger (§16.1).
-- edge cases / how E9 attaches: each future side effect is one numbered
--   block below, in this order, appended without restructuring the caller:
--     [1] projection_refresh_outbox insert  (E9)
--     [2] review-queue enqueue               (E9 — owner ruling 4 moves this
--         to the consumer worker, overriding §16's "exactly two artifacts";
--         if so, block [2] stays empty)
--     [3] mastery derivation                 (E9; Doc 05 owns the design)
--   No EXECUTE grant: only the orchestrator (same owner) calls it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.emit_score_run_side_effects(p_score_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM score_runs WHERE id = p_score_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'emit_score_run_side_effects: score_run % does not exist', p_score_run_id;
  END IF;

  -- [1] projection_refresh_outbox insert — E9. (none yet)
  -- [2] review-queue enqueue — E9 / owner ruling 4. (none yet)
  -- [3] mastery derivation — E9 / Doc 05. (none yet; §16.1)
END;
$$;

-- ---------------------------------------------------------------------------
-- §12.1 — score_test_session_from_outbox (orchestrator; D10)
-- @spec [Doc-04B_V4.3, §5.17, §12.1, §12.2, §14.3, §15.2, §19.6, §19.7,
--        §20.1] | @implemented [2026-09-24]
-- plain English: idempotent on outbox_event_id (ledger hit -> existing id,
--   no write); reads the event and its session; refuses to score unless the
--   form's version is active or superseded AND fully attested (23000); scores
--   each 'submitted' section; inserts one score_runs row (total for two
--   sections, partial_display for one) and one ledger row; calls the E9
--   side-effect seam; logs §20.1's structured line (UUIDs and scaled values
--   only — no answers, no constants).
-- edge cases: two workers racing on one event -> one wins, the other gets
--   23505 on score_runs_test_session_id_key and its retry finds the ledger
--   (§19.7). A second DIFFERENT event for an already-scored session also
--   raises 23505 (spec keys idempotency on the event, §9.2).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.score_test_session_from_outbox(
  p_outbox_event_id uuid
) RETURNS uuid
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at      timestamptz := clock_timestamp();
  v_event_type      text;
  v_test_session_id uuid;
  v_test_form_id    uuid;
  v_student_id      uuid;
  v_score_table_ver text;
  v_existing_run_id uuid;
  v_score_run_id    uuid;

  v_rw_present   boolean := false;
  v_math_present boolean := false;
  v_rw_row       record;
  v_math_row     record;
  v_total        int;
  v_partial_display int;
BEGIN
  -- IDEMPOTENCY CHECK (§5.17 — once, at the entrypoint)
  SELECT score_run_id INTO v_existing_run_id
  FROM score_run_event_ledger
  WHERE outbox_event_id = p_outbox_event_id;

  IF FOUND THEN
    RAISE LOG '%', jsonb_build_object(
      'event', 'scoring.session.scored',
      'score_run_id', v_existing_run_id,
      'source_outbox_event_id', p_outbox_event_id,
      'idempotent_return', true,
      'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000));
    RETURN v_existing_run_id;
  END IF;

  -- READ THE OUTBOX EVENT (04A wrote this; we consume it)
  SELECT event_type, aggregate_id
  INTO v_event_type, v_test_session_id
  FROM exam_runtime_outbox
  WHERE id = p_outbox_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox event not found: %', p_outbox_event_id;
  END IF;

  IF v_event_type NOT IN ('test_session_completed', 'test_session_partial_scored_abandoned') THEN
    RAISE EXCEPTION 'Outbox event type not handled by scoring: %', v_event_type;
  END IF;

  -- Read session metadata (D10: a missing session raises, §21.1)
  SELECT student_id, test_form_id
  INTO v_student_id, v_test_form_id
  FROM test_sessions
  WHERE id = v_test_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test session not found for outbox event %: session_id=%',
      p_outbox_event_id, v_test_session_id;
  END IF;

  SELECT score_table_version
  INTO v_score_table_ver
  FROM test_forms
  WHERE id = v_test_form_id;

  -- VERSION-VALIDATION GATE (§12.1, §19.6). Active and superseded score;
  -- candidate, missing or partially attested versions never do.
  PERFORM 1
  FROM scoring_model_versions
  WHERE version = v_score_table_ver
    AND status IN ('active', 'superseded')
    AND published_at IS NOT NULL
    AND constants_sha256 IS NOT NULL
    AND validation_packet_sha256 IS NOT NULL
    AND validation_packet_url IS NOT NULL;   -- D10: §19.6 lists the URL too

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Scoring blocked: scoring_model_version % is missing, candidate, or '
      'incompletely attested. score_runs MUST NOT be inserted for an '
      'unattested version. (Doc 04B V4.3 §12.1 + §19.6.)',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scoring_constants
    WHERE scoring_model_version = v_score_table_ver
  ) THEN
    RAISE EXCEPTION
      'Scoring blocked: no scoring_constants rows for version %',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- DETERMINE WHICH SECTIONS ARE SCOREABLE
  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'RW'
      AND state = 'submitted'
  ) INTO v_rw_present;

  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'M'
      AND state = 'submitted'
  ) INTO v_math_present;

  IF NOT v_rw_present AND NOT v_math_present THEN
    RAISE EXCEPTION 'No scoreable sections found for session %', v_test_session_id;
  END IF;

  -- COMPUTE PRESENT SECTIONS
  IF v_rw_present THEN
    SELECT * INTO v_rw_row
    FROM compute_section_scaled_score(v_test_session_id, 'rw');
  END IF;

  IF v_math_present THEN
    SELECT * INTO v_math_row
    FROM compute_section_scaled_score(v_test_session_id, 'math');
  END IF;

  -- TOTAL_SCALED / PARTIAL_DISPLAY_SCALED (§9.1, §15.2)
  IF v_rw_present AND v_math_present THEN
    v_total := v_rw_row.scaled + v_math_row.scaled;
    v_partial_display := NULL;
  ELSIF v_rw_present THEN
    v_total := NULL;
    v_partial_display := v_rw_row.scaled;
  ELSE
    v_total := NULL;
    v_partial_display := v_math_row.scaled;
  END IF;

  -- INSERT score_runs ROW (with ALL intermediate values)
  INSERT INTO score_runs (
    test_session_id, student_id, test_form_id, scoring_model_version,
    source_outbox_event_id, source_event_type,
    rw_scored, rw_module1_correct, rw_module2_correct, rw_module2_path,
    rw_m2_easy_wrong, rw_m2_medium_wrong, rw_m2_hard_wrong,
    rw_ceiling, rw_deduction, rw_raw_floor, rw_path_floor, rw_effective_floor,
    rw_s_raw, rw_scaled,
    math_scored, math_module1_correct, math_module2_correct, math_module2_path,
    math_m2_easy_wrong, math_m2_medium_wrong, math_m2_hard_wrong,
    math_ceiling, math_deduction, math_raw_floor, math_path_floor, math_effective_floor,
    math_s_raw, math_scaled,
    total_scaled, partial_display_scaled, constants_snapshot
  ) VALUES (
    v_test_session_id, v_student_id, v_test_form_id, v_score_table_ver,
    p_outbox_event_id, v_event_type,
    v_rw_present,
    CASE WHEN v_rw_present THEN v_rw_row.module1_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_path END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_easy_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_medium_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_hard_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.ceiling END,
    CASE WHEN v_rw_present THEN v_rw_row.deduction END,
    CASE WHEN v_rw_present THEN v_rw_row.raw_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.path_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.effective_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.s_raw END,
    CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    v_math_present,
    CASE WHEN v_math_present THEN v_math_row.module1_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_path END,
    CASE WHEN v_math_present THEN v_math_row.m2_easy_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_medium_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_hard_wrong END,
    CASE WHEN v_math_present THEN v_math_row.ceiling END,
    CASE WHEN v_math_present THEN v_math_row.deduction END,
    CASE WHEN v_math_present THEN v_math_row.raw_floor END,
    CASE WHEN v_math_present THEN v_math_row.path_floor END,
    CASE WHEN v_math_present THEN v_math_row.effective_floor END,
    CASE WHEN v_math_present THEN v_math_row.s_raw END,
    CASE WHEN v_math_present THEN v_math_row.scaled END,
    v_total, v_partial_display,
    scoring_constants_snapshot_jsonb(v_score_table_ver)
  ) RETURNING id INTO v_score_run_id;

  -- WRITE THE LEDGER ENTRY (idempotency anchor)
  INSERT INTO score_run_event_ledger (outbox_event_id, score_run_id, test_session_id)
  VALUES (p_outbox_event_id, v_score_run_id, v_test_session_id);

  -- E9 SEAM (no-op today; §16.1: no mastery emission from 04B)
  PERFORM emit_score_run_side_effects(v_score_run_id);

  -- §20.1 structured log — UUIDs and scaled values only (§20.4)
  RAISE LOG '%', jsonb_build_object(
    'event', 'scoring.session.scored',
    'score_run_id', v_score_run_id,
    'test_session_id', v_test_session_id,
    'student_id', v_student_id,
    'test_form_id', v_test_form_id,
    'scoring_model_version', v_score_table_ver,
    'source_outbox_event_id', p_outbox_event_id,
    'source_event_type', v_event_type,
    'rw_scored', v_rw_present,
    'math_scored', v_math_present,
    'rw_scaled', CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    'math_scaled', CASE WHEN v_math_present THEN v_math_row.scaled END,
    'total_scaled', v_total,
    'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000),
    'idempotent_return', false);

  RETURN v_score_run_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- §9.4 Layer 1 — privileges. §9.4 Layer 3 + D7/D8 — RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.score_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_run_event_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.score_runs             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.score_run_event_ledger FROM PUBLIC, anon, authenticated, service_role;
-- service_role reads (API / ops; BYPASSRLS in Supabase). No write for anyone
-- but the scoring owner, through the SECURITY DEFINER orchestrator.
GRANT SELECT ON TABLE public.score_runs             TO service_role;
GRANT SELECT ON TABLE public.score_run_event_ledger TO service_role;
GRANT SELECT, INSERT ON TABLE public.score_runs             TO lyceon_scoring_owner;
GRANT SELECT, INSERT ON TABLE public.score_run_event_ledger TO lyceon_scoring_owner;

-- Layer 3 (§9.4, verbatim) + the scoring owner's write/read path (D7).
CREATE POLICY score_runs_no_update ON public.score_runs FOR UPDATE USING (false);
CREATE POLICY score_runs_no_delete ON public.score_runs FOR DELETE USING (false);
CREATE POLICY score_runs_scoring_owner_insert ON public.score_runs
  FOR INSERT TO lyceon_scoring_owner WITH CHECK (true);
CREATE POLICY score_runs_scoring_owner_select ON public.score_runs
  FOR SELECT TO lyceon_scoring_owner USING (true);

CREATE POLICY score_run_event_ledger_internal ON public.score_run_event_ledger FOR ALL USING (false);
CREATE POLICY score_run_event_ledger_scoring_owner_insert ON public.score_run_event_ledger
  FOR INSERT TO lyceon_scoring_owner WITH CHECK (true);
CREATE POLICY score_run_event_ledger_scoring_owner_select ON public.score_run_event_ledger
  FOR SELECT TO lyceon_scoring_owner USING (true);

-- §11.1 — the owner's read set, column-scoped (D7). RLS is on for all nine,
-- so each also needs a SELECT policy for this one role.
GRANT SELECT (id, difficulty, item_type, correct_answer, correct_variants)
  ON TABLE public.questions TO lyceon_scoring_owner;
GRANT SELECT (id, score_table_version, routing_threshold_rw, routing_threshold_m)
  ON TABLE public.test_forms TO lyceon_scoring_owner;
GRANT SELECT (test_form_id, section, module, ordinal, question_id)
  ON TABLE public.test_form_items TO lyceon_scoring_owner;
GRANT SELECT (id, student_id, test_form_id)
  ON TABLE public.test_sessions TO lyceon_scoring_owner;
GRANT SELECT (test_session_id, section, state, module2_path)
  ON TABLE public.test_session_sections TO lyceon_scoring_owner;
GRANT SELECT (test_session_id, section, module, ordinal, question_id, answer)
  ON TABLE public.test_session_answers TO lyceon_scoring_owner;
GRANT SELECT (id, event_type, aggregate_id)
  ON TABLE public.exam_runtime_outbox TO lyceon_scoring_owner;
GRANT SELECT (version, status, published_at, constants_sha256, validation_packet_sha256, validation_packet_url)
  ON TABLE public.scoring_model_versions TO lyceon_scoring_owner;
GRANT SELECT (scoring_model_version, key, section, value)
  ON TABLE public.scoring_constants TO lyceon_scoring_owner;

CREATE POLICY questions_scoring_owner_read ON public.questions
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY test_forms_scoring_owner_read ON public.test_forms
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY test_form_items_scoring_owner_read ON public.test_form_items
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY test_sessions_scoring_owner_read ON public.test_sessions
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY test_session_sections_scoring_owner_read ON public.test_session_sections
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY test_session_answers_scoring_owner_read ON public.test_session_answers
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY exam_runtime_outbox_scoring_owner_read ON public.exam_runtime_outbox
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY scoring_model_versions_scoring_owner_read ON public.scoring_model_versions
  FOR SELECT TO lyceon_scoring_owner USING (true);
CREATE POLICY scoring_constants_scoring_owner_read ON public.scoring_constants
  FOR SELECT TO lyceon_scoring_owner USING (true);

-- scoring_constant() is E2's SECURITY DEFINER helper (owner = migrating role).
GRANT EXECUTE ON FUNCTION public.scoring_constant(text, text, text) TO lyceon_scoring_owner;

-- ---------------------------------------------------------------------------
-- Function privileges (§9.4): EXECUTE to service_role only on the callable
-- scoring surface; nothing for PUBLIC / anon / authenticated anywhere.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.prevent_score_runs_mutation()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_answer_correct(text, text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_scaled_score_from_counts(text, int, int, int, int, int, int, int, int)
                                                                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_section_scaled_score(uuid, text)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scoring_constants_snapshot_jsonb(text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_score_run_side_effects(uuid)            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.score_test_session_from_outbox(uuid)         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_answer_correct(text, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_scaled_score_from_counts(text, int, int, int, int, int, int, int, int)
                                                                           TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_section_scaled_score(uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.scoring_constants_snapshot_jsonb(text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.score_test_session_from_outbox(uuid)      TO service_role;

-- §11.1 / §12.1 ownership: the scoring functions run as lyceon_scoring_owner.
-- (prevent_score_runs_mutation stays with the table owner — D6.)
ALTER FUNCTION public.is_answer_correct(text, text)                         OWNER TO lyceon_scoring_owner;
ALTER FUNCTION public.compute_scaled_score_from_counts(text, int, int, int, int, int, int, int, int)
                                                                            OWNER TO lyceon_scoring_owner;
ALTER FUNCTION public.compute_section_scaled_score(uuid, text)              OWNER TO lyceon_scoring_owner;
ALTER FUNCTION public.scoring_constants_snapshot_jsonb(text)                OWNER TO lyceon_scoring_owner;
ALTER FUNCTION public.emit_score_run_side_effects(uuid)                     OWNER TO lyceon_scoring_owner;
ALTER FUNCTION public.score_test_session_from_outbox(uuid)                  OWNER TO lyceon_scoring_owner;

COMMIT;
