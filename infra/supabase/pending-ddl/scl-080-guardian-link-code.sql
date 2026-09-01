-- SCL-080 — guardian linking by student code. AUTHORED, NOT APPLIED.
--
-- This file is deliberately NOT in supabase/migrations/. A file there is applied
-- automatically by scripts/ci/genesis-fresh-apply.sh and by the next person to run the
-- pipeline; keeping it here makes "author, never apply" literally true, per
-- docs/plans/Stripe_Vertical_Session_Charter.md:79-81.
--
-- It exists as SQL rather than only as fenced blocks in
-- docs/plans/GUARDIAN_LINK_CODE_DDL.md so that the PG-backed contract tests can APPLY it
-- to their throwaway database and prove the routes and the DDL together. Without that,
-- no part of this feature can be proved against real Postgres at all.
--
-- Owner: apply D-6..D-8 here and the D-9 DML from the queue doc. If the migration freeze
-- is lifted, this becomes a migration with `git mv` and nothing else changes.
--
-- Rationale for every statement is in docs/plans/GUARDIAN_LINK_CODE_DDL.md.

-- Redeeming a code creates a LIVE link. The student's act of sharing is the consent
-- (SCL-080), so there is no second party to wait for and no pending status to pass through.
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
  v_row public.guardian_links;
BEGIN
  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
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

  RETURN v_row;
END;
$fn$;

-- The two-step flow's acceptance half. SCL-080 removes the step; the function is dead.
DROP FUNCTION IF EXISTS public.accept_guardian_link_audited(uuid, uuid, text);

-- Superseded by create_active_guardian_link_audited. Dropped so link creation has exactly
-- one implementation (CLAUDE.md, "One implementation per operation").
DROP FUNCTION IF EXISTS public.create_guardian_link_audited(uuid, uuid, text, text);

-- pending_* become unreachable under SCL-080. Narrow the CHECK so the database refuses a
-- status no code path can legitimately produce, rather than leaving it writable.
-- SAFE TODAY: production holds 0 guardian_links rows (verified 2026-09-01, read-only).
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS guardian_links_status_check;
ALTER TABLE public.guardian_links ADD CONSTRAINT guardian_links_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text]));

ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS unique_active_link;

-- Says exactly what the invariant is: one active link per pair, any number of historical
-- revoked rows. NULLS NOT DISTINCT is dropped with the constraint — neither keyed column is
-- nullable, so it was never doing anything.
CREATE UNIQUE INDEX unique_active_guardian_link
  ON public.guardian_links (guardian_profile_id, student_profile_id)
  WHERE status = 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_link_code_issued_at timestamptz;

-- Rotation is read-path work: the code is looked up by value on redemption and by owner on
-- display. The existing profiles_student_link_code_key covers lookup by value.
COMMENT ON COLUMN public.profiles.student_link_code_issued_at IS
  'SCL-080: when the current student_link_code was issued. NULL means no code has been '
  'issued yet. TTL comes from auth_runtime_config.student_link_code_ttl_seconds.';


-- ===========================================================================
-- D-9 — DML. Seeds the bucket map (absent in production, which is why every
-- guardian route 503s today) and the code TTL. Included here so the PG-backed
-- tests get a database the routes can actually run against.
-- ===========================================================================

INSERT INTO public.rate_limit_runtime_config (key, value, value_type, owner, description, environment)
VALUES (
  'bucket_definitions',
  '{
     "guardian_link_attempts_daily":    {"limit": 10, "window_seconds": 86400},
     "guardian_link_email_attempts":    {"limit": 3,  "window_seconds": 86400},
     "guardian_link_code_entry":        {"limit": 10, "window_seconds": 86400},
     "student_link_code_regeneration":  {"limit": 10, "window_seconds": 86400}
   }'::jsonb,
  'object',
  'guardian',
  'Doc 01A Appendix A.3 bucket map. Doc 01 V8 §36.2 supplies the first two limits verbatim; SCL-080 supplies the code buckets.',
  'all'
);

INSERT INTO public.auth_runtime_config (key, value, value_type, owner, description, environment)
VALUES (
  'student_link_code_ttl_seconds',
  '86400'::jsonb,
  'integer',
  'guardian',
  'SCL-080: how long a student link code stays valid before rotation. 24h per the owner ruling.',
  'all'
);
