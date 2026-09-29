-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian link functions: the revoker must be a party, and EXECUTE is revoked
-- from every client role explicitly.
--
-- @spec [Guardian_Closure_Plan G1-07; audit G-AUD-10; Doc-01 V8 §36.3 (either
--        party may revoke); Coding Standards §6.1] | @implemented [2026-09-29]
--
-- plain English:
--
-- 1. `revoke_guardian_link_audited` recorded whoever it was told as the revoker,
--    and notified the student, without checking that the revoker was the guardian
--    or the student on the link. Both routes that call it pass a party today; the
--    function now refuses anyone else itself, so a future caller cannot record a
--    stranger as having revoked a child's link. Refused with SQLSTATE LY005,
--    BEFORE anything is written: no status change, no audit row, no notification.
--    Every other line of the body is unchanged from its previous home,
--    20260915000000_guardian_unlinked_event.sql.
--
-- 2. Five of the six guardian functions revoked EXECUTE only FROM PUBLIC. That is
--    safe only while the platform's default privileges grant nothing to anon or
--    authenticated, which is exactly the assumption that left
--    create_active_guardian_link_audited PUBLIC-executable in production until a
--    hand REVOKE on 2026-09-23 (20261001000000). Each role is now revoked by name.
--
--    guardian_can_view_student(uuid) KEEPS EXECUTE for authenticated: it is the
--    predicate every guardian RLS SELECT policy calls (05b/05c mirror tables), and
--    a policy expression runs as the querying role. Production has it
--    authenticated-executable (owner check 2026-09-27); that is intended and kept.
--
-- Expected grants after this migration (public / anon / authenticated / service_role):
--   guardian_view_decision(uuid,uuid)                       f f f t
--   guardian_can_view_student_as(uuid,uuid)                 f f f t
--   guardian_can_view_student(uuid)                         f f t t
--   guardian_link_audit(text,uuid,uuid,jsonb,uuid,text)     f f f t
--   create_active_guardian_link_audited(uuid,uuid,text)     f f f t
--   revoke_guardian_link_audited(uuid,uuid,uuid,text,text)  f f f t
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets any of these six
-- functions (grep, 2026-09-29), so none needs re-pointing to this file.
-- ---------------------------------------------------------------------------

BEGIN;

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
  -- G1-07: only a party to the link may revoke it. Checked before any write, and NULL is
  -- not a party (IS DISTINCT FROM keeps a NULL revoker from slipping through as unknown).
  IF p_revoked_by IS DISTINCT FROM p_guardian_id
     AND p_revoked_by IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'revoker is not a party to this link' USING ERRCODE = 'LY005';
  END IF;

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

-- Explicit, per role. service_role is the only client role that may execute any of these,
-- except guardian_can_view_student, which authenticated also needs (see header, point 2).
REVOKE ALL ON FUNCTION public.guardian_view_decision(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_view_decision(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.guardian_can_view_student_as(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_can_view_student_as(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.guardian_can_view_student(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_can_view_student(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guardian_link_audit(text, uuid, uuid, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_link_audit(text, uuid, uuid, jsonb, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.revoke_guardian_link_audited(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link_audited(uuid, uuid, uuid, text, text)
  TO service_role;

COMMIT;
