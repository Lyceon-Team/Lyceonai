-- ---------------------------------------------------------------------------
-- Guardian-link transitions, each atomic with its own audit row.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-01_V8 §35 ("Additional audit table ... captures every status change for
--        traceability"), §36.1 Initiation, §36.3 Revocation; owner ruling 2026-08-27 Q5
--        (unify to fail-closed, matching PR 1's resolver)]
-- @implemented 2026-08-28
--
-- WHY THIS IS A MIGRATION AND NOT A CHANGED `catch`.
--   The route wrote the status through one PostgREST call and the audit row through another.
--   PostgREST runs every request in its OWN transaction, so those two writes could never be
--   atomic from the application no matter how their errors were handled. Flipping the writer's
--   catch to fail-closed in that shape produces the WORST of the three outcomes: a 500 returned
--   to the caller, an ACTIVE link in the database, and no audit row -- a link that exists, is
--   unrecorded, and was reported as a failure. Fail-closed only means anything if the state
--   change and its record share a transaction, and in this stack that means the pair moves into
--   the database. Each function below is one plpgsql body, which is one transaction: if the
--   audit insert raises, the status change rolls back with it, and the caller is told the
--   transition did not happen -- which is then true.
--
-- WHAT THE SCHEMA ALREADY SAID.
--   `audit_logs` carries `audit_logs_no_mutate` (genesis.sql:284), a BEFORE UPDATE OR DELETE
--   trigger making it append-only, and it holds zero rows in production. The schema has been
--   enforcing immutability on a record that has never received a write, while its only writer
--   was built to lose one. This makes the code agree with the intent the schema already states.
--
-- ERROR SIGNALLING. Custom SQLSTATEs, surfaced by PostgREST as `error.code`, so the caller maps
-- a CODE rather than matching a message string. One definition of the map, in
-- packages/shared/src/guardian-link-schema.ts.
--   LY001 not pending   LY002 wrong acceptor   LY003 not active   LY004 already exists
--
-- IDEMPOTENT: every function is CREATE OR REPLACE; no table, column or constraint is touched.
-- NOT APPLIED BY THIS SESSION -- Karl applies all SQL.
--
-- rollback:
--   DROP FUNCTION IF EXISTS public.create_guardian_link_audited(uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.accept_guardian_link_audited(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.revoke_guardian_link_audited(uuid, uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.guardian_link_audit(text, uuid, uuid, jsonb, uuid, text);
--   -- The application falls back by reverting server/lib/account.ts to its PostgREST writes;
--   -- no data migration is required because these functions add no columns and no rows beyond
--   -- the audit_logs entries they write, which are themselves the point and are append-only.
-- ---------------------------------------------------------------------------

-- Shared audit insert. Actor is the acting profile, target the counterparty -- the shape every
-- existing call site already uses, so the trail does not change meaning when it moves.
CREATE OR REPLACE FUNCTION public.guardian_link_audit(
  p_action     text,
  p_actor      uuid,
  p_target     uuid,
  p_changes    jsonb,
  p_link_id    uuid,
  p_request_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  VALUES (
    p_actor, p_target, p_action, p_changes,
    jsonb_build_object('request_id', p_request_id, 'link_id', p_link_id)
  );
$fn$;

-- §36.1 initiation. The application-level occupancy rule, made a database rule.
CREATE OR REPLACE FUNCTION public.create_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_initiated_by text,
  p_request_id   text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_row    public.guardian_links;
  v_actor  uuid;
  v_target uuid;
BEGIN
  IF p_initiated_by NOT IN ('guardian', 'student') THEN
    RAISE EXCEPTION 'initiated_by must be guardian or student' USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_initiated_by
                WHEN 'guardian' THEN 'pending_student_accept'
                ELSE 'pending_guardian_accept'
              END;

  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status IN ('active', 'pending_student_accept', 'pending_guardian_accept')
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at)
  VALUES (p_guardian_id, p_student_id, v_status, p_initiated_by, now())
  RETURNING * INTO v_row;

  IF p_initiated_by = 'guardian' THEN
    v_actor := p_guardian_id; v_target := p_student_id;
  ELSE
    v_actor := p_student_id;  v_target := p_guardian_id;
  END IF;

  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', v_actor, v_target,
    jsonb_build_object('from', NULL, 'to', v_row.status, 'initiated_by', p_initiated_by),
    v_row.id, p_request_id
  );

  RETURN v_row;
END;
$fn$;

-- §36.1 step 5 acceptance. Party-agnostic: the acceptor must be whichever side the pending
-- status waits on, which is the entire content of the two-step flow.
CREATE OR REPLACE FUNCTION public.accept_guardian_link_audited(
  p_link_id              uuid,
  p_accepting_profile_id uuid,
  p_request_id           text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before   public.guardian_links;
  v_after    public.guardian_links;
  v_required uuid;
  v_target   uuid;
BEGIN
  -- FOR UPDATE, so a concurrent acceptance waits rather than races. The application version
  -- used a compare-and-swap for the same reason; a row lock is the stronger form and costs
  -- nothing now the whole transition is one transaction.
  SELECT * INTO v_before FROM public.guardian_links WHERE id = p_link_id FOR UPDATE;

  IF NOT FOUND OR v_before.status NOT IN ('pending_student_accept','pending_guardian_accept') THEN
    RAISE EXCEPTION 'link is not awaiting acceptance' USING ERRCODE = 'LY001';
  END IF;

  v_required := CASE v_before.status
                  WHEN 'pending_student_accept' THEN v_before.student_profile_id
                  ELSE v_before.guardian_profile_id
                END;

  IF v_required <> p_accepting_profile_id THEN
    RAISE EXCEPTION 'awaiting acceptance by the other party' USING ERRCODE = 'LY002';
  END IF;

  UPDATE public.guardian_links
     SET status = 'active',
         accepted_at = now(),
         accepted_by_profile_id = p_accepting_profile_id
   WHERE id = p_link_id
  RETURNING * INTO v_after;

  v_target := CASE WHEN p_accepting_profile_id = v_after.student_profile_id
                   THEN v_after.guardian_profile_id
                   ELSE v_after.student_profile_id
              END;

  -- `from` is READ from the row, never asserted. The route that hardcoded
  -- 'pending_guardian_accept' was correct only by virtue of which half it served.
  PERFORM public.guardian_link_audit(
    'guardian_link_accepted', p_accepting_profile_id, v_target,
    jsonb_build_object('from', v_before.status, 'to', v_after.status),
    v_after.id, p_request_id
  );

  RETURN v_after;
END;
$fn$;

-- §36.3 revocation. Either party may revoke; the revoker is recorded, not assumed.
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
  v_after  public.guardian_links;
  v_target uuid;
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

  RETURN v_after;
END;
$fn$;

-- Service-role only, matching guardian_view_decision's two-arg forms: these MUTATE state and
-- must never be reachable from an authenticated client.
REVOKE ALL ON FUNCTION public.guardian_link_audit(text, uuid, uuid, jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_guardian_link_audited(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_guardian_link_audited(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_guardian_link_audited(uuid, uuid, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.guardian_link_audit(text, uuid, uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_guardian_link_audited(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_guardian_link_audited(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link_audited(uuid, uuid, uuid, text, text) TO service_role;
