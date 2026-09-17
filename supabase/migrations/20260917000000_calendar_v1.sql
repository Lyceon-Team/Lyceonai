-- ============================================================================
-- Doc 05F — Study Calendar V1: schema, config, generators, write RPCs
-- ============================================================================
-- @spec [Doc-05F_V1.0 §7 (DDL), §10 (generator contract + validator), §12
--        (regeneration lifecycle), §16 (entitlement/guardian read)]
--       [Doc_05F_formula_sheet.md §1–§8 — canonical for the formula; Doc 05F §11
--        is superseded by it per the sheet's §8 change record item 4]
--       [Doc-01A_V1 §2 config doctrine — per-table *_runtime_config + _history]
--       [Doc-02B_V4 §41 — practice_runtime_config is the owner of
--        target_seconds_per_question; never duplicated here]
-- @implemented [2026-09-17]
--
-- plain English: creates the whole calendar data layer in one transaction —
--   ten tables, one view, the runtime-config rows, the two pure plan
--   generators, the validator, the snapshot builder and the five write RPCs.
--   A student's plan is an append-only chain of versions; the newest accepted
--   version that owns a date is that date's plan. Nothing is ever updated or
--   deleted except the student's own study profile.
--
-- expected outcome: `calendar_compute_plan(snapshot)` is a pure integer
--   function that reproduces scripts/ci/reference/calendar_formula_reference.py
--   byte-for-byte on the nine committed fixtures and on the seeded 3,000
--   snapshot suite; the parity gate (scripts/ci/calendar-parity.ts) fails CI on
--   any difference.
--
-- trade-offs: the formula is duplicated between PL/pgSQL and the Python
--   reference. That duplication is the point — the reference is an independent
--   oracle, not a second implementation anything calls. The TypeScript server
--   never contains the formula (sheet §6).
--
-- edge cases: no COALESCE defaults for essential inputs — a missing profile or
--   missing constants means nothing is generated and the prior plan stands
--   (sheet §6 "Never fails closed" clause 4). Integer arithmetic only: every
--   ratio is basis points, so PL/pgSQL truncation and Python floor division
--   agree on the non-negative operands the formula uses.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`); agents
--   hold no service_role. Genesis-extending; the genesis-fresh-apply gate
--   covers it. NOT APPLIED TO PROD BY THIS CHANGE.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Revert = DROP the ten
--   tables + the view + the functions listed below; CREATE/seed only, no
--   forward-data destruction.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP VIEW public.calendar_current_plan, public.calendar_plan_versions_student;
--   DROP TABLE public.calendar_job_runs, public.calendar_mutation_ledger,
--     public.calendar_block_launches, public.calendar_plan_block_memberships,
--     public.calendar_blocks, public.calendar_plan_dates,
--     public.calendar_plan_versions, public.student_study_profile,
--     public.calendar_runtime_config_history, public.calendar_runtime_config;
--   DROP FUNCTION public.calendar_scope_is_valid(text, text, jsonb),
--                 public.calendar_viewer_is_admin(),
--                 public.calendar_require_int(jsonb, text),
--                 public.calendar_place_full_lengths(jsonb),
--                 public.calendar_compute_plan(jsonb),
--                 public.calendar_compute_plan_fallback(jsonb),
--                 public.calendar_plan_to_output(jsonb, text, text[]),
--                 public.calendar_validate_plan(text, jsonb, jsonb).
--   Policies and grants go with their tables. CREATE/seed only.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Shape guard for calendar_blocks.scope
--
-- Doc 05F §7.4 as amended by formula sheet §8 item 3: `domain` and
-- `skill_codes` are replaced by a single `scope jsonb` with a per-type shape.
--
-- This function validates SHAPE ONLY — that a practice mix is a non-empty
-- array of {domain, count, explanation_key} over canonical (section, domain)
-- pairs with positive integer counts. It deliberately does NOT check
-- `granularity`, `min_domain_questions` or `max_domains_per_block`: those are
-- calendar_runtime_config values and belong to the validator (V-04), not to a
-- constraint that would freeze today's config into the schema.
--
-- The canonical eight (section, domain) pairs are embedded here for the same
-- reason 20260816010000_canonical_domain_checks.sql embeds them: the database
-- must be able to refuse a bad row without trusting the application.
--
-- DEVIATION D-1 (recorded in the PR): sheet §8 item 3 gives the practice shape
-- as {"mix":[{"domain","count"}]}. That covers the weighted branch only.
-- Sheet §1 also allows section-level scope at cold start, and both generators
-- emit exactly that (reference lines 128 and 256 emit {section: count}, no
-- domains). A discriminator is therefore required. Practice scope is
--   {"level":"domain","mix":[{domain,count,explanation_key}, …]}   weighted
--   {"level":"section","count":N,"explanation_key":"…"}            cold start / fallback
-- rather than overloading `domain` with a section code (which would break V-06)
-- or letting it be null (which would make "whole section" an absence of data).
--
-- DEVIATION D-2 (recorded in the PR): the per-domain explanation keys of sheet
-- §6 ("one key per domain and one per block") have no column in §7.4 — the
-- block's own key is `explanation_key`. They are carried on the mix entries.
-- The Python reference emits them as an unpersisted 5th tuple element; this is
-- where they land.
--
-- The count test is a regex on the rendered number, not a ::bigint cast: a cast
-- RAISES on {"count": 10.5} instead of returning false, which would make this
-- predicate partial. calendar_validate_plan calls it as a boolean, so it must be
-- total. '^[1-9][0-9]*$' rejects 0, negatives, 10.5 and 10.0 in one test, and
-- uses no numeric/float type (sheet §2: integers only). For the same reason
-- every value reached by an IN test is first proved to be a JSON string: ->>
-- over a JSON null yields SQL NULL, and NULL IN (...) is NULL, which a CHECK
-- and a NOT EXISTS filter both read as 'no objection'.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_scope_is_valid(
  p_block_type text,
  p_section    text,
  p_scope      jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_block_type

    WHEN 'practice' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NOT NULL AND p_section IN ('M', 'RW')
      AND CASE p_scope ->> 'level'

        WHEN 'section' THEN
              p_scope ?& ARRAY['level', 'count', 'explanation_key']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'count') = 'number'
          AND (p_scope ->> 'count') ~ '^[1-9][0-9]*$'
          AND jsonb_typeof(p_scope -> 'explanation_key') = 'string'

        WHEN 'domain' THEN
              p_scope ?& ARRAY['level', 'mix']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 2
          AND jsonb_typeof(p_scope -> 'mix') = 'array'
          AND jsonb_array_length(p_scope -> 'mix') >= 1
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry)
            WHERE NOT (
                  jsonb_typeof(entry) = 'object'
              AND entry ?& ARRAY['domain', 'count', 'explanation_key']
              AND (SELECT count(*) FROM jsonb_object_keys(entry)) = 3
              AND jsonb_typeof(entry -> 'domain') = 'string'
              AND jsonb_typeof(entry -> 'count') = 'number'
              AND (entry ->> 'count') ~ '^[1-9][0-9]*$'
              AND jsonb_typeof(entry -> 'explanation_key') = 'string'
              AND (
                (p_section = 'M'  AND entry ->> 'domain' IN (
                   'Algebra', 'Advanced Math',
                   'Problem Solving and Data Analysis',
                   'Geometry and Trigonometry'))
                OR
                (p_section = 'RW' AND entry ->> 'domain' IN (
                   'Information and Ideas', 'Craft and Structure',
                   'Expression of Ideas', 'Standard English Conventions'))
              )
            )
          )
          -- a domain appears at most once in a mix
          AND (SELECT count(DISTINCT e.entry ->> 'domain')
               FROM jsonb_array_elements(p_scope -> 'mix') AS e(entry))
              = jsonb_array_length(p_scope -> 'mix')

        ELSE false
      END

    WHEN 'review' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      AND CASE p_scope ->> 'mode'
        WHEN 'queue' THEN
              p_scope ?& ARRAY['mode']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 1
        WHEN 'session' THEN
              p_scope ?& ARRAY['mode', 'source_engine', 'source_session_id']
          AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 3
          AND jsonb_typeof(p_scope -> 'source_engine') = 'string'
          AND p_scope ->> 'source_engine' IN ('practice', 'full_length')
          AND jsonb_typeof(p_scope -> 'source_session_id') = 'string'
        ELSE false
      END

    WHEN 'full_length' THEN
      p_scope IS NOT NULL
      AND jsonb_typeof(p_scope) = 'object'
      AND p_section IS NULL
      AND p_scope ?& ARRAY['form_id']
      AND (SELECT count(*) FROM jsonb_object_keys(p_scope)) = 1
      AND jsonb_typeof(p_scope -> 'form_id') IN ('string', 'null')

    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.calendar_scope_is_valid(text, text, jsonb) IS
  'Doc 05F §7.4 (formula sheet §8 item 3): per-block-type shape guard for calendar_blocks.scope. Shape only — config-derived magnitudes belong to calendar_validate_plan (V-04).';

-- ----------------------------------------------------------------------------
-- 2. student_study_profile (Doc 05F §7.1)
--    The only calendar table written outside an INSERT: profile edits and
--    plan-change acknowledgement (§12.7).
-- ----------------------------------------------------------------------------
CREATE TABLE public.student_study_profile (
  student_id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  timezone              text NOT NULL,
  target_exam_date      date,
  target_score          integer CHECK (target_score BETWEEN 400 AND 1600 AND target_score % 10 = 0),
  study_days_mask       smallint NOT NULL CHECK (study_days_mask BETWEEN 1 AND 127),
  daily_minutes         integer NOT NULL CHECK (daily_minutes BETWEEN 5 AND 600),
  full_length_weekday   smallint CHECK (full_length_weekday BETWEEN 0 AND 6),
  planner_mode          text NOT NULL DEFAULT 'auto' CHECK (planner_mode IN ('auto', 'custom')),
  setup_completed_at    timestamptz,
  last_acknowledged_nonstudent_version_no integer NOT NULL DEFAULT 0
                          CHECK (last_acknowledged_nonstudent_version_no >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT setup_requires_target_score
    CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL)
);

COMMENT ON TABLE public.student_study_profile IS
  'Doc 05F §7.1. study_days_mask bit i = Postgres DOW i (0 = Sunday); full_length_weekday uses the same convention (sheet §6 mask convention). timezone is IANA, validated at the route against pg_timezone_names.';

-- ----------------------------------------------------------------------------
-- 3. calendar_plan_versions (Doc 05F §7.2, append-only)
--    `generator` CHECK widened to both generators per sheet §8 item 1;
--    validator_detail carries the fallback reason.
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_plan_versions (
  plan_version_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version_no            integer NOT NULL CHECK (version_no >= 1),
  generator             text NOT NULL DEFAULT 'deterministic_v1'
                          CHECK (generator IN ('deterministic_v1', 'fallback_v1')),
  generator_version     text NOT NULL,
  trigger               text NOT NULL CHECK (trigger IN
                          ('setup', 'profile_change', 'weekly', 'student_refresh', 'post_exam',
                           'day_edit', 'day_regenerate', 'day_reset', 'do_it_now', 'rollback')),
  initiated_by          text NOT NULL CHECK (initiated_by IN ('student', 'system', 'admin')),
  input_snapshot        jsonb NOT NULL,
  input_snapshot_hash   text NOT NULL,
  constants_snapshot    jsonb NOT NULL,
  validator_result      text NOT NULL CHECK (validator_result IN ('accepted', 'rejected')),
  validator_detail      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, version_no),
  UNIQUE (plan_version_id, student_id)                 -- composite FK target (INV-08-22)
);

CREATE INDEX calendar_plan_versions_student_created
  ON public.calendar_plan_versions (student_id, created_at DESC);

COMMENT ON TABLE public.calendar_plan_versions IS
  'Doc 05F §7.2, append-only. generator IN (deterministic_v1, fallback_v1) per formula sheet §8 item 1; when fallback_v1 ran, validator_detail carries the reason.';

-- ----------------------------------------------------------------------------
-- 4. calendar_plan_dates (Doc 05F §7.3, append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_plan_dates (
  plan_version_id       uuid NOT NULL,
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_date        date NOT NULL,
  timezone              text NOT NULL,
  is_user_override      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_version_id, scheduled_date),
  UNIQUE (plan_version_id, scheduled_date, student_id),
  FOREIGN KEY (plan_version_id, student_id)
    REFERENCES public.calendar_plan_versions (plan_version_id, student_id) ON DELETE CASCADE
);

CREATE INDEX calendar_plan_dates_student_date
  ON public.calendar_plan_dates (student_id, scheduled_date);

COMMENT ON COLUMN public.calendar_plan_dates.timezone IS
  'Doc 05F §7.3: the IANA zone in force when this date was planned. It is the date''s temporal meaning and is immutable — a later profile timezone change does not rewrite it.';

-- ----------------------------------------------------------------------------
-- 5. calendar_blocks (Doc 05F §7.4, append-only, identity-stable)
--    `domain`/`skill_codes` replaced by `scope jsonb` (sheet §8 item 3).
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_blocks (
  block_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_in_version_id uuid NOT NULL,
  scheduled_date        date NOT NULL,
  block_type            text NOT NULL CHECK (block_type IN ('practice', 'review', 'full_length')),
  section               text CHECK (section IN ('M', 'RW')),
  scope                 jsonb NOT NULL,
  target_count          integer NOT NULL CHECK (target_count >= 1),
  source                text NOT NULL CHECK (source IN ('auto', 'student', 'post_exam')),
  derived_from_block_id uuid,
  explanation_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, student_id),
  UNIQUE (block_id, student_id, scheduled_date),
  FOREIGN KEY (derived_from_block_id, student_id)
    REFERENCES public.calendar_blocks (block_id, student_id),          -- lineage is same-student (INV-08-22)
  FOREIGN KEY (created_in_version_id, student_id)
    REFERENCES public.calendar_plan_versions (plan_version_id, student_id),
  CONSTRAINT calendar_blocks_section_by_type CHECK (
    (block_type = 'practice'    AND section IS NOT NULL) OR
    (block_type IN ('review', 'full_length') AND section IS NULL)
  ),
  CONSTRAINT calendar_blocks_full_length_single CHECK (
    block_type <> 'full_length' OR target_count = 1
  ),
  CONSTRAINT calendar_blocks_scope_shape
    CHECK (public.calendar_scope_is_valid(block_type, section, scope))
);

CREATE INDEX calendar_blocks_student_date
  ON public.calendar_blocks (student_id, scheduled_date);

COMMENT ON COLUMN public.calendar_blocks.scope IS
  'Doc 05F §7.4 as amended by formula sheet §8 item 3. practice: {"level":"domain","mix":[{domain,count,explanation_key}]} or {"level":"section","count","explanation_key"} (cold start / fallback — sheet §1). review: {"mode":"queue"} or {"mode":"session","source_engine","source_session_id"} (§8 item 13). full_length: {"form_id"}. Shape enforced by calendar_scope_is_valid.';

COMMENT ON TABLE public.calendar_blocks IS
  'Doc 05F §7.4, append-only. No ordinal, no override flag, no status: order is membership, override is the plan date, status is derived.';

-- ----------------------------------------------------------------------------
-- 6. calendar_plan_block_memberships (Doc 05F §7.5, append-only)
--    The composite FK to (block_id, student_id, scheduled_date) makes
--    "a block never moves dates" a relational fact (INV-08-22).
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_plan_block_memberships (
  plan_version_id       uuid NOT NULL,
  student_id            uuid NOT NULL,
  scheduled_date        date NOT NULL,
  block_id              uuid NOT NULL,
  display_ordinal       smallint NOT NULL CHECK (display_ordinal >= 1),
  membership_type       text NOT NULL CHECK (membership_type IN ('created', 'carried')),
  PRIMARY KEY (plan_version_id, scheduled_date, block_id),
  UNIQUE (plan_version_id, scheduled_date, display_ordinal),
  FOREIGN KEY (plan_version_id, scheduled_date, student_id)
    REFERENCES public.calendar_plan_dates (plan_version_id, scheduled_date, student_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id, student_id, scheduled_date)
    REFERENCES public.calendar_blocks (block_id, student_id, scheduled_date)
);

CREATE INDEX calendar_plan_block_memberships_block
  ON public.calendar_plan_block_memberships (block_id);

-- ----------------------------------------------------------------------------
-- 7. calendar_block_launches (Doc 05F §7.7, append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_block_launches (
  block_id              uuid NOT NULL,
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  launch_sequence       smallint NOT NULL CHECK (launch_sequence >= 1),
  engine                text NOT NULL CHECK (engine IN ('practice', 'review', 'full_length')),
  engine_session_id     uuid NOT NULL,
  launched_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, launch_sequence),
  UNIQUE (engine, engine_session_id),
  FOREIGN KEY (block_id, student_id)
    REFERENCES public.calendar_blocks (block_id, student_id)
);

COMMENT ON TABLE public.calendar_block_launches IS
  'Doc 05F §7.7, append-only. Used for Resume/Continue and calendar_launch_rate only. Never for progress — progress is the §13 allocator over engine events.';

-- ----------------------------------------------------------------------------
-- 8. calendar_mutation_ledger (Doc 05F §7.8, interim idempotency, INV-08-09)
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_mutation_ledger (
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key       uuid NOT NULL,
  route                 text NOT NULL,
  response_hash         text NOT NULL,
  response              jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, idempotency_key)
);

COMMENT ON TABLE public.calendar_mutation_ledger IS
  'Doc 05F §7.8. A replayed key returns the stored response and writes nothing. Retired when Doc 01A Part IV IdempotencyService ships (G-08-04); the client contract does not change.';

-- ----------------------------------------------------------------------------
-- 9. calendar_job_runs (Doc 05F §7.10, observability only)
--    No uniqueness on (student, period): reruns are safe and recorded. Weekly
--    idempotency is a property of plan versions (§12.5), not of this table.
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_job_runs (
  run_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job                   text NOT NULL CHECK (job IN ('weekly_regen')),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_key            date NOT NULL,
  outcome               text NOT NULL CHECK (outcome IN
                          ('ok', 'skipped_fresh', 'skipped_custom', 'skipped_no_entitlement', 'failed')),
  detail                jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_job_runs_student_period
  ON public.calendar_job_runs (student_id, period_key DESC);

-- ----------------------------------------------------------------------------
-- 10. calendar_runtime_config + calendar_runtime_config_history
--     (Doc 05F §7.9 as amended by sheet §8 item 9: PER-TABLE history, following
--     20260610000000_ws2_config_constants.sql:31-76. Thirteen such pairs exist
--     in prod; this is the fourteenth. The doc's "shared history table" note
--     was wrong.)
--     Column shape is identical to practice_runtime_config, including the
--     triggers, so the existing runtime-config accessor reads it unchanged.
-- ----------------------------------------------------------------------------
CREATE TABLE public.calendar_runtime_config (
  key            TEXT PRIMARY KEY,
  value          JSONB NOT NULL,
  value_type     TEXT NOT NULL CHECK (value_type IN ('integer','string','boolean','array','object','float')),
  min_value      JSONB,
  max_value      JSONB,
  allowed_values JSONB,
  owner          TEXT NOT NULL,
  description    TEXT NOT NULL,
  environment    TEXT NOT NULL DEFAULT 'all' CHECK (environment IN ('all','development','staging','production')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_profile_id UUID REFERENCES public.profiles(id)
);

CREATE TABLE public.calendar_runtime_config_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name            TEXT NOT NULL,
  key                   TEXT NOT NULL,
  old_value             JSONB,
  new_value             JSONB NOT NULL,
  changed_by_profile_id UUID REFERENCES public.profiles(id),
  change_reason         TEXT,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER calendar_runtime_config_notify
  AFTER INSERT OR UPDATE ON public.calendar_runtime_config
  FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();

CREATE TRIGGER calendar_runtime_config_history_no_mutate
  BEFORE UPDATE OR DELETE ON public.calendar_runtime_config_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();

-- ----------------------------------------------------------------------------
-- 11. calendar_current_plan (Doc 05F §7.6)
--     The newest ACCEPTED version that owns a date is that date's plan.
--     A cleared day appears with block_id NULL and its override flag intact.
--     security_invoker = true: the view carries the caller's privileges, so the
--     base-table RLS policies below are what decide visibility. Dropping that
--     setting would make the view owner-rights and silently bypass them.
-- ----------------------------------------------------------------------------
CREATE VIEW public.calendar_current_plan WITH (security_invoker = true) AS
WITH owner AS (
  SELECT d.student_id, d.scheduled_date, MAX(v.version_no) AS version_no
  FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions v ON v.plan_version_id = d.plan_version_id
  WHERE v.validator_result = 'accepted'
  GROUP BY d.student_id, d.scheduled_date
)
SELECT d.student_id,
       d.scheduled_date,
       d.timezone,
       d.is_user_override,
       v.version_no,
       v.plan_version_id,
       m.block_id,
       m.display_ordinal,
       m.membership_type
FROM owner o
JOIN public.calendar_plan_versions v
  ON v.student_id = o.student_id AND v.version_no = o.version_no
JOIN public.calendar_plan_dates d
  ON d.plan_version_id = v.plan_version_id AND d.scheduled_date = o.scheduled_date
LEFT JOIN public.calendar_plan_block_memberships m
  ON m.plan_version_id = d.plan_version_id AND m.scheduled_date = d.scheduled_date;

COMMENT ON VIEW public.calendar_current_plan IS
  'Doc 05F §7.6. security_invoker = true — visibility is decided by the base tables'' RLS policies, not by the view owner.';

-- ----------------------------------------------------------------------------
-- 12. Admin predicate for the calendar RLS policies
--
-- Doc 05F §7 names current_student_id() / is_admin() (Doc 01, G-08-08). Formula
-- sheet §8 item 10: neither exists in prod, and a repo-wide search finds no SQL
-- definition of either. Policies therefore use auth.uid() (= profiles.id,
-- verified 117/117) and profiles.role = 'admin'.
--
-- DEVIATION D-3 (recorded in the PR): this helper is deliberately named for the
-- calendar rather than claiming the platform-wide name `is_admin()`, which
-- Doc 01 reserves for a primitive this change is not scoped to define. When
-- that primitive lands, this collapses into it and the policies below change
-- one identifier. Writing the same EXISTS into eight policies instead would be
-- the worse duplication.
--
-- SECURITY DEFINER + a pinned search_path, matching guardian_can_view_student:
-- the subquery must read profiles regardless of the caller's own row-level view
-- of it, and must not be redirectable by a caller-set search_path.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_viewer_is_admin() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'::public.profile_role
  );
$$;

COMMENT ON FUNCTION public.calendar_viewer_is_admin() IS
  'Doc 05F §7.12 admin SELECT policies (formula sheet §8 item 10: is_admin() does not exist in prod). Collapses into Doc 01 is_admin() when that primitive ships.';

-- ----------------------------------------------------------------------------
-- 13. calendar_plan_versions_student (Doc 05F §7.12)
--
-- The student-facing projection of a plan version. input_snapshot and
-- constants_snapshot are deliberately absent: the snapshot carries the
-- student's mastery levels and the whole config surface, and neither belongs in
-- a client payload. The base table additionally withholds them at the GRANT
-- level below, so this view is the convenience, not the control.
-- ----------------------------------------------------------------------------
CREATE VIEW public.calendar_plan_versions_student WITH (security_invoker = true) AS
SELECT v.plan_version_id,
       v.student_id,
       v.version_no,
       v.generator,
       v.generator_version,
       v.trigger,
       v.initiated_by,
       v.input_snapshot_hash,
       v.validator_result,
       v.created_at
FROM public.calendar_plan_versions v;

COMMENT ON VIEW public.calendar_plan_versions_student IS
  'Doc 05F §7.12. Excludes input_snapshot and constants_snapshot. security_invoker = true, so the base table RLS decides rows and the column grants decide columns.';

-- ----------------------------------------------------------------------------
-- 14. RLS on every calendar table (Doc 05F §7.12; genesis gate A.4)
--
-- RLS here is defense in depth, not the authorization boundary: the product
-- read model is the server's, reached through authenticated API routes. These
-- policies exist so that a mistake one layer up cannot become a cross-student
-- read.
--
-- NO policy is created for INSERT, UPDATE or DELETE on any calendar table, and
-- none for guardians on any calendar table (§16 — guardian reads are served by
-- the route through resolveSubject + the entitlement gate, sheet §8 item 14).
-- ----------------------------------------------------------------------------
ALTER TABLE public.student_study_profile              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_plan_versions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_plan_dates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_blocks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_plan_block_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_block_launches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_mutation_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_job_runs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_runtime_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_runtime_config_history    ENABLE ROW LEVEL SECURITY;

-- Student SELECT — own rows only.
CREATE POLICY student_study_profile_student_read ON public.student_study_profile
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY calendar_plan_versions_student_read ON public.calendar_plan_versions
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY calendar_plan_dates_student_read ON public.calendar_plan_dates
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY calendar_blocks_student_read ON public.calendar_blocks
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY calendar_plan_block_memberships_student_read ON public.calendar_plan_block_memberships
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY calendar_block_launches_student_read ON public.calendar_block_launches
  FOR SELECT TO authenticated USING (student_id = auth.uid());

-- Admin SELECT — explicit, read-only, same six tables.
CREATE POLICY student_study_profile_admin_read ON public.student_study_profile
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());
CREATE POLICY calendar_plan_versions_admin_read ON public.calendar_plan_versions
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());
CREATE POLICY calendar_plan_dates_admin_read ON public.calendar_plan_dates
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());
CREATE POLICY calendar_blocks_admin_read ON public.calendar_blocks
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());
CREATE POLICY calendar_plan_block_memberships_admin_read ON public.calendar_plan_block_memberships
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());
CREATE POLICY calendar_block_launches_admin_read ON public.calendar_block_launches
  FOR SELECT TO authenticated USING (public.calendar_viewer_is_admin());

-- calendar_mutation_ledger, calendar_job_runs, calendar_runtime_config and
-- calendar_runtime_config_history get NO client policies at all (§7.12). RLS is
-- enabled with zero policies: denial by absence.

-- ----------------------------------------------------------------------------
-- 15. Grants (Doc 05F §7.11, §7.12)
--
-- INV-08-05: authenticated and anon hold no INSERT, UPDATE or DELETE on any
-- calendar table, and no EXECUTE on any calendar write RPC. The writers are
-- SECURITY DEFINER and are callable only by the trusted server role, after the
-- route has done auth, role and entitlement.
--
-- Account deletion still works untouched: ON DELETE CASCADE runs as a
-- referential action with the FK's own privileges, not the deleting role's, so
-- withholding DELETE here does not strand a deleted account's rows.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.student_study_profile,
              public.calendar_plan_versions,
              public.calendar_plan_dates,
              public.calendar_blocks,
              public.calendar_plan_block_memberships,
              public.calendar_block_launches,
              public.calendar_mutation_ledger,
              public.calendar_job_runs,
              public.calendar_runtime_config,
              public.calendar_runtime_config_history,
              public.calendar_current_plan,
              public.calendar_plan_versions_student
  FROM PUBLIC, anon, authenticated;

-- Server role: read everything, insert the append-only tables, update only the
-- one table Doc 05F allows to be updated. DELETE is granted nowhere.
GRANT SELECT ON public.student_study_profile,
                public.calendar_plan_versions,
                public.calendar_plan_dates,
                public.calendar_blocks,
                public.calendar_plan_block_memberships,
                public.calendar_block_launches,
                public.calendar_mutation_ledger,
                public.calendar_job_runs,
                public.calendar_runtime_config,
                public.calendar_runtime_config_history,
                public.calendar_current_plan,
                public.calendar_plan_versions_student
  TO service_role;

GRANT INSERT ON public.student_study_profile,
                public.calendar_plan_versions,
                public.calendar_plan_dates,
                public.calendar_blocks,
                public.calendar_plan_block_memberships,
                public.calendar_block_launches,
                public.calendar_mutation_ledger,
                public.calendar_job_runs
  TO service_role;

-- The only UPDATE in the calendar: profile edits and plan acknowledgement (§12.7).
GRANT UPDATE ON public.student_study_profile TO service_role;

-- No service_role POLICY is created: service_role holds BYPASSRLS in Supabase,
-- and 20260624020000_05d_governance_substrate.sql R8 already ruled the explicit
-- policy redundant. Following that ruling rather than forking a second pattern.

-- Client reads. calendar_plan_versions is granted COLUMN BY COLUMN: input_snapshot
-- and constants_snapshot are withheld from authenticated entirely, so the
-- narrowing holds even for a caller that queries the base table directly and
-- never goes through calendar_plan_versions_student.
GRANT SELECT ON public.student_study_profile           TO authenticated;
GRANT SELECT ON public.calendar_plan_dates             TO authenticated;
GRANT SELECT ON public.calendar_blocks                 TO authenticated;
GRANT SELECT ON public.calendar_plan_block_memberships TO authenticated;
GRANT SELECT ON public.calendar_block_launches         TO authenticated;
GRANT SELECT ON public.calendar_current_plan           TO authenticated;
GRANT SELECT ON public.calendar_plan_versions_student  TO authenticated;

GRANT SELECT (plan_version_id, student_id, version_no, generator, generator_version,
              trigger, initiated_by, input_snapshot_hash, validator_result, created_at)
  ON public.calendar_plan_versions TO authenticated;

-- anon gets nothing anywhere: the REVOKE above is the whole story.

-- ----------------------------------------------------------------------------
-- 16. calendar_runtime_config rows (formula sheet §4; §21 per sheet §8 item 8)
--
-- Every plan-shaping number the generator uses lives here. The generator reads
-- NONE of them directly: calendar_build_plan_input freezes them into the
-- snapshot's `constants` and calendar_compute_plan reads only the snapshot
-- (INV-08-06). That is what lets a stored snapshot replay months later and
-- reproduce the same plan after config has moved.
--
-- Ratios are basis points because the whole formula is integer arithmetic
-- (sheet §2: "Every quantity is an integer ... No floats anywhere"). There is
-- deliberately no 'float' value_type row in this table.
--
-- Deliberately NOT keys (sheet §8 item 8): strength_level_floor,
-- max_domain_gap_days, missed_domain_bonus, final_month_days,
-- full_length_interval_days_final. Doc 05F §21 listed them; the formula has no
-- use for any of them.
--
-- Read from their owners and never duplicated here (sheet §4):
--   practice_runtime_config.target_seconds_per_question
--   review_runtime_config review_estimated_seconds_per_item  (SCL-08-F)
--   exam_runtime_config durations                            (Doc 02B §41 / 04A)
-- ----------------------------------------------------------------------------
INSERT INTO public.calendar_runtime_config
  (key, value, value_type, min_value, max_value, owner, description) VALUES

  ('horizon_days', '14', 'integer', '7', '28', 'product',
   'Doc 05F formula sheet §2: days planned per generation.'),

  ('review_share_max_bp', '5000', 'integer', '0', '10000', 'product',
   'Doc 05F formula sheet §2 step 4: review takes at most this share of a day, in basis points (5000 = 50%). Ruling §3 — tutor-guided review is slower per item by design.'),

  ('review_block_max', '30', 'integer', '1', '100', 'product',
   'Doc 05F formula sheet §2 step 4: ceiling on one ordinary review block, in items.'),

  ('exam_review_default_count', '20', 'integer', '5', '60', 'product',
   'Doc 05F formula sheet §2 step 4: placeholder size for a placed-but-not-yet-taken exam. The post_exam regeneration replaces it with the real missed count.'),

  ('weight_by_level', '{"0":5,"1":4,"2":3,"3":2,"4":1}', 'object', NULL, NULL, 'product',
   'Doc 05F formula sheet §2 step 3 / §4: need weight per mastery level over the LIVE domain, levels 0-4 (public.mastery_levels: L0 Foundations weakest .. L4 Strong). L0 leads; L4 keeps a floor of 1 so strengths stay in rotation. Sheet §8 item 8: re-keyed from Doc 05F §21, whose 1-5 was wrong against the prod CHECK of 0..4.'),

  ('null_level_weight', '3', 'integer', '1', '5', 'product',
   'Doc 05F formula sheet §2 step 3: weight for an unmeasured (NULL) domain. Sits between Developing and Proficient. Ruling R-08-26 — unknown mastery is neutral, never inferred.'),

  ('post_exam_emphasis_days', '7', 'integer', '0', '30', 'product',
   'Doc 05F formula sheet §2 step 3: days after a completed exam during which its weak domains are emphasised. Window matches Doc 02B §19.'),

  ('post_exam_multiplier', '2', 'integer', '1', '5', 'product',
   'Doc 05F formula sheet §2 step 3: weight multiplier applied to those domains inside the emphasis window.'),

  ('min_domain_questions', '5', 'integer', '5', '20', 'product',
   'Doc 05F formula sheet §2 step 5: a domain that appears in a mix gets at least this many questions.'),

  ('max_domains_per_block', '4', 'integer', '1', '8', 'product',
   'Doc 05F formula sheet §2 step 5: once a block holds this many distinct domains, further granules stay within them. Interleaving (Rohrer 2007/2015) with a cap that keeps a session legible.'),

  ('granularity', '5', 'integer', '5', '5', 'product',
   'Doc 05F formula sheet §2 step 5: allocation granule, in questions. Every practice count is a multiple of this. Locked at 5 — bounds are equal on purpose.'),

  ('full_length_every_n_occurrences', '2', 'integer', '1', '6', 'product',
   'Doc 05F formula sheet §2 step 2: cadence, counted in occurrences of full_length_weekday from the first on/after setup. College Board: space practice tests at least two weeks apart.'),

  ('full_length_min_gap_days', '7', 'integer', '1', '21', 'product',
   'Doc 05F formula sheet §2 step 2: minimum days between two full-lengths and from the last completed one.'),

  ('final_exam_lead_days', '7', 'integer', '3', '21', 'product',
   'Doc 05F formula sheet §2 step 2: the final rehearsal sits at least this far before the target date, and nothing else is placed inside that window.'),

  ('max_full_length_per_horizon', '2', 'integer', '0', '4', 'product',
   'Doc 05F formula sheet §2 step 2 / validator V-11: cap on full-lengths placed in one horizon.'),

  ('taper_days', '3', 'integer', '0', '7', 'product',
   'Doc 05F formula sheet §2 step 1: days before the target over which the daily budget is reduced. Ruling §3 — rest before the test.'),

  ('taper_ratio_bp', '5000', 'integer', '0', '10000', 'product',
   'Doc 05F formula sheet §2 step 1: budget retained during the taper, in basis points (5000 = 50%).'),

  ('recent_planned_window_days', '28', 'integer', '14', '56', 'product',
   'Doc 05F formula sheet §4 / §5: how far back recent_planned_by_domain reaches. The deficit rule measures a domain against what it has had over this window plus today.'),

  ('canonical_domain_order', '["Algebra","Advanced Math","Problem Solving and Data Analysis","Geometry and Trigonometry","Information and Ideas","Craft and Structure","Expression of Ideas","Standard English Conventions"]',
   'array', NULL, NULL, 'product',
   'Doc 05F formula sheet §2 step 5 / §4: TIE-BREAK ONLY. Two domains with an equal deficit are separated by this order and nothing else. The strings are the canonical eight enforced by 20260816010000_canonical_domain_checks.sql — Math first, then Reading & Writing.'),

  ('enabled_block_types', '["practice"]', 'array', NULL, NULL, 'product',
   'Doc 05F §21 as amended by formula sheet §8 item 12 / validator V-03: launch value is practice only. Review and full-length are rebuild verticals; their adapters ship as fail-open stubs with contract tests, and this flag gains a member when each engine lands (G-08-02, G-08-03).');

-- ----------------------------------------------------------------------------
-- 17. Strict snapshot accessors
--
-- "No COALESCE defaults for essential inputs" (sheet §6). A missing constant is
-- an error, never a zero. The message shape matches loadPracticeConfig's
-- ("<table>: missing or invalid key '<key>'") so an operator reading a log sees
-- one vocabulary across engines.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_require_int(p_obj jsonb, p_key text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE v text;
BEGIN
  v := p_obj ->> p_key;
  IF v IS NULL OR v !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION 'calendar_runtime_config: missing or invalid key ''%''', p_key
      USING ERRCODE = '22023';
  END IF;
  RETURN v::integer;
END;
$$;

COMMENT ON FUNCTION public.calendar_require_int(jsonb, text) IS
  'Doc 05F formula sheet §6: essential inputs are never invented. Raises 22023 rather than defaulting. The integer regex also refuses a float, keeping sheet §2 (integers only) true at the boundary.';

-- ----------------------------------------------------------------------------
-- 18. calendar_compute_plan — deterministic_v1 (formula sheet §2)
--
-- PURE and IMMUTABLE: no table access, no now(), no random. Everything comes
-- from p_input, which calendar_build_plan_input froze (INV-08-06). That is what
-- lets a snapshot stored today replay in a year and produce the same plan.
--
-- INTEGER ARITHMETIC ONLY. Every ratio is basis points. Every division in this
-- function has non-negative operands, so PostgreSQL's truncation and the Python
-- reference's floor division agree: B / practice_seconds, Q / granularity,
-- (Q / granularity / 2) * granularity, B * taper_ratio_bp / 10000, and
-- (D - anchor) / 7 which is guarded by the D < anchor skip above it. Deficits
-- can be negative, but a deficit is only ever compared, never divided.
--
-- Mask convention: EXTRACT(DOW) — Sunday = 0. Never ISODOW. The parity gate
-- exists partly to catch that exact slip (sheet §6).
--
-- Output. `mix` is an ARRAY, not an object, because jsonb sorts object keys and
-- the allocation order is meaningful: the first domain in a mix is the one the
-- deficit rule reached for first, and the fixtures store that order. An object
-- would silently re-sort {"SEC":5,"II":5,"CS":5} into CS, II, SEC and make
-- byte-equality against the oracle impossible.
--
--   { "generator": "deterministic_v1",
--     "days": [ { "date": "YYYY-MM-DD", "blocks": [ <block>, ... ] }, ... ] }
--
-- where <block> mirrors the calendar_blocks columns so calendar_persist_version
-- inserts it without reshaping.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_compute_plan(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  -- constants (sheet §4)
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_null_weight       integer;
  k_post_days         integer;
  k_post_mult         integer;
  k_min_domain_q      integer;
  k_max_domains       integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  v_constants         jsonb;
  v_weight_by_level   jsonb;
  v_order             jsonb;

  -- engine planning (snapshotted from the owning configs)
  e_practice_secs     integer;
  e_review_secs       integer;

  -- profile
  p_today             date;
  p_setup             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  p_fl_weekday        integer;

  -- exams
  x_last_date         date;
  x_days_since        integer;
  x_missed            integer;
  x_reviewed          boolean;
  x_weak              text[];

  -- domain arrays, all aligned on canonical order
  d_dom               text[] := '{}';
  d_sec               text[] := '{}';
  d_lvl               integer[] := '{}';
  d_w                 integer[] := '{}';
  d_why               text[] := '{}';
  d_alloc             integer[] := '{}';
  v_cold_start        boolean;

  -- exam placement (shared derivation)
  v_fl                jsonb;

  -- running state
  v_allocated_total   integer := 0;
  v_planned_total     integer := 0;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;

  -- per-day
  v_d                 date;
  v_i                 integer;
  v_j                 integer;
  v_k                 integer;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_sec_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_tot               integer;
  v_sec_tot           integer;
  v_units             integer;
  v_cum               integer;
  v_best              integer;
  v_best_def          integer;
  v_def               integer;
  v_sec_w             integer[];
  v_sec_units         integer[];
  v_planned_sec       integer[];
  v_s                 integer;
  v_secname           text;
  v_mix_dom           integer[];
  v_mix_cnt           integer[];
  v_mix_json          jsonb;
  v_pool_ok           boolean;
  v_key               text;
BEGIN
  ----------------------------------------------------------------------------
  -- Snapshot unpacking. Every essential field is required, never defaulted.
  ----------------------------------------------------------------------------
  v_constants := p_input -> 'constants';
  IF v_constants IS NULL OR jsonb_typeof(v_constants) <> 'object' THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no constants object' USING ERRCODE = '22023';
  END IF;

  k_horizon_days     := public.calendar_require_int(v_constants, 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(v_constants, 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(v_constants, 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(v_constants, 'exam_review_default_count');
  k_null_weight      := public.calendar_require_int(v_constants, 'null_level_weight');
  k_post_days        := public.calendar_require_int(v_constants, 'post_exam_emphasis_days');
  k_post_mult        := public.calendar_require_int(v_constants, 'post_exam_multiplier');
  k_min_domain_q     := public.calendar_require_int(v_constants, 'min_domain_questions');
  k_max_domains      := public.calendar_require_int(v_constants, 'max_domains_per_block');
  k_granularity      := public.calendar_require_int(v_constants, 'granularity');
  k_taper_days       := public.calendar_require_int(v_constants, 'taper_days');
  k_taper_bp         := public.calendar_require_int(v_constants, 'taper_ratio_bp');

  v_weight_by_level := v_constants -> 'weight_by_level';
  v_order           := v_constants -> 'canonical_domain_order';
  IF v_weight_by_level IS NULL OR jsonb_typeof(v_weight_by_level) <> 'object'
     OR v_order IS NULL OR jsonb_typeof(v_order) <> 'array'
     OR jsonb_array_length(v_order) <> 8 THEN
    RAISE EXCEPTION 'calendar_compute_plan: constants must carry weight_by_level and an eight-entry canonical_domain_order'
      USING ERRCODE = '22023';
  END IF;

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan: engine_planning seconds-per-unit must be positive' USING ERRCODE = '22023';
  END IF;

  IF (p_input -> 'profile') IS NULL OR (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: snapshot has no profile or no today' USING ERRCODE = '22023';
  END IF;
  p_today      := (p_input ->> 'today')::date;
  p_setup      := (p_input #>> '{profile,setup_date}')::date;
  p_mask       := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes    := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target     := (p_input #>> '{profile,target_exam_date}')::date;
  p_fl_weekday := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan: profile.setup_date is essential and was not supplied' USING ERRCODE = '22023';
  END IF;

  x_last_date  := (p_input #>> '{exams,last_completed_local_date}')::date;
  x_days_since := CASE WHEN (p_input #>> '{exams,days_since_exam}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'days_since_exam') END;
  x_missed     := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                       ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;
  x_reviewed   := (p_input #> '{exams,reviewed}')::boolean;
  SELECT COALESCE(array_agg(t), '{}') INTO x_weak
  FROM jsonb_array_elements_text(COALESCE(p_input #> '{exams,weak_domains}', '[]'::jsonb)) t;

  ----------------------------------------------------------------------------
  -- Domain arrays, in canonical order. `mastery` carries the section for each
  -- domain, so the M/RW split is read from the snapshot rather than restated
  -- here; canonical_domain_order supplies only the order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. 7 LOOP
    d_dom := d_dom || (v_order ->> v_i);
    SELECT m ->> 'section',
           CASE WHEN m ->> 'mastery_level' IS NULL THEN NULL ELSE (m ->> 'mastery_level')::integer END
      INTO v_secname, v_s
    FROM jsonb_array_elements(COALESCE(p_input -> 'mastery', '[]'::jsonb)) m
    WHERE m ->> 'domain' = (v_order ->> v_i);
    IF v_secname IS NULL THEN
      RAISE EXCEPTION 'calendar_compute_plan: snapshot mastery has no row for domain ''%''', v_order ->> v_i
        USING ERRCODE = '22023';
    END IF;
    d_sec := d_sec || v_secname;
    d_lvl := d_lvl || v_s;
    d_alloc := d_alloc || 0;
  END LOOP;

  -- recent_planned_by_domain seeds the deficit state (sheet §2 step 5: the
  -- deficit is measured against the last recent_planned_window_days plus today).
  FOR v_i IN 1 .. 8 LOOP
    SELECT COALESCE((SELECT public.calendar_require_int(r, 'count')
                     FROM jsonb_array_elements(COALESCE(p_input -> 'recent_planned_by_domain', '[]'::jsonb)) r
                     WHERE r ->> 'domain' = d_dom[v_i]), 0)
      INTO v_s;
    d_alloc[v_i] := v_s;
    v_allocated_total := v_allocated_total + v_s;
  END LOOP;
  v_planned_total := v_allocated_total;

  ----------------------------------------------------------------------------
  -- Step 3 — need weights. All eight unmeasured is cold start: Step 5 splits
  -- Math and R&W evenly and no weight is consulted.
  ----------------------------------------------------------------------------
  v_cold_start := true;
  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NOT NULL THEN v_cold_start := false; END IF;
  END LOOP;

  FOR v_i IN 1 .. 8 LOOP
    IF d_lvl[v_i] IS NULL THEN
      d_w := d_w || k_null_weight;
      d_why := d_why || 'exploring'::text;
    ELSE
      d_w := d_w || public.calendar_require_int(v_weight_by_level, d_lvl[v_i]::text);
      d_why := d_why || (CASE WHEN d_lvl[v_i] <= 1 THEN 'weak'
                              WHEN d_lvl[v_i] >= 3 THEN 'strength'
                              ELSE 'balanced' END)::text;
    END IF;
    IF x_days_since IS NOT NULL AND x_days_since <= k_post_days AND d_dom[v_i] = ANY (x_weak) THEN
      d_w[v_i] := d_w[v_i] * k_post_mult;
      d_why[v_i] := 'post_exam';
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- Step 2 — full-length placement, shared with fallback_v1 so the precedence
  -- rules have exactly one implementation (sheet §5A).
  ----------------------------------------------------------------------------
  v_fl := public.calendar_place_full_lengths(p_input);

  ----------------------------------------------------------------------------
  -- An exam completed and not yet reviewed owes an exam-review block on the
  -- next study day. A missed count of zero leaves the debt standing rather than
  -- discharging it silently -- the reference does the same, and inventing a
  -- size here would be exactly the kind of guess §6 forbids.
  ----------------------------------------------------------------------------
  IF x_last_date IS NOT NULL AND x_missed IS NOT NULL AND x_reviewed IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := x_missed;
    v_pending_key    := 'exam_review';
  END IF;

  ----------------------------------------------------------------------------
  -- The six steps, per date in horizon order.
  ----------------------------------------------------------------------------
  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT v_due + COALESCE((SELECT public.calendar_require_int(r, 'due_count')
                             FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r
                             WHERE (r ->> 'date')::date = v_d), 0)
      INTO v_due;

    -- An exam day holds nothing else, and sets up the review that follows it.
    SELECT f ->> 'explanation_key' INTO v_key
    FROM jsonb_array_elements(v_fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL),
                           'target_count', 1, 'explanation_key', v_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    -- Step 1 — budget. Nothing is planned on or after the test until the
    -- student sets a new date.
    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    -- Step 4 — review. Exam review takes the whole budget if it needs it;
    -- otherwise ordinary review is capped by its share of the day.
    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Step 5 — practice.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      IF v_cold_start THEN
        -- Math and R&W halves, the leading section alternating by study-day index.
        v_half := (v_day_q / k_granularity / 2) * k_granularity;
        IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
        ELSE v_lead := 'RW'; v_other := 'M'; END IF;
        v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'cold_start' END;
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                      'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_day_q - v_half, 'explanation_key', v_key);
        IF v_half <> 0 THEN
          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                        'scope', jsonb_build_object('level','section','count', v_half,
                                                    'explanation_key', v_key),
                        'target_count', v_half, 'explanation_key', v_key);
        END IF;
      ELSE
        v_tot := 0;
        FOR v_j IN 1 .. 8 LOOP v_tot := v_tot + d_w[v_j]; END LOOP;

        v_sec_w := ARRAY[0, 0];         -- [1] = M, [2] = RW
        v_planned_sec := ARRAY[0, 0];
        FOR v_j IN 1 .. 8 LOOP
          v_s := CASE WHEN d_sec[v_j] = 'M' THEN 1 ELSE 2 END;
          v_sec_w[v_s] := v_sec_w[v_s] + d_w[v_j];
          v_planned_sec[v_s] := v_planned_sec[v_s] + d_alloc[v_j];
        END LOOP;
        v_sec_tot := v_sec_w[1] + v_sec_w[2];
        v_units := v_day_q / k_granularity;

        -- Level 1 — each granule goes to the section furthest behind its share.
        -- Ties go to Math.
        v_sec_units := ARRAY[0, 0];
        FOR v_j IN 1 .. v_units LOOP
          v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2] + 1) * k_granularity;
          v_best := 1;
          v_best_def := v_cum * v_sec_w[1] - (v_planned_sec[1] + v_sec_units[1] * k_granularity) * v_sec_tot;
          v_def := v_cum * v_sec_w[2] - (v_planned_sec[2] + v_sec_units[2] * k_granularity) * v_sec_tot;
          IF v_def > v_best_def THEN v_best := 2; v_best_def := v_def; END IF;
          v_sec_units[v_best] := v_sec_units[v_best] + 1;
        END LOOP;

        -- Product rule: when the day has two or more granules, both sections appear.
        IF v_units >= 2 THEN
          IF v_sec_units[1] = 0 THEN v_sec_units[1] := 1; v_sec_units[2] := v_sec_units[2] - 1; END IF;
          IF v_sec_units[2] = 0 THEN v_sec_units[2] := 1; v_sec_units[1] := v_sec_units[1] - 1; END IF;
        END IF;

        -- Level 2 — within each section, each granule goes to the domain
        -- furthest behind its share; once the block holds max_domains_per_block
        -- distinct domains, later granules stay inside them. Math first, so the
        -- R&W deficits already see Math's allocations for the day.
        FOR v_s IN 1 .. 2 LOOP
          v_secname := CASE WHEN v_s = 1 THEN 'M' ELSE 'RW' END;
          v_sec_q := v_sec_units[v_s] * k_granularity;
          CONTINUE WHEN v_sec_q < k_min_domain_q;

          v_mix_dom := '{}';
          v_mix_cnt := '{}';
          FOR v_j IN 1 .. v_sec_q / k_granularity LOOP
            v_cum := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
            v_best := NULL;
            v_pool_ok := COALESCE(array_length(v_mix_dom, 1), 0) >= k_max_domains;
            FOR v_k IN 1 .. 8 LOOP       -- canonical order; ties keep the earlier index
              CONTINUE WHEN d_sec[v_k] <> v_secname;
              CONTINUE WHEN v_pool_ok AND NOT (v_k = ANY (v_mix_dom));
              v_def := v_cum * d_w[v_k]
                     - (d_alloc[v_k] + COALESCE(
                         (SELECT v_mix_cnt[ix] FROM generate_subscripts(v_mix_dom, 1) ix
                          WHERE v_mix_dom[ix] = v_k), 0)) * v_tot;
              IF v_best IS NULL OR v_def > v_best_def THEN
                v_best := v_k; v_best_def := v_def;
              END IF;
            END LOOP;
            IF v_best = ANY (v_mix_dom) THEN
              v_mix_cnt := (SELECT array_agg(CASE WHEN v_mix_dom[ix] = v_best
                                                  THEN v_mix_cnt[ix] + k_granularity
                                                  ELSE v_mix_cnt[ix] END ORDER BY ix)
                            FROM generate_subscripts(v_mix_dom, 1) ix);
            ELSE
              v_mix_dom := v_mix_dom || v_best;       -- first touch fixes display order
              v_mix_cnt := v_mix_cnt || k_granularity;
            END IF;
          END LOOP;

          v_mix_json := '[]'::jsonb;
          FOR v_j IN 1 .. array_length(v_mix_dom, 1) LOOP
            v_mix_json := v_mix_json || jsonb_build_object(
              'domain', d_dom[v_mix_dom[v_j]],
              'count',  v_mix_cnt[v_j],
              'explanation_key', d_why[v_mix_dom[v_j]]);
            d_alloc[v_mix_dom[v_j]] := d_alloc[v_mix_dom[v_j]] + v_mix_cnt[v_j];
          END LOOP;

          v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_secname,
                        'scope', jsonb_build_object('level','domain','mix', v_mix_json),
                        'target_count', v_sec_q,
                        'explanation_key', CASE WHEN v_tapered THEN 'taper' ELSE 'weighted' END);
        END LOOP;

        v_planned_total := v_planned_total + (v_sec_units[1] + v_sec_units[2]) * k_granularity;
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  RETURN jsonb_build_object('generator', 'deterministic_v1', 'days', v_days);
END;
$$;

COMMENT ON FUNCTION public.calendar_compute_plan(jsonb) IS
  'Doc 05F §11 as superseded by the Doc 05F Formula Sheet §2 (sheet §8 item 4). Pure, IMMUTABLE, integer-only. scripts/ci/calendar-parity.ts proves it byte-equal to scripts/ci/reference/calendar_formula_reference.py on the nine fixtures and the seeded 3,000-snapshot suite.';

-- ----------------------------------------------------------------------------
-- 19. calendar_place_full_lengths — formula sheet §2 step 2
--
-- Both generators place exams identically (sheet §5A: "Step 2 exam placement
-- ... identical"), so the derivation lives in one function rather than twice.
-- A second copy is how the two generators would quietly drift apart.
--
-- Returns [{"date":"YYYY-MM-DD","explanation_key":"final_rehearsal"|"exam_cadence"}, ...]
-- in placement order: the final rehearsal first, then cadence exams in date
-- order. Precedence: (1) final rehearsal on the last weekday occurrence at
-- least final_exam_lead_days before the target; (2) nothing else inside the
-- lead window or on/after the target; (3) full_length_min_gap_days from the
-- last completed exam and from each other; (4) cadence; (5) the horizon cap.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_place_full_lengths(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  k_horizon_days integer;
  k_fl_every_n   integer;
  k_fl_min_gap   integer;
  k_final_lead   integer;
  k_fl_max       integer;
  p_today        date;
  p_setup        date;
  p_target       date;
  p_wd           integer;
  x_last         date;
  fl_date        date[] := '{}';
  fl_key         text[] := '{}';
  v_i            integer;
  v_d            date;
  v_probe        date;
  v_anchor       date;
  v_ok           boolean;
  v_out          jsonb := '[]'::jsonb;
BEGIN
  k_horizon_days := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_fl_every_n   := public.calendar_require_int(p_input -> 'constants', 'full_length_every_n_occurrences');
  k_fl_min_gap   := public.calendar_require_int(p_input -> 'constants', 'full_length_min_gap_days');
  k_final_lead   := public.calendar_require_int(p_input -> 'constants', 'final_exam_lead_days');
  k_fl_max       := public.calendar_require_int(p_input -> 'constants', 'max_full_length_per_horizon');

  p_today  := (p_input ->> 'today')::date;
  p_setup  := (p_input #>> '{profile,setup_date}')::date;
  p_target := (p_input #>> '{profile,target_exam_date}')::date;
  p_wd     := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                   ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;
  x_last   := (p_input #>> '{exams,last_completed_local_date}')::date;

  -- No full-length weekday means no automatic exams at all (§7.1).
  IF p_wd IS NULL THEN
    RETURN v_out;
  END IF;
  IF p_setup IS NULL THEN
    RAISE EXCEPTION 'calendar_place_full_lengths: profile.setup_date is essential and was not supplied'
      USING ERRCODE = '22023';
  END IF;

  IF p_target IS NOT NULL THEN
    v_probe := p_target - k_final_lead;
    WHILE EXTRACT(DOW FROM v_probe)::integer <> p_wd LOOP
      v_probe := v_probe - 1;
    END LOOP;
    IF v_probe >= p_today AND v_probe <= p_today + (k_horizon_days - 1) THEN
      fl_date := fl_date || v_probe;
      fl_key  := fl_key  || 'final_rehearsal'::text;
    END IF;
  END IF;

  v_anchor := p_setup;
  WHILE EXTRACT(DOW FROM v_anchor)::integer <> p_wd LOOP
    v_anchor := v_anchor + 1;
  END LOOP;

  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    -- COALESCE, not a bare array_length: an empty array measures NULL, and
    -- NULL >= 0 is NULL, which would let a cap of zero place exams anyway.
    EXIT WHEN COALESCE(array_length(fl_date, 1), 0) >= k_fl_max;
    v_d := p_today + v_i;
    CONTINUE WHEN EXTRACT(DOW FROM v_d)::integer <> p_wd;
    CONTINUE WHEN v_d = ANY (fl_date);
    CONTINUE WHEN v_d < v_anchor;                      -- guards the division below
    CONTINUE WHEN ((v_d - v_anchor) / 7) % k_fl_every_n <> 0;
    CONTINUE WHEN p_target IS NOT NULL AND (v_d >= p_target OR (p_target - v_d) < k_final_lead);
    v_ok := true;
    FOREACH v_probe IN ARRAY fl_date LOOP
      IF abs(v_d - v_probe) < k_fl_min_gap THEN v_ok := false; END IF;
    END LOOP;
    IF x_last IS NOT NULL AND abs(v_d - x_last) < k_fl_min_gap THEN v_ok := false; END IF;
    IF v_ok THEN
      fl_date := fl_date || v_d;
      fl_key  := fl_key  || 'exam_cadence'::text;
    END IF;
  END LOOP;

  FOR v_i IN 1 .. COALESCE(array_length(fl_date, 1), 0) LOOP
    v_out := v_out || jsonb_build_object('date', fl_date[v_i]::text, 'explanation_key', fl_key[v_i]);
  END LOOP;
  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.calendar_place_full_lengths(jsonb) IS
  'Doc 05F formula sheet §2 step 2. Shared by both generators (sheet §5A: exam placement is identical), so the precedence rules have exactly one implementation.';

-- ----------------------------------------------------------------------------
-- 20. calendar_compute_plan_fallback — fallback_v1 (formula sheet §5A)
--
-- The fail-open backup. Same six steps with every mastery-dependent part
-- removed, so it needs only the profile plus, where readable, the last exam's
-- facts and a single total of review due. It reads no mastery, no per-date
-- review queue and no plan history, which is precisely why it can still run
-- when the builder reports those as degraded.
--
-- Pure and IMMUTABLE, integer-only, same output shape and same validator as
-- deterministic_v1. Every practice block carries the explanation key
-- 'fallback' so the UI and the audit trail say why the day looks like this.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_compute_plan_fallback(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  k_horizon_days      integer;
  k_review_share_bp   integer;
  k_review_block_max  integer;
  k_exam_review_dflt  integer;
  k_min_domain_q      integer;
  k_granularity       integer;
  k_taper_days        integer;
  k_taper_bp          integer;
  e_practice_secs     integer;
  e_review_secs       integer;
  p_today             date;
  p_mask              integer;
  p_minutes           integer;
  p_target            date;
  x_last              date;
  x_reviewed          boolean;
  x_missed            integer;
  fl                  jsonb;
  v_due               integer := 0;
  v_pending_active    boolean := false;
  v_pending_size      integer;
  v_pending_key       text;
  v_study_index       integer := 0;
  v_i                 integer;
  v_d                 date;
  v_days              jsonb := '[]'::jsonb;
  v_blocks            jsonb;
  v_budget            integer;
  v_tapered           boolean;
  v_dd                integer;
  v_size              integer;
  v_r                 integer;
  v_day_q             integer;
  v_half              integer;
  v_lead              text;
  v_other             text;
  v_key               text;
  v_fl_key            text;
BEGIN
  k_horizon_days     := public.calendar_require_int(p_input -> 'constants', 'horizon_days');
  k_review_share_bp  := public.calendar_require_int(p_input -> 'constants', 'review_share_max_bp');
  k_review_block_max := public.calendar_require_int(p_input -> 'constants', 'review_block_max');
  k_exam_review_dflt := public.calendar_require_int(p_input -> 'constants', 'exam_review_default_count');
  k_min_domain_q     := public.calendar_require_int(p_input -> 'constants', 'min_domain_questions');
  k_granularity      := public.calendar_require_int(p_input -> 'constants', 'granularity');
  k_taper_days       := public.calendar_require_int(p_input -> 'constants', 'taper_days');
  k_taper_bp         := public.calendar_require_int(p_input -> 'constants', 'taper_ratio_bp');

  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');
  IF e_practice_secs < 1 OR e_review_secs < 1 THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: engine_planning seconds-per-unit must be positive'
      USING ERRCODE = '22023';
  END IF;

  IF (p_input ->> 'today') IS NULL THEN
    RAISE EXCEPTION 'calendar_compute_plan_fallback: snapshot has no today' USING ERRCODE = '22023';
  END IF;
  p_today   := (p_input ->> 'today')::date;
  p_mask    := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_target  := (p_input #>> '{profile,target_exam_date}')::date;

  x_last     := (p_input #>> '{exams,last_completed_local_date}')::date;
  x_reviewed := (p_input #> '{exams,reviewed}')::boolean;
  x_missed   := CASE WHEN (p_input #>> '{exams,missed_count}') IS NULL THEN NULL
                     ELSE public.calendar_require_int(p_input -> 'exams', 'missed_count') END;

  fl := public.calendar_place_full_lengths(p_input);

  -- A single total is enough here: the fallback runs precisely when the
  -- per-date review queue may be unreadable.
  SELECT COALESCE(sum(public.calendar_require_int(r, 'due_count')), 0) INTO v_due
  FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r;

  -- Unlike deterministic_v1, a missing OR ZERO missed count falls back to the
  -- placeholder size rather than leaving the debt standing. The fallback's whole
  -- job is to produce a usable day from partial inputs; deterministic_v1 has the
  -- real number or it waits. Both behaviours are the reference's.
  IF x_last IS NOT NULL AND COALESCE(x_reviewed, true) IS NOT true THEN
    v_pending_active := true;
    v_pending_size   := CASE WHEN COALESCE(x_missed, 0) = 0 THEN k_exam_review_dflt ELSE x_missed END;
    v_pending_key    := 'exam_review';
  END IF;

  FOR v_i IN 0 .. k_horizon_days - 1 LOOP
    v_d := p_today + v_i;

    SELECT f ->> 'explanation_key' INTO v_fl_key
    FROM jsonb_array_elements(fl) f WHERE (f ->> 'date')::date = v_d;

    IF v_fl_key IS NOT NULL THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', jsonb_build_array(
        jsonb_build_object('block_type','full_length','section', NULL,
                           'scope', jsonb_build_object('form_id', NULL),
                           'target_count', 1, 'explanation_key', v_fl_key)));
      v_pending_active := true;
      v_pending_size   := k_exam_review_dflt;
      v_pending_key    := 'exam_review_placeholder';
      CONTINUE;
    END IF;

    IF ((p_mask >> (EXTRACT(DOW FROM v_d)::integer)) & 1) <> 1 THEN
      v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', '[]'::jsonb);
      CONTINUE;
    END IF;

    v_budget := p_minutes * 60;
    v_tapered := false;
    IF p_target IS NOT NULL THEN
      v_dd := p_target - v_d;
      IF v_dd <= 0 THEN
        v_budget := 0;
      ELSIF v_dd <= k_taper_days THEN
        v_budget := v_budget * k_taper_bp / 10000;
        v_tapered := true;
      END IF;
    END IF;

    v_blocks := '[]'::jsonb;

    IF v_pending_active THEN
      v_size := least(v_pending_size, v_budget / e_review_secs);
      IF v_size >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_size, 'explanation_key', v_pending_key);
        v_budget := v_budget - v_size * e_review_secs;
        v_pending_active := false;
      END IF;
    ELSE
      v_r := least(v_due, k_review_block_max, (k_review_share_bp * v_budget / 10000) / e_review_secs);
      IF v_r >= 1 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','review','section', NULL,
                      'scope', jsonb_build_object('mode','queue'),
                      'target_count', v_r, 'explanation_key','review_due');
        v_due := v_due - v_r;
        v_budget := v_budget - v_r * e_review_secs;
      END IF;
    END IF;

    -- Two practice blocks, Math and R&W halves, the leading section alternating
    -- by study-day index so no state has to be stored to keep them balanced.
    v_day_q := (v_budget / e_practice_secs) / k_granularity * k_granularity;
    IF v_day_q >= k_min_domain_q THEN
      v_half := (v_day_q / k_granularity / 2) * k_granularity;
      IF v_study_index % 2 = 0 THEN v_lead := 'M'; v_other := 'RW';
      ELSE v_lead := 'RW'; v_other := 'M'; END IF;
      v_key := CASE WHEN v_tapered THEN 'taper' ELSE 'fallback' END;
      v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_lead,
                    'scope', jsonb_build_object('level','section','count', v_day_q - v_half,
                                                'explanation_key', v_key),
                    'target_count', v_day_q - v_half, 'explanation_key', v_key);
      IF v_half <> 0 THEN
        v_blocks := v_blocks || jsonb_build_object('block_type','practice','section', v_other,
                      'scope', jsonb_build_object('level','section','count', v_half,
                                                  'explanation_key', v_key),
                      'target_count', v_half, 'explanation_key', v_key);
      END IF;
    END IF;

    v_days := v_days || jsonb_build_object('date', v_d::text, 'blocks', v_blocks);
    v_study_index := v_study_index + 1;
  END LOOP;

  RETURN jsonb_build_object('generator', 'fallback_v1', 'days', v_days);
END;
$$;

COMMENT ON FUNCTION public.calendar_compute_plan_fallback(jsonb) IS
  'Doc 05F formula sheet §5A. The fail-open backup: profile-only inputs, no mastery, no per-date review queue, no plan history. Same output shape and validator as deterministic_v1; every practice block carries explanation_key = fallback.';

-- ----------------------------------------------------------------------------
-- 21. calendar_plan_to_output — generator plan -> Doc 05F §10.2 PlanOutput
--
-- The generators emit days of blocks. §10.2 is a richer shape: each date
-- carries its override flag and an ordered member list, where a member is
-- either a newly created block or a carried block id. Display order is array
-- order, and calendar_persist_version turns that into display_ordinal.
--
-- Carried members come from §12.2 protected state — a block the student has
-- already started is never regenerated away — and are merged in by
-- calendar_persist_version before validation, which is why this converter
-- emits created members only.
--
-- This is also where enabled_block_types is applied (§21 as amended by sheet
-- §8 item 12; validator V-03). Both generators always compute the WHOLE day,
-- review and full-length included, because those blocks consume the day's
-- budget — a plan generated with review suppressed is a different plan, and
-- filtering inside the formula would break parity with the oracle. So the
-- formula decides the day and this boundary decides what is offered: at launch
-- the flag is ["practice"], so review and full-length blocks are computed,
-- charged against the budget, and then not persisted. When each engine lands
-- the flag gains a member (G-08-02, G-08-03) and those blocks appear with no
-- change to the formula.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_plan_to_output(
  p_plan jsonb, p_generator_version text, p_enabled_block_types text[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'generator', p_plan ->> 'generator',
    'generator_version', p_generator_version,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'scheduled_date', d ->> 'date',
               'is_user_override', false,
               'members', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('kind', 'created', 'block', b) ORDER BY ord)
                 FROM jsonb_array_elements(d -> 'blocks') WITH ORDINALITY AS e(b, ord)
                 WHERE (b ->> 'block_type') = ANY (p_enabled_block_types)
               ), '[]'::jsonb))
             ORDER BY ord)
      FROM jsonb_array_elements(p_plan -> 'days') WITH ORDINALITY AS t(d, ord)
    ), '[]'::jsonb));
$$;

COMMENT ON FUNCTION public.calendar_plan_to_output(jsonb, text, text[]) IS
  'Doc 05F §10.2. Generator days -> PlanOutput dates/members, filtered to enabled_block_types (§21 / sheet §8 item 12). Created members only; carried members are merged by calendar_persist_version from §12.2 protected state.';

-- ----------------------------------------------------------------------------
-- 22. calendar_validate_plan — Doc 05F §10.3, as amended by formula sheet §8
--     item 6
--
-- Pure. Returns
--   {"result":"accepted"} or
--   {"result":"rejected","violations":[{"rule":"V-04","date":"...","detail":"..."}]}
-- and never raises on a bad plan: a rejection is data, because
-- calendar_persist_version has to record it and fall back rather than abort
-- (sheet §5A). It raises only when the SNAPSHOT itself is unusable, which is a
-- different failure.
--
-- Modes: 'generated' | 'student_edit' | 'do_it_now' | 'rollback'.
--
-- V-07 is RETIRED, not skipped. It checked skill_codes against the registry;
-- sheet §8 item 3 removed skill_codes from calendar_blocks entirely, so there
-- is nothing left for it to check. Scope is domain-level, or section-level at
-- cold start (sheet §1). The rule is listed here so a reader does not think it
-- was forgotten.
--
-- FINDING for the owner (does not block this migration): Doc 05F §17.6 still
-- keys its student-facing copy to the PRE-SHEET vocabulary — weak_domain,
-- maintain_strength, post_exam_focus — while the sheet §6 keys the generators
-- actually emit are weak, strength, post_exam, balanced, exploring. §17.6 also
-- has no copy for taper, exam_review, exam_review_placeholder, weighted or
-- fallback. Sheet §8 item 4 retires §11.6 but says nothing about §17.6, so the
-- gap is uncovered. V-09 below validates against what the generators emit, per
-- the sheet; §17.6 needs renaming and five new rows, which is the owner's to
-- write — inventing student-facing copy here would be worse than reporting it.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.calendar_validate_plan(p_mode text, p_input jsonb, p_output jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  c_block_keys  CONSTANT text[] := ARRAY[
    'review_due','exam_review','exam_review_placeholder','final_rehearsal',
    'exam_cadence','taper','cold_start','weighted','fallback'];
  c_domain_keys CONSTANT text[] := ARRAY['weak','exploring','balanced','strength','post_exam'];

  k_granularity   integer;
  k_min_domain_q  integer;
  k_max_domains   integer;
  k_review_max    integer;
  k_fl_max        integer;
  e_practice_secs integer;
  e_review_secs   integer;

  p_today      date;
  p_mask       integer;
  p_minutes    integer;
  p_wd         integer;
  v_enabled    text[];
  v_gen_dates  date[];

  v_viol       jsonb := '[]'::jsonb;
  v_date       date;
  v_rec        record;
  v_m          jsonb;
  v_b          jsonb;
  v_sec_seen   text[];
  v_secs       integer;
  v_created_fl integer := 0;
  v_fl_total   integer := 0;
  v_review_planned integer := 0;
  v_due_through integer;
  v_has_created_fl boolean;
  v_count      integer;
  v_sum        integer;
  v_txt        text;
BEGIN
  IF p_mode NOT IN ('generated','student_edit','do_it_now','rollback') THEN
    RAISE EXCEPTION 'calendar_validate_plan: unknown mode ''%''', p_mode USING ERRCODE = '22023';
  END IF;

  k_granularity   := public.calendar_require_int(p_input -> 'constants', 'granularity');
  k_min_domain_q  := public.calendar_require_int(p_input -> 'constants', 'min_domain_questions');
  k_max_domains   := public.calendar_require_int(p_input -> 'constants', 'max_domains_per_block');
  k_review_max    := public.calendar_require_int(p_input -> 'constants', 'review_block_max');
  k_fl_max        := public.calendar_require_int(p_input -> 'constants', 'max_full_length_per_horizon');
  e_practice_secs := public.calendar_require_int(p_input -> 'engine_planning', 'practice_seconds_per_unit');
  e_review_secs   := public.calendar_require_int(p_input -> 'engine_planning', 'review_seconds_per_unit');

  p_today   := (p_input ->> 'today')::date;
  p_mask    := public.calendar_require_int(p_input -> 'profile', 'study_days_mask');
  p_minutes := public.calendar_require_int(p_input -> 'profile', 'daily_minutes');
  p_wd      := CASE WHEN (p_input #>> '{profile,full_length_weekday}') IS NULL THEN NULL
                    ELSE public.calendar_require_int(p_input -> 'profile', 'full_length_weekday') END;

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(COALESCE(p_input -> 'enabled_block_types', '[]'::jsonb)) t;

  -- generated_for.dates is the horizon the builder froze. When it is absent the
  -- generator's own days are the horizon, which is the case for a plain
  -- generate-and-validate round trip.
  SELECT COALESCE(array_agg(t::date), '{}') INTO v_gen_dates
  FROM jsonb_array_elements_text(COALESCE(p_input #> '{generated_for,dates}', '[]'::jsonb)) t;

  FOR v_rec IN
    SELECT (d ->> 'scheduled_date')::date AS sd,
           COALESCE((d ->> 'is_user_override')::boolean, false) AS ovr,
           d -> 'members' AS members,
           ord
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) WITH ORDINALITY AS t(d, ord)
  LOOP
    v_date := v_rec.sd;

    ------------------------------------------------------------------ V-01
    IF COALESCE(array_length(v_gen_dates, 1), 0) > 0 AND NOT (v_date = ANY (v_gen_dates)) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-01','date',v_date::text,
                  'detail','date is outside generated_for.dates');
    END IF;
    IF v_date < p_today THEN
      v_viol := v_viol || jsonb_build_object('rule','V-01','date',v_date::text,
                  'detail','date is before the student-local today');
    END IF;

    ------------------------------------------------------------------ V-14
    IF p_mode IN ('generated','do_it_now')
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                     COALESCE(p_input -> 'current_overrides', '[]'::jsonb)) o
                   WHERE (o ->> 'scheduled_date')::date = v_date
                     AND (o ->> 'is_user_override')::boolean) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-14','date',v_date::text,
                  'detail', p_mode || ' may not take over a date the student has overridden');
    END IF;

    v_sec_seen := '{}';
    v_secs := 0;
    v_has_created_fl := false;
    v_count := 0;

    FOR v_m IN SELECT m FROM jsonb_array_elements(COALESCE(v_rec.members, '[]'::jsonb)) m LOOP
      v_count := v_count + 1;

      ---------------------------------------------------------------- V-13
      IF v_m ->> 'kind' = 'carried' THEN
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                         COALESCE(p_input -> 'existing_blocks_by_date', '[]'::jsonb)) x
                       WHERE x ->> 'block_id' = v_m ->> 'block_id'
                         AND (x ->> 'scheduled_date')::date = v_date) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-13','date',v_date::text,
                      'detail','carried block ' || COALESCE(v_m ->> 'block_id','<null>')
                            || ' is not an existing block of this student on this date');
        END IF;
        CONTINUE;
      END IF;

      v_b := v_m -> 'block';
      IF v_b IS NULL THEN
        v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                    'detail','created member carries no block');
        CONTINUE;
      END IF;

      ---------------------------------------------------------------- V-03
      IF NOT (v_b ->> 'block_type' = ANY (v_enabled)) THEN
        v_viol := v_viol || jsonb_build_object('rule','V-03','date',v_date::text,
                    'detail','block_type ' || COALESCE(v_b ->> 'block_type','<null>')
                          || ' is not in enabled_block_types');
      END IF;

      ---------------------------------------------------------------- V-06 (and the shape)
      IF NOT public.calendar_scope_is_valid(v_b ->> 'block_type', v_b ->> 'section', v_b -> 'scope') THEN
        v_viol := v_viol || jsonb_build_object('rule','V-06','date',v_date::text,
                    'detail','scope is not valid for this block_type and section');
      END IF;

      IF v_b ->> 'block_type' = 'full_length' THEN
        v_has_created_fl := true;
        v_created_fl := v_created_fl + 1;
        v_fl_total := v_fl_total + 1;
        -------------------------------------------------------------- V-02
        IF p_mode = 'generated'
           AND (p_wd IS NULL OR EXTRACT(DOW FROM v_date)::integer <> p_wd) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a full_length was created off the student''s full-length weekday');
        END IF;
        -------------------------------------------------------------- V-04
        IF public.calendar_require_int(v_b, 'target_count') <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','full_length target_count must be 1');
        END IF;

      ELSIF v_b ->> 'block_type' = 'review' THEN
        -------------------------------------------------------------- V-02
        IF p_mode = 'generated' AND ((p_mask >> (EXTRACT(DOW FROM v_date)::integer)) & 1) <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a review block was created on a non-study day');
        END IF;
        -------------------------------------------------------------- V-04
        -- review_block_max bounds ORDINARY review. An exam-review block is
        -- sized by the exam and may take the whole budget (sheet §2 step 4);
        -- sheet §8 item 6 puts its sizing under V-10, and V-05 still caps it
        -- at the day.
        IF public.calendar_require_int(v_b, 'target_count') < 1
           OR (v_b ->> 'explanation_key' = 'review_due'
               AND public.calendar_require_int(v_b, 'target_count') > k_review_max) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','review target_count is outside 1..review_block_max');
        END IF;
        v_secs := v_secs + public.calendar_require_int(v_b, 'target_count') * e_review_secs;
        -------------------------------------------------------------- V-10
        -- Ordinary review may not outrun what is actually due through this
        -- date. An exam-review block is sized by the exam, not the queue, so
        -- the queue cap does not apply to it (sheet §2 step 4).
        IF v_b ->> 'explanation_key' = 'review_due' THEN
          -- deterministic_v1 works a per-date queue, so availability is what is
          -- due THROUGH this date. fallback_v1 deliberately works a single
          -- total (sheet §5A) precisely because the per-date queue may be
          -- unreadable when it runs, so its availability is the horizon total.
          -- Holding it to the through-date cap would reject every fallback plan
          -- for doing exactly what §5A tells it to do.
          SELECT COALESCE(sum(public.calendar_require_int(r, 'due_count')), 0) INTO v_due_through
          FROM jsonb_array_elements(COALESCE(p_input -> 'review_due_by_date', '[]'::jsonb)) r
          WHERE p_output ->> 'generator' = 'fallback_v1' OR (r ->> 'date')::date <= v_date;
          IF v_review_planned + public.calendar_require_int(v_b, 'target_count') > v_due_through THEN
            v_viol := v_viol || jsonb_build_object('rule','V-10','date',v_date::text,
                        'detail','review target exceeds what is due through this date net of review already planned');
          END IF;
          v_review_planned := v_review_planned + public.calendar_require_int(v_b, 'target_count');
        END IF;

      ELSIF v_b ->> 'block_type' = 'practice' THEN
        -------------------------------------------------------------- V-02
        IF p_mode = 'generated' AND ((p_mask >> (EXTRACT(DOW FROM v_date)::integer)) & 1) <> 1 THEN
          v_viol := v_viol || jsonb_build_object('rule','V-02','date',v_date::text,
                      'detail','a practice block was created on a non-study day');
        END IF;
        -------------------------------------------------------------- V-04
        IF (v_b ->> 'section') = ANY (v_sec_seen) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                      'detail','more than one practice block in section ' || (v_b ->> 'section'));
        END IF;
        v_sec_seen := v_sec_seen || (v_b ->> 'section');

        IF v_b #>> '{scope,level}' = 'domain' THEN
          IF jsonb_array_length(v_b #> '{scope,mix}') > k_max_domains THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','more than max_domains_per_block domains in one block');
          END IF;
          SELECT COALESCE(sum(public.calendar_require_int(e, 'count')), 0),
                 COALESCE(string_agg(e ->> 'count', ',') FILTER (
                   WHERE public.calendar_require_int(e, 'count') % k_granularity <> 0
                      OR public.calendar_require_int(e, 'count') < k_min_domain_q), '')
            INTO v_sum, v_txt
          FROM jsonb_array_elements(v_b #> '{scope,mix}') e;
          IF v_txt <> '' THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','domain count(s) ' || v_txt || ' are not multiples of granularity at or above min_domain_questions');
          END IF;
          IF v_sum <> public.calendar_require_int(v_b, 'target_count') THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','the mix sums to ' || v_sum || ' but target_count is ' || (v_b ->> 'target_count'));
          END IF;
        ELSE
          IF public.calendar_require_int(v_b -> 'scope', 'count') <> public.calendar_require_int(v_b, 'target_count') THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','section-level scope count disagrees with target_count');
          END IF;
          IF public.calendar_require_int(v_b, 'target_count') % k_granularity <> 0
             OR public.calendar_require_int(v_b, 'target_count') < k_min_domain_q THEN
            v_viol := v_viol || jsonb_build_object('rule','V-04','date',v_date::text,
                        'detail','section-level practice count is not a multiple of granularity at or above min_domain_questions');
          END IF;
        END IF;
        v_secs := v_secs + public.calendar_require_int(v_b, 'target_count') * e_practice_secs;
      END IF;

      ---------------------------------------------------------------- V-09
      IF p_mode = 'generated' THEN
        IF NOT (v_b ->> 'explanation_key' = ANY (c_block_keys)) THEN
          v_viol := v_viol || jsonb_build_object('rule','V-09','date',v_date::text,
                      'detail','block explanation_key ' || COALESCE(v_b ->> 'explanation_key','<null>')
                            || ' is not in the formula sheet §6 block set');
        END IF;
        IF v_b #>> '{scope,level}' = 'domain' THEN
          SELECT string_agg(DISTINCT e ->> 'explanation_key', ',') INTO v_txt
          FROM jsonb_array_elements(v_b #> '{scope,mix}') e
          WHERE NOT (e ->> 'explanation_key' = ANY (c_domain_keys));
          IF v_txt IS NOT NULL THEN
            v_viol := v_viol || jsonb_build_object('rule','V-09','date',v_date::text,
                        'detail','domain explanation_key(s) ' || v_txt || ' are not in the formula sheet §6 domain set');
          END IF;
        END IF;
      END IF;
    END LOOP;

    ------------------------------------------------------------------ V-05
    IF p_mode = 'generated' THEN
      IF v_has_created_fl AND v_count > 1 THEN
        v_viol := v_viol || jsonb_build_object('rule','V-05','date',v_date::text,
                    'detail','an exam date carries other created blocks');
      END IF;
      IF v_secs > p_minutes * 60 THEN
        v_viol := v_viol || jsonb_build_object('rule','V-05','date',v_date::text,
                    'detail','planned seconds ' || v_secs || ' exceed the day budget ' || (p_minutes * 60));
      END IF;
    END IF;

    ------------------------------------------------------------------ V-12
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_input -> 'started_blocks_by_date', '[]'::jsonb)) s
      WHERE (s ->> 'scheduled_date')::date = v_date
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_rec.members, '[]'::jsonb)) m
          WHERE m ->> 'kind' = 'carried' AND m ->> 'block_id' = s ->> 'block_id')
    ) THEN
      v_viol := v_viol || jsonb_build_object('rule','V-12','date',v_date::text,
                  'detail','a block the student has already started was not carried');
    END IF;
  END LOOP;

  -------------------------------------------------------------------- V-08
  -- Display order IS the member array order (§10.2), so contiguity from 1 is
  -- automatic within one date. What is not automatic is a date appearing twice
  -- in `dates`: the two member lists would both start at ordinal 1 and collide
  -- on calendar_plan_block_memberships' UNIQUE (plan_version_id,
  -- scheduled_date, display_ordinal). Catching it here turns an opaque 23505
  -- inside the writer into a named rejection.
  FOR v_rec IN
    SELECT d ->> 'scheduled_date' AS sd, count(*) AS n
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) d
    GROUP BY 1 HAVING count(*) > 1
  LOOP
    v_viol := v_viol || jsonb_build_object('rule','V-08','date', v_rec.sd,
                'detail','the date appears ' || v_rec.n || ' times in the output; display ordinals would collide');
  END LOOP;

  -- A block id may not be carried onto two different dates in one plan: a
  -- block never moves (INV-08-22), and the composite FK would refuse it.
  FOR v_rec IN
    SELECT m ->> 'block_id' AS sd, count(DISTINCT d ->> 'scheduled_date') AS n
    FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) d,
         jsonb_array_elements(COALESCE(d -> 'members', '[]'::jsonb)) m
    WHERE m ->> 'kind' = 'carried'
    GROUP BY 1 HAVING count(DISTINCT d ->> 'scheduled_date') > 1
  LOOP
    v_viol := v_viol || jsonb_build_object('rule','V-08','date', NULL,
                'detail','carried block ' || v_rec.sd || ' appears on ' || v_rec.n || ' different dates');
  END LOOP;

  -------------------------------------------------------------------- V-11
  IF v_created_fl > k_fl_max THEN
    v_viol := v_viol || jsonb_build_object('rule','V-11','date', NULL,
                'detail','the horizon creates ' || v_created_fl
                      || ' full-lengths, above max_full_length_per_horizon ' || k_fl_max);
  END IF;

  IF jsonb_array_length(v_viol) = 0 THEN
    RETURN jsonb_build_object('result','accepted');
  END IF;
  RETURN jsonb_build_object('result','rejected','violations', v_viol);
END;
$$;

COMMENT ON FUNCTION public.calendar_validate_plan(text, jsonb, jsonb) IS
  'Doc 05F §10.3 as amended by formula sheet §8 item 6. Pure; returns a rejection as data rather than raising, because calendar_persist_version has to record it and fall back. V-07 is retired: sheet §8 item 3 removed skill_codes.';

COMMIT;
