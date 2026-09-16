-- ===========================================================================
-- ACCOUNT DELETION — EVIDENCE BUNDLE (plan v4 Phase 1) + billing record (Phase 4 table)
-- ===========================================================================
-- @spec [Doc-01_V8 §5.1 retention tiers (SCL-085 PROPOSED: 24-month evidence clock);
--        Doc-01_V8 §40.2.1 / §40.3 (SCL-086 PROPOSED: cancel at T+7);
--        Doc-05E §2, §3 Rule 4, §6 INV-05E-01 / INV-05E-02 / INV-05E-05 (SCL-088 PROPOSED:
--        no time-of-deletion signal and no shared transaction on the synthetic-identifier side);
--        Doc-05D §10.5 (idempotency / rollback); SCL-002 stands (the cascade still destroys
--        and anonymizes; PS-5 still removes the request row);
--        owner brief 2026-09-16 "Deletion Vertical: SCLs, Phase 4, Phase 1", Part C]
--        | @implemented [2026-09-16]
--
-- plain English: today a completed deletion leaves no record. The request row is consumed
-- by the cascade (PS-5), nothing writes audit_logs on the deletion path, and the only
-- surviving row (anonymized_actors) carries no identity by design. This migration adds an
-- EVIDENCE BUNDLE beside the identity graph — never inside it:
--
--   deletion_request_log       one row per request: who asked, for whom, how, on what date,
--                              with what outcome (CCPA §7101 fields, at DAY granularity)
--   deletion_consent_evidence  the person's legal acceptances, copied at execution, keyed
--                              to the log row (COPPA consent evidence; accepted_on as a DATE)
--   deletion_billing_record    the Stripe ids and the cancellation outcome, keyed to the log
--                              row (financial record; written by the Phase 4 executor)
--
-- THE GOVERNING INVARIANT (plan v4 §1; SCL-088). Two universes: the pseudonymous learning
-- history under actor_id, and the evidence bundle under log_id. Nothing joins them:
--   1. no evidence-side surface carries actor_id, profile_id, or any key reaching the
--      pseudonymous graph (the tables below have no such column; log_id is a RANDOM uuid,
--      not a serial, so it carries no request order either);
--   2. no retained surface on the actor_id side carries a time-of-deletion signal
--      (anonymized_actors.anonymized_at is DROPPED; the ledger is rewritten after every
--      executor pass so xmin/ctid carry no insertion order);
--   3. no transaction writes rows in both universes, and no retained ordering on the
--      evidence side reproduces execution order. Postgres exposes xmin on every row: two
--      rows written in one transaction share it, and xmin is monotonic, so rank on one
--      side joins rank on the other even when no two rows share a value. Hence the
--      execution path is THREE transactions (T1 evidence / T1.5+T2 identity side / T3
--      evidence), the evidence writes are single set-based statements ordered by the
--      random log_id, and the executor processes profiles ORDER BY profile_id (a v4 uuid
--      unrelated to request time, destroyed with the profile).
--
-- The DATE columns are dates on purpose and there is NO created_at on any evidence
-- table: the genesis convention's TIMESTAMPTZ DEFAULT now() would void rule 2/3 by
-- restoring a same-transaction timestamp. tests/ci/deletion-evidence-bundle.pg.ci.test.ts
-- asserts this structurally from information_schema.
--
-- WHAT IS NOT HERE: the +24-month identity strip (Phase 5), audit_logs deletion actions
-- (Phase 3), the proof harness (Phase 6). Doc 06D §6.5 / Doc 06B §8.6 keyed on a
-- surviving account_deletion_requests row; that row does not survive and the controls
-- re-point to log_id in Phase 6.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: this file alone (it replaces request/cancel/restore RPCs and the cascade
-- in place; the executor change in server/lib/account-deletion-execute.ts ships in the
-- same PR and tolerates request rows created before this migration — log_id NULL).
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- PART 1 — evidence tables (RLS on, zero policies, service_role read; writes only through
-- the SECURITY DEFINER functions below)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.deletion_request_log (
  log_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_email         text NOT NULL,
  requester_email       text NOT NULL,
  request_channel       text NOT NULL CHECK (request_channel IN ('self_service_web')),
  requested_on          date NOT NULL,
  responded_on          date,
  status                text NOT NULL CHECK (status IN ('pending','executing','completed','cancelled','denied')),
  denial_basis          text,
  suppression_requested boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.deletion_request_log IS
  'Evidence bundle root (plan v4 §3.3; SCL-085). One row per deletion request: CCPA §7101 fields at day granularity. NO created_at, NO uuid other than the random log_id, NO FK outside the bundle — see the migration header for why (evidence invariant rules 1-3).';
COMMENT ON COLUMN public.deletion_request_log.log_id IS
  'Random (gen_random_uuid), NOT a serial: a serial reproduces request order, which at low volume rank-joins the deletion order visible on the actor_id side through xmin.';

CREATE TABLE IF NOT EXISTS public.deletion_consent_evidence (
  log_id          uuid NOT NULL REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE,
  accepted_on     date NOT NULL,
  doc_key         text NOT NULL,
  doc_version     text NOT NULL,
  actor_type      text NOT NULL,
  minor           boolean NOT NULL,
  consent_source  text NOT NULL,
  ip_address      text,
  user_agent      text,
  PRIMARY KEY (log_id, doc_key, doc_version, actor_type)
);
COMMENT ON TABLE public.deletion_consent_evidence IS
  'Consent evidence copied from legal_acceptances at execution, keyed to the deletion request log (plan v4 §3.5; SCL-085). accepted_on is a DATE: signup is minutes before the first activity row, so a timestamp would correlate to the actor_id side. Composite key on purpose: a serial would reproduce copy order.';

CREATE TABLE IF NOT EXISTS public.deletion_billing_record (
  log_id                 uuid PRIMARY KEY REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  cancelled_on           date NOT NULL,
  final_status           text NOT NULL CHECK (final_status IN ('cancelled','item_removed','none_active','failed_manual'))
);
COMMENT ON TABLE public.deletion_billing_record IS
  'Minimal financial record of the Stripe outcome at execution (plan v4 §3.7; SCL-086). NO actor_id (Doc 05E §3 Rule 2: the synthetic identifier is never written to billing surfaces; stripe_customer_id resolves to an email inside Stripe) and NO email. Legal-obligation basis, 7-year tier.';

ALTER TABLE public.deletion_request_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_consent_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_billing_record   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_request_log, public.deletion_consent_evidence, public.deletion_billing_record FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deletion_request_log, public.deletion_consent_evidence, public.deletion_billing_record TO service_role;

-- ===========================================================================
-- PART 2 — the identity-side link that dies with the request row, and the column drop
-- ===========================================================================

-- The executor must find a request's log row at T1/T3 and the reconciler must tell "the
-- request row is gone (cascade committed)" from "still pending (cascade rolled back)".
-- Matching by email cannot do that: deidentify_user scrubs profiles.email in its own
-- transaction BEFORE the cascade, so a retried request no longer carries the address.
-- So the request row — which PS-5 destroys on success — carries the evidence key. This is
-- the one place a key crosses universes, and it lives only on a row that does not survive
-- a completed deletion. Deliberately NO foreign key: an FK would let the identity side
-- block or cascade evidence rows.
ALTER TABLE public.account_deletion_requests ADD COLUMN IF NOT EXISTS log_id uuid;
COMMENT ON COLUMN public.account_deletion_requests.log_id IS
  'deletion_request_log.log_id for this request (no FK on purpose). Set by request_account_deletion; NULL for rows created before migration 20260917000000. Dies with the row at cascade PS-5.';

-- SCL-088: the only reader of anonymized_at was the cascade that wrote it (verified: no
-- view, no function, no server code). A deletion timestamp on the pseudonymous side joins
-- a dated evidence record deterministically at this volume (prod: two days, two rows each).
ALTER TABLE public.anonymized_actors DROP COLUMN IF EXISTS anonymized_at;
COMMENT ON TABLE public.anonymized_actors IS
  'Ledger of anonymized actor_ids (Doc 05E §3 Rule 4, INV-05E-01/02; build-derived, no spec anchor — SCL-088). actor_id only: no timestamp, and rewrite_anonymized_actors() strips insertion order after every executor pass.';

-- ===========================================================================
-- PART 3 — T0: the request writes the log row; cancel / restore close it
-- ===========================================================================

-- A new parameter means a new signature; the 4-argument overload must go or PostgREST
-- (and any 4-argument caller) sees two candidates once the default applies.
DROP FUNCTION IF EXISTS public.request_account_deletion(uuid, uuid, text, integer);

-- @spec [Doc-01_V8 §40.2.1 Phase 1 (atomic soft-delete + request insert); plan v4 §3.3 T0]
-- Unchanged behaviour: soft-delete lock + pending row + recovery-token hash, idempotent on an
-- existing pending request. Added: the deletion_request_log row (T0), written here — inside
-- the SQL that performs the mutation — with the subject's and requester's addresses read from
-- profiles BEFORE anything scrubs them. T0 shares a transaction only with rows that die on
-- completion (the request row) or belong to a live, identified person (the profile, if the
-- request is later cancelled), so it creates no pseudonymous linkage.
CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_profile_id          uuid,
  p_actor_id            uuid,
  p_recovery_token_hash text,
  p_grace_days          integer DEFAULT 7,
  p_request_channel     text    DEFAULT 'self_service_web'
)
RETURNS TABLE (requested_at timestamptz, scheduled_hard_delete_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now       timestamptz := now();
  v_sched     timestamptz := now() + make_interval(days => p_grace_days);
  v_subject   text;
  v_requester text;
  v_log_id    uuid;
BEGIN
  -- Idempotency: surface the existing pending request rather than creating a second one.
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests adr
     WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
  ) THEN
    RETURN QUERY
      SELECT adr.requested_at, adr.scheduled_hard_delete_at
        FROM public.account_deletion_requests adr
       WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
       LIMIT 1;
    RETURN;
  END IF;

  SELECT p.email INTO v_subject FROM public.profiles p WHERE p.id = p_profile_id;
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion: profile % not found', p_profile_id;
  END IF;
  SELECT p.email INTO v_requester FROM public.profiles p WHERE p.id = p_actor_id;
  v_requester := coalesce(v_requester, v_subject);

  -- T0 (evidence side): the request record, at day granularity.
  INSERT INTO public.deletion_request_log
    (subject_email, requester_email, request_channel, requested_on, status)
  VALUES
    (v_subject, v_requester, p_request_channel, (v_now AT TIME ZONE 'utc')::date, 'pending')
  RETURNING log_id INTO v_log_id;

  UPDATE public.profiles SET deleted_at = v_now, updated_at = v_now WHERE id = p_profile_id;

  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status,
     stripe_cancellation_status, recovery_token_hash, recovery_token_expires_at, log_id)
  VALUES
    (p_profile_id, v_now, v_sched, p_actor_id, 'pending',
     'pending', p_recovery_token_hash, v_sched, v_log_id);

  RETURN QUERY SELECT v_now, v_sched;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer, text) TO service_role;

-- @spec [Doc-01_V8 §40.4 recovery during grace; plan v4 §3.3 outcome 'cancelled']
-- Unchanged behaviour (clear deleted_at, cancel the request, cancelled_by_recovery) plus the
-- log outcome. The profile this transaction touches is LIVE and named in the log anyway, so
-- sharing the transaction creates no pseudonymous linkage.
CREATE OR REPLACE FUNCTION public.restore_account_deletion(p_recovery_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid;
  v_log_id     uuid;
BEGIN
  SELECT adr.profile_id, adr.log_id INTO v_profile_id, v_log_id
    FROM public.account_deletion_requests adr
   WHERE adr.recovery_token_hash    = p_recovery_token_hash
     AND adr.status                 = 'pending'
     AND adr.recovery_token_expires_at > now()
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = v_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE recovery_token_hash = p_recovery_token_hash
     AND status              = 'pending';

  IF v_log_id IS NOT NULL THEN
    UPDATE public.deletion_request_log
       SET status = 'cancelled', responded_on = (now() AT TIME ZONE 'utc')::date
     WHERE log_id = v_log_id AND status IN ('pending', 'executing');
  END IF;

  RETURN v_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_account_deletion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_account_deletion(text) TO service_role;

-- @spec [Doc-01_V8 §40.4 in-app cancel; plan v4 §3.3 outcome 'cancelled']
-- GRACE-WINDOW: as before, this RPC does NOT enforce the 7-day window — the calling route does.
CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid;
  v_log_id     uuid;
BEGIN
  SELECT adr.id, adr.log_id INTO v_request_id, v_log_id
    FROM public.account_deletion_requests adr
   WHERE adr.profile_id = p_profile_id
     AND adr.status = 'pending'
   LIMIT 1;

  IF v_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lift the soft-delete lock first; a 23505 here aborts the whole function (both writes roll back).
  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = p_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE id = v_request_id;

  IF v_log_id IS NOT NULL THEN
    UPDATE public.deletion_request_log
       SET status = 'cancelled', responded_on = (now() AT TIME ZONE 'utc')::date
     WHERE log_id = v_log_id AND status IN ('pending', 'executing');
  END IF;

  RETURN p_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid) TO service_role;

-- ===========================================================================
-- PART 4 — T1.5: pre-clear the rows that belong to OTHER identities, in their own transaction
-- ===========================================================================

-- @spec [Doc-05E §6 INV-05E-05 (explicit, gated); plan v4 §3.4 T1.5; SCL-088 rule 3]
-- PS-2 .. PS-4 of the cascade, lifted out. When a guardian deletes, PS-3 NULLs
-- guardian_profile_id on their students' consent requests; those students are live, their
-- rows survive, and a row written in the cascade's transaction shares its xmin with the
-- anonymized_actors row — a two-hop join from actor_id through the student to the deleted
-- guardian's address on profiles.guardian_email. Same class at PS-4 (another person's
-- request naming this profile as actor) and at guardian_links. So these run HERE, alone,
-- before the cascade, which in anonymize mode verifies they ran and fails closed.
-- Guarded like the cascade: only for a request that is pending AND due. Idempotent.
CREATE OR REPLACE FUNCTION public.preclear_account_deletion_links(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_count  bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests adr
     WHERE adr.profile_id = p_profile_id
       AND adr.status = 'pending'
       AND adr.scheduled_hard_delete_at <= now()
  ) THEN
    RAISE EXCEPTION 'PRECLEAR_NOT_DUE: no pending, due deletion request for profile %', p_profile_id;
  END IF;

  -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
  UPDATE public.guardian_links SET accepted_by_profile_id = NULL
   WHERE accepted_by_profile_id = p_profile_id;
  UPDATE public.guardian_links SET revoked_by_profile_id = NULL
   WHERE revoked_by_profile_id = p_profile_id;
  DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
  DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

  -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
  UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
   WHERE guardian_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_consent_requests_as_guardian', v_count);
  DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

  -- PS-4. account_deletion_requests — actor_profile_id edge case
  UPDATE public.account_deletion_requests
     SET actor_profile_id = profile_id
   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests_as_actor', v_count);

  RETURN jsonb_build_object('status', 'precleared', 'profile_id', p_profile_id, 'rows_affected', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.preclear_account_deletion_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preclear_account_deletion_links(uuid) TO service_role;

-- ===========================================================================
-- PART 5 — the cascade, replaced in place (copied verbatim from 20260903010000 and edited at
-- three anchored points: PS-2..PS-4 mode-conditional; L1-13 legal_acceptance_outbox; ledger
-- insert without a timestamp and with the corrected citation)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.execute_account_deletion_cascade(
  p_profile_id    uuid,
  p_privacy_mode  text DEFAULT 'hard_delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result    jsonb := '{}'::jsonb;
  v_count     bigint;
  v_op_ref   record;
  v_actor_id  uuid;
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  IF p_privacy_mode NOT IN ('hard_delete', 'anonymize') THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete, anonymize', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- CAPTURE actor_id (anonymize mode: needed for sentinel + ledger;
  -- must be read BEFORE profile deletion destroys the mapping — §3 Rule 4)
  -- ========================================================================
  IF p_privacy_mode = 'anonymize' THEN
    SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_profile_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION '05E-5d: profiles.actor_id IS NULL for profile % — cannot anonymize without grouping identifier (INV-05E-06)',
        p_profile_id;
    END IF;
  END IF;

  -- ========================================================================
  -- OPERATOR-FK PREFLIGHT GUARD (fail-closed, before ANY destructive step)
  -- ========================================================================
  -- 36 operator-identity FK edges (updated_by_profile_id / changed_by_profile_id
  -- across 18 *_config + 18 *_config_history governance tables). Operator
  -- attribution is governance data — must BLOCK deletion until consciously
  -- reassigned. The guard refuses cascade with a clear error BEFORE any rows
  -- are deleted. LYCEON-MIGRATION-REVIEWED
  FOR v_op_ref IN
    SELECT * FROM (VALUES
      ('abuse_score_runtime_config'::text,              'updated_by_profile_id'::text),
      ('abuse_score_runtime_config_history',            'changed_by_profile_id'),
      ('account_deletion_runtime_config',               'updated_by_profile_id'),
      ('account_deletion_runtime_config_history',       'changed_by_profile_id'),
      ('auth_mfa_config',                               'updated_by_profile_id'),
      ('auth_mfa_config_history',                       'changed_by_profile_id'),
      ('auth_runtime_config',                           'updated_by_profile_id'),
      ('auth_runtime_config_history',                   'changed_by_profile_id'),
      ('caching_runtime_config',                        'updated_by_profile_id'),
      ('caching_runtime_config_history',                'changed_by_profile_id'),
      ('consent_runtime_config',                        'updated_by_profile_id'),
      ('consent_runtime_config_history',                'changed_by_profile_id'),
      ('entitlement_runtime_config',                    'updated_by_profile_id'),
      ('entitlement_runtime_config_history',            'changed_by_profile_id'),
      ('exam_runtime_config',                           'updated_by_profile_id'),
      ('exam_runtime_config_history',                   'changed_by_profile_id'),
      ('full_length_adaptive_config',                   'updated_by_profile_id'),
      ('full_length_adaptive_config_history',           'changed_by_profile_id'),
      ('idempotency_runtime_config',                    'updated_by_profile_id'),
      ('idempotency_runtime_config_history',            'changed_by_profile_id'),
      ('internal_service_auth_config',                  'updated_by_profile_id'),
      ('internal_service_auth_config_history',          'changed_by_profile_id'),
      ('mastery_constants',                             'updated_by_profile_id'),
      ('mastery_constants_history',                     'changed_by_profile_id'),
      ('mobile_auth_config',                            'updated_by_profile_id'),
      ('mobile_auth_config_history',                    'changed_by_profile_id'),
      ('observability_runtime_config',                  'updated_by_profile_id'),
      ('observability_runtime_config_history',          'changed_by_profile_id'),
      ('practice_runtime_config',                       'updated_by_profile_id'),
      ('practice_runtime_config_history',               'changed_by_profile_id'),
      ('rate_limit_runtime_config',                     'updated_by_profile_id'),
      ('rate_limit_runtime_config_history',             'changed_by_profile_id'),
      ('review_runtime_config',                         'updated_by_profile_id'),
      ('review_runtime_config_history',                 'changed_by_profile_id'),
      ('tutor_context_runtime_config',                  'updated_by_profile_id'),
      ('tutor_context_runtime_config_history',          'changed_by_profile_id')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I = $1',
      v_op_ref.tbl, v_op_ref.col
    ) INTO v_count USING p_profile_id;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES: '
        'profile % is referenced as an operator in %.% '
        '— reassign config attributions before deletion',
        p_profile_id, v_op_ref.tbl, v_op_ref.col;
    END IF;
  END LOOP;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

  -- PS-2 .. PS-4: the pre-clears that touch rows belonging to OTHER identities
  -- (a student's consent request when a guardian deletes; another person's deletion
  -- request that named this profile as actor; the guardian_links rows on either side).
  --
  -- ANONYMIZE MODE (the user-facing path): these MUST already have run in their own
  -- transaction — public.preclear_account_deletion_links, T1.5 of the executor. A row
  -- of a LIVE identity written in THIS transaction would share its xmin with the
  -- anonymized_actors row written below, which is a deterministic join from actor_id
  -- to that live person and, through profiles.guardian_email, to the deleted one
  -- (evidence invariant rule 3, SCL-088; plan v4 §1). So this mode does not clear:
  -- it verifies, and fails closed (INV-05E-05: explicit, gated, nothing implicit).
  --
  -- HARD_DELETE MODE (service_role-only internal tool, Doc 05E §1): self-clears, as
  -- before. Nothing pseudonymous is retained by that mode, so the join has nothing
  -- to reach.
  IF p_privacy_mode = 'anonymize' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links
                WHERE accepted_by_profile_id = p_profile_id
                   OR revoked_by_profile_id  = p_profile_id
                   OR student_profile_id     = p_profile_id
                   OR guardian_profile_id    = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.guardian_consent_requests
                   WHERE guardian_profile_id = p_profile_id
                      OR student_profile_id  = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.account_deletion_requests
                   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id)
    THEN
      RAISE EXCEPTION 'PRECLEAR_REQUIRED: profile % still has guardian_links / guardian_consent_requests / actor_profile_id references — run public.preclear_account_deletion_links(profile) in its own transaction first (evidence invariant rule 3)',
        p_profile_id;
    END IF;
  ELSE
    -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
    UPDATE public.guardian_links SET accepted_by_profile_id = NULL
     WHERE accepted_by_profile_id = p_profile_id;
    UPDATE public.guardian_links SET revoked_by_profile_id = NULL
     WHERE revoked_by_profile_id = p_profile_id;
    DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
    DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

    -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
    UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
     WHERE guardian_profile_id = p_profile_id;
    DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

    -- PS-4. account_deletion_requests — actor_profile_id edge case
    UPDATE public.account_deletion_requests
       SET actor_profile_id = profile_id
     WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  END IF;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: DELETE derived state (SHARED — both modes; INV-05E-09 proven safe)
  -- ========================================================================
  -- All derived state: mastery, KPI, projections, scheduling. Recomputable from
  -- retained activity if ever needed (§5). No FK to profiles (convention only).
  -- Zero triggers on any L1 table. Zero FKs from L1 to L2.

  -- L1-01. student_section_projection_snapshots (05C)
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projection_snapshots', v_count);

  -- L1-02. student_section_projections (05C)
  DELETE FROM public.student_section_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projections', v_count);

  -- L1-03. student_projection_refresh_state (05C)
  DELETE FROM public.student_projection_refresh_state WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_projection_refresh_state', v_count);

  -- L1-04. projection_refresh_outbox (05C)
  DELETE FROM public.projection_refresh_outbox WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('projection_refresh_outbox', v_count);

  -- L1-05. student_section_kpi (05B)
  DELETE FROM public.student_section_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_kpi', v_count);

  -- L1-06. student_domain_kpi (05B)
  DELETE FROM public.student_domain_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_kpi', v_count);

  -- L1-07. student_skill_kpi (05B)
  DELETE FROM public.student_skill_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_kpi', v_count);

  -- L1-08. student_overall_kpi (05B)
  DELETE FROM public.student_overall_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_overall_kpi', v_count);

  -- L1-09. student_domain_mastery (05B)
  DELETE FROM public.student_domain_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_mastery', v_count);

  -- L1-10. student_skill_mastery (05A)
  DELETE FROM public.student_skill_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_mastery', v_count);

  -- L1-11. review_schedule (Q3 ruling: L1 — identity-linked SM-2 state, not event data)
  DELETE FROM public.review_schedule WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('review_schedule', v_count);

  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

  -- L1-13. legal_acceptance_outbox (2026-09-16 evidence audit, plan v4 Phase 1). The
  -- outbox has NO profiles FK (20260619000300 dropped it so consent intent survives a
  -- late profile insert), sat in no cascade list, and is invisible to the FK-driven
  -- preflight above — so its rows, keyed by the auth uuid (= profile id), survived a
  -- deletion in signup order. Classified here as identity-keyed queue state: DELETED in
  -- both modes. The consent EVIDENCE lives in deletion_consent_evidence, copied from
  -- legal_acceptances by mark_deletion_log_executing before this transaction; an
  -- undrained outbox row at T+7 is intent that never became an acceptance and is not
  -- evidence of one.
  DELETE FROM public.legal_acceptance_outbox WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('legal_acceptance_outbox', v_count);

  -- ========================================================================
  -- MODE BRANCH: hard_delete vs anonymize diverge at L2
  -- ========================================================================

  IF p_privacy_mode = 'hard_delete' THEN
    -- ====================================================================
    -- LAYER 2 (hard_delete): Hard-delete event/audit sources
    -- ====================================================================
    -- Children-before-parent FK-safe order. All event + session + audit rows removed.

    -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
    DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions
    DELETE FROM public.practice_sessions WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (child of review_session_items via ON DELETE CASCADE)
    DELETE FROM public.review_error_attempts WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (child of review_sessions via ON DELETE CASCADE)
    DELETE FROM public.review_session_items WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions
    DELETE FROM public.review_sessions WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- L2-06. mastery_event_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_event_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L2-07. mastery_domain_refresh_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    DECLARE
      v_sentinel_tbl text;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
    BEGIN
      FOR v_sentinel_tbl, v_sentinel_col IN VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id')
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM public.%I WHERE %I = $1 AND actor_id IS NULL',
          v_sentinel_tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id;
        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% have identity present but actor_id IS NULL — refusing to sever identity from ungrouped row',
            v_sentinel_cnt, v_sentinel_tbl;
        END IF;
      END LOOP;
    END;

    -- ====================================================================
    -- LAYER 2 (anonymize): Sever identity + remove fingerprints on
    -- activity tables — rows RETAINED for world-model training (§5)
    -- ====================================================================
    -- §5.1: "Removed: the identity link and any client/device/session
    --   fingerprint that could enable re-identification."
    -- §5.1: "Retained: the learning interaction — item answered, response
    --   chosen, correctness, difficulty/domain/skill/section, ordering,
    --   timing, and shared question-bank content."
    -- actor_id (NOT NULL, PR-5c) is the surviving synthetic grouping id.
    -- Children before parents (convention match with hard-delete ordering).
    --
    -- Partial unique indexes (uq_practice_items_idem, uq_review_attempts_idem)
    -- are on (identity, client_attempt_id) WHERE client_attempt_id IS NOT NULL.
    -- Setting client_attempt_id = NULL removes rows from the partial index;
    -- no uniqueness violation. Live write path unaffected (non-anonymized
    -- users retain non-NULL identity and client_attempt_id).

    -- L2-01. practice_session_items (identity + fingerprint)
    UPDATE public.practice_session_items
       SET user_id = NULL, client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET user_id = NULL, client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET student_id = NULL, client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (identity only — no fingerprint columns)
    UPDATE public.review_session_items
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET student_id = NULL, client_instance_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- ====================================================================
    -- LAYER 3 (anonymize): Sever identity on audit tables
    -- ====================================================================
    -- §5: "Audit layer: one-way anonymized per Doc 05D §10, idempotency
    --   guarantees untouched."
    -- mastery_event_audit_log_dedup_uq is UNIQUE on (event_source_kind,
    -- event_id) — does NOT include student_id. SET NULL is safe; the
    -- idempotency anchor (INV-05A-10) is preserved.
    -- No FK to profiles (denormalized, convention only).

    -- L3-01. mastery_event_audit_log
    UPDATE public.mastery_event_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L3-02. mastery_domain_refresh_audit_log
    UPDATE public.mastery_domain_refresh_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- ANONYMIZED_ACTORS LEDGER — Doc 05E §3 Rule 4 / INV-05E-01 / INV-05E-02
    -- (build-derived ledger; no spec anchor — SCL-088. The earlier citation of section 3.1 ("Industry precedent")
    -- was wrong.)
    -- ====================================================================
    -- Records that this actor_id is anonymized, BEFORE the profile deletion below
    -- destroys the one linkage surface. actor_id ONLY: no timestamp (SCL-088 — a
    -- deletion time on the pseudonymous side joins a dated evidence record at this
    -- volume), and public.rewrite_anonymized_actors() strips insertion order after
    -- every executor pass so xmin/ctid carry no sequence either.
    INSERT INTO public.anonymized_actors (actor_id)
    VALUES (v_actor_id)
    ON CONFLICT (actor_id) DO NOTHING;
    v_result := v_result || jsonb_build_object('anonymized_actors', 1);

  END IF;

  -- ========================================================================
  -- PROFILE + AUTH DELETE (shared — both modes destroy the profile row)
  -- ========================================================================
  -- §3 Rule 4: "Linkage destroyed at anonymization." The profile row
  -- contains profiles.actor_id — the ONLY surface linking identity to the
  -- synthetic identifier. Deleting the row makes the link irreversible.
  -- auto-CASCADE FKs fire: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_events, notification_messages, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- Operator-FK edges (36 config/history) were preflight-guarded above.
  -- In anonymize mode, L2/L3 identity columns are already NULL — no FK
  -- from those tables blocks this DELETE (FKs are NO ACTION, nullable).

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  DELETE FROM auth.users WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('auth_users', v_count);

  RETURN jsonb_build_object(
    'status', 'completed',
    'profile_id', p_profile_id,
    'privacy_mode', p_privacy_mode,
    'rows_affected', v_result
  );
END;
$$;

-- ===========================================================================
-- PART 6 — T1 and T3 (evidence side, set-based, batched per executor run) and the reconciler
-- ===========================================================================

-- @spec [plan v4 §3.4 T1; §3.5 consent copy] Marks the given log rows 'executing' and copies
-- the subjects' legal acceptances beside them. ONE statement each, ordered by the random
-- log_id: a per-row loop in executor order would give the evidence rows an insertion order
-- equal to the deletion order. Reads the identity side; writes only the evidence side.
-- Idempotent: re-running for a request whose cascade rolled back re-copies nothing
-- (composite key) and re-marks nothing already executing.
CREATE OR REPLACE FUNCTION public.mark_deletion_log_executing(p_log_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consent bigint;
  v_marked  bigint;
BEGIN
  IF p_log_ids IS NULL OR cardinality(p_log_ids) = 0 THEN
    RETURN jsonb_build_object('marked', 0, 'consent_rows', 0);
  END IF;

  INSERT INTO public.deletion_consent_evidence
    (log_id, accepted_on, doc_key, doc_version, actor_type, minor, consent_source, ip_address, user_agent)
  SELECT adr.log_id,
         (la.accepted_at AT TIME ZONE 'utc')::date,
         la.doc_key, la.doc_version, la.actor_type, la.minor, la.consent_source,
         la.ip_address, la.user_agent
    FROM public.account_deletion_requests adr
    JOIN public.legal_acceptances la ON la.user_id = adr.profile_id
   WHERE adr.log_id = ANY (p_log_ids)
     AND adr.status = 'pending'
   ORDER BY adr.log_id, la.doc_key, la.doc_version, la.actor_type
  ON CONFLICT (log_id, doc_key, doc_version, actor_type) DO NOTHING;
  GET DIAGNOSTICS v_consent = ROW_COUNT;

  UPDATE public.deletion_request_log
     SET status = 'executing'
   WHERE log_id = ANY (p_log_ids)
     AND status = 'pending';
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  RETURN jsonb_build_object('marked', v_marked, 'consent_rows', v_consent);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_deletion_log_executing(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_deletion_log_executing(uuid[]) TO service_role;

-- @spec [plan v4 §3.4 T3; §3.7 billing record; SCL-086] Completes the given log rows and
-- writes the billing record for those that had a Stripe customer or subscription. Input:
-- a JSON array (as text, so every transport passes it the same way) of
-- {log_id, stripe_customer_id, stripe_subscription_id, final_status}.
-- Batched per executor run, set-based. The UPDATE is driven by a scalar array filter over
-- the log table, NOT by a join from the input: a join would let the planner visit rows in
-- input order, which is execution order, and stamp that order into the evidence side's
-- physical layout. The billing INSERT is ordered by the random log_id for the same reason.
-- Only rows that are 'executing' complete; a row the cascade did not reach stays for the
-- reconciler.
CREATE OR REPLACE FUNCTION public.complete_deletion_log(p_completions text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'utc')::date;
  v_json      jsonb;
  v_ids       uuid[];
  v_completed bigint;
  v_billing   bigint;
BEGIN
  v_json := p_completions::jsonb;
  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'array' THEN
    RAISE EXCEPTION 'complete_deletion_log: p_completions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE _completions ON COMMIT DROP AS
    SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id, c.final_status
      FROM jsonb_to_recordset(v_json)
        AS c(log_id uuid, stripe_customer_id text, stripe_subscription_id text, final_status text);

  SELECT array_agg(c.log_id ORDER BY c.log_id) INTO v_ids FROM _completions c;

  UPDATE public.deletion_request_log
     SET status = 'completed', responded_on = v_today
   WHERE log_id = ANY (v_ids)
     AND status = 'executing';
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  INSERT INTO public.deletion_billing_record
    (log_id, stripe_customer_id, stripe_subscription_id, cancelled_on, final_status)
  SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id, v_today, c.final_status
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE c.final_status IS NOT NULL
     AND (c.stripe_customer_id IS NOT NULL OR c.stripe_subscription_id IS NOT NULL)
   ORDER BY c.log_id
  ON CONFLICT (log_id) DO NOTHING;
  GET DIAGNOSTICS v_billing = ROW_COUNT;

  RETURN jsonb_build_object('completed', v_completed, 'billing_records', v_billing);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_deletion_log(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_deletion_log(text) TO service_role;

-- @spec [plan v4 §3.4 "reconciliation replaces atomicity"] A log row left 'executing' means
-- the executor did not reach T3 for it: the cascade rolled back (request row still pending)
-- or the process died between T2 and T3 (request row gone — PS-5 ran, so the cascade
-- committed). Resolve both from the identity side, writing only the evidence side. Runs at
-- the end of every executor pass and is safe to run at any time.
CREATE OR REPLACE FUNCTION public.reconcile_deletion_log()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'utc')::date;
  v_reverted    bigint;
  v_completed   bigint;
  v_cancelled   bigint;
BEGIN
  UPDATE public.deletion_request_log l
     SET status = 'pending'
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'pending');
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE public.deletion_request_log l
     SET status = 'cancelled', responded_on = coalesce(l.responded_on, v_today)
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'cancelled');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.deletion_request_log l
     SET status = 'completed', responded_on = coalesce(l.responded_on, v_today)
   WHERE l.status = 'executing'
     AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                      WHERE adr.log_id = l.log_id);
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  RETURN jsonb_build_object('reverted_to_pending', v_reverted, 'completed', v_completed, 'cancelled', v_cancelled);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_deletion_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_deletion_log() TO service_role;

-- ===========================================================================
-- PART 7 — the ledger loses its insertion order after every executor pass
-- ===========================================================================

-- @spec [SCL-088; plan v4 §1 rule 2] Re-inserts every ledger row in one transaction, ordered
-- by actor_id, so all rows share one xmin and their physical order is the (random) actor_id
-- order — no sequence of deletions survives on the pseudonymous side. Writes ONLY the
-- actor_id side. Cheap at this scale; called at the end of executeDueDeletions on the
-- existing 03:00 UTC cron, no new schedule.
CREATE OR REPLACE FUNCTION public.rewrite_anonymized_actors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Concurrency (spec-auditor finding C on PR #769): a cascade committing between the
  -- snapshot and the DELETE would have its ledger row destroyed and never re-inserted —
  -- the only proof that an actor_id was anonymized. ACCESS EXCLUSIVE makes a concurrent
  -- cascade's INSERT wait for this transaction to commit; the function is milliseconds.
  LOCK TABLE public.anonymized_actors IN ACCESS EXCLUSIVE MODE;
  CREATE TEMP TABLE _ledger ON COMMIT DROP AS
    SELECT actor_id FROM public.anonymized_actors;
  DELETE FROM public.anonymized_actors;
  INSERT INTO public.anonymized_actors (actor_id)
    SELECT actor_id FROM _ledger ORDER BY actor_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.rewrite_anonymized_actors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rewrite_anonymized_actors() TO service_role;

COMMIT;
