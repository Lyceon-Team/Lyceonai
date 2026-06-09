-- ============================================================================
-- Lyceon — GENESIS 0000 (from-spec rebuild foundation)
-- ============================================================================
-- @spec [Doc-00_V6, §7 truth flow / §10 lifecycle] [Doc-01_V8 identity]
--       [Doc-01A_V1 primitives] [Doc-02A_V6 content] [Doc-02 Preamble_V3 §12 reveal matrix]
-- @implemented [2026-06-09]
-- plain English: from-scratch foundation schema for the teardown + genesis-from-spec
--   rebuild. Built FROM docs/Spec (NOT captured from deployed prod). Creates identity
--   (Doc 01 V8), platform primitives (Doc 01A), and the content-core question bank
--   (Doc 02A) needed for the reseed. Order: enum (before profiles) → identity (RLS on,
--   profiles.id FK RESTRICT) → 01A primitives → config family → content (questions,
--   anti-leak shape). Idempotent where practical.
-- Governing contract: docs/SpecAudit/30-genesis-recut/RECUT-CONTRACT.md
-- Correctness contract: contracts/ws1-genesis-foundation.contract.md
--
-- SCOPE (foundation only). Runtime engines (Doc 02B), mastery (Doc 05), scoring
--   (Doc 04), LISA (Doc 03), ops (Doc 06), analytics (Doc 07) are LATER waves.
--   Content-generation tables (questions_staging, promotion_log, question_versions)
--   are deferred to the content/generation wave. `guardian_link_audit` (Doc 01 V8 §35
--   shared append-only) is a DEFERRED identity object — its exact DDL is not pinned in
--   the sections grounded for this pass; it lands in a precise identity follow-up
--   (contract §F), not invented here.
--
-- PLATFORM ASSUMPTIONS (provided by Supabase, NOT created here):
--   • schema `auth` + `auth.users` + `auth.uid()` pre-exist (Supabase Auth).
--   • roles anon / authenticated / service_role pre-exist.
--   The CI fresh-apply harness stubs these for a non-Supabase throwaway Postgres.
--
-- SPEC-FIDELITY ADAPTATIONS (directional spec DDL → runnable Postgres; each flagged):
--   A1  profiles.age_years / is_under_13: Doc 01 V8 §4 writes GENERATED ALWAYS STORED,
--       which Postgres rejects (age() is not IMMUTABLE; a generated col cannot reference
--       another generated col). KEY: a STORED generated column is computed only at write
--       time, so it would ALSO go stale as a student ages — the under-13 birthday
--       transition (GAP-OP-01) is required under EITHER rendering. Rendered as plain
--       columns MAINTAINED AT WRITE by trigger `set_profile_age_fields` (schema-layer
--       enforcement, equivalent to GENERATED-at-write); time-passage transitions are
--       OP-01's job. → candidate SP-08 (spec DDL clarification).
--   A2  rate_limit_check_and_increment: rendered as the spec's single-statement atomic
--       INSERT…ON CONFLICT DO UPDATE…WHERE (Doc 01A §41) — check+increment in one
--       statement, no read-then-write race.
--   A3  RLS ENABLED as target-state (Ruling 3 / RECUT decision #6) — the Doc 01 V8 §14.3
--       Neon-pooling RLS-bypass deviation is retired (Supabase-in-place). → SP-04.
--   A4  questions anti-leak: RLS enabled + service-role-only grants (NO anon/authenticated).
--       Answer columns exist in the table; pre-submit unreadability is enforced by absence
--       of grant + RLS; the app serves the §12 reveal-matrix projection (Doc 02 Preamble §12).
--   A5  account_deletion_requests.stripe_cancellation_status: from Doc 01 V8 §40.2.1 prose
--       (not the Appendix B.6 DDL block). → candidate spec amendment (escalated).
--   A7  No closed "skills" reference table: Doc 02A §13 treats skill_codes as an open
--       text[] (no closed taxonomy); only section/difficulty/distractor taxonomies are seeded.
--   A8  No extensions declared in foundation 0000: `vector` is DEFERRED to the embeddings
--       wave (no vector cols here; GAP-HY-07 closes there); `pgcrypto` is unneeded since
--       gen_random_uuid() is core PG13+. Reconciled in contract A.3.
--   A9  distractor_taxonomy_v1 uses a COMPOSITE PK (section, label) so the spec-exact
--       label `partial_reasoning` (Doc 02A §18, listed under BOTH sections) is seeded
--       verbatim in each section — no invented suffixes.
--
-- ROLLBACK (INV-06: every-migration-has-rollback):
--   Genesis runs in ONE transaction (BEGIN/COMMIT). Any apply failure rolls back
--   atomically, leaving the (post-teardown, empty) public schema unchanged — there is no
--   partial state. To revert an ALREADY-APPLIED genesis, re-run the teardown
--   (docs/SpecAudit/30-genesis-recut/TEARDOWN-RUNBOOK.md: DROP SCHEMA public CASCADE;
--   CREATE SCHEMA public; restore grants) and restore from the owner's preservation
--   snapshot. Genesis only CREATEs/seeds — it destroys no pre-existing data (the schema
--   was already torn down before it runs), so the rollback is non-destructive by design.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — transactional all-or-nothing apply;
--   revert = teardown re-run + snapshot restore; no forward-data destruction (CREATE/seed only).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Owned extensions
--    @adaptation A8: foundation 0000 declares NO extensions (vector deferred to the
--      embeddings wave; gen_random_uuid() is core PG13+ so pgcrypto is unneeded).
--      Reconciled in contract A.3. (Rollback: header LYCEON-MIGRATION-REVIEWED block.)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 0a. Shared helper functions (no table deps)
-- ----------------------------------------------------------------------------
-- @spec [Doc-01A_V1, App B §B.2] append-only guard for shared append-only tables.
CREATE OR REPLACE FUNCTION public.prevent_update_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE are not permitted', TG_TABLE_NAME;
END;
$$;

-- @spec [Doc-01A_V1, §4] config-change invalidation NOTIFY for the *_runtime_config family.
CREATE OR REPLACE FUNCTION public.notify_config_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'config_invalidate',
    json_build_object('table', TG_TABLE_NAME, 'key', NEW.key, 'environment', NEW.environment)::text
  );
  RETURN NEW;
END;
$$;

-- @spec [Doc-01_V8, §4] @adaptation A1: maintain age_years/is_under_13 from date_of_birth
--   at write time (schema-layer COPPA derivation; GENERATED ALWAYS is not Postgres-valid
--   for age()). Time-passage transitions are owned by GAP-OP-01.
CREATE OR REPLACE FUNCTION public.set_profile_age_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date_of_birth IS NULL THEN
    NEW.age_years   := NULL;
    NEW.is_under_13 := NULL;
  ELSE
    NEW.age_years   := EXTRACT(YEAR FROM age(NEW.date_of_birth))::INTEGER;
    NEW.is_under_13 := (EXTRACT(YEAR FROM age(NEW.date_of_birth))::INTEGER < 13);
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. ENUMS — created BEFORE the tables that use them (SF-4 ordering constraint)
--    @spec [Doc-01_V8, §4]  profile_role MUST precede profiles.role.
-- ============================================================================
CREATE TYPE public.profile_role AS ENUM ('student', 'guardian', 'admin', 'tutor', 'teacher');

-- ============================================================================
-- 2. IDENTITY (Doc 01 V8) — single-writer per Appendix E; RLS enabled (A3)
-- ============================================================================

-- @spec [Doc-01_V8, §4] profiles — central identity; PK = auth.users(id) ON DELETE RESTRICT.
--   single writer: profile-service.ts
CREATE TABLE public.profiles (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email                 TEXT NOT NULL,
  full_name             TEXT,
  display_name          TEXT,
  role                  public.profile_role NOT NULL DEFAULT 'student',
  date_of_birth         DATE,
  age_years             INTEGER,     -- @adaptation A1 (maintained at write by trigger; not GENERATED)
  is_under_13           BOOLEAN,     -- @adaptation A1 (COPPA gate; maintained from date_of_birth)
  country_code          TEXT,        -- ISO 3166-1 alpha-2 (billing address authoritative)
  stripe_customer_id    TEXT UNIQUE,
  guardian_email        TEXT,
  guardian_consent      BOOLEAN DEFAULT FALSE,
  consent_given_at      TIMESTAMPTZ,
  guardian_profile_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_login_at         TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ, -- soft-delete marker (Part VII)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_role            ON public.profiles (role)               WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_stripe_customer ON public.profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_profiles_deleted         ON public.profiles (deleted_at)         WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_email_active ON public.profiles (lower(email))   WHERE deleted_at IS NULL;
-- @adaptation A1: derive age fields at write (schema-layer COPPA enforcement)
CREATE TRIGGER profiles_set_age BEFORE INSERT OR UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_age_fields();

-- @spec [Doc-01_V8, §20–§24] entitlements — student-scoped subscription state; writer: Stripe webhook handler.
CREATE TABLE public.entitlements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  tier                   TEXT NOT NULL CHECK (tier IN ('free', 'premium')),
  status                 TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','unpaid','incomplete','incomplete_expired','trialing')),
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id        TEXT,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN DEFAULT FALSE,
  grace_period_ends_at   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entitlements_profile ON public.entitlements (profile_id);
CREATE INDEX idx_entitlements_active  ON public.entitlements (profile_id) WHERE status = 'active' OR status = 'past_due';

-- @spec [Doc-01_V8, §27] entitlement_features — declarative feature gates; admin-mutable.
CREATE TABLE public.entitlement_features (
  feature_key             TEXT PRIMARY KEY,
  required_tier           TEXT NOT NULL CHECK (required_tier IN ('free', 'premium')),
  required_age_minimum    INTEGER DEFAULT 13,
  requires_tier_1_country BOOLEAN DEFAULT TRUE,
  blocked_during_live_exam BOOLEAN DEFAULT FALSE,
  min_abuse_score_tier    TEXT DEFAULT 'clean',
  enabled                 BOOLEAN DEFAULT TRUE,
  description             TEXT,
  added_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deprecated_at           TIMESTAMPTZ
);
-- @spec [Doc-01_V8, §27.2] launch feature seed
INSERT INTO public.entitlement_features (feature_key, required_tier, blocked_during_live_exam, description) VALUES
  ('practice_daily_free', 'free',    FALSE, 'Daily practice quota for free tier'),
  ('practice_unlimited',  'premium', FALSE, 'Unlimited practice'),
  ('tutor_access',        'premium', TRUE,  'LISA AI tutor access; blocked during live exam'),
  ('review_full',         'premium', FALSE, 'Full review with spaced repetition'),
  ('exam_full_length',    'premium', FALSE, 'Full-length SAT exams'),
  ('calendar_access',     'premium', FALSE, 'Study calendar'),
  ('mastery_detail',      'premium', FALSE, 'Section/domain/skill-level mastery breakdown'),
  ('historical_trends',   'premium', FALSE, 'Historical mastery trend data');

-- @spec [Doc-01_V8, §35] guardian_links — single guardian-derivation mechanism; writer: guardian-service.ts.
CREATE TABLE public.guardian_links (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  student_profile_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL CHECK (status IN ('active','pending_student_accept','pending_guardian_accept','revoked')),
  initiated_by           TEXT NOT NULL CHECK (initiated_by IN ('guardian','student','admin')),
  initiated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at            TIMESTAMPTZ,
  accepted_by_profile_id UUID REFERENCES public.profiles(id),
  revoked_at             TIMESTAMPTZ,
  revoked_by_profile_id  UUID REFERENCES public.profiles(id),
  revocation_reason      TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_active_link UNIQUE NULLS NOT DISTINCT (guardian_profile_id, student_profile_id, status)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT guardian_not_self CHECK (guardian_profile_id <> student_profile_id)
);
CREATE INDEX idx_guardian_links_guardian ON public.guardian_links (guardian_profile_id) WHERE status = 'active';
CREATE INDEX idx_guardian_links_student  ON public.guardian_links (student_profile_id)  WHERE status = 'active';

-- @spec [Doc-01_V8, §37.2] guardian_consent_requests — under-13 consent; writer: consent-service.ts.
CREATE TABLE public.guardian_consent_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_profile_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  guardian_email           TEXT NOT NULL,
  guardian_profile_id      UUID REFERENCES public.profiles(id),
  status                   TEXT NOT NULL CHECK (status IN ('pending','consented','denied','expired')),
  consent_token            TEXT NOT NULL UNIQUE,
  consent_token_expires_at TIMESTAMPTZ NOT NULL,
  consented_at             TIMESTAMPTZ,
  denied_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @spec [Doc-01_V8, §40 + §40.2.1] account_deletion_requests — soft-delete window; writer: deletion-service.ts.
CREATE TABLE public.account_deletion_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_hard_delete_at  TIMESTAMPTZ NOT NULL,
  actor_profile_id          UUID NOT NULL REFERENCES public.profiles(id),
  status                    TEXT NOT NULL CHECK (status IN ('pending','cancelled','completed')),
  stripe_cancellation_status TEXT NOT NULL DEFAULT 'pending'   -- @adaptation A5 (from §40.2.1 prose; not B.6 DDL)
    CHECK (stripe_cancellation_status IN ('pending','in_progress','completed','failed_manual','cancelled_by_recovery')),
  completion_at             TIMESTAMPTZ,
  deletion_reason           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_account_deletion_pending ON public.account_deletion_requests (scheduled_hard_delete_at) WHERE status = 'pending';

-- @spec [Doc-01_V8, §5] audit_logs — immutable identity-event trail; shared append-only.
CREATE TABLE public.audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id  UUID REFERENCES public.profiles(id),
  target_profile_id UUID REFERENCES public.profiles(id),
  action            TEXT NOT NULL,
  changes           JSONB,
  context           JSONB,
  ip_address        INET,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_target ON public.audit_logs (target_profile_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor  ON public.audit_logs (actor_profile_id,  created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs (action,            created_at DESC);
CREATE TRIGGER audit_logs_no_mutate BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();

-- 2a. Identity RLS (A3 — enabled target-state; writes are service-role only)
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_features      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_links            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_consent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;

-- @spec [Doc-01_V8, §4] a student may read only its own profile row; all writes service-role.
CREATE POLICY profiles_select_self ON public.profiles FOR SELECT USING (id = auth.uid());

-- ============================================================================
-- 3. PLATFORM PRIMITIVES (Doc 01A) — service-internal; NO anon/authenticated grants
-- ============================================================================

-- @spec [Doc-01A_V1, §31] idempotency_records — dedup ledger; writer: IdempotencyService.
CREATE TABLE public.idempotency_records (
  scope        TEXT NOT NULL,
  client_key   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  result       JSONB,
  status       TEXT NOT NULL CHECK (status IN ('completed','in_progress','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, client_key)
);
CREATE INDEX idx_idempotency_expires      ON public.idempotency_records (expires_at);
CREATE INDEX idx_idempotency_scope_status ON public.idempotency_records (scope, status);

-- @spec [Doc-01A_V1, §41] rate_limit_ledger — quota tracking; writer: RateLimitLedger.
CREATE TABLE public.rate_limit_ledger (
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket_key   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end   TIMESTAMPTZ NOT NULL,
  used_count   INTEGER NOT NULL DEFAULT 0,
  limit_count  INTEGER NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, bucket_key, window_start)
);
CREATE INDEX idx_ratelimit_window_end ON public.rate_limit_ledger (window_end);

-- @spec [Doc-01A_V1, §41] atomic reserve-under-limit. @adaptation A2: single-statement
--   INSERT…ON CONFLICT DO UPDATE…WHERE — the check+increment is one atomic statement
--   (no read-then-write race); the guarded DO UPDATE re-evaluates under the row lock.
CREATE OR REPLACE FUNCTION public.rate_limit_check_and_increment(
  p_profile_id UUID, p_bucket_key TEXT, p_cost INTEGER,
  p_window_start TIMESTAMPTZ, p_window_end TIMESTAMPTZ, p_limit INTEGER
) RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, used INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_used INTEGER;
BEGIN
  INSERT INTO public.rate_limit_ledger AS l
    (profile_id, bucket_key, window_start, window_end, used_count, limit_count)
  VALUES (p_profile_id, p_bucket_key, p_window_start, p_window_end, p_cost, p_limit)
  ON CONFLICT (profile_id, bucket_key, window_start) DO UPDATE
    SET used_count = l.used_count + p_cost, updated_at = now()
    WHERE l.used_count + p_cost <= p_limit
  RETURNING l.used_count INTO v_used;

  IF FOUND THEN
    allowed := TRUE; used := v_used; remaining := p_limit - v_used; RETURN NEXT; RETURN;
  END IF;

  -- denied: the window row exists and adding p_cost would exceed the limit.
  SELECT l.used_count INTO v_used FROM public.rate_limit_ledger AS l
   WHERE l.profile_id = p_profile_id AND l.bucket_key = p_bucket_key AND l.window_start = p_window_start;
  allowed := FALSE; used := COALESCE(v_used, 0); remaining := GREATEST(p_limit - COALESCE(v_used, 0), 0);
  RETURN NEXT;
END;
$$;

-- @spec [Doc-01A_V1, §55] abuse_score_incidents — shared append-only signal log.
CREATE TABLE public.abuse_score_incidents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  incident_type      TEXT NOT NULL,
  severity           SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  context            JSONB,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_module      TEXT NOT NULL
);
CREATE INDEX idx_abuse_incidents_student ON public.abuse_score_incidents (student_profile_id, detected_at DESC);
CREATE INDEX idx_abuse_incidents_type    ON public.abuse_score_incidents (incident_type, detected_at DESC);
CREATE TRIGGER abuse_score_incidents_no_mutate BEFORE UPDATE OR DELETE ON public.abuse_score_incidents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();

-- @spec [Doc-01A_V1, §55] abuse_scores — per-student trust tier; writer: AbuseScoreService.
CREATE TABLE public.abuse_scores (
  student_profile_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  score                      INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier                       TEXT NOT NULL,
  computed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  manual_override            BOOLEAN DEFAULT FALSE,
  manual_override_expires_at TIMESTAMPTZ,
  appeal_history             JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX idx_abuse_scores_tier ON public.abuse_scores (tier) WHERE tier <> 'clean';

-- @spec [Doc-01A_V1, §64] service_auth_secrets — HMAC per-service-pair rotation ledger; writer: admin/ops.
CREATE TABLE public.service_auth_secrets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_service  TEXT NOT NULL,
  callee_service  TEXT NOT NULL,
  secret_material TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_until    TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  UNIQUE (caller_service, callee_service, created_at)
);
CREATE INDEX idx_service_auth_active ON public.service_auth_secrets (caller_service, callee_service) WHERE revoked_at IS NULL;

-- 3a. Primitive RLS — enabled, deny-all to anon/authenticated (service-role only; §49/§57 non-visibility).
--     No anon/authenticated grants are issued for any 01A table (contract C.5).
ALTER TABLE public.idempotency_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_score_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_scores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_auth_secrets  ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. CONFIG FAMILY (Doc 01A §2/§4/§5) — 12 *_config tables + _history + triggers
--    @spec [Doc-01A_V1, §2 template / §4 NOTIFY / §5 history] ; Doc 01 V8 App A names.
--    Admin-mutable; service-role read. History is append-only.
-- ============================================================================
DO $cfg$
DECLARE
  cfg_names TEXT[] := ARRAY[
    -- Doc 01 V8 App A (identity domain config)
    'auth_runtime_config','auth_mfa_config','consent_runtime_config',
    'entitlement_runtime_config','account_deletion_runtime_config','mobile_auth_config',
    -- Doc 01A §8 (primitive domain config)
    'rate_limit_runtime_config','idempotency_runtime_config','abuse_score_runtime_config',
    'observability_runtime_config','caching_runtime_config','internal_service_auth_config'
  ];
  n TEXT;
BEGIN
  FOREACH n IN ARRAY cfg_names LOOP
    EXECUTE format($t$
      CREATE TABLE public.%I (
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
      );$t$, n);

    EXECUTE format($t$
      CREATE TABLE public.%I (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name           TEXT NOT NULL,
        key                  TEXT NOT NULL,
        old_value            JSONB,
        new_value            JSONB NOT NULL,
        changed_by_profile_id UUID REFERENCES public.profiles(id),
        change_reason        TEXT,
        changed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );$t$, n || '_history');

    EXECUTE format($t$
      CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.notify_config_change();$t$, n || '_notify', n);

    EXECUTE format($t$
      CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete();$t$, n || '_history_no_mutate', n || '_history');

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', n);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', n || '_history');
  END LOOP;
END;
$cfg$;

-- ============================================================================
-- 5. CONTENT-CORE (Doc 02A) — questions bank (anti-leak shape) + reference taxonomy
-- ============================================================================

-- @spec [Doc-02A_V6, §14/§16/§17] questions — canonical bank. Answer columns present;
--   pre-submit unreadability via service-role-only grant + RLS (A4). NO answer_text (decision #7).
CREATE TABLE public.questions (
  id            TEXT PRIMARY KEY CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'),  -- §14 canonical id
  section       TEXT NOT NULL CHECK (section IN ('M','RW')),                 -- §14
  source_type   INTEGER NOT NULL CHECK (source_type IN (1,2)),               -- §14
  domain        TEXT NOT NULL,
  skill_codes   TEXT[] NOT NULL,                                             -- §13 open taxonomy (A7)
  difficulty    INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),         -- §17 (closes GAP-EX-06)
  stem          TEXT NOT NULL,
  passage       TEXT,
  options       JSONB NOT NULL,            -- student-visible [{key,text}] only (§19)
  correct_answer TEXT NOT NULL,            -- INTERNAL: pre-submit never served (§12)
  explanation   TEXT NOT NULL,             -- INTERNAL: post-submit only (§12)
  option_metadata JSONB,                   -- INTERNAL: never to clients (§19)
  assets        JSONB,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','qa','published','retired')),
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  retired_at    TIMESTAMPTZ,
  source_lineage         JSONB,            -- INTERNAL (provenance)
  generation_attribution JSONB,            -- INTERNAL
  estimated_time_seconds INTEGER,
  premium_flag  BOOLEAN DEFAULT FALSE,
  quality_score NUMERIC,
  issue_flags   TEXT[]
);
CREATE INDEX idx_questions_section ON public.questions (section) WHERE status = 'published';
CREATE INDEX idx_questions_status  ON public.questions (status);

-- 5a. questions anti-leak posture (A4): RLS enabled, NO anon/authenticated grant.
--     Service-role reads full; the app serves the §12 reveal-matrix projection.
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

-- @spec [Doc-02A_V6, §14/§17/§18] reference taxonomy (closes GAP-HY-08). (A7: no closed skills table.)
-- Grant posture: `sections`/`difficulties` are client-facing labels (anon-readable); the rest are
-- INTERNAL — `distractor_taxonomy_v1` is anti-leak-sensitive trap metadata (Doc 02A §19: must not
-- reach students), `source_types`/`taxonomy_versions` are ops-internal — so service-role only.
CREATE TABLE public.sections (
  code TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT
);
INSERT INTO public.sections (code, label, description) VALUES
  ('M',  'Math',              'Mathematics section of the SAT'),
  ('RW', 'Reading & Writing', 'Reading and Writing combined section of the SAT');

CREATE TABLE public.difficulties (
  value INTEGER PRIMARY KEY, label TEXT NOT NULL, description TEXT
);
INSERT INTO public.difficulties (value, label, description) VALUES
  (1, 'Easy',   'Difficulty level 1 — Easy'),
  (2, 'Medium', 'Difficulty level 2 — Medium'),
  (3, 'Hard',   'Difficulty level 3 — Hard');

CREATE TABLE public.source_types (
  code INTEGER PRIMARY KEY, label TEXT NOT NULL, description TEXT
);
INSERT INTO public.source_types (code, label, description) VALUES
  (1, 'Source-derived', 'Derived from source materials'),
  (2, 'AI-generated',   'Generated by AI model');

-- @spec [Doc-02A_V6, §18] distractor taxonomy v1 (closed enum). @adaptation A9: composite PK
--   (section, label) so the spec-exact label `partial_reasoning` is seeded in BOTH sections.
CREATE TABLE public.distractor_taxonomy_v1 (
  section     TEXT NOT NULL REFERENCES public.sections(code),
  label       TEXT NOT NULL,
  description TEXT,
  version     TEXT NOT NULL DEFAULT 'distractor_taxonomy.v1',
  PRIMARY KEY (section, label)
);
INSERT INTO public.distractor_taxonomy_v1 (section, label, description) VALUES
  ('M','sign_error','Wrong sign in calculation'),
  ('M','arithmetic_slip','Careless arithmetic mistake'),
  ('M','equation_setup_error','Incorrect equation setup or order of operations'),
  ('M','unit_error','Wrong units in answer'),
  ('M','graph_read_error','Misread graph or data visualization'),
  ('M','concept_gap','Fundamental misunderstanding of concept'),
  ('M','partial_reasoning','Incomplete reasoning or partial application of concept'),
  ('M','misread_question','Misread or misunderstood the stem'),
  ('RW','detail_misread','Misread a specific detail or fact'),
  ('RW','inference_overreach','Drew an inference beyond what text supports'),
  ('RW','evidence_mismatch','Selected evidence that does not support the claim'),
  ('RW','grammar_rule_error','Misapplied or confused a grammar rule'),
  ('RW','sentence_boundary_error','Error in sentence boundaries or punctuation'),
  ('RW','rhetorical_purpose_error','Misunderstood the rhetorical purpose'),
  ('RW','vocab_context_error','Word choice or vocabulary-in-context error'),
  ('RW','partial_reasoning','Incomplete reasoning or partial application of concept');

CREATE TABLE public.taxonomy_versions (
  version TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT, is_active BOOLEAN DEFAULT TRUE
);
INSERT INTO public.taxonomy_versions (version, description, is_active) VALUES
  ('distractor_taxonomy.v1', 'Starter closed enum per Doc 02A §18', TRUE);

-- reference-table RLS. sections/difficulties are client-readable; the rest service-role only.
ALTER TABLE public.sections              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.difficulties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distractor_taxonomy_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_versions     ENABLE ROW LEVEL SECURITY;
CREATE POLICY sections_read     ON public.sections     FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY difficulties_read ON public.difficulties FOR SELECT TO anon, authenticated USING (TRUE);

-- ============================================================================
-- 6. Final grants — service_role owns all writes; anon/authenticated minimal.
--    (Re-asserted after all objects exist so service_role covers the full set.)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
-- student-scoped minimal reads (everything else is service-role only / RLS deny):
GRANT SELECT ON public.profiles      TO authenticated;          -- RLS profiles_select_self limits rows
GRANT SELECT ON public.sections, public.difficulties TO anon, authenticated;
-- questions + all 01A primitives: deliberately NO anon/authenticated grant
-- (A4 anti-leak / C.5 service-internal — app serves the §12 projection).

COMMIT;
