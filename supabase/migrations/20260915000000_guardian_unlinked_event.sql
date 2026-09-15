-- ---------------------------------------------------------------------------
-- guardian_unlinked — §36.3 revocation notifies the party who did not revoke.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-01_V8 §36.3 Revocation ("either party can revoke"), §38.1 aggregate-only
--        guardian visibility, §12.1 no free text from a minor in a trail;
--        contracts/notifications.contract.md §1.1 (adding a type is a CHECK change plus a
--        §2.3 row), §2.2 (emit inside the mutating SQL function), §5.1/§5.2 (deterministic
--        id, replay no-op), §8 (payload = identifiers and rendering parameters only)]
-- @implemented 2026-09-15
--
-- plain English: when a guardian link is revoked, the OTHER party is told. The recipient is
-- `v_target`, which this function already derived for the audit row (the party who did not
-- revoke) — the emit reuses it, so there is exactly one derivation of "who is notified".
-- Expected outcome: one `guardian_unlinked` event and two message rows (in_app + email) for
-- the non-revoking party, written in the same transaction as the status flip; the revoker
-- gets UI confirmation and no notification. Trade-off: `revocation_reason` stays on the row
-- and enters neither the payload nor the audit `changes` — it is free text, often written by
-- a minor, and the payload becomes student-readable under RLS the moment it is written.
-- Edge cases: the event id is derived from the link ROW id, so (a) it cannot collide with
-- the `guardian_linked` id for the same row (the event type is part of the hash input),
-- (b) a link that is created, revoked and re-created is a NEW row and yields a distinct id,
-- and (c) a row is revoked at most once (active→revoked has no path back), so the row id is
-- a complete identifier for "this revocation" and a replay is a no-op under ON CONFLICT.
--
-- IDEMPOTENT: the CHECK is dropped-if-exists and re-added; the function is CREATE OR REPLACE
-- (the whole body is restated — no partial edit). Existing GRANT/REVOKE on the function are
-- preserved by CREATE OR REPLACE. Safe on live data: widening a CHECK cannot fail on rows
-- that already satisfy the narrower one.
--
-- NOT APPLIED BY THIS SESSION — Karl applies all SQL.
--
-- rollback:
--   ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
--   ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_type_check
--     CHECK (event_type IN ('guardian_linked'));
--   -- (fails if any guardian_unlinked event rows exist; delete them first — they cascade to
--   --  their messages.)
--   -- Restore the pre-emit function body by re-running the revoke_guardian_link_audited
--   -- block of 20260828000000_guardian_link_audited_transitions.sql.
-- ---------------------------------------------------------------------------

BEGIN;

-- Contract §1.1: adding an event type is a CHECK change plus a §2.3 row.
ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (event_type IN ('guardian_linked', 'guardian_unlinked'));

-- §36.3 revocation. Either party may revoke; the revoker is recorded, not assumed.
-- Restated in full (contract §2.2 — the emit lives inside the mutating function).
CREATE OR REPLACE FUNCTION public.revoke_guardian_link_audited(
  p_guardian_id uuid,
  p_student_id  uuid,
  p_revoked_by  uuid,
  p_reason      text DEFAULT NULL,
  p_request_id  text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_after         public.guardian_links;
  v_target        uuid;
  v_student_name  text;
  v_guardian_name text;
BEGIN
  UPDATE public.guardian_links
     SET status = 'revoked',
         revoked_at = now(),
         revoked_by_profile_id = p_revoked_by,
         revocation_reason = p_reason
   WHERE guardian_profile_id = p_guardian_id
     AND student_profile_id  = p_student_id
     AND status = 'active'
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link is not active' USING ERRCODE = 'LY003';
  END IF;

  -- THE one derivation of the counterparty: the party who did not revoke. The audit row and
  -- the notification below both read v_target; nothing derives the recipient a second time.
  v_target := CASE WHEN p_revoked_by = v_after.student_profile_id
                   THEN v_after.guardian_profile_id
                   ELSE v_after.student_profile_id
              END;

  -- The reason is on the ROW and deliberately NOT in `changes`: free text, often written by a
  -- minor, and the trail records the transition rather than its prose (§12.1).
  PERFORM public.guardian_link_audit(
    'guardian_link_revoked', p_revoked_by, v_target,
    jsonb_build_object('from', 'active', 'to', v_after.status),
    v_after.id, p_request_id
  );

  -- §36.3 — the other party is told, in THIS transaction (contract §2.2). Recipient: v_target
  -- only, in_app + email; the revoker gets UI confirmation, never a notification. Subject is
  -- the student (the account the link is about), as for guardian_linked. Payload: the link id
  -- and the two display names (contract §8.1; Doc 01 §38.1 — identity only). The reason is
  -- NEVER here: it would become student-readable under RLS and leave in an email body.
  SELECT display_name INTO v_student_name
    FROM public.profiles WHERE id = v_after.student_profile_id;
  SELECT display_name INTO v_guardian_name
    FROM public.profiles WHERE id = v_after.guardian_profile_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_unlinked', v_after.id::text),
    'guardian_unlinked',
    v_after.student_profile_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', v_target, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object(
      'link_id', v_after.id,
      'student_display_name', coalesce(v_student_name, ''),
      'guardian_display_name', coalesce(v_guardian_name, '')
    )
  );

  RETURN v_after;
END;
$fn$;

COMMIT;
