-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian links join a guardian to a student, and nothing else.
--
-- @spec [Guardian_Closure_Plan G2-01; audit G-AUD-05; owner ruling R5 (2026-09-27);
--        SCL-078; Doc-01 V8 §36.1] | @implemented [2026-09-29]
--
-- plain English: `create_active_guardian_link_audited` checked only that the two ids
-- differ and that the pair was not already linked. It now also refuses, with SQLSTATE
-- LY006 and before any write, a grantee whose profile is not `role = 'guardian'` and a
-- subject whose profile is not `role = 'student'`. The route already refuses non-guardians
-- (the guardian role gate, same change); this makes the function true on its own, so a
-- future caller that skips the route cannot link an admin, or a second student, to a child.
--
-- LY006 is deliberately unmapped in GUARDIAN_LINK_SQLSTATE: the route refuses first, so
-- reaching it means an invariant is broken, and the caller's 500 is the correct answer.
--
-- Every other line of the body is unchanged from its previous home,
-- 20260903000000_notifications_rebuild.sql. CREATE OR REPLACE keeps the function's ACL;
-- the grants from 20261013000000 (service_role only) are restated so this file is
-- correct on its own.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets this function (grep, 2026-09-29).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.create_active_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row          public.guardian_links;
  v_student_name text;
BEGIN
  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- G2-01: both parties' roles, read here rather than trusted from the caller. The grantee
  -- must be a guardian and the subject a student; anything else (an admin, a second student,
  -- a guardian as subject, an id with no profile) is refused BEFORE anything is written.
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_guardian_id AND role = 'guardian') THEN
    RAISE EXCEPTION 'grantee is not a guardian' USING ERRCODE = 'LY006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'subject is not a student' USING ERRCODE = 'LY006';
  END IF;

  -- Edge case 2: already linked is a 409, not a duplicate row. Only 'active' is
  -- checked because SCL-080 leaves no reachable pending status.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
     accepted_at, accepted_by_profile_id)
  VALUES (p_guardian_id, p_student_id, 'active', 'student', now(), now(), p_student_id)
  RETURNING * INTO v_row;

  -- initiated_by='student' and accepted_by=the student: the student issued and shared the
  -- code, so the student is both the initiator and the consenting party. Recording the
  -- guardian as initiator would misattribute the consent.
  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', 'student_link_code'),
    v_row.id, p_request_id
  );

  -- Doc 01 §36.1 step 6 — both parties notified, in THIS transaction (contract §2.2).
  -- Student: in_app. Guardian: in_app + email. Payload: link_id and the student's display
  -- name only (contract §8.1; Doc 01 §38.1/§38.2 — nothing beyond identity to a guardian).
  SELECT display_name INTO v_student_name FROM public.profiles WHERE id = p_student_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_linked', v_row.id::text),
    'guardian_linked',
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id,  'channels', jsonb_build_array('in_app')),
      jsonb_build_object('profile_id', p_guardian_id, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object('link_id', v_row.id, 'student_display_name', coalesce(v_student_name, ''))
  );

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_active_guardian_link_audited(uuid, uuid, text)
  TO service_role;

COMMIT;
