-- ---------------------------------------------------------------------------
-- guardian_view_decision — ONE derivation of "may this guardian see this student".
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc 01 V8 §35 guardian-student linkage; §38.1 aggregate-only access;
--        Doc 05B §10.1 absence-of-policy denial, §10.3 path-layer authz
--        (404-not-403), §10.4 empty-list semantics; Doc 05 Parent AC#19;
--        owner rulings 2026-08-26 R3 (404 globally) and R6 (the resolver CALLS
--        this gate, it does not reimplement it); owner ruling 2026-08-27 OQ1
--        (return the decision, not a boolean, so 404 and 402 are distinguishable)]
-- @implemented 2026-08-27
--
-- plain English: a guardian may read a linked student's aggregates only if the
-- link is ACTIVE and the STUDENT'S entitlement is active. That rule already
-- existed, correctly, as `guardian_can_view_student(uuid)` — and had ZERO
-- application callers, because it reads `auth.uid()` and the application talks
-- to Postgres with the service role, where `auth.uid()` is NULL. The gate was
-- therefore reimplemented in TypeScript, against columns that do not exist
-- (`student_user_id`, `linked_at`), which is why `guardian_links` has never held
-- a row: `createGuardianLink` fails on its first SELECT.
--
-- WHAT THIS MIGRATION DOES. It moves the BODY down one level and leaves two thin
-- delegations on top:
--
--   guardian_view_decision(guardian, student) -> text   <-- THE derivation
--        |                                       |
--        |                                       +-- 'allow' | 'not_linked' | 'student_unentitled'
--        v
--   guardian_can_view_student_as(guardian, student) -> boolean   (application; principal explicit)
--   guardian_can_view_student(student)            -> boolean   (RLS; principal = auth.uid())
--
-- The six existing RLS policies keep calling the ONE-ARG form and are not
-- touched by this migration. The application calls the two-arg form and passes
-- the principal explicitly, so it works under the service role without needing
-- `auth.uid()` to resolve.
--
-- WHY NOT set_config('request.jwt.claims', ...) SO auth.uid() RESOLVES.
--   PostgREST pools connections. A GUC set outside a transaction can survive
--   into a later request on the same backend, and a leaked GUC on THIS predicate
--   is a cross-student read. One migration is cheaper than that risk.
--
-- WHY A DECISION AND NOT A BOOLEAN. The gate has two terms and the caller must
-- respond differently to each: an unrelated caller gets 404 (Doc 05B §10.3 —
-- "avoids leaking whether the student_id exists"), while a caller who IS linked
-- to a student whose subscription lapsed gets 402, because that answer tells
-- them nothing they do not already know and it is the paywall path. A boolean
-- collapses the two and the distinction gets reinvented in TypeScript — a second
-- derivation, which is the class this whole rebuild removes.
--
-- SECURITY. `guardian_view_decision` and `guardian_can_view_student_as` take the
-- guardian id as an ARGUMENT, so a caller who could execute them directly could
-- probe "is A linked to B" for any pair. They are therefore service-role only.
-- The one-arg form stays `authenticated`-callable because RLS needs it, and it
-- cannot be abused: it passes `auth.uid()`, so a caller may only ask about
-- themselves as guardian.
--
-- FAIL-CLOSED. A NULL principal (unauthenticated, or the service role with no
-- `auth.uid()`) matches no link row, so the decision is 'not_linked' -> false.
--
-- expected outcome: one place decides guardian visibility. Changing the body of
-- `guardian_view_decision` changes the application gate and all six RLS policies
-- together; if a test of one moves and the others do not, they are not one path.
-- trade-offs: three functions where there was one. The two added are pure
-- delegation with no branching of their own, which is the cost of having the
-- application and RLS share a derivation while entering it differently.
-- edge cases: `entitlement_active` admits 'active', 'past_due' and 'trialing'
-- (SCL-029 — the platform predicate wins over a literal status='active'), so the
-- gate deliberately grants during the grace window. Unchanged by this migration.
--
-- rollback:
--   CREATE OR REPLACE FUNCTION public.guardian_can_view_student(p_student_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path TO 'public', 'pg_temp' AS $$
--     SELECT EXISTS (
--       SELECT 1 FROM public.guardian_links gl
--       WHERE gl.guardian_profile_id = auth.uid()
--         AND gl.student_profile_id  = p_student_id
--         AND gl.status              = 'active'
--     ) AND public.entitlement_active(p_student_id);
--   $$;
--   DROP FUNCTION IF EXISTS public.guardian_can_view_student_as(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.guardian_view_decision(uuid, uuid);
--   (Restores the pre-migration body verbatim. The six RLS policies reference the
--    one-arg signature, which this migration never drops, so they are unaffected
--    in both directions.)
-- ---------------------------------------------------------------------------

BEGIN;

-- THE derivation. Every other guardian-visibility check delegates here.
CREATE OR REPLACE FUNCTION public.guardian_view_decision(
    p_guardian_id uuid,
    p_student_id  uuid
) RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = p_guardian_id
        AND gl.student_profile_id  = p_student_id
        AND gl.status              = 'active'
    ) THEN 'not_linked'
    WHEN NOT public.entitlement_active(p_student_id) THEN 'student_unentitled'
    ELSE 'allow'
  END;
$$;

COMMENT ON FUNCTION public.guardian_view_decision(uuid, uuid) IS
  'THE guardian-visibility derivation (Doc 01 V8 §35 + §38.1, Doc 05B §10.1/§10.3). '
  'Returns allow | not_linked | student_unentitled. Service-role only: the guardian id '
  'is an argument, so direct callers could otherwise probe arbitrary link pairs. '
  'guardian_can_view_student_as and guardian_can_view_student both delegate here.';

-- Boolean form for the application. Principal explicit -> works under service role.
CREATE OR REPLACE FUNCTION public.guardian_can_view_student_as(
    p_guardian_id uuid,
    p_student_id  uuid
) RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.guardian_view_decision(p_guardian_id, p_student_id) = 'allow';
$$;

COMMENT ON FUNCTION public.guardian_can_view_student_as(uuid, uuid) IS
  'Boolean form of guardian_view_decision with the principal passed explicitly, for '
  'application callers on the service-role connection where auth.uid() is NULL. '
  'Service-role only, for the same reason as guardian_view_decision.';

-- The RLS-facing signature, body replaced by delegation. Six policies unchanged.
CREATE OR REPLACE FUNCTION public.guardian_can_view_student(
    p_student_id uuid
) RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.guardian_can_view_student_as(auth.uid(), p_student_id);
$$;

COMMENT ON FUNCTION public.guardian_can_view_student(uuid) IS
  'RLS entry point for guardian visibility. Delegates to guardian_can_view_student_as '
  'with auth.uid() as the principal, so a caller may only ask about themselves as '
  'guardian. Body moved to guardian_view_decision 2026-08-27 so the application gate '
  'and the six RLS policies share ONE derivation.';

REVOKE ALL ON FUNCTION public.guardian_view_decision(uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_view_decision(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.guardian_can_view_student_as(uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardian_can_view_student_as(uuid, uuid) TO service_role;

COMMIT;
