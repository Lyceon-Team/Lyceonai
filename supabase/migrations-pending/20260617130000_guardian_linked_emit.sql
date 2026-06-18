-- ============================================================================
-- guardian_linked emission — atomic emit helper (READY-TO-DROP; NOT YET WIRED)
-- ============================================================================
-- @spec [Doc-01_V8 §35 Guardian-student linkage / §38 Guardian visibility model]
--   [contracts/notification-outbox.contract.md §2/§3] [contracts/auth-login-e2e.contract.md AL-6]
--   [docs/SpecAudit/notification-triggers.md catalog #1]
-- @implemented [2026-06-17]
-- plain English: the same-transaction emit primitive for back-emit catalog item #1
--   (guardian_linked, recipient_kind='both', subject=student). When a guardian↔student link becomes
--   ACTIVE, exactly one notification_outbox row must be emitted IN THE SAME TRANSACTION as the
--   status->'active' write (transactional-outbox; emit-with-the-write). This function is that emit,
--   keyed to the CANONICAL genesis guardian_links shape (student_profile_id; status enum
--   active|pending_student_accept|pending_guardian_accept|revoked; 3-col unique
--   (guardian_profile_id, student_profile_id, status)). event_id is a deterministic, insert-once
--   idempotency key (v5-style SHA-256 over the link id; no uuid-ossp dependency — uses genesis
--   pgcrypto extensions.digest), so retries / re-activation emit AT MOST ONE row per link.
--
-- *** NOT WIRED IN THIS LANE (auth-login wave, by owner ruling 2026-06-17). ***
--   The live TS writer server/lib/account.ts::createGuardianLink is on the WRONG schema generation
--   (it writes dead columns student_user_id / account_id / linked_at and conflicts on a key that does
--   not exist in canonical genesis). Re-pointing that writer onto genesis is the CLEANUP lane's owned
--   concern (registered: docs/SpecAudit/10-gap-registry/gap-registry.md GAP-AL-06). This migration
--   ships the genesis-correct emit so cleanup wires it in ONE LINE at the point the link goes active,
--   WITHOUT redesigning the emit. It deliberately does NOT assume create->active: it emits only for a
--   row already in status='active', so it composes with either an immediate-active create or the
--   genesis pending_*->active accept transition.
--
-- HOW CLEANUP WIRES IT (same transaction as the status->'active' write):
--   -- inside the genesis-correct link-activation RPC/transaction, immediately after the UPDATE/INSERT
--   -- that sets guardian_links.status='active' RETURNING id INTO v_link_id:
--   PERFORM public.emit_guardian_linked(v_link_id);
--   A standalone client .rpc('emit_guardian_linked', ...) call is NOT atomic with a separate
--   client-side update — emit MUST be composed into the activation transaction (SQL-side) to satisfy
--   the notification-outbox §3.1 same-transaction discipline.
--
-- PENDING / OWNER-RUN: staged in supabase/migrations-pending/ (same discipline as
--   20260617000000_notification_outbox.sql before activation) so the CI fresh-apply gate and the
--   committed genesis-schema.expected.sql snapshot do not drift. To activate: git mv into
--   supabase/migrations/, regenerate scripts/ci/genesis-schema.expected.sql, apply to the project.
--   Depends only on public.guardian_links + public.notification_outbox (both genesis/applied).
--
-- ROLLBACK (INV-06): reversible — DOWN block at foot drops the function. CREATE-only / additive.
--   LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.emit_guardian_linked(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_link        public.guardian_links%ROWTYPE;
  v_digest      bytea;
  v_uuid_bytes  bytea;
  v_event_id    uuid;
BEGIN
  SELECT * INTO v_link FROM public.guardian_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'emit_guardian_linked: guardian_links row % not found', p_link_id;
  END IF;

  -- Emit only for an ACTIVE link (the notifiable moment). Composes with create->active or the
  -- genesis pending_*->active accept transition; never assumes create implies active.
  IF v_link.status <> 'active' THEN
    RAISE EXCEPTION 'emit_guardian_linked: link % is not active (status=%)', p_link_id, v_link.status;
  END IF;

  -- Deterministic, insert-once event_id: v5-style SHA-256 over the logical event ('guardian_linked'
  -- + the link id, which is 1:1 with the (guardian, student) active link). 16 bytes, version=5 and
  -- RFC-4122 variant bits set. genesis pgcrypto digest (extensions.digest) — no uuid-ossp dependency.
  v_digest := extensions.digest('guardian_linked:' || v_link.id::text, 'sha256');
  v_uuid_bytes := substring(v_digest FROM 1 FOR 16);
  v_uuid_bytes := set_byte(v_uuid_bytes, 6, (get_byte(v_uuid_bytes, 6) & 15) | 80);    -- version 5
  v_uuid_bytes := set_byte(v_uuid_bytes, 8, (get_byte(v_uuid_bytes, 8) & 63) | 128);   -- RFC variant
  v_event_id := encode(v_uuid_bytes, 'hex')::uuid;

  -- recipient_kind='both' (the link is meaningful to student AND guardian, Doc-01 §15/§16);
  -- subject (recipient_profile_id) = the STUDENT; payload = ids only (§12 privacy).
  INSERT INTO public.notification_outbox (
    event_id, event_type, recipient_kind, recipient_profile_id, payload
  )
  VALUES (
    v_event_id,
    'guardian_linked',
    'both',
    v_link.student_profile_id,
    jsonb_build_object(
      'guardian_profile_id', v_link.guardian_profile_id,
      'link_id', v_link.id
    )
  )
  ON CONFLICT (event_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_guardian_linked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emit_guardian_linked(uuid) TO service_role;  -- no authenticated grant

COMMIT;

-- ============================================================================
-- DOWN (reversible). Run to revert this migration.
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.emit_guardian_linked(uuid);
-- COMMIT;
