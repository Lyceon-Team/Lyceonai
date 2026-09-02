-- ============================================================================
-- SCL-080 APPLY — guardian linking by student code. OWNER RUNS THIS.
-- ============================================================================
-- Paste the contents of this file into the Supabase SQL editor and run it top to
-- bottom. It is the SAME change as
-- `supabase/migrations/20260901000000_scl_080_guardian_link_code.sql`, restated as
-- seven ordered steps with a pre-flight check and a verdict — a migration file
-- explains itself to CI, and this file explains itself to a person.
--
-- @spec [Doc-01_V8 §35, §36.1, §36.2; SCL-080] | @implemented [2026-09-01]
--
-- WHAT PRODUCTION LOOKS LIKE RIGHT NOW (verified read-only, 2026-09-01)
--   guardian_links                        0 rows, 0 of them pending
--   guardian_links_status_check           still the WIDE 4-status CHECK
--   create_guardian_link_audited          present  -> dropped by step 3
--   accept_guardian_link_audited          present  -> dropped by step 2
--   revoke_guardian_link_audited          present  -> KEPT, untouched here
--   guardian_link_audit                   present  -> KEPT, untouched here
--   create_active_guardian_link_audited   ABSENT   -> created by step 1
--   unique_active_link                    present  -> dropped by step 5
--   unique_active_guardian_link           ABSENT   -> created by step 5
--   profiles.student_link_code            present
--   profiles.student_link_code_issued_at  ABSENT   -> added by step 6
--   rate_limit_runtime_config             no bucket_definitions row -> step 7
--   auth_runtime_config                   no student_link_code_ttl_seconds -> step 7
--
-- THE ORDERING CONSTRAINT — WHY THESE SEVEN GO IN THIS ORDER
--   Step 4 narrows guardian_links.status to ('active','revoked'). ADD CONSTRAINT
--   validates every existing row, so THE NARROWING FAILS OUTRIGHT IF ANY ROW HOLDS
--   A PENDING STATUS. It is safe today only because the table is empty, and the
--   PRE-FLIGHT below re-checks that at run time rather than trusting this comment.
--
--   Steps 2 and 3 must precede step 4 for the same reason in the other tense:
--   create_guardian_link_audited WRITES 'pending_student_accept'. While it still
--   exists a live request can insert a pending row between the check and the ALTER,
--   and step 4 then fails. Dropping the writers first closes that window.
--
--   Step 1 must precede steps 2 and 3: the deployed redeem route already calls
--   create_active_guardian_link_audited, so creating the replacement before
--   removing the old pair means link creation is never without an implementation.
--
--   Steps 5, 6 and 7 are order-independent of one another, and sit after the CHECK
--   so that a failure at step 4 stops the run before the schema gains objects the
--   feature cannot yet use.
--
-- THE CONSEQUENCE OF A PARTIAL APPLY
--   Until all seven are applied, guardian linking by code DOES NOT FUNCTION in
--   production. The routes are already deployed, so the failure is live, not
--   latent: without step 1 redemption 500s on a missing function; without step 6
--   no code has an issue time, so the TTL cannot be evaluated; without step 7 the
--   rate-limit read fails closed and EVERY guardian route returns 503. There is no
--   useful intermediate state — this is one change in seven statements.
--
-- IDEMPOTENT. Every step is safe to re-run: CREATE OR REPLACE, DROP ... IF EXISTS,
-- IF NOT EXISTS, ON CONFLICT DO NOTHING. Re-running the whole file is a no-op.
-- Step 4 is drop-then-add rather than IF NOT EXISTS because a CHECK has no such
-- form; dropping first is what makes it re-runnable.
--
-- NOT REVERSIBLE BY ITSELF — the rollback is at the head of the migration file.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — read-only. Step 4 fails on a pending row, so prove there is none.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                       AS guardian_link_rows,
  count(*) FILTER (WHERE status LIKE 'pending%') AS pending_rows,
  CASE WHEN count(*) FILTER (WHERE status LIKE 'pending%') = 0
       THEN 'SAFE — proceed'
       ELSE 'STOP — resolve the pending rows first; step 4 will fail'
  END                                            AS verdict
FROM public.guardian_links;


-- ===========================================================================
-- STEP 1 of 7 — create the one-step link function the deployed route calls.
-- ===========================================================================
-- Redeeming a code creates a LIVE link: the student's act of sharing IS the
-- consent (SCL-080), so there is no second party left to wait for.
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

  -- initiated_by='student' and accepted_by=the student: the student issued and
  -- shared the code, so the student is both initiator and consenting party.
  -- Recording the guardian as initiator would misattribute the consent.
  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', 'student_link_code'),
    v_row.id, p_request_id
  );

  RETURN v_row;
END;
$fn$;


-- ===========================================================================
-- STEP 2 of 7 — drop the acceptance half of the two-step flow.
-- ===========================================================================
-- SCL-080 removes the acceptance step entirely, so this function has no caller.
DROP FUNCTION IF EXISTS public.accept_guardian_link_audited(uuid, uuid, text);


-- ===========================================================================
-- STEP 3 of 7 — drop the superseded link-creation function.
-- ===========================================================================
-- Superseded by step 1, so link creation has exactly one implementation. This is
-- also the writer of 'pending_student_accept'; step 4 depends on it being gone.
DROP FUNCTION IF EXISTS public.create_guardian_link_audited(uuid, uuid, text, text);


-- ===========================================================================
-- STEP 4 of 7 — narrow the status CHECK to the two reachable statuses.
-- ===========================================================================
-- Makes the database refuse a status no code path can now produce, rather than
-- leaving it writable. FAILS IF ANY ROW HOLDS A PENDING STATUS — see PRE-FLIGHT.
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS guardian_links_status_check;
ALTER TABLE public.guardian_links ADD CONSTRAINT guardian_links_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text]));


-- ===========================================================================
-- STEP 5 of 7 — re-key uniqueness onto the ACTIVE link, not the (pair, status).
-- ===========================================================================
-- The old 3-column constraint let a pair hold one row PER STATUS, so a second
-- revocation of the same pair raised 23505. Drop it...
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS unique_active_link;

-- ...and state what the invariant actually is: one active link per pair, any
-- number of historical revoked rows. NULLS NOT DISTINCT goes with the old
-- constraint — neither keyed column is nullable, so it was never doing anything.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_guardian_link
  ON public.guardian_links (guardian_profile_id, student_profile_id)
  WHERE status = 'active';


-- ===========================================================================
-- STEP 6 of 7 — record when the current link code was issued, so a TTL exists.
-- ===========================================================================
-- Without this column no code has an issue time and expiry cannot be evaluated.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_link_code_issued_at timestamptz;

COMMENT ON COLUMN public.profiles.student_link_code_issued_at IS
  'SCL-080: when the current student_link_code was issued. NULL means no code has been '
  'issued yet. TTL comes from auth_runtime_config.student_link_code_ttl_seconds.';


-- ===========================================================================
-- STEP 7 of 7 — seed the rate-limit bucket map and the code TTL.
-- ===========================================================================
-- The bucket map is absent in production today and the rate-limit read fails
-- closed, which is why every guardian route currently returns 503.
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
)
ON CONFLICT (key) DO NOTHING;

-- How long a displayed code stays valid before it must be rotated.
INSERT INTO public.auth_runtime_config (key, value, value_type, owner, description, environment)
VALUES (
  'student_link_code_ttl_seconds',
  '86400'::jsonb,
  'integer',
  'guardian',
  'SCL-080: how long a student link code stays valid before rotation. 24h per the owner ruling.',
  'all'
)
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- POST-APPLY VERDICT — read-only. All seven must read PASS.
-- ---------------------------------------------------------------------------
SELECT step, detail, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM (
  VALUES
    (1, 'create_active_guardian_link_audited exists',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='create_active_guardian_link_audited')),
    (2, 'accept_guardian_link_audited is gone',
        NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='accept_guardian_link_audited')),
    (3, 'create_guardian_link_audited is gone',
        NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='create_guardian_link_audited')),
    -- Asserted by CONTENT, not by an exact rendering: pg_get_constraintdef's
    -- formatting is a server-version detail (prod is PG17), and what matters is
    -- which statuses the CHECK admits.
    (4, 'status CHECK admits active/revoked and no pending status',
        (SELECT pg_get_constraintdef(oid) LIKE '%''active''%'
            AND pg_get_constraintdef(oid) LIKE '%''revoked''%'
            AND pg_get_constraintdef(oid) NOT LIKE '%pending%'
           FROM pg_constraint
          WHERE conrelid='public.guardian_links'::regclass
            AND conname='guardian_links_status_check')),
    (5, 'unique_active_guardian_link replaces unique_active_link',
        EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='unique_active_guardian_link')
        AND NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conrelid='public.guardian_links'::regclass AND conname='unique_active_link')),
    (6, 'profiles.student_link_code_issued_at exists',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles'
                   AND column_name='student_link_code_issued_at')),
    (7, 'bucket map and code TTL are seeded',
        EXISTS (SELECT 1 FROM public.rate_limit_runtime_config WHERE key='bucket_definitions')
        AND EXISTS (SELECT 1 FROM public.auth_runtime_config WHERE key='student_link_code_ttl_seconds'))
) AS t(step, detail, ok)
ORDER BY step;
