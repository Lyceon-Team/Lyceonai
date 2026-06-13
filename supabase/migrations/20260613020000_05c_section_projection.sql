-- ============================================================================
-- 05C — Score Projections & Snapshots (Doc 05C V1.0 LOCKED) — STATE A ONLY
--       compute_section_projection (State A) + projection constants + reader +
--       canonical serializer + round_to_step + projection tables + snapshots +
--       refresh-state + outbox + bump_projection_refresh_counter
-- ============================================================================
-- @spec [Doc-05C_V1 §2 (doctrine) / §3 (INV-05C-A1/A2/13/14/15/16/17) / §4 (projection
--   constants + §4.2 weights + §4.3 8-domain set) / §5 (compute_section_projection RPC) /
--   §6 (formula + §6.7 worked examples, esp. Example 2 State A Math 480 (380-580)) /
--   §7 (table schemas + §7.7 refresh-state + outbox) / §8 (throttle + bump fn) /
--   §9 (read_projection_constants + canonicalize_projection_constants_serialized)]
--   [Doc-05 Parent §4.2/§6/§10.2/§11.1] [contract ws3-05b-05c §D/§E/§G3]
-- @implemented [2026-06-13]
-- plain English: the projection tier of the spine apply_mastery_event -> skill -> domain ->
--   KPI -> PROJECTION. compute_section_projection maps 05B domain mastery onto the legal SAT
--   section scale (200..800), wraps it in an evidence-driven confidence band, upserts one
--   current row per (student, section) and appends an immutable snapshot — the projection audit
--   trail (Q6, INV-05C-17). STATE A ONLY this wave (HALT-1): blend_denominator=1, the mastery
--   term alone — there are NO full-lengths pre-WS-4, so the §5.7 04B blend (States B/C) is a
--   NAMED forward-ref comment and reads no test/full-length table. The §4.9 wiring of
--   bump_projection_refresh_counter into apply_mastery_event is Milestone 3 (main thread); this
--   migration BUILDS the 05C functions + the 05C-owned counter table + the increment fn that M3
--   will call. All projection constants are OPERATIONAL: seeded into mastery_constants, read via
--   read_projection_constants(), and EXCLUDED from canonicalize_mastery_constants's hash list
--   (INV-05C-16) — no numeric literals in compute_section_projection's body.
--
-- @adaptation HALT-1 / STATE-A-ONLY (contract §D): the §5.7 full-length blend (States B/C) reads
--   the 04B completed-full-length section-score surface, which Doc 05C §5.7 / §11.C mark
--   BLOCKING_UPSTREAM_GAP — 04B object unnamed (WS-4). State A has NO 04B dependency
--   (blend_denominator=1, fl1/fl2 = NULL, fl_count_used=0). This migration therefore does NOT
--   read any full_length_section_scores object (it does not exist) — the States-B/C terms are a
--   named deploy-gated forward-ref comment in compute_section_projection's body. The blend
--   numerator ALWAYS seeds with v_mastery_term (INV-05C-13), so adding the FL terms in WS-4 is
--   purely additive (denominator 1 -> 2 -> 3) with no body restructure.
--
-- @adaptation GUARDIAN-RLS: Doc 05C §7.4 references guardian_student_links(guardian_id,
--   linked_student_id, link_active) + student_entitlements(student_id, active); the genesis
--   identity model (Doc 01 V8) names guardian_links(guardian_profile_id, student_profile_id,
--   status='active') + entitlements(profile_id, status = 'active'). NARROWED to active-only (spec §5.3 active=true; safer guardian posture; past_due grace excluded — owner may widen). LYCEON-MIGRATION-REVIEWED. The guardian
--   read predicate is reconciled to those tables BYTE-IDENTICALLY to 05B's
--   student_domain_mastery_guardian_read (20260613010000), preserving Parent §11.1 semantics:
--   active link AND active student entitlement. auth.uid() = the guardian profile id. This is the
--   "one guardian-gate pattern across the entire 05 family" §7.4 requires.
--
-- @adaptation ADMIN-ROLE: Doc 05C §7.5 names admin_role for the GRANT SELECT (all columns) admin
--   read; the genesis 3-role model (anon/authenticated/service_role) treats admin as a PROFILE
--   role and routes admin/internal DB reads via service_role (same SP-20 ruling as 05B
--   20260613010000 and the mastery formula migration). admin_role is never created in the
--   pipeline; the §7.5 admin_role GRANTs are therefore folded into service_role (which already
--   has GRANT ALL). The blend-anchor/hash columns stay out of the `authenticated` GRANT exactly
--   as §7.5 / §10.5 require — the column-projection defence-in-depth is preserved.
--
-- @adaptation ACCESSORS: Doc 05C §5.5 calls public.mastery_min_events() and §5.9 calls
--   public.mastery_model_version() (05A/Parent accessors). Neither exists in this repo yet (05A
--   stamped the version inline from canonicalize_mastery_constants and read MIN_EVENTS_FOR_MASTERY
--   inside compute_mastery_for_entity). This migration creates the two thin accessors EXACTLY as
--   05C names them — each reads mastery_constants directly (no literal 5 / no literal 'v1.0' in
--   05C bodies), so a Parent change to either propagates. They are additive helpers, not a
--   redefinition of any 05A object.
--
-- OWNER-RUN: tracked pipeline; genesis-extending; genesis-fresh-apply gate covers it (the main
--   thread regenerates scripts/ci/genesis-schema.expected.sql — this migration does NOT).
-- ROLLBACK (INV-06): transactional; reviewed. Revert =
--   DROP FUNCTION bump_projection_refresh_counter(uuid,text),
--     compute_section_projection(uuid,text,timestamptz),
--     canonicalize_projection_constants_serialized(), read_projection_constants(),
--     round_to_step(numeric,integer), mastery_min_events(), mastery_model_version();
--   DROP TABLE projection_refresh_outbox, student_projection_refresh_state,
--     student_section_projection_snapshots, student_section_projections;
--   DELETE FROM mastery_constants WHERE key LIKE 'PROJECTION\_%' ESCAPE '\'.
--   CREATE/seed only; no forward-data destruction. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Projection operational constants (Doc 05C §4.1 + §4.2 weights + §4.3 8-domain set).
--    Live in mastery_constants (05D-governed) but are EXCLUDED from
--    canonicalize_mastery_constants's IN-list (20260610010000) — so they NEVER enter
--    constants_snapshot_hash (INV-05C-16, RB-05B-V1-01 precedent). Operational, not formula-
--    affecting: changing a projection delta/weight triggers only a projection recompute, never a
--    mastery-row invalidation. Values stored as jsonb scalars (matching the #>>'{}' cast in
--    read_projection_constants). Seeded top-level (not a function body) — not literals-in-code.
--    Domain strings are BYTE-IDENTICAL to Parent §10.2 / RB-05P-V1-13 / 05B (RB-05C-V1-04):
--    "Problem Solving and Data Analysis" (no hyphen). Each section's weights sum to 1.000000.
-- ----------------------------------------------------------------------------
INSERT INTO public.mastery_constants (key, value, description) VALUES
  ('PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION', '500',
     'Doc 05C §4.1: section-relevant evidence count at which the band reaches its tightest width (excluded from constants_snapshot_hash)'),
  ('PROJECTION_MIN_DELTA', '25',
     'Doc 05C §4.1: tightest half-width in scaled points at >= target evidence (excluded from constants_snapshot_hash)'),
  ('PROJECTION_MAX_DELTA', '100',
     'Doc 05C §4.1: widest half-width in scaled points at ~0 evidence just past the Q4 gate (excluded from constants_snapshot_hash)'),
  ('PROJECTION_MIDPOINT_ROUND_TO', '10',
     'Doc 05C §4.1: rounding step for the blended midpoint, legal SAT 10-pt increment (excluded from constants_snapshot_hash)'),
  ('PROJECTION_BOUND_ROUND_TO', '10',
     'Doc 05C §4.1: rounding step for the low/high bounds, legal SAT 10-pt increment (excluded from constants_snapshot_hash)'),
  ('PROJECTION_SECTION_MAX_SCORE', '800',
     'Doc 05C §4.1: per-section ceiling (excluded from constants_snapshot_hash)'),
  ('PROJECTION_SECTION_MIN_SCORE', '200',
     'Doc 05C §4.1/§6.5: per-section floor; the range spec''s 0 lower clamp is overridden to 200 (excluded from constants_snapshot_hash)'),
  ('PROJECTION_REFRESH_EVENT_THRESHOLD', '40',
     'Doc 05C §4.1/§8.2: answered events since last refresh that trigger a throttled refresh (excluded from constants_snapshot_hash)'),
  ('PROJECTION_REFRESH_TIME_THRESHOLD_HOURS', '24',
     'Doc 05C §4.1/§8.2: hours since last refresh that trigger a throttled refresh via the 05D daily sweep (excluded from constants_snapshot_hash)'),
  ('PROJECTION_DOMAIN_WEIGHTS',
     '{"M":{"Algebra":0.350000,"Advanced Math":0.350000,"Problem Solving and Data Analysis":0.150000,"Geometry and Trigonometry":0.150000},"RW":{"Information and Ideas":0.260000,"Craft and Structure":0.280000,"Expression of Ideas":0.200000,"Standard English Conventions":0.260000}}',
     'Doc 05C §4.2/§4.3: official CB domain weights per section, keyed by (section,domain), MUST sum to 1.000000 per section (excluded from constants_snapshot_hash)')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1. Accessors named by Doc 05C §5.5 / §5.9 (see header ACCESSORS note). Each reads
--    mastery_constants DIRECTLY so 05C bodies carry no literal 5 / no literal 'v1.0'. Additive.
-- ----------------------------------------------------------------------------
-- §5.5: MIN_EVENTS_FOR_MASTERY accessor (the same value compute_mastery_for_entity uses). 05C
-- reads it rather than hardcoding 5, so a Parent threshold change propagates to the Q4 gate.
CREATE OR REPLACE FUNCTION public.mastery_min_events()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
  SELECT (value #>> '{}')::integer
  FROM public.mastery_constants
  WHERE key = 'MIN_EVENTS_FOR_MASTERY';
$func$;
REVOKE ALL ON FUNCTION public.mastery_min_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mastery_min_events() TO service_role;

-- §5.9: mastery_model_version accessor (the formula+constants version stamp). 05C stamps it on
-- projection rows without a literal 'v1.0' in the projection body.
CREATE OR REPLACE FUNCTION public.mastery_model_version()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
  SELECT (value #>> '{}')::text
  FROM public.mastery_constants
  WHERE key = 'mastery_model_version';
$func$;
REVOKE ALL ON FUNCTION public.mastery_model_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mastery_model_version() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. round_to_step (Doc 05C §6.4) — VERBATIM. Rounds to the nearest multiple of step (10 -> legal
--    SAT 10-pt increment). HALF-AWAY-FROM-ZERO (Postgres numeric ROUND default; banker's rounding
--    is NOT used). IMMUTABLE because it is pure arithmetic. The "round to nearest multiple" form
--    (ROUND(value/step)*step) is the algebraic statement of the rounding op, not a tunable
--    constant; step is a parameter read from PROJECTION_*_ROUND_TO by the caller.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.round_to_step(
  p_value numeric,
  p_step  integer
) RETURNS integer LANGUAGE sql IMMUTABLE AS $func$
  SELECT (ROUND(p_value / p_step) * p_step)::integer;
$func$;
REVOKE ALL ON FUNCTION public.round_to_step(numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.round_to_step(numeric, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. read_projection_constants (Doc 05C §9.1) — VERBATIM. The SOLE projection-constants reader.
--    Reads mastery_constants DIRECTLY (NOT canonicalize_mastery_constants) so projection keys stay
--    OUT of the formula hash (INV-05C-16). Validates bounds and the per-section weights-sum-to-1
--    rule (§4.2). The structural bounds (365/0/800/1e-6 etc.) are validation guards, not tunable
--    params. Raises PROJECTION_CONSTANTS_MISSING / PROJECTION_CONSTANTS_OUT_OF_RANGE /
--    PROJECTION_DOMAIN_WEIGHTS_INVALID (§5.4 error table).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_projection_constants(
  OUT target_qcount integer,
  OUT min_delta     numeric,
  OUT max_delta     numeric,
  OUT mid_round     integer,
  OUT bound_round   integer,
  OUT section_max   integer,
  OUT section_min   integer,
  OUT weights       jsonb
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_raw    jsonb;
  v_m_sum  numeric;
  v_rw_sum numeric;
BEGIN
  SELECT jsonb_object_agg(key, value)
  INTO   v_raw
  FROM   public.mastery_constants
  WHERE  key IN (
      'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION',
      'PROJECTION_MIN_DELTA',
      'PROJECTION_MAX_DELTA',
      'PROJECTION_MIDPOINT_ROUND_TO',
      'PROJECTION_BOUND_ROUND_TO',
      'PROJECTION_SECTION_MAX_SCORE',
      'PROJECTION_SECTION_MIN_SCORE',
      'PROJECTION_DOMAIN_WEIGHTS'
  );

  IF v_raw IS NULL
     OR NOT (v_raw ? 'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION')
     OR NOT (v_raw ? 'PROJECTION_MIN_DELTA')
     OR NOT (v_raw ? 'PROJECTION_MAX_DELTA')
     OR NOT (v_raw ? 'PROJECTION_MIDPOINT_ROUND_TO')
     OR NOT (v_raw ? 'PROJECTION_BOUND_ROUND_TO')
     OR NOT (v_raw ? 'PROJECTION_SECTION_MAX_SCORE')
     OR NOT (v_raw ? 'PROJECTION_SECTION_MIN_SCORE')
     OR NOT (v_raw ? 'PROJECTION_DOMAIN_WEIGHTS')
  THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_MISSING: one or more projection constant keys missing/inactive in mastery_constants';
  END IF;

  target_qcount := (v_raw -> 'PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION' #>> '{}')::integer;
  min_delta     := (v_raw -> 'PROJECTION_MIN_DELTA'                         #>> '{}')::numeric;
  max_delta     := (v_raw -> 'PROJECTION_MAX_DELTA'                         #>> '{}')::numeric;
  mid_round     := (v_raw -> 'PROJECTION_MIDPOINT_ROUND_TO'                 #>> '{}')::integer;
  bound_round   := (v_raw -> 'PROJECTION_BOUND_ROUND_TO'                    #>> '{}')::integer;
  section_max   := (v_raw -> 'PROJECTION_SECTION_MAX_SCORE'                 #>> '{}')::integer;
  section_min   := (v_raw -> 'PROJECTION_SECTION_MIN_SCORE'                 #>> '{}')::integer;
  weights       := (v_raw -> 'PROJECTION_DOMAIN_WEIGHTS');

  -- Bounds checks (structural validation guards; not tunable formula constants).
  IF target_qcount <= 0 OR target_qcount > 100000 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: target_qcount=%', target_qcount;
  END IF;
  IF min_delta < 0 OR max_delta < 0 OR min_delta > max_delta THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: min_delta=% max_delta=%', min_delta, max_delta;
  END IF;
  IF mid_round <= 0 OR bound_round <= 0 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: mid_round=% bound_round=%', mid_round, bound_round;
  END IF;
  IF section_min < 0 OR section_max <= section_min OR section_max > 800 THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_OUT_OF_RANGE: section_min=% section_max=%', section_min, section_max;
  END IF;

  -- Domain-weights structural + per-section sum check (|Σ−1| ≤ 1e-6, §4.2).
  IF NOT (weights ? 'M') OR NOT (weights ? 'RW') THEN
    RAISE EXCEPTION 'PROJECTION_DOMAIN_WEIGHTS_INVALID: missing M or RW key';
  END IF;

  SELECT COALESCE(SUM((v.value #>> '{}')::numeric), 0)
  INTO   v_m_sum
  FROM   jsonb_each(weights -> 'M') v;

  SELECT COALESCE(SUM((v.value #>> '{}')::numeric), 0)
  INTO   v_rw_sum
  FROM   jsonb_each(weights -> 'RW') v;

  IF ABS(v_m_sum - 1.0) > 0.000001 OR ABS(v_rw_sum - 1.0) > 0.000001 THEN
    RAISE EXCEPTION 'PROJECTION_DOMAIN_WEIGHTS_INVALID: M sum=%, RW sum=% (must each equal 1.000000)', v_m_sum, v_rw_sum;
  END IF;
END;
$func$;
REVOKE ALL ON FUNCTION public.read_projection_constants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_projection_constants() TO service_role;

-- ----------------------------------------------------------------------------
-- 4. canonicalize_projection_constants_serialized (Doc 05C §9.5, RB-05C-V1-06) — VERBATIM.
--    Canonical serialization for the projection-constants hash: stable key order + fixed numeric
--    formatting (FM9990.000000) so the hash is reproducible across Postgres versions, jsonb
--    internal ordering, and locale. Mirrors 05A's canonicalize_mastery_constants_serialized. The
--    ONLY input to the §5.9 projection hash (NOT raw jsonb::text). The fixed numeric format mask is
--    a serialization spec, not a tunable constant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_projection_constants_serialized()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_target_qcount integer;
  v_min_delta     numeric;
  v_max_delta     numeric;
  v_mid_round     integer;
  v_bound_round   integer;
  v_section_max   integer;
  v_section_min   integer;
  v_weights       jsonb;
  v_weights_canon text;
BEGIN
  SELECT target_qcount, min_delta, max_delta, mid_round,
         bound_round, section_max, section_min, weights
  INTO   v_target_qcount, v_min_delta, v_max_delta, v_mid_round,
         v_bound_round, v_section_max, v_section_min, v_weights
  FROM   public.read_projection_constants();

  -- Canonical weights serialization: sections in fixed order (M, RW), domains sorted by key within
  -- each section, weights to a fixed 6-decimal scale. Deterministic regardless of jsonb internals.
  SELECT string_agg(
             sec || ':' || dom_csv,
             '|' ORDER BY sec
         )
  INTO   v_weights_canon
  FROM (
      SELECT s.sec,
             string_agg(
                 w.key || '=' || to_char((w.value #>> '{}')::numeric, 'FM9990.000000'),
                 ',' ORDER BY w.key
             ) AS dom_csv
      FROM   (VALUES ('M'), ('RW')) AS s(sec)
      CROSS JOIN LATERAL jsonb_each(v_weights -> s.sec) AS w
      GROUP BY s.sec
  ) per_section;

  RETURN
      'target_qcount=' || v_target_qcount::text
   || ';min_delta='    || to_char(v_min_delta,   'FM9990.000000')
   || ';max_delta='    || to_char(v_max_delta,   'FM9990.000000')
   || ';mid_round='    || v_mid_round::text
   || ';bound_round='  || v_bound_round::text
   || ';section_min='  || v_section_min::text
   || ';section_max='  || v_section_max::text
   || ';weights='      || COALESCE(v_weights_canon, '');
END;
$func$;
REVOKE ALL ON FUNCTION public.canonicalize_projection_constants_serialized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonicalize_projection_constants_serialized() TO service_role;

-- ----------------------------------------------------------------------------
-- 5. student_section_projections (Doc 05C §7.1) — one current row per (student, section).
--    SINGLE WRITER: public.compute_section_projection (via service_role, RLS-bypassing). Column
--    names projected_score_{mid,low,high} + relevant_question_count MATCH
--    buildScoreEstimateFromCanonical (canonical-runtime-views.ts ~L477) so the honest-uncomputed
--    -> computed transition flips. The two CHECK constraints make INV-05C-15 (range coherence) and
--    INV-05C-13 (denominator arithmetic) database-enforced.
--
-- @adaptation SHELL-RECONCILE (Doc 05C §11.D / §11.2 greenfield): the mastery-formula migration
--   (20260610010000) created a PLACEHOLDER student_section_projections shell
--   (student_id, section, projected_score numeric, payload jsonb, computed_at) — "05B/05C fill the
--   refresher bodies later". That shell does NOT match the §7.1 schema (no range columns, no blend
--   anchors, no CHECK constraints; extra projected_score/payload columns). Per §11.D we do NOT
--   silently CREATE TABLE IF NOT EXISTS over a mismatched pre-existing table. 05C is the FIRST and
--   ONLY writer of this table (no refresher existed before this migration), so the shell is EMPTY
--   in every environment — the §11.D "DROP-and-recreate with an explicit plan" path is safe (no
--   data loss possible). We DROP the empty placeholder (its RLS/grants drop with it) and CREATE the
--   canonical §7.1 table; the §8 block below re-establishes RLS + GRANTs. LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.student_section_projections;

CREATE TABLE IF NOT EXISTS public.student_section_projections (
  -- Identity
  student_id                uuid          NOT NULL,
  section                   text          NOT NULL CHECK (section IN ('M', 'RW')),

  -- Displayed projection (NULL together below the Q4 gate; INV-05C-14/15)
  projected_score_mid       integer       NULL
      CHECK (projected_score_mid  IS NULL OR projected_score_mid  BETWEEN 200 AND 800),
  projected_score_low       integer       NULL
      CHECK (projected_score_low  IS NULL OR projected_score_low  BETWEEN 200 AND 800),
  projected_score_high      integer       NULL
      CHECK (projected_score_high IS NULL OR projected_score_high BETWEEN 200 AND 800),
  range_width               integer       NULL
      CHECK (range_width IS NULL OR range_width >= 0),
  relevant_question_count   integer       NULL
      CHECK (relevant_question_count IS NULL OR relevant_question_count >= 0),

  -- Blend audit anchors (reconstruct the blend exactly; admin/service-only)
  mastery_term              numeric(8,4)  NULL,
  fl1_score                 integer       NULL
      CHECK (fl1_score IS NULL OR fl1_score BETWEEN 200 AND 800),
  fl2_score                 integer       NULL
      CHECK (fl2_score IS NULL OR fl2_score BETWEEN 200 AND 800),
  fl_count_used             smallint      NOT NULL DEFAULT 0
      CHECK (fl_count_used BETWEEN 0 AND 2),
  blend_denominator         smallint      NOT NULL DEFAULT 1
      CHECK (blend_denominator BETWEEN 1 AND 3),

  -- Versioning / audit
  projection_constants_hash text          NULL,
  mastery_model_version     text          NOT NULL DEFAULT 'v1.0',
  computed_at               timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now        timestamptz   NOT NULL DEFAULT now(),

  PRIMARY KEY (student_id, section),

  -- INV-05C-15: range columns NULL together or present together; when present satisfy
  -- low <= mid <= high and width = high - low.
  CONSTRAINT projection_range_coherent CHECK (
      (
          projected_score_mid  IS NULL AND
          projected_score_low  IS NULL AND
          projected_score_high IS NULL AND
          range_width          IS NULL
      )
      OR
      (
          projected_score_mid  IS NOT NULL AND
          projected_score_low  IS NOT NULL AND
          projected_score_high IS NOT NULL AND
          range_width          IS NOT NULL AND
          projected_score_low  <= projected_score_mid AND
          projected_score_mid  <= projected_score_high AND
          range_width          =  projected_score_high - projected_score_low
      )
  ),

  -- INV-05C-13 arithmetic: fl_count_used must be consistent with blend_denominator.
  CONSTRAINT projection_blend_denominator_coherent CHECK (
      blend_denominator = fl_count_used + 1
  )
);

CREATE INDEX IF NOT EXISTS idx_student_section_projections_student
  ON public.student_section_projections (student_id);

-- ----------------------------------------------------------------------------
-- 6. student_section_projection_snapshots (Doc 05C §7.2) — append-only audit trail (Q6,
--    INV-05C-17). Surrogate identity PK so the table is purely append-only (no natural-key upsert
--    path). NO UPDATE/DELETE policy for any role except the 05D account-deletion cascade.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_section_projection_snapshots (
  snapshot_id               bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id                uuid          NOT NULL,
  section                   text          NOT NULL CHECK (section IN ('M', 'RW')),

  projected_score_mid       integer       NULL
      CHECK (projected_score_mid  IS NULL OR projected_score_mid  BETWEEN 200 AND 800),
  projected_score_low       integer       NULL
      CHECK (projected_score_low  IS NULL OR projected_score_low  BETWEEN 200 AND 800),
  projected_score_high      integer       NULL
      CHECK (projected_score_high IS NULL OR projected_score_high BETWEEN 200 AND 800),
  range_width               integer       NULL,
  relevant_question_count   integer       NULL,

  mastery_term              numeric(8,4)  NULL,
  fl1_score                 integer       NULL,
  fl2_score                 integer       NULL,
  fl_count_used             smallint      NOT NULL DEFAULT 0,
  blend_denominator         smallint      NOT NULL DEFAULT 1,

  projection_constants_hash text          NULL,
  mastery_model_version     text          NOT NULL DEFAULT 'v1.0',
  snapshot_at               timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projection_snapshots_student_section_time
  ON public.student_section_projection_snapshots (student_id, section, snapshot_at DESC);

-- ----------------------------------------------------------------------------
-- 7. 05C-owned refresh-state + outbox tables (Doc 05C §7.7, RB-05C-V1-03 / RB-05C-V1-07).
--    Projection-refresh bookkeeping is owned by 05C, NOT by an 05A/05B table.
-- ----------------------------------------------------------------------------
-- Throttle counter. One row per student. 05C-owned (RB-05C-V1-03). bump_projection_refresh_counter
-- is the single writer; apply_mastery_event calls THAT (M3), never this table directly.
CREATE TABLE IF NOT EXISTS public.student_projection_refresh_state (
  student_id            uuid          NOT NULL PRIMARY KEY,
  events_since_refresh  integer       NOT NULL DEFAULT 0
      CHECK (events_since_refresh >= 0),
  last_refresh_at       timestamptz   NULL
);

-- Full-length-completion handoff. Append-only outbox; 04B inserts (WS-4), the 05C/05D worker
-- consumes (05D). This migration CREATEs the locked table shell only — the EMIT (04B) and the
-- CONSUMER (05D) are carried forward-refs. Partial index keeps the consumer scan cheap.
CREATE TABLE IF NOT EXISTS public.projection_refresh_outbox (
  outbox_id     bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    uuid          NOT NULL,
  reason        text          NOT NULL
      CHECK (reason IN ('full_length_completed')),
  requested_at  timestamptz   NOT NULL DEFAULT now(),
  processed_at  timestamptz   NULL
);
CREATE INDEX IF NOT EXISTS idx_projection_refresh_outbox_unprocessed
  ON public.projection_refresh_outbox (requested_at)
  WHERE processed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 8. RLS + GRANTs (Doc 05C §7.4 / §7.5 / §7.7).
-- ----------------------------------------------------------------------------
ALTER TABLE public.student_section_projections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_section_projection_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_projection_refresh_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projection_refresh_outbox            ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_section_projections          FROM PUBLIC;
REVOKE ALL ON public.student_section_projection_snapshots FROM PUBLIC;
REVOKE ALL ON public.student_projection_refresh_state     FROM PUBLIC;
REVOKE ALL ON public.projection_refresh_outbox            FROM PUBLIC;

GRANT ALL ON public.student_section_projections          TO service_role;
GRANT ALL ON public.student_section_projection_snapshots TO service_role;
GRANT ALL ON public.student_projection_refresh_state     TO service_role;
GRANT ALL ON public.projection_refresh_outbox            TO service_role;

-- §7.4 read policies — current projection: student self-read.
CREATE POLICY student_section_projections_student_read
  ON public.student_section_projections
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- §7.4 current projection: guardian read (active link AND active entitlement, §11.1).
-- BYTE-IDENTICAL in shape to 05B's student_domain_mastery_guardian_read (genesis guardian_links +
-- entitlements; "active" = status = 'active' (narrowed, spec §5.3). One guardian-gate pattern, §7.4. LYCEON-MIGRATION-REVIEWED
CREATE POLICY student_section_projections_guardian_read
  ON public.student_section_projections
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT gl.student_profile_id
      FROM   public.guardian_links gl
      WHERE  gl.guardian_profile_id = auth.uid()
        AND  gl.status = 'active'
        AND  EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE  e.profile_id = gl.student_profile_id
            AND  e.status = 'active'
        )
    )
  );

-- §7.4 snapshots: student self-read.
CREATE POLICY projection_snapshots_student_read
  ON public.student_section_projection_snapshots
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- §7.4 snapshots: guardian read (same entitlement gate; 8-a — guardian sees snapshot history too).
CREATE POLICY projection_snapshots_guardian_read
  ON public.student_section_projection_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT gl.student_profile_id
      FROM   public.guardian_links gl
      WHERE  gl.guardian_profile_id = auth.uid()
        AND  gl.status = 'active'
        AND  EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE  e.profile_id = gl.student_profile_id
            AND  e.status = 'active'
        )
    )
  );

-- §7.4 WRITE: no INSERT/UPDATE/DELETE policy for authenticated on either projection table —
-- absence of policy is the denial. Only service_role (RLS-bypassing) writes, only through
-- compute_section_projection. INV-05C-17: the snapshot table additionally has NO UPDATE/DELETE
-- path for ANY role except the 05D account-deletion cascade (no such policy exists here).

-- §7.7 refresh-state + outbox: internal bookkeeping — NO authenticated (student/guardian) access.
-- Denial by policy absence (the 05B student_skill_kpi precedent). No read policy created.

-- §7.5 column-level GRANTs (defence-in-depth: RLS decides rows, GRANTs decide columns). The blend
-- anchors (mastery_term, fl*, blend_denominator), hashes, mastery_model_version, and
-- refreshed_at_t_now are admin/service-only and are NOT in the `authenticated` GRANT (§10.5). The
-- §7.5 admin_role GRANT is folded into service_role per the genesis 3-role model (header note).
GRANT SELECT (
    student_id, section,
    projected_score_mid, projected_score_low, projected_score_high,
    range_width, relevant_question_count, computed_at
) ON public.student_section_projections TO authenticated;

GRANT SELECT (
    student_id, section,
    projected_score_mid, projected_score_low, projected_score_high,
    range_width, relevant_question_count, snapshot_at
) ON public.student_section_projection_snapshots TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. compute_section_projection (Doc 05C §5, STATE A ONLY — see header HALT-1 note) — the single
--    writer of student_section_projections + student_section_projection_snapshots. Reads
--    student_domain_mastery.mastery_score (05B output) — NEVER calls compute_mastery_for_entity
--    (INV-05C-A1). NO numeric literals in the body: every value comes from read_projection_
--    constants() / mastery_min_events() / mastery_model_version(). State A: blend_denominator=1,
--    no full-length terms (the §5.7 04B blend is a NAMED forward-ref comment — WS-4).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_section_projection(
  p_student_id  uuid,
  p_section     text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_section_projections
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_min_delta         numeric;
  v_max_delta         numeric;
  v_target_qcount     integer;
  v_mid_round         integer;
  v_bound_round       integer;
  v_section_max       integer;
  v_section_min       integer;
  v_weights           jsonb;
  v_min_events        integer;
  v_gate_passed       boolean;
  v_weighted_mastery  numeric;
  v_mastery_term      numeric;
  v_fl1_score         integer;     -- State A: always NULL (no full-lengths pre-WS-4)
  v_fl2_score         integer;     -- State A: always NULL (no full-lengths pre-WS-4)
  v_fl_count_used     integer;
  v_blend_numerator   numeric;
  v_blend_denominator integer;
  v_blended_raw       numeric;
  v_relevant_qcount   integer;
  v_evidence_ratio    numeric;
  v_projection_delta  numeric;
  v_mid               integer;
  v_low               integer;
  v_high              integer;
  v_range_width       integer;
  v_constants_hash    text;
  v_result_row        public.student_section_projections;
BEGIN
  -- §5.2 input validation
  IF p_section NOT IN ('M', 'RW') THEN
    RAISE EXCEPTION 'PROJECTION_INVALID_SECTION: section must be M or RW, got %', p_section;
  END IF;
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'PROJECTION_INVALID_STUDENT: p_student_id is NULL';
  END IF;

  -- §5.3 acquire student-section advisory transaction lock (serializes concurrent refreshes).
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtext('projection|' || p_student_id::text || '|' || p_section)
    );
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'PROJECTION_LOCK_TIMEOUT: projection lock (%, %)', p_student_id, p_section;
  END;

  -- §5.4 read and validate projection constants (raises on missing/out-of-range/weights-not-1).
  SELECT target_qcount, min_delta, max_delta,
         mid_round, bound_round, section_max, section_min, weights
  INTO   v_target_qcount, v_min_delta, v_max_delta,
         v_mid_round, v_bound_round, v_section_max, v_section_min, v_weights
  FROM public.read_projection_constants();

  -- §5.5 evaluate the Q4 evidence gate (INV-05C-14, RB-05C-V1-01). Anti-join the canonical 8-domain
  -- set against student_domain_mastery: the gate passes iff NO required (section,domain) pair is
  -- absent or below mastery_min_events(). The required_domains VALUES set drives the gate, NOT a
  -- COUNT(*) — duplicate/extra/non-canonical rows cannot make it pass. The 8 strings are byte-
  -- identical to Parent §10.2 / PROJECTION_DOMAIN_WEIGHTS keys (RB-05C-V1-04).
  v_min_events := public.mastery_min_events();
  WITH required_domains(section, domain) AS (
      VALUES
          ('M','Algebra'),
          ('M','Advanced Math'),
          ('M','Problem Solving and Data Analysis'),
          ('M','Geometry and Trigonometry'),
          ('RW','Information and Ideas'),
          ('RW','Craft and Structure'),
          ('RW','Expression of Ideas'),
          ('RW','Standard English Conventions')
  )
  SELECT NOT EXISTS (
      SELECT 1
      FROM   required_domains rd
      LEFT JOIN public.student_domain_mastery sdm
             ON sdm.student_id = p_student_id
            AND sdm.section    = rd.section
            AND sdm.domain     = rd.domain
      WHERE COALESCE(sdm.event_count_total, 0) < v_min_events
  )
  INTO v_gate_passed;

  IF NOT v_gate_passed THEN
    -- Emit an explicit NULL projection row (UI shows "not enough evidence yet"), §5.5/§6.2.
    v_weighted_mastery := NULL;
    v_mastery_term     := NULL;
    v_blended_raw      := NULL;
    v_mid              := NULL;
    v_low              := NULL;
    v_high             := NULL;
    v_range_width      := NULL;
    v_relevant_qcount  := NULL;
    v_fl1_score        := NULL;
    v_fl2_score        := NULL;
    v_fl_count_used    := 0;
    v_blend_denominator := 1;
  ELSE
    -- §5.6 compute the mastery term (gate passed). Sum over exactly the 4 domains of THIS section,
    -- weighted by official CB domain weights, to get weighted_mastery ∈ [0,1]. mastery_score is the
    -- [0,1] decimal from 05B's student_domain_mastery (NEVER recomputed here — INV-05C-A1).
    SELECT
        SUM(
            sdm.mastery_score
            * ((v_weights -> p_section ->> sdm.domain)::numeric)
        )
    INTO v_weighted_mastery
    FROM public.student_domain_mastery sdm
    WHERE sdm.student_id = p_student_id
      AND sdm.section    = p_section
      AND sdm.mastery_score IS NOT NULL;

    -- Defensive: gate passed => all 4 section domains must have non-NULL mastery_score and a weight
    -- entry. A NULL here is a domain/weight key mismatch (data-integrity fault), not a low score
    -- (RB-05B-V1-02 discipline: surface, never silently COALESCE to 0).
    IF v_weighted_mastery IS NULL THEN
      RAISE EXCEPTION
        'PROJECTION_MASTERY_TERM_NULL: gate passed but weighted mastery is NULL for (%, %) — domain/weight key mismatch',
        p_student_id, p_section;
    END IF;

    -- RB-05C-V1-05: map weighted_mastery [0,1] onto the legal SAT section scale
    -- [SECTION_MIN_SCORE, SECTION_MAX_SCORE] so the mastery term is itself a legal section-scaled
    -- value (= 200 + weighted_mastery × 600), homogeneous with the full-length terms it blends with.
    v_mastery_term :=
        v_section_min + (v_weighted_mastery * (v_section_max - v_section_min));

    -- §5.7 resolve the full-length terms and compute the blend (INV-05C-13).
    -- ┌─ NAMED FORWARD-REF (WS-4, BLOCKING_UPSTREAM_GAP — 04B object unnamed) ────────────────────┐
    -- │ States B/C read the 04B completed-full-length section-score surface (the two most recent  │
    -- │ completed full-lengths by completed_at, tiebreak id desc), adding fl1/fl2 to the numerator │
    -- │ and 1/2 to the denominator. Doc 05C §5.7 / §11.C mark that object BLOCKING_UPSTREAM_GAP    │
    -- │ until Doc 04B names it (columns student_id, section, section_scaled_score, is_complete,    │
    -- │ completed_at, id; "completed = both modules submitted and scored"). State A has NO 04B     │
    -- │ dependency, so NO full_length_section_scores read appears here — it is added in WS-4. The  │
    -- │ blend numerator ALWAYS seeds with v_mastery_term (INV-05C-13), so the WS-4 addition is     │
    -- │ purely additive (denominator 1 -> 2 -> 3) with no body restructure.                        │
    -- └───────────────────────────────────────────────────────────────────────────────────────────┘
    v_fl1_score         := NULL;   -- State A
    v_fl2_score         := NULL;   -- State A
    v_blend_numerator   := v_mastery_term;                 -- mastery term always present (INV-05C-13)
    v_blend_denominator := 1;                              -- State A (no full-lengths pre-WS-4)
    v_fl_count_used     := v_blend_denominator - 1;        -- 0 in State A
    v_blended_raw       := v_blend_numerator / v_blend_denominator;

    -- §5.8 bounded range. relevant_question_count = 05B student_section_kpi.events_total (the same
    -- evidence population 05B aggregates; 05C reads it, never recomputes the union — INV-05C-A1/A2).
    SELECT COALESCE(ssk.events_total, 0)
    INTO   v_relevant_qcount
    FROM   public.student_section_kpi ssk
    WHERE  ssk.student_id = p_student_id
      AND  ssk.section    = p_section;
    -- No KPI row yet (gate can pass on raw events before the KPI refresh commits) => 0 evidence.
    v_relevant_qcount := COALESCE(v_relevant_qcount, 0);

    -- evidence_ratio in [0,1]: 0 at no evidence, 1 at >= target.
    v_evidence_ratio := LEAST(
        GREATEST(v_relevant_qcount::numeric / v_target_qcount::numeric, 0),
        1
    );

    -- Shrinking delta: widest at ratio 0, tightest at ratio 1 (locked formula, §6.5).
    v_projection_delta :=
        v_max_delta - ((v_max_delta - v_min_delta) * v_evidence_ratio);

    -- Midpoint = rounded blended projection, clamped to legal SAT range.
    v_mid := public.round_to_step(
        LEAST(GREATEST(v_blended_raw, v_section_min), v_section_max),
        v_mid_round
    );

    -- Bounds: clamp to [section_min, section_max] (the range spec's lower clamp 0 is overridden to
    -- PROJECTION_SECTION_MIN_SCORE = 200 per §6.5), then round.
    v_low := public.round_to_step(
        LEAST(GREATEST(v_mid - v_projection_delta, v_section_min), v_section_max),
        v_bound_round
    );
    v_high := public.round_to_step(
        LEAST(GREATEST(v_mid + v_projection_delta, v_section_min), v_section_max),
        v_bound_round
    );

    v_range_width := v_high - v_low;
  END IF;

  -- §5.9 capture the operational projection-constants hash (NOT the formula hash; INV-05C-16). Hash
  -- the CANONICAL serialization (RB-05C-V1-06), not raw jsonb::text. pgcrypto digest lives in the
  -- extensions schema (genesis), same as 05A/05B.
  v_constants_hash := encode(
      extensions.digest(
          convert_to(
              public.canonicalize_projection_constants_serialized(),
              'UTF8'
          ),
          'sha256'
      ),
      'hex'
  );

  -- Upsert the canonical current row, then append an immutable snapshot — one transaction so the
  -- current row and its snapshot can never disagree.
  INSERT INTO public.student_section_projections (
      student_id, section,
      projected_score_mid, projected_score_low, projected_score_high,
      range_width, relevant_question_count,
      mastery_term, fl1_score, fl2_score, fl_count_used,
      blend_denominator,
      projection_constants_hash, mastery_model_version,
      computed_at, refreshed_at_t_now
  ) VALUES (
      p_student_id, p_section,
      v_mid, v_low, v_high,
      v_range_width, v_relevant_qcount,
      v_mastery_term, v_fl1_score, v_fl2_score, v_fl_count_used,
      v_blend_denominator,
      v_constants_hash, public.mastery_model_version(),
      now(), p_t_now
  )
  ON CONFLICT (student_id, section) DO UPDATE SET
      projected_score_mid       = EXCLUDED.projected_score_mid,
      projected_score_low       = EXCLUDED.projected_score_low,
      projected_score_high      = EXCLUDED.projected_score_high,
      range_width               = EXCLUDED.range_width,
      relevant_question_count   = EXCLUDED.relevant_question_count,
      mastery_term              = EXCLUDED.mastery_term,
      fl1_score                 = EXCLUDED.fl1_score,
      fl2_score                 = EXCLUDED.fl2_score,
      fl_count_used             = EXCLUDED.fl_count_used,
      blend_denominator         = EXCLUDED.blend_denominator,
      projection_constants_hash = EXCLUDED.projection_constants_hash,
      mastery_model_version     = EXCLUDED.mastery_model_version,
      computed_at               = EXCLUDED.computed_at,
      refreshed_at_t_now        = EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  -- Append-only snapshot (Q6: this IS the projection audit trail). RB-05C-V1-02: v_result_row is a
  -- PL/pgSQL record variable, NOT a relation — insert via a VALUES list of its fields, never
  -- `FROM v_result_row`.
  INSERT INTO public.student_section_projection_snapshots (
      student_id, section,
      projected_score_mid, projected_score_low, projected_score_high,
      range_width, relevant_question_count,
      mastery_term, fl1_score, fl2_score, fl_count_used,
      blend_denominator,
      projection_constants_hash, mastery_model_version,
      snapshot_at, refreshed_at_t_now
  )
  VALUES (
      v_result_row.student_id,
      v_result_row.section,
      v_result_row.projected_score_mid,
      v_result_row.projected_score_low,
      v_result_row.projected_score_high,
      v_result_row.range_width,
      v_result_row.relevant_question_count,
      v_result_row.mastery_term,
      v_result_row.fl1_score,
      v_result_row.fl2_score,
      v_result_row.fl_count_used,
      v_result_row.blend_denominator,
      v_result_row.projection_constants_hash,
      v_result_row.mastery_model_version,
      now(),
      v_result_row.refreshed_at_t_now
  );

  RETURN v_result_row;
END;
$func$;
REVOKE ALL ON FUNCTION public.compute_section_projection(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_section_projection(uuid, text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. bump_projection_refresh_counter (Doc 05C §8.4) — the SINGLE 05A->05C seam. apply_mastery_event
--     (05A) calls THIS in M3 after recording a mastery event; it does not touch any projection
--     column directly. Increments the 05C-owned student_projection_refresh_state counter; on
--     crossing PROJECTION_REFRESH_EVENT_THRESHOLD it refreshes BOTH sections in the same txn and
--     resets the counter. SECURITY DEFINER, service_role-only.
--
--     SPEC RETURN: Doc 05C §8.4 declares RETURNS void (the threshold/refresh/reset are internal).
--     The contract §E1 / this milestone's "RETURNS boolean" framing is satisfied by the void fn's
--     OBSERVABLE behavior: on threshold-cross it has already PERFORMed compute_section_projection
--     for both sections and zeroed the counter, so M3's caller needs no return value — it just
--     calls bump_projection_refresh_counter and the refresh+reset are done. We follow the LOCKED
--     §8.4 signature VERBATIM (RETURNS void) because the spec body is the source of truth; a
--     boolean return would diverge from the locked contract. M3 calls:
--         PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);
--     after the §4.9 refresh_domain_mastery, inside apply_mastery_event's single transaction.
--     p_section is retained in the signature deliberately (V1.1 section-specific-throttling hook +
--     call-site self-documentation); V1.0 refreshes BOTH sections on cross.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_projection_refresh_counter(
  p_student_id uuid,
  p_section    text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_cnt       integer;
  v_threshold integer;
BEGIN
  -- Upsert-and-increment atomically; the row may not exist yet.
  INSERT INTO public.student_projection_refresh_state (student_id, events_since_refresh)
  VALUES (p_student_id, 1)
  ON CONFLICT (student_id) DO UPDATE
      SET events_since_refresh = student_projection_refresh_state.events_since_refresh + 1
  RETURNING events_since_refresh INTO v_cnt;

  SELECT (value #>> '{}')::integer
  INTO   v_threshold
  FROM   public.mastery_constants
  WHERE  key = 'PROJECTION_REFRESH_EVENT_THRESHOLD';

  IF v_threshold IS NULL THEN
    RAISE EXCEPTION 'PROJECTION_CONSTANTS_MISSING: PROJECTION_REFRESH_EVENT_THRESHOLD';
  END IF;

  IF v_cnt >= v_threshold THEN
    -- Refresh BOTH sections (the gate/range are per-section but activity may have touched either
    -- since the last refresh). p_section is intentionally not used to scope the refresh in V1.0.
    PERFORM public.compute_section_projection(p_student_id, 'M',  now());
    PERFORM public.compute_section_projection(p_student_id, 'RW', now());

    UPDATE public.student_projection_refresh_state
       SET events_since_refresh = 0,
           last_refresh_at      = now()
     WHERE student_id = p_student_id;
  END IF;
END;
$func$;
REVOKE ALL ON FUNCTION public.bump_projection_refresh_counter(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_projection_refresh_counter(uuid, text) TO service_role;

COMMIT;
