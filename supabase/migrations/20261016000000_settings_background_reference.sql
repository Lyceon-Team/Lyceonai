-- ===========================================================================
-- SETTINGS, SERVER SIDE: STUDENT BACKGROUND, REFERENCE DATA, PASSWORD RECOVERY GRANT
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [SCL-195 (PROPOSED); Brief 8 rulings 1, 3 and 4 (owner, 2026-10-01);
--        Doc 00 §6 (minimize data collection on student surfaces); Doc 01 V8 §40.5
--        (hard delete) and scripts/ci/fk-delete-action-guard.sql (every edge into an identity
--        is CASCADE, SET NULL or allowlisted); Doc 01A Part V §39–§47 (RateLimitLedger);
--        Coding Standards §4.2 (idempotent mutations), §7 (Zod at the boundary, the CHECK
--        behind it)]
-- @implemented [2026-10-01]
--
-- plain English: four things the Settings screens need, and nothing else.
--   1. `student_background` and `student_dream_schools` — the optional background a student may
--      give: graduation year, a GPA band, their high school, and up to three dream colleges in
--      order. Every field optional, every field clearable. Keyed by student; deleting the
--      account deletes them (ON DELETE CASCADE, so the existing cascade covers them with no
--      edit to it).
--   2. `ref_colleges` and `ref_high_schools` — the reference lists those choices point at,
--      loaded by `scripts/reference-data/import-reference-data.ts` from the committed snapshot in
--      `content/reference/`, never typed in by a student. "My school isn't listed" stores
--      nothing: there is no free-text column anywhere in this file.
--   3. `save_student_background` — the ONE writer for the background, so Settings and the
--      calendar's dream-school picker cannot drift; and the two search functions.
--   4. `password_recovery_grants` — the server-held proof that THIS user just completed a
--      password-recovery link, which is what lets `/update-password` set a password without the
--      current one while an ordinary session cannot (Brief 8 ruling 4, owner choice 2026-10-01).
--
-- WHY NOT COLUMNS ON `profiles`. Ruling 1: `profiles` is Doc 01's table. A separate table also
-- keeps these fields out of every `select("*")` on profiles, and out of `req.user`.
--
-- WHY NO pg_trgm. Ruling 3 asked whether it is available and to report before adding any
-- extension. It is not enabled by any migration, and production's extension list cannot be read
-- from here. The search below needs none: a case-insensitive substring match over ~36k short
-- names, prefix matches first, capped at 20. Recorded in the register for the owner.
--
-- NOTHING HERE IS VISIBLE TO A GUARDIAN. No RLS policy is created on any table in this file, so
-- `anon` and `authenticated` read nothing; the server reads with the service role and serves the
-- student's own row only. No guardian route, projection or payload names these tables.
--
-- rollback:
--   DROP FUNCTION public.save_student_background(uuid, jsonb);
--   DROP FUNCTION public.search_ref_colleges(text, integer);
--   DROP FUNCTION public.search_ref_high_schools(text, integer);
--   DROP FUNCTION public.grant_password_recovery(uuid, integer);
--   DROP FUNCTION public.password_recovery_live(uuid);
--   DROP FUNCTION public.consume_password_recovery(uuid);
--   DROP TABLE public.student_dream_schools, public.student_background,
--              public.password_recovery_grants, public.ref_colleges, public.ref_high_schools;
--   UPDATE public.rate_limit_runtime_config SET value = value - 'reference_search'
--     WHERE key = 'bucket_definitions';
--   No data outside these tables is touched, so the rollback is exact.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reference tables
--
-- `retired_at`: the import never deletes. A college that drops out of a later snapshot is marked
-- retired — excluded from search and from new choices — but a student who already chose it keeps
-- a resolvable row. Deleting it would either fail on the foreign key or silently erase the
-- student's choice; neither is the import's decision to make.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ref_colleges (
  id          text PRIMARY KEY CHECK (id ~ '^[0-9]{6}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  city        text NOT NULL CHECK (char_length(city) <= 100),
  state       text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  retired_at  timestamptz NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ref_colleges IS
  'SCL-195. College Scorecard institutions, keyed by IPEDS UNITID: currently operating, four-year, degree-granting. Loaded only by scripts/reference-data/import-reference-data.ts from content/reference/colleges.csv (manifest.json carries source, vintage, filters, SHA-256). retired_at marks a row absent from the latest snapshot; it is never deleted.';

CREATE TABLE IF NOT EXISTS public.ref_high_schools (
  id          text PRIMARY KEY CHECK (id ~ '^(nces:[0-9]{12}|pss:[A-Z0-9]{8})$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  city        text NOT NULL CHECK (char_length(city) <= 100),
  state       text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  retired_at  timestamptz NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ref_high_schools IS
  'SCL-195. Schools offering grade 12: NCES CCD public (id nces:<NCESSCH>) and NCES PSS private (id pss:<PPIN>). Loaded only by scripts/reference-data/import-reference-data.ts from content/reference/high_schools.csv. retired_at as on ref_colleges.';

ALTER TABLE public.ref_colleges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_high_schools ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. The student's background
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_background (
  student_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The moving window (this year .. this year + 6) is enforced in the shared Zod schema, which
  -- knows the request's date. A CHECK cannot read the clock honestly (it would hold for a row
  -- written in 2026 and fail a dump restored in 2033), so this one only bounds the impossible.
  graduation_year smallint NULL CHECK (graduation_year BETWEEN 2000 AND 2100),
  gpa_range       text NULL CHECK (gpa_range IN
                    ('lt_2_0','2_0_2_49','2_5_2_99','3_0_3_49','3_5_3_79','3_8_4_0','gt_4_0')),
  -- SET NULL, not CASCADE: a reference row is never deleted by the import (see retired_at), and
  -- if an operator ever does delete one, the student's other answers survive it.
  high_school_id  text NULL REFERENCES public.ref_high_schools(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.student_background IS
  'SCL-195. Optional, student-supplied background. Never shown to a guardian, never used in any calculation (dream schools are motivation only). Written only by save_student_background. ON DELETE CASCADE from profiles: account deletion removes it.';

CREATE TABLE IF NOT EXISTS public.student_dream_schools (
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  college_id text NOT NULL REFERENCES public.ref_colleges(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, position),
  UNIQUE (student_id, college_id)
);
COMMENT ON TABLE public.student_dream_schools IS
  'SCL-195. Up to three ordered dream colleges per student (position 1..3, each college at most once). Shown on the student''s calendar as motivation only; no effect on target score or any calculation. Written only by save_student_background.';

CREATE INDEX IF NOT EXISTS student_dream_schools_college
  ON public.student_dream_schools (college_id);
CREATE INDEX IF NOT EXISTS student_background_high_school
  ON public.student_background (high_school_id) WHERE high_school_id IS NOT NULL;

ALTER TABLE public.student_background    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_dream_schools ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Password recovery grant (Brief 8 ruling 4)
--
-- Written by /auth/callback after verifyOtp(type = 'recovery') succeeds — the user has just
-- proved control of the account's email. Read and consumed by POST /api/auth/update-password.
-- One live grant per profile; a new recovery link replaces it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_recovery_grants (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > granted_at)
);
COMMENT ON TABLE public.password_recovery_grants IS
  'Brief 8 ruling 4. A single-use, short-lived proof that the profile completed a password-recovery link. Only its holder may set a password without the current one. Written by grant_password_recovery, consumed by consume_password_recovery.';
ALTER TABLE public.password_recovery_grants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.grant_password_recovery(
  p_profile_id uuid,
  p_ttl_seconds integer
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'grant_password_recovery: ttl % is outside 60..3600 seconds', p_ttl_seconds;
  END IF;
  INSERT INTO public.password_recovery_grants (profile_id, granted_at, expires_at)
  VALUES (p_profile_id, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (profile_id) DO UPDATE
    SET granted_at = EXCLUDED.granted_at, expires_at = EXCLUDED.expires_at;
END;
$fn$;

-- Read-only: is there a live grant? Checked BEFORE the password is set, so a refused update (a
-- provider error) does not spend the grant and force the student back to their inbox.
CREATE OR REPLACE FUNCTION public.password_recovery_live(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.password_recovery_grants
    WHERE profile_id = p_profile_id AND expires_at > now()
  );
$fn$;

-- Single use, atomically: the row is deleted by the same statement that decides it was live, so
-- two concurrent requests cannot both spend one grant.
CREATE OR REPLACE FUNCTION public.consume_password_recovery(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
SET search_path = public
AS $fn$
  WITH spent AS (
    DELETE FROM public.password_recovery_grants
    WHERE profile_id = p_profile_id
    RETURNING expires_at
  )
  SELECT COALESCE(bool_or(expires_at > now()), false) FROM spent;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Search
--
-- Case-insensitive substring match on the name; prefix matches first, then by name, then by id
-- so equal names order deterministically. The 2-character minimum and the 20-row cap are
-- enforced by the route's Zod schema AND here, so no caller of the function can widen either.
-- `strpos` rather than LIKE, so a query containing % or _ is matched literally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_ref_colleges(p_query text, p_limit integer)
RETURNS TABLE (id text, name text, city text, state text)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  WITH q AS (SELECT lower(btrim(p_query)) AS term)
  SELECT c.id, c.name, c.city, c.state
  FROM public.ref_colleges c, q
  WHERE char_length(q.term) >= 2
    AND c.retired_at IS NULL
    AND strpos(lower(c.name), q.term) > 0
  ORDER BY (strpos(lower(c.name), q.term) = 1) DESC, c.name, c.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20);
$fn$;

CREATE OR REPLACE FUNCTION public.search_ref_high_schools(p_query text, p_limit integer)
RETURNS TABLE (id text, name text, city text, state text)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  WITH q AS (SELECT lower(btrim(p_query)) AS term)
  SELECT s.id, s.name, s.city, s.state
  FROM public.ref_high_schools s, q
  WHERE char_length(q.term) >= 2
    AND s.retired_at IS NULL
    AND strpos(lower(s.name), q.term) > 0
  ORDER BY (strpos(lower(s.name), q.term) = 1) DESC, s.name, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20);
$fn$;

-- ---------------------------------------------------------------------------
-- 5. save_student_background — the one writer
--
-- p_patch carries ONLY the keys the request named (the route's Zod schema has already checked
-- each value): an absent key leaves the stored value alone, a JSON null clears it, and
-- `dream_school_ids` replaces the whole ordered list ([] clears it). One transaction, so a
-- failed dream-school write never leaves a half-saved background.
--
-- Expected failures are RETURNED, not raised (Coding Standards §3.6): an unknown reference id,
-- or a retired one the student does not already hold, is the student's input being wrong, a 400,
-- not a fault. A retired id the student ALREADY holds is accepted: re-saving or reordering a list
-- must not fail because one of its entries left a later snapshot (the retired row still resolves).
--
-- Idempotent by construction (§4.2): the same body twice leaves the same row and list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_student_background(
  p_student_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_ids        text[];
  v_unknown    text[];
  v_hs         text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'save_student_background: patch must be a JSON object';
  END IF;

  IF p_patch ? 'high_school_id' AND jsonb_typeof(p_patch -> 'high_school_id') = 'string' THEN
    v_hs := p_patch ->> 'high_school_id';
    IF NOT EXISTS (
      SELECT 1 FROM public.ref_high_schools WHERE id = v_hs AND retired_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.student_background
       WHERE student_id = p_student_id AND high_school_id = v_hs
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unknown_high_school');
    END IF;
  END IF;

  IF p_patch ? 'dream_school_ids' THEN
    SELECT COALESCE(array_agg(value ORDER BY ord), ARRAY[]::text[])
      INTO v_ids
      FROM jsonb_array_elements_text(p_patch -> 'dream_school_ids') WITH ORDINALITY AS t(value, ord);
    IF cardinality(v_ids) > 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'too_many_dream_schools');
    END IF;
    IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'duplicate_dream_school');
    END IF;
    SELECT array_agg(x) INTO v_unknown
      FROM unnest(v_ids) AS x
     WHERE NOT EXISTS (
       SELECT 1 FROM public.ref_colleges c WHERE c.id = x AND c.retired_at IS NULL
     ) AND NOT EXISTS (
       SELECT 1 FROM public.student_dream_schools d
        WHERE d.student_id = p_student_id AND d.college_id = x
     );
    IF v_unknown IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unknown_college');
    END IF;
  END IF;

  INSERT INTO public.student_background AS b (student_id, graduation_year, gpa_range, high_school_id, updated_at)
  VALUES (
    p_student_id,
    CASE WHEN p_patch ? 'graduation_year' THEN (p_patch ->> 'graduation_year')::smallint END,
    CASE WHEN p_patch ? 'gpa_range' THEN p_patch ->> 'gpa_range' END,
    CASE WHEN p_patch ? 'high_school_id' THEN p_patch ->> 'high_school_id' END,
    now()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    graduation_year = CASE WHEN p_patch ? 'graduation_year'
                           THEN (p_patch ->> 'graduation_year')::smallint ELSE b.graduation_year END,
    gpa_range       = CASE WHEN p_patch ? 'gpa_range'
                           THEN p_patch ->> 'gpa_range' ELSE b.gpa_range END,
    high_school_id  = CASE WHEN p_patch ? 'high_school_id'
                           THEN p_patch ->> 'high_school_id' ELSE b.high_school_id END,
    updated_at      = now();

  IF p_patch ? 'dream_school_ids' THEN
    DELETE FROM public.student_dream_schools WHERE student_id = p_student_id;
    INSERT INTO public.student_dream_schools (student_id, position, college_id)
    SELECT p_student_id, ord::smallint, value
      FROM unnest(v_ids) WITH ORDINALITY AS t(value, ord);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Privileges: service role only. Every function is SECURITY INVOKER; anon and authenticated
-- can execute none of them, and no RLS policy opens any table above to them.
-- ---------------------------------------------------------------------------
GRANT ALL ON TABLE public.ref_colleges             TO service_role;
GRANT ALL ON TABLE public.ref_high_schools         TO service_role;
GRANT ALL ON TABLE public.student_background       TO service_role;
GRANT ALL ON TABLE public.student_dream_schools    TO service_role;
GRANT ALL ON TABLE public.password_recovery_grants TO service_role;

REVOKE ALL ON FUNCTION
  public.save_student_background(uuid, jsonb),
  public.search_ref_colleges(text, integer),
  public.search_ref_high_schools(text, integer),
  public.grant_password_recovery(uuid, integer),
  public.password_recovery_live(uuid),
  public.consume_password_recovery(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.save_student_background(uuid, jsonb),
  public.search_ref_colleges(text, integer),
  public.search_ref_high_schools(text, integer),
  public.grant_password_recovery(uuid, integer),
  public.password_recovery_live(uuid),
  public.consume_password_recovery(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Rate-limit bucket for the two search endpoints (Doc 01A §39–§47).
-- One bucket for both: they are one feature (the picker), and a student switching between the
-- two pickers should not get twice the allowance. 300 per hour per student: a debounced picker
-- issues a handful of requests per search, so this is generous for a person and a hard stop for
-- a script walking the alphabet. Merged into the existing object, never replacing it.
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'reference_search', jsonb_build_object('limit', 300, 'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
    WHERE key = 'bucket_definitions' AND value ? 'reference_search'
  ) THEN
    RAISE EXCEPTION 'settings migration: the bucket_definitions row is missing, so reference_search was not seeded and both search routes would answer 503';
  END IF;
END
$rl$;

COMMIT;
