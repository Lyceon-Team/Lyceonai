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
--                 public.calendar_viewer_is_admin().
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

COMMIT;
