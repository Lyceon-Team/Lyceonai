-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- The date of birth is fixed once a profile is complete, and is_under_13 is never written
-- except by deriving it from the date of birth.
--
-- @spec [Guardian_Closure_Plan G2-03; audit G-AUD-02; owner ruling R10 (2026-09-27);
--        Doc-01 V8 §37.1 (under-13 gating derives from the date of birth)]
--        | @implemented [2026-09-29]
--
-- plain English: `is_under_13` is derived from `date_of_birth` by `profiles_set_age`, and the
-- under-13 gate reads it. A completed student could change the date of birth and walk out of
-- the gate. The route now refuses that (PATCH /api/profile → 409 DATE_OF_BIRTH_LOCKED); this
-- trigger makes the database refuse it too, so a future route or a hand-written UPDATE cannot.
--
-- Refused with SQLSTATE LY007, before the row changes:
--   1. any UPDATE that changes `is_under_13` without changing `date_of_birth` — it is derived,
--      never written directly (this was the bypass: the age trigger only fires on a date change);
--   2. any change to a COMPLETED profile's `date_of_birth`, except:
--      a. NULL → a date: the one-time guardian fill (POST /api/profile/date-of-birth, which
--         also writes only while the stored value is NULL);
--      b. a date → NULL on a row whose deletion was requested (`deleted_at` set): account
--         deletion's `deidentify_user` (20260621000000). This is the ONE named service path; no
--         admin tool edits a date of birth, and none is created here.
--
-- ORDER. BEFORE triggers fire in name order: `profiles_lock_date_of_birth` runs before
-- `profiles_set_age`, so it judges the caller's own values, not the derived ones.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets profiles triggers (grep, 2026-09-29).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.profiles_lock_date_of_birth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.is_under_13 IS DISTINCT FROM OLD.is_under_13
     AND NEW.date_of_birth IS NOT DISTINCT FROM OLD.date_of_birth THEN
    RAISE EXCEPTION 'is_under_13 is derived from date_of_birth and cannot be written'
      USING ERRCODE = 'LY007';
  END IF;

  IF OLD.profile_completed_at IS NOT NULL
     AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    IF OLD.date_of_birth IS NULL THEN
      RETURN NEW;                       -- (a) the one-time fill
    END IF;
    IF NEW.date_of_birth IS NULL AND OLD.deleted_at IS NOT NULL THEN
      RETURN NEW;                       -- (b) account deletion (deidentify_user)
    END IF;
    RAISE EXCEPTION 'date of birth is locked after profile completion'
      USING ERRCODE = 'LY007';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.profiles_lock_date_of_birth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_lock_date_of_birth ON public.profiles;
CREATE TRIGGER profiles_lock_date_of_birth
  BEFORE UPDATE OF date_of_birth, is_under_13 ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_lock_date_of_birth();

COMMIT;
