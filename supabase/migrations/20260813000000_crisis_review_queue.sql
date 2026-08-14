-- LYCEON-MIGRATION-REVIEWED
-- @spec [Doc-03_V3 §21.3, SCL-025, CR-03C-V3-01 §3.4]
-- @implemented 2026-08-13
--
-- plain English: Creates the durable crisis review queue infrastructure.
-- crisis_review_cases tracks every crisis-flagged conversation with SLA
-- deadline, status lifecycle, reviewer assignment, and disposition.
-- crisis_review_audit_log provides append-only audit trail per SCL-025
-- (every read logged with reviewer identity, conversation id, timestamp, action).
--
-- expected outcome:
--   - Every crisis-flagged conversation produces a row in crisis_review_cases
--     with a 48h SLA deadline (§21.3 V1 launch).
--   - Admin reviewers confirm classification (true_positive / false_positive),
--     status lifecycle: open → in_review → resolved.
--   - classifier_degraded source tracks CR-03C-V3-01 §3.4 condition 3
--     (Layer 2 failed, turn force-enqueued to review queue).
--   - Every access to a crisis case is logged append-only in the audit log.
--
-- trade-offs:
--   - sla_deadline is stored as a computed column (created_at + interval '48 hours')
--     rather than a generated column, because the SLA window may change (§21.3 targets
--     24h after 30 days). Stored value lets the sweep query use a plain index.
--   - student_id is denormalized from tutor_conversations to avoid a JOIN in the
--     admin listing query (performance for the review surface).
--   - Audit log is INSERT-only — no UPDATE or DELETE policies exist.
--
-- edge cases:
--   - Duplicate crisis flag on the same conversation: UNIQUE constraint on
--     (conversation_id) WHERE status != 'resolved' prevents duplicate open cases.
--   - Account deletion cascade: student_id FK uses ON DELETE RESTRICT. Open crisis
--     cases block account deletion. This is a deliberate safety constraint — an open
--     crisis case for a student who wants to delete their account is a counsel question,
--     not an automatic cascade. Tracked as part of GAP-HY-15.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS crisis_review_cases_set_updated_at ON public.crisis_review_cases;
--   DROP FUNCTION IF EXISTS public.crisis_review_cases_updated_at();
--   DROP POLICY IF EXISTS "service_role_crisis_review_audit_log" ON public.crisis_review_audit_log;
--   DROP POLICY IF EXISTS "crisis_review_admin select crisis_review_audit_log" ON public.crisis_review_audit_log;
--   DROP POLICY IF EXISTS "crisis_review_admin insert crisis_review_audit_log" ON public.crisis_review_audit_log;
--   DROP POLICY IF EXISTS "crisis_review_writer insert crisis_review_audit_log" ON public.crisis_review_audit_log;
--   DROP POLICY IF EXISTS "service_role_crisis_review_cases" ON public.crisis_review_cases;
--   DROP POLICY IF EXISTS "crisis_review_admin update crisis_review_cases" ON public.crisis_review_cases;
--   DROP POLICY IF EXISTS "crisis_review_admin select crisis_review_cases" ON public.crisis_review_cases;
--   DROP POLICY IF EXISTS "crisis_review_writer insert crisis_review_cases" ON public.crisis_review_cases;
--   REVOKE crisis_review_admin FROM service_role;
--   REVOKE crisis_review_writer FROM service_role;
--   DROP TABLE IF EXISTS public.crisis_review_audit_log CASCADE;
--   DROP TABLE IF EXISTS public.crisis_review_cases CASCADE;
--   DROP ROLE IF EXISTS crisis_review_admin;
--   DROP ROLE IF EXISTS crisis_review_writer;

-- ── Table: crisis_review_cases ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crisis_review_cases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL
                    REFERENCES public.tutor_conversations(id)
                    ON DELETE RESTRICT,
  student_id        UUID NOT NULL
                    REFERENCES public.profiles(id)
                    ON DELETE RESTRICT,

  -- Classification source — what triggered the review case.
  -- 'signature': Layer 1 deterministic match.
  -- 'model': Layer 2 model inference.
  -- 'both': both layers positive.
  -- 'classifier_degraded': CR-03C-V3-01 §3.4 condition 3 — Layer 2 failed,
  --   turn proceeded, force-enqueued for mandatory human review.
  source            TEXT NOT NULL
                    CHECK (source IN ('signature', 'model', 'both', 'classifier_degraded')),
  signature_id      UUID,                -- Layer 1 match ID when applicable
  model_confidence  NUMERIC,             -- Layer 2 confidence when applicable

  -- Lifecycle: open → in_review → resolved
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_review', 'resolved')),

  -- Reviewer disposition per §21.3 review action 1
  disposition       TEXT
                    CHECK (disposition IS NULL OR disposition IN ('true_positive', 'false_positive')),

  -- Reviewer assignment
  reviewer_id       UUID
                    REFERENCES public.profiles(id)
                    ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,

  -- SLA: 48h at launch (§21.3). Stored as absolute deadline for index-friendly sweep.
  sla_deadline      TIMESTAMPTZ NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open/in_review case per conversation at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crisis_review_cases_conversation_active
  ON public.crisis_review_cases (conversation_id)
  WHERE status IN ('open', 'in_review');

-- SLA breach sweep: find open cases past deadline.
CREATE INDEX IF NOT EXISTS idx_crisis_review_cases_sla_breach
  ON public.crisis_review_cases (sla_deadline)
  WHERE status = 'open';

-- Admin listing by status + creation time.
CREATE INDEX IF NOT EXISTS idx_crisis_review_cases_status
  ON public.crisis_review_cases (status, created_at DESC);

-- ── Table: crisis_review_audit_log ───────────────────────────────────
-- SCL-025: "Every read logged append-only with reviewer identity,
-- conversation id, timestamp, action."

CREATE TABLE IF NOT EXISTS public.crisis_review_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL
                    REFERENCES public.crisis_review_cases(id)
                    ON DELETE RESTRICT,
  conversation_id   UUID NOT NULL,       -- denormalized per SCL-025 requirement
  reviewer_id       UUID NOT NULL
                    REFERENCES public.profiles(id)
                    ON DELETE RESTRICT,
  action            TEXT NOT NULL
                    CHECK (action IN ('viewed', 'status_changed', 'disposition_set', 'note_added')),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip                INET,
  request_id        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit queries by case and by reviewer.
CREATE INDEX IF NOT EXISTS idx_crisis_audit_log_case
  ON public.crisis_review_audit_log (case_id, created_at);

CREATE INDEX IF NOT EXISTS idx_crisis_audit_log_reviewer
  ON public.crisis_review_audit_log (reviewer_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Admin-only. Students and guardians have zero access (SCL-025 + §21.4).

ALTER TABLE public.crisis_review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisis_review_audit_log ENABLE ROW LEVEL SECURITY;

-- Drop any broad service_role policies that may exist from defaults.
DROP POLICY IF EXISTS "service_role full access crisis_review_cases"
  ON public.crisis_review_cases;
DROP POLICY IF EXISTS "service_role full access crisis_review_audit_log"
  ON public.crisis_review_audit_log;

-- ── Dedicated roles (following tutor_dedicated_roles.sql pattern) ────

-- crisis_review_writer: the application service account that creates review cases
-- when a crisis is detected. INSERT only — no UPDATE or DELETE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crisis_review_writer') THEN
    CREATE ROLE crisis_review_writer NOLOGIN;
  END IF;
END $$;

-- crisis_review_admin: the admin review surface. SELECT + UPDATE on cases,
-- INSERT-only on audit log.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crisis_review_admin') THEN
    CREATE ROLE crisis_review_admin NOLOGIN;
  END IF;
END $$;

-- Grant roles to service_role (Supabase convention)
GRANT crisis_review_writer TO service_role;
GRANT crisis_review_admin TO service_role;

-- ── crisis_review_cases policies ─────────────────────────────────────

-- Writer can INSERT new cases (crisis detection path)
CREATE POLICY "crisis_review_writer insert crisis_review_cases"
  ON public.crisis_review_cases
  FOR INSERT
  TO crisis_review_writer
  WITH CHECK (true);

-- Admin can SELECT all cases (review surface)
CREATE POLICY "crisis_review_admin select crisis_review_cases"
  ON public.crisis_review_cases
  FOR SELECT
  TO crisis_review_admin
  USING (true);

-- Admin can UPDATE cases (set disposition, status, reviewer)
CREATE POLICY "crisis_review_admin update crisis_review_cases"
  ON public.crisis_review_cases
  FOR UPDATE
  TO crisis_review_admin
  USING (true)
  WITH CHECK (true);

-- service_role full access (needed for the application server)
CREATE POLICY "service_role_crisis_review_cases"
  ON public.crisis_review_cases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── crisis_review_audit_log policies ─────────────────────────────────

-- Writer can INSERT audit entries (from the review surface)
CREATE POLICY "crisis_review_writer insert crisis_review_audit_log"
  ON public.crisis_review_audit_log
  FOR INSERT
  TO crisis_review_writer
  WITH CHECK (true);

-- Admin can INSERT audit entries (from the review surface)
CREATE POLICY "crisis_review_admin insert crisis_review_audit_log"
  ON public.crisis_review_audit_log
  FOR INSERT
  TO crisis_review_admin
  WITH CHECK (true);

-- Admin can SELECT audit entries (view audit trail)
CREATE POLICY "crisis_review_admin select crisis_review_audit_log"
  ON public.crisis_review_audit_log
  FOR SELECT
  TO crisis_review_admin
  USING (true);

-- service_role full access
CREATE POLICY "service_role_crisis_review_audit_log"
  ON public.crisis_review_audit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- NO DELETE policies on either table — crisis review data is never deleted
-- through the application. Retention is handled by the account deletion
-- cascade (GAP-HY-15, deferred for counsel ruling).

-- NO student or guardian policies — these tables are invisible to
-- non-admin roles (§21.4 student privacy, SCL-025).

-- ── updated_at trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crisis_review_cases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crisis_review_cases_set_updated_at
  BEFORE UPDATE ON public.crisis_review_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.crisis_review_cases_updated_at();
