-- ============================================================================
-- 05E §3/§5/§6/§8 step 1 — Actor-ID Substrate (PR-5a, additive)
-- ============================================================================
-- @spec [Doc-05E §3 actor_id mechanism, §5 table partition, §6 INV-05E-03,
--        §8 step 1 substrate] | SCL-010 (supersedes 05D §10.2 v_surrogate)
-- @implemented [2026-06-25]
-- plain English: additive-only substrate for the decoupled actor_id anonymization
--   mechanism. Creates the anonymized_actors ledger (zero identity data), adds
--   profiles.actor_id (the mapping home, destroyed at cascade), adds nullable
--   actor_id to 5 activity tables + 2 audit-layer tables (7 total per SCL-011),
--   and drops NOT NULL on the 5 activity-table identity columns so SET NULL is
--   legal at anonymization time (5d). Audit-layer student_id NOT NULL unchanged
--   (different disposition per 05D §10). No behavioral change — write-path
--   stamping (5b), backfill (5c), and anonymize logic (5d) are separate PRs.
-- LYCEON-MIGRATION-REVIEWED

-- ============================================================================
-- 1. anonymized_actors ledger (05E §3.1)
-- ============================================================================
-- Records that an actor_id has been anonymized. Zero identity data. Event tables
-- do NOT FK to this table — actor_id is a free grouping column, not an integrity
-- parent. The ledger exists so queries can distinguish "this actor_id is
-- anonymized" from "this actor_id is still live."
CREATE TABLE public.anonymized_actors (
  actor_id      uuid PRIMARY KEY,
  anonymized_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.anonymized_actors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anonymized_actors FROM anon, authenticated;
GRANT SELECT, INSERT ON public.anonymized_actors TO service_role;

-- ============================================================================
-- 2. profiles.actor_id — the mapping home (05E §3.3)
-- ============================================================================
-- NOT NULL DEFAULT gen_random_uuid() is safe here: profiles is one-row-per-user,
-- so the per-row default IS per-user assignment. All existing profiles get an
-- actor_id immediately (no separate backfill). UNIQUE enforces 1:1 mapping.
-- This mapping is DESTROYED when the profile row is deleted by the cascade
-- (execute_account_deletion_cascade) — making the anonymization irreversible.
ALTER TABLE public.profiles
  ADD COLUMN actor_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX idx_profiles_actor_id ON public.profiles (actor_id);

-- ============================================================================
-- 3. actor_id on 5 activity tables + 2 audit-layer tables (05E §5, SCL-011)
-- ============================================================================
-- Nullable (populated by 5b write-path stamping, 5c backfill).
-- NO DEFAULT: gen_random_uuid() would generate per-ROW, fragmenting trajectories
-- (INV-05E-06). actor_id is stamped per-USER from profiles.actor_id.
-- NO FK: not to anonymized_actors (ledger, not integrity parent), not to
-- profiles.actor_id (mapping severed at anonymization; FK would block cascade).

-- Activity tables (5)
ALTER TABLE public.practice_sessions       ADD COLUMN actor_id uuid;
ALTER TABLE public.practice_session_items   ADD COLUMN actor_id uuid;
ALTER TABLE public.review_sessions         ADD COLUMN actor_id uuid;
ALTER TABLE public.review_session_items    ADD COLUMN actor_id uuid;
ALTER TABLE public.review_error_attempts   ADD COLUMN actor_id uuid;

-- Audit-layer tables (2) — one-way anonymized per 05D §10
ALTER TABLE public.mastery_event_audit_log          ADD COLUMN actor_id uuid;
ALTER TABLE public.mastery_domain_refresh_audit_log ADD COLUMN actor_id uuid;

-- ============================================================================
-- 4. DROP NOT NULL on activity-table identity columns (Resolution B, 05E §3)
-- ============================================================================
-- Makes SET user_id/student_id = NULL legal at anonymization time (5d).
-- FK to profiles RETAINED — nullable FK permits NULL in Postgres.
-- Audit-layer student_id NOT NULL is NOT altered: audit tables have no FK to
-- profiles (denormalized), and their anonymization disposition (SET NULL vs
-- SET surrogate vs DELETE) is a 5d decision. Preserving NOT NULL now preserves
-- optionality.

-- practice_sessions.user_id: FK profiles(id) NO ACTION, was NOT NULL
ALTER TABLE public.practice_sessions       ALTER COLUMN user_id    DROP NOT NULL;
-- practice_session_items.user_id: FK profiles(id) NO ACTION, was NOT NULL
ALTER TABLE public.practice_session_items   ALTER COLUMN user_id    DROP NOT NULL;
-- review_sessions.student_id: FK profiles(id) NO ACTION, was NOT NULL
ALTER TABLE public.review_sessions         ALTER COLUMN student_id DROP NOT NULL;
-- review_session_items.student_id: FK profiles(id) NO ACTION, was NOT NULL
ALTER TABLE public.review_session_items    ALTER COLUMN student_id DROP NOT NULL;
-- review_error_attempts.student_id: FK profiles(id) NO ACTION, was NOT NULL
ALTER TABLE public.review_error_attempts   ALTER COLUMN student_id DROP NOT NULL;
