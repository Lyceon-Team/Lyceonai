-- ============================================================================
-- Notification Outbox — emission foundation (table only; no dispatcher, no drain)
-- ============================================================================
-- @spec [Doc-01_V6 §15 Guardian Trust and Linkage / §16 Guardian Visibility / §17 Under-13 Consent &
--   COPPA] [Doc-01_V6 "Cross-Domain Writes": notification-authority consolidation acknowledged
--   (Doc 05 scope, unresolved)] [lyceon-coding-standards §4.2 idempotency/outbox-dedup, §12 privacy,
--   §17 hard-stops]
-- @implemented [2026-06-17]
-- plain English: the durable, idempotent event-emission seam for user-facing notifications. Features
--   INSERT one row per notifiable moment IN THE SAME TRANSACTION as the state change that produced it
--   (transactional-outbox pattern: emit-with-the-write, drain-later). event_id is an insert-once
--   idempotency key (deterministic per logical event — same discipline as mastery_event_audit_log's
--   UNIQUE(event_source_kind,event_id)), so webhook re-delivery / retries / resume emit at most one
--   row. The table is INERT: nothing reads or drains it in this lane. processed_at stays NULL until
--   the future end-stage dispatcher exists. recipient_kind encodes RIGHT-PARTY resolution at emission
--   time per the guardian-trust model (NOT "the user"); recipient_profile_id is the subject/anchor
--   profile (the student for every catalogued moment), and the dispatcher resolves concrete guardian
--   recipients via the guardian-trust gate at delivery. Governing contract:
--   contracts/notification-outbox.contract.md. Back-emit catalog: docs/SpecAudit/notification-triggers.md.
--
-- SCOPE: emission foundation ONLY. The dispatcher, channel delivery (email/push/in-app), the in-app
--   notification UI (+ its scoped read policy), and user notification preferences are the END-STAGE
--   notification lane and are NOT built here. COPPA/AADC minor-directed DELIVERY (Doc-01 §17) is a
--   dispatcher-stage concern enforced later; this migration only captures the audience at emission.
--
-- PENDING / OWNER-RUN: staged in supabase/migrations-pending/ — NOT in the active supabase/migrations/
--   pipeline, so the CI fresh-apply gate + the committed genesis-schema.expected.sql snapshot do not
--   drift. To activate: git mv into supabase/migrations/, regenerate scripts/ci/genesis-schema.expected.sql
--   (the established genesis-extending step, as 05B/05C did), then apply to the project. Applies cleanly
--   on top of genesis (depends only on public.profiles from 00000000000000_genesis.sql).
--
-- ROLLBACK (INV-06: every-migration-has-rollback): reversible. The DOWN block at the foot of this file
--   drops the table; its policies, indexes, and grants drop with it. CREATE-only / additive — no
--   forward-data destruction on apply. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- notification_outbox — one row per notifiable moment.
--   * event_id PRIMARY KEY = insert-once idempotency (emitter supplies a deterministic id;
--     INSERT ... ON CONFLICT (event_id) DO NOTHING).
--   * event_type CHECK enum grows as features land (one line per new type, tracked migration).
--   * recipient_kind CHECK (student|guardian|both) — guardian-trust audience, resolved at delivery.
--   * recipient_profile_id FK -> profiles(id) — subject/anchor profile (student for the current catalog).
--   * payload jsonb — ids + small scalars only; NO PII / secrets / answers / tutor content (§12).
--   * processed_at NULL until the future dispatcher drains it.
--   * channel_hint NULL = no hint (advisory only; dispatcher + prefs decide the real channel).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  event_id              uuid          NOT NULL PRIMARY KEY,

  event_type            text          NOT NULL
      CHECK (event_type IN (
          'guardian_linked',
          'quota_reached',
          'trial_ending',
          'payment_failed',
          'score_projection_updated',
          'mastery_milestone'
      )),

  recipient_kind        text          NOT NULL
      CHECK (recipient_kind IN ('student', 'guardian', 'both')),

  recipient_profile_id  uuid          NOT NULL
      REFERENCES public.profiles(id) ON DELETE CASCADE,

  payload               jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz   NOT NULL DEFAULT now(),
  processed_at          timestamptz   NULL,

  channel_hint          text          NULL
      CHECK (channel_hint IS NULL OR channel_hint IN ('in_app', 'email', 'push'))
);

-- Dispatcher scan (future): undrained rows, oldest-first. Partial index keeps it cheap as the table
-- grows — matches the projection_refresh_outbox precedent (20260613020000).
CREATE INDEX IF NOT EXISTS idx_notification_outbox_unprocessed
  ON public.notification_outbox (created_at)
  WHERE processed_at IS NULL;

-- Per-recipient lookup (future UI / per-subject queries).
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient
  ON public.notification_outbox (recipient_profile_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS — service-role-only, exactly like the other outboxes (projection_refresh_outbox,
-- student_projection_refresh_state). No anon/authenticated policy: absence of policy is the denial.
-- The in-app notification UI's scoped student/guardian read policy is an END-STAGE deliverable, added
-- WITH the UI, not here.
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notification_outbox FROM PUBLIC;
GRANT ALL ON public.notification_outbox TO service_role;

-- (No CREATE POLICY for anon/authenticated — client access is denied by policy absence.)

COMMIT;

-- ============================================================================
-- DOWN (reversible). Run to revert this migration. Dropping the table drops its
-- policies, indexes, and grants with it. No data beyond this table is touched.
-- ============================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.notification_outbox;
-- COMMIT;
