-- ============================================================================
-- Email send gate: a silent bulk pause for a named list of students.
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see the rollback block below.
--
-- @spec [post-ALPHA brief (Karl, 2026-11-11) item 4: "Service-role function
--       email_gate_pause_profiles(profile_ids uuid[], reason text): sets paused silently (no
--       sunset note, no parent pause email), records each transition with the reason, idempotent,
--       mirrors email_state to Resend for existing contacts only (never create contacts, never
--       under-13), leaves wake-up on activity unchanged, includes a dry-run mode listing who would
--       change"; Karl's ruling on the December cohort drop: emails only paused, silently, account,
--       progress and any free Pro kept; owner brief "Email send gate" (Karl, 2026-10-30);
--       contracts/notifications.contract.md C15; SCL-281] | @implemented [2026-11-21]
--
-- plain English: the owner passes a list of student ids and a reason (e.g.
-- cohort_drop_2026_11_16). With p_dry_run (the DEFAULT) nothing is written: the result lists who
-- would be paused, who already is, and who is not a student. With p_dry_run => false each listed
-- student who is not already paused moves to paused, with one transition row (actor
-- 'bulk_pause', reason as given) and the Resend mirror queued.
--
-- WHAT "SILENT" COVERS. No student pause note (email_gate_refresh emits that; this function never
-- calls it for the student). No parent pause email: email_gate_guardian_refresh would otherwise
-- send one the first time it saw the student idle, so this function opens the parent's digest
-- pause for that student itself, with no event, exactly as that function would have (same link,
-- digest and view filters, next episode). That pause closes the way every parent pause closes:
-- student activity, a guardian sign-in, or the link ending.
--
-- WHAT IS UNCHANGED. Wake-up: email_gate_compute keeps a pause until activity (or Keep me posted)
-- after state_since, and this function sets state_since = p_now like every other pause. No
-- account, progress, entitlement or Stripe row is touched. The mirror is
-- email_gate_enqueue_mirror, which never queues an under-13; its worker PATCHes an EXISTING
-- Resend contact and treats a 404 as nothing to do, so no contact is ever created.
--
-- Trade-offs: students only. A guardian's own state is computed from their students (a direct
-- pause would be undone by the next refresh), so a guardian id is reported as not_student and left
-- alone. A list of more than 1000 ids is refused: split it.
-- Edge cases: duplicates count once; a deleted or unknown id is no_profile; a second run with the
-- same list changes nothing and writes nothing (already_paused).
--
-- rollback (by hand, in this order):
--   DROP FUNCTION IF EXISTS public.email_gate_pause_profiles(uuid[], text, boolean, timestamptz);
--   -- only once no row carries the new actor (they stay as history otherwise):
--   --   SELECT count(*) FROM public.email_gate_transitions WHERE actor = 'bulk_pause';
--   ALTER TABLE public.email_gate_transitions DROP CONSTRAINT email_gate_transitions_actor_check;
--   ALTER TABLE public.email_gate_transitions ADD CONSTRAINT email_gate_transitions_actor_check
--     CHECK (actor IN ('system', 'keep_me_posted', 'backfill'));
--   -- students this function paused stay paused until they wake (activity or Keep me posted).
-- ============================================================================

BEGIN;

-- 1. The transition ledger names this actor.
ALTER TABLE public.email_gate_transitions DROP CONSTRAINT email_gate_transitions_actor_check;
ALTER TABLE public.email_gate_transitions ADD CONSTRAINT email_gate_transitions_actor_check
  CHECK (actor IN ('system', 'keep_me_posted', 'backfill', 'bulk_pause'));

-- 2. The function.
CREATE OR REPLACE FUNCTION public.email_gate_pause_profiles(
  p_profile_ids uuid[],
  p_reason      text,
  p_dry_run     boolean DEFAULT true,
  p_now         timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r             record;
  g             record;
  v_row         public.email_gate_state%ROWTYPE;
  v_found       boolean;
  v_episode     integer;
  v_to_pause    uuid[] := '{}';
  v_already     uuid[] := '{}';
  v_not_student uuid[] := '{}';
  v_no_profile  uuid[] := '{}';
  v_guardians   integer := 0;
BEGIN
  IF p_dry_run IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'email_gate_pause_profiles: p_dry_run and p_now are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'email_gate_pause_profiles: reason must be 3-64 characters of a-z, 0-9 and _, starting with a letter'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_profile_ids IS NULL OR cardinality(p_profile_ids) = 0 THEN
    RAISE EXCEPTION 'email_gate_pause_profiles: no profile ids' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF cardinality(p_profile_ids) > 1000 THEN
    RAISE EXCEPTION 'email_gate_pause_profiles: at most 1000 ids per call' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT DISTINCT u.id, p.id AS pid, p.role::text AS role, p.deleted_at
      FROM unnest(p_profile_ids) AS u(id)
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE u.id IS NOT NULL
     ORDER BY u.id
  LOOP
    IF r.pid IS NULL OR r.deleted_at IS NOT NULL THEN
      v_no_profile := v_no_profile || r.id;
      CONTINUE;
    END IF;
    IF r.role <> 'student' THEN
      v_not_student := v_not_student || r.id;
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      -- The same per-person lock email_gate_refresh takes, so a concurrent refresh cannot interleave.
      PERFORM pg_advisory_xact_lock(hashtext('email_gate:' || r.id::text));
    END IF;
    SELECT * INTO v_row FROM public.email_gate_state WHERE profile_id = r.id FOR UPDATE;
    v_found := FOUND;
    IF v_found AND v_row.state = 'paused' THEN
      v_already := v_already || r.id;
      CONTINUE;
    END IF;
    v_to_pause := v_to_pause || r.id;

    -- The parent digest pauses this function opens (counted in a dry run too): the open filter of
    -- email_gate_guardian_refresh, minus the idle threshold.
    FOR g IN
      SELECT DISTINCT l.guardian_profile_id AS guardian_id
        FROM public.guardian_links l
        JOIN public.profiles gp ON gp.id = l.guardian_profile_id
       WHERE l.student_profile_id = r.id AND l.status = 'active'
         AND gp.role::text = 'guardian' AND gp.deleted_at IS NULL
         AND public.guardian_daily_digest_email_enabled(gp.id)
         AND public.guardian_view_decision(gp.id, r.id) = 'allow'
         AND public.email_gate_launch_pause_reason(gp.id, p_now) IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses x
                          WHERE x.guardian_id = gp.id AND x.student_id = r.id AND x.resumed_at IS NULL)
       ORDER BY 1
    LOOP
      v_guardians := v_guardians + 1;
      IF NOT p_dry_run THEN
        SELECT COALESCE(max(x.episode), 0) + 1 INTO v_episode
          FROM public.email_gate_guardian_pauses x
         WHERE x.guardian_id = g.guardian_id AND x.student_id = r.id;
        INSERT INTO public.email_gate_guardian_pauses (guardian_id, student_id, episode, paused_at)
        VALUES (g.guardian_id, r.id, v_episode, p_now);
      END IF;
    END LOOP;

    IF p_dry_run THEN
      CONTINUE;
    END IF;

    IF NOT v_found THEN
      INSERT INTO public.email_gate_state (profile_id, state, reason, state_since, updated_at)
      VALUES (r.id, 'active', 'initial', p_now, p_now)
      RETURNING * INTO v_row;
    END IF;

    UPDATE public.email_gate_state
       SET state = 'paused',
           reason = p_reason,
           state_since = p_now,
           pause_episode = pause_episode + 1,
           updated_at = p_now
     WHERE profile_id = r.id;

    INSERT INTO public.email_gate_transitions (profile_id, from_state, to_state, reason, actor, occurred_at)
    VALUES (r.id, v_row.state, 'paused', p_reason, 'bulk_pause', p_now);

    -- Never for an under-13; the worker only updates an existing Resend contact.
    PERFORM public.email_gate_enqueue_mirror(r.id, 'paused', p_now);
  END LOOP;

  -- Guardians whose digest pauses changed: bring their own state up to date (no email: the
  -- pause note in email_gate_refresh is for students only).
  IF NOT p_dry_run THEN
    FOR g IN
      SELECT DISTINCT x.guardian_id FROM public.email_gate_guardian_pauses x
       WHERE x.paused_at = p_now AND x.student_id = ANY (v_to_pause)
       ORDER BY 1
    LOOP
      PERFORM public.email_gate_refresh(g.guardian_id, p_now, 'system');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'reason', p_reason,
    'to_pause', to_jsonb(v_to_pause),
    'already_paused', to_jsonb(v_already),
    'not_student', to_jsonb(v_not_student),
    'no_profile', to_jsonb(v_no_profile),
    'guardian_digest_pauses', v_guardians);
END;
$fn$;

-- 3. Privileges: service role only (contract §9).
REVOKE ALL ON FUNCTION public.email_gate_pause_profiles(uuid[], text, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_gate_pause_profiles(uuid[], text, boolean, timestamptz)
  TO service_role;

COMMIT;
