-- ===========================================================================
-- DELETION PHASE 3 — audit_logs on the deletion path, and the ONE exempt path
-- ===========================================================================
-- @spec [Doc-01_V8 §5 (the identity audit trail: "Every `profiles` mutation emits an entry to
--        `audit_logs`", action enum naming profile_soft_deleted / profile_restored /
--        profile_hard_deleted); Doc-01_V8 §5.1 (GDPR / data deletion interaction: at hard
--        delete the actor and target ids "become NULL"; audit rows are hard-deleted after
--        `account_deletion_runtime_config.anonymization_retention_days`); Doc-01_V8 App E
--        (`audit_logs` is shared append-only, UPDATE/DELETE prohibited at schema level);
--        SCL-087 PROPOSED (the R3 ruling that reconciles those two: immutability wins, with
--        ONE named exemption); owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §3]
--        | @implemented [2026-09-17]
--
-- plain English: the deletion path has never written an audit row. Production holds 32
-- audit_logs rows across three guardian actions and nothing else, while Doc 01 §5 names three
-- deletion actions and names the deletion service as a writer. This migration writes all three,
-- and builds the single gated path that may ever mutate the table.
--
-- WHY audit_logs GETS ITS OWN TRIGGER FUNCTION, AND THE SHARED ONE IS NOT TOUCHED.
-- `public.prevent_update_delete()` is the append-only guard for TWENTY tables — audit_logs,
-- abuse_score_incidents, mastery_constants_history, and every *_runtime_config_history table.
-- Putting the retention exemption inside it would hand the same session-context escape hatch to
-- all nineteen others: one GUC and a caller could rewrite the operator-attribution history of
-- every config table in the platform. The exemption belongs to audit_logs' retention rule, so it
-- lives in an audit_logs-only guard. The TRIGGER KEEPS ITS NAME (`audit_logs_no_mutate`) and its
-- timing (BEFORE DELETE OR UPDATE); only the function it calls changes. The shared function and
-- the other nineteen triggers are untouched by this file.
--
-- WHAT "RECOGNISED BY SESSION CONTEXT" MEANS, AND WHAT IT IS WORTH. The guard allows a mutation
-- only while `lyceon.audit_logs_retention` is set to 'on'. That GUC is set in exactly one place —
-- `apply_audit_logs_retention` below — with `set_config(..., is_local => true)`, so it dies with
-- the transaction, and the function RESETS it before returning so the remainder of its own
-- transaction cannot ride it. The boundary is therefore: one function sets the flag, and only
-- service_role may execute that function. A second function that tried to UPDATE or DELETE
-- audit_logs without the flag is refused by the trigger, which is what the gate is for; a second
-- function that also set the flag would not be, which is why the PG suite asserts from `pg_proc`
-- that exactly ONE function body in the schema sets this GUC. That assertion is the real guard
-- against a second path appearing later, and it fails closed when someone adds one.
--
-- WHY profile_hard_deleted IS WRITTEN IN T3, WITH A NULL TARGET FROM THE START. Two reasons,
-- neither visible to a schema test, so both are contract:
--   (a) `audit_logs.created_at` defaults to now(). A row written inside the cascade transaction
--       (T2) would share that transaction's xmin with the `anonymized_actors` ledger row, handing
--       the pseudonymous side a deletion timestamp — the exact join SCL-088 dropped
--       `anonymized_at` to remove. T3 is the evidence-side transaction, so the row can only be
--       joined to evidence, never to actor_id.
--   (b) Writing it populated and stripping it afterwards would force the exempt function to run
--       INSIDE the cascade. Written NULL from the start, the hard-delete row needs no exemption
--       at all — only the pre-existing rows do.
--
-- The other two actions carry real ids on purpose: at request and at restore the profile is live
-- and identified, and §5's trail is worth nothing if it cannot say whose account it was.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: FIRST of three (this file, then 20260917110000, then 20260917120000).
-- Phase 5's audit purge calls the exempt function this file creates.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- PART 1 — the audit_logs-only append-only guard
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.audit_logs_retention_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The sole exemption (SCL-087 / R3). `current_setting(..., true)` returns NULL rather than
  -- raising when the GUC was never set, so the default posture of every session is "refused".
  IF current_setting('lyceon.audit_logs_retention', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE are not permitted', TG_TABLE_NAME;
END;
$$;

COMMENT ON FUNCTION public.audit_logs_retention_guard() IS
  'Append-only guard for audit_logs ONLY (SCL-087 / R3). Identical refusal to public.prevent_update_delete(), plus the single retention exemption gated on the lyceon.audit_logs_retention GUC that public.apply_audit_logs_retention sets transaction-locally. The shared guard is deliberately not modified: nineteen other append-only tables use it and must not inherit this exemption.';

-- Same trigger name, same timing, same table; only the function changes.
DROP TRIGGER IF EXISTS audit_logs_no_mutate ON public.audit_logs;
CREATE TRIGGER audit_logs_no_mutate
  BEFORE DELETE OR UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_retention_guard();

-- ===========================================================================
-- PART 2 — the retention window, defined once
-- ===========================================================================

-- @spec [Doc-01_V8 §5.1 "After `account_deletion_runtime_config.anonymization_retention_days`
--        (default 365), audit logs are hard-deleted"; App A.5]
-- The ONE definition of the audit window. Reads the operator-tunable row and falls back to the
-- spec default when the table is unseeded, so this function is correct both before and after
-- Phase 5 seeds it. A non-positive or unparseable value falls back too: a window of zero would
-- purge the whole table on the next sweep, which is not a tuning mistake anyone should be able
-- to make from a config row.
CREATE OR REPLACE FUNCTION public.audit_logs_retention_days()
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw   jsonb;
  v_days  integer;
BEGIN
  SELECT c.value INTO v_raw
    FROM public.account_deletion_runtime_config c
   WHERE c.key = 'anonymization_retention_days';

  IF v_raw IS NULL OR jsonb_typeof(v_raw) <> 'number' THEN
    RETURN 365;
  END IF;

  v_days := (v_raw #>> '{}')::integer;
  IF v_days IS NULL OR v_days < 1 THEN
    RETURN 365;
  END IF;
  RETURN v_days;
END;
$$;

-- ===========================================================================
-- PART 3 — the ONE exempt path (SCL-087 / R3)
-- ===========================================================================

-- @spec [Doc-01_V8 §5.1 (both tier transitions); SCL-087 PROPOSED]
-- The single function permitted to mutate or delete audit_logs. It serves BOTH transitions the
-- spec names, because they are one rule at two ages and a second function would be a second
-- path to gate:
--   'strip_identity' — at hard delete (T+7): NULL the actor and target ids of every row naming
--                      this profile. §5.1: "actor_profile_id and target_profile_id become NULL;
--                      only anonymized metadata retained".
--   'purge_expired'  — after the window: hard-delete rows older than audit_logs_retention_days(),
--                      oldest first, at most p_batch_size per call.
-- Returns what it did AND the cutoff it used, so a run that changed nothing is distinguishable
-- in the logs from a run that never happened (the notification-sweep discipline).
CREATE OR REPLACE FUNCTION public.apply_audit_logs_retention(
  p_action      text,
  p_profile_id  uuid    DEFAULT NULL,
  p_batch_size  integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz;
  v_rows   bigint;
BEGIN
  IF p_action NOT IN ('strip_identity', 'purge_expired') THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: unknown action %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'strip_identity' AND p_profile_id IS NULL THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: strip_identity requires a profile id' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'purge_expired' AND (p_batch_size IS NULL OR p_batch_size < 1) THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Open the gate for this transaction only.
  PERFORM set_config('lyceon.audit_logs_retention', 'on', true);

  IF p_action = 'strip_identity' THEN
    UPDATE public.audit_logs
       SET actor_profile_id  = NULL,
           target_profile_id = NULL
     WHERE actor_profile_id = p_profile_id
        OR target_profile_id = p_profile_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Close it again, so nothing later in THIS transaction inherits the exemption.
    PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
    RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', NULL);
  END IF;

  v_cutoff := now() - make_interval(days => public.audit_logs_retention_days());

  DELETE FROM public.audit_logs a
   WHERE a.id IN (
     SELECT b.id FROM public.audit_logs b
      WHERE b.created_at < v_cutoff
      ORDER BY b.created_at
      LIMIT p_batch_size
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
  RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', v_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_audit_logs_retention(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_audit_logs_retention(text, uuid, integer) TO service_role;


-- ===========================================================================
-- PART 4 — the three actions Doc 01 §5 names, written by the deletion path
-- ===========================================================================
-- Each function below is the CURRENT definition from
-- supabase/migrations/20260917000000_deletion_evidence_bundle.sql, reproduced verbatim with the
-- audit write added at one anchored point. Nothing else in them changes; the generator that
-- produced this file aborts if any anchor has moved.

-- ---------------------------------------------------------------------------
-- profile_soft_deleted — at request, inside the same transaction as the lock
-- ---------------------------------------------------------------------------
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

  -- @spec [Doc-01_V8 §5 action enum; §40.2.1 Phase 1 "Emit audit event" inside the DB
  -- transaction] | @implemented [2026-09-17]
  -- The profile is live and identified here, so the row carries real ids: §5's trail is worth
  -- nothing if it cannot say whose account it was. No address, no token, no free text — the
  -- changes/context payloads carry the schedule and the source, which are not personal data.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor_id,
    p_profile_id,
    'profile_soft_deleted',
    jsonb_build_object('deleted_at', jsonb_build_object('from', NULL, 'to', 'set')),
    jsonb_build_object(
      'source', 'request_account_deletion',
      'scheduled_hard_delete_at', v_sched,
      'grace_days', p_grace_days
    )
  );

  RETURN QUERY SELECT v_now, v_sched;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- profile_restored — recovery-token path
-- ---------------------------------------------------------------------------
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

  -- @spec [Doc-01_V8 §5 action enum; §40.4 "profile_restored audit event"]
  -- | @implemented [2026-09-17] Self-service recovery: the actor is the profile itself (§5
  -- "may be the profile itself for self-service"). The token hash is deliberately absent.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    v_profile_id,
    v_profile_id,
    'profile_restored',
    jsonb_build_object('deleted_at', jsonb_build_object('from', 'set', 'to', NULL)),
    jsonb_build_object('source', 'restore_account_deletion', 'path', 'recovery_token')
  );

  RETURN v_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_account_deletion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_account_deletion(text) TO service_role;

-- ---------------------------------------------------------------------------
-- profile_restored — in-app cancel path
-- ---------------------------------------------------------------------------
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

  -- @spec [Doc-01_V8 §5 action enum; §40.4] | @implemented [2026-09-17]
  -- The in-app twin of the recovery path above; same action, different route, recorded as such.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_profile_id,
    p_profile_id,
    'profile_restored',
    jsonb_build_object('deleted_at', jsonb_build_object('from', 'set', 'to', NULL)),
    jsonb_build_object('source', 'cancel_account_deletion', 'path', 'in_app')
  );

  RETURN p_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- profile_hard_deleted + the at-execution id strip — T3, evidence-side
-- ---------------------------------------------------------------------------
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
  v_profile   uuid;
  v_stripped  bigint := 0;
  v_strip     jsonb;
BEGIN
  v_json := p_completions::jsonb;
  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'array' THEN
    RAISE EXCEPTION 'complete_deletion_log: p_completions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE _completions ON COMMIT DROP AS
    SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id,
           c.stripe_subscription_item_id, c.final_status, c.profile_id
      FROM jsonb_to_recordset(v_json)
        AS c(log_id uuid, stripe_customer_id text, stripe_subscription_id text,
             stripe_subscription_item_id text, final_status text, profile_id uuid);

  SELECT array_agg(c.log_id ORDER BY c.log_id) INTO v_ids FROM _completions c;

  UPDATE public.deletion_request_log
     SET status = 'completed', responded_on = v_today
   WHERE log_id = ANY (v_ids)
     AND status = 'executing';
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  INSERT INTO public.deletion_billing_record
    (log_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id, cancelled_on, final_status)
  SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id, c.stripe_subscription_item_id, v_today, c.final_status
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE c.final_status IS NOT NULL
     AND (c.stripe_customer_id IS NOT NULL OR c.stripe_subscription_id IS NOT NULL)
   ORDER BY c.log_id
  ON CONFLICT (log_id) DO NOTHING;
  GET DIAGNOSTICS v_billing = ROW_COUNT;

  -- @spec [Doc-01_V8 §5 (profile_hard_deleted), §5.1 (ids become NULL at hard delete);
  -- SCL-087 PROPOSED; owner brief 2026-09-17 §3.1/§3.3] | @implemented [2026-09-17]
  --
  -- THE AUDIT HALF OF T3. This is the evidence-side transaction, so neither of the two writes
  -- below can share an xmin with an actor_id-side row — that isolation is the whole reason they
  -- are here and not in the cascade (see this migration's header).
  --
  -- p_completions carries profile_id for exactly this: the profile row is already gone, so the
  -- uuid is a dead key used to FIND audit rows and then erased from them. It is never stored on
  -- the evidence side — the PG suite asserts structurally that no evidence table has a uuid
  -- column other than log_id.
  FOR v_profile IN SELECT c.profile_id FROM _completions c WHERE c.profile_id IS NOT NULL ORDER BY c.profile_id
  LOOP
    v_strip := public.apply_audit_logs_retention('strip_identity', v_profile);
    v_stripped := v_stripped + COALESCE((v_strip ->> 'rows')::bigint, 0);
  END LOOP;

  -- One row per completed deletion, with NO ids from the start: §5.1 retains "action type,
  -- timestamp, status code" and nothing else once a profile is hard-deleted. Written NULL rather
  -- than written-then-stripped, so this row never needs the exemption at all.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  SELECT NULL, NULL, 'profile_hard_deleted', NULL,
         jsonb_build_object('source', 'complete_deletion_log', 'status', 'completed')
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE l.status = 'completed';

  RETURN jsonb_build_object(
    'completed', v_completed,
    'billing_records', v_billing,
    'audit_rows_stripped', v_stripped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_deletion_log(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_deletion_log(text) TO service_role;

COMMIT;
