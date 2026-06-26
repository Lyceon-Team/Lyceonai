-- ============================================================================
-- PR-5c: actor_id backfill + NOT NULL seal (Doc 05E §8 step 3)
-- ============================================================================
-- @spec [Doc-05E §8 step 3, §6 INV-05E-06/07, SCL-011] | @implemented [2026-06-26]
-- plain English: backfills actor_id from profiles on any rows where it is NULL
--   (no-op on empty tables; correct for any rows at apply time), then seals all
--   7 actor_id columns NOT NULL. A fail-closed sentinel between the two phases
--   aborts the entire migration if any row remains unstamped (profile-gone or
--   identity-null edge case). One transaction: backfill → sentinel → seal.
-- LYCEON-MIGRATION-REVIEWED

-- ============================================================================
-- PART 1: Backfill — stamp actor_id from profiles where NULL
-- ============================================================================
-- Idempotent: AND t.actor_id IS NULL means already-stamped rows are untouched.
-- Sources actor_id from profiles via the identity column (user_id or student_id).

-- Activity tables (5)
UPDATE public.practice_sessions       t SET actor_id = p.actor_id FROM public.profiles p WHERE t.user_id    = p.id AND t.actor_id IS NULL;
UPDATE public.practice_session_items  t SET actor_id = p.actor_id FROM public.profiles p WHERE t.user_id    = p.id AND t.actor_id IS NULL;
UPDATE public.review_sessions        t SET actor_id = p.actor_id FROM public.profiles p WHERE t.student_id = p.id AND t.actor_id IS NULL;
UPDATE public.review_session_items   t SET actor_id = p.actor_id FROM public.profiles p WHERE t.student_id = p.id AND t.actor_id IS NULL;
UPDATE public.review_error_attempts  t SET actor_id = p.actor_id FROM public.profiles p WHERE t.student_id = p.id AND t.actor_id IS NULL;

-- Audit tables (2)
UPDATE public.mastery_event_audit_log          t SET actor_id = p.actor_id FROM public.profiles p WHERE t.student_id = p.id AND t.actor_id IS NULL;
UPDATE public.mastery_domain_refresh_audit_log t SET actor_id = p.actor_id FROM public.profiles p WHERE t.student_id = p.id AND t.actor_id IS NULL;

-- ============================================================================
-- PART 1b: Fail-closed sentinel — abort if any row still has actor_id NULL
-- ============================================================================
-- Catches the profile-gone edge case: a row whose identity column points to a
-- deleted profile cannot be backfilled (no source). If any such row exists, the
-- NOT NULL seal MUST NOT proceed. INV-05E-07: fail-closed grouping.
DO $sentinel$
DECLARE
  v_tbl text;
  v_cnt bigint;
BEGIN
  FOR v_tbl IN VALUES
    ('practice_sessions'), ('practice_session_items'),
    ('review_sessions'), ('review_session_items'),
    ('review_error_attempts'),
    ('mastery_event_audit_log'), ('mastery_domain_refresh_audit_log')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE actor_id IS NULL', v_tbl) INTO v_cnt;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION '05E-5c BACKFILL SENTINEL: % row(s) in public.% still have actor_id NULL after backfill — cannot seal NOT NULL (profile-gone or identity-null rows?)',
        v_cnt, v_tbl;
    END IF;
  END LOOP;
END $sentinel$;

-- ============================================================================
-- PART 2: NOT NULL seal — DB-enforced actor_id presence
-- ============================================================================
-- Safe: sentinel above guarantees zero NULL rows. Makes the actor_id-always-
-- present invariant DB-ENFORCED, not just guard-enforced (G6/G7 remain as
-- defense-in-depth).

-- Activity tables (5)
ALTER TABLE public.practice_sessions       ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.practice_session_items  ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.review_sessions        ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.review_session_items   ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.review_error_attempts  ALTER COLUMN actor_id SET NOT NULL;

-- Audit tables (2)
ALTER TABLE public.mastery_event_audit_log          ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.mastery_domain_refresh_audit_log ALTER COLUMN actor_id SET NOT NULL;
