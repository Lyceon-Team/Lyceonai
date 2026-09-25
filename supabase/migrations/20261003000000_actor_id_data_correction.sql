-- ===========================================================================
-- CORRECT THE LIVE ROWS; DELETE THE ORPHANED ONES
-- ===========================================================================
-- @spec [Doc 05E §3 Rule 4, §5, §6 INV-05E-06; Doc 01 V8 §40.5; GDPR Art. 11 as applied by
--        owner ruling 2026-09-25 R3; SCL-151 (PROPOSED)] | @implemented [2026-09-25]
--
-- plain English: two write paths set `actor_id` to the profile's own primary key. This repairs
-- the rows they wrote. Measured in production 2026-09-25, across all nine tables that carry an
-- actor_id column beside an identity column:
--
--   practice_session_items   399 rows — 160 with actor_id = user_id,  40 orphaned and bogus
--   practice_sessions         35 rows —   4 with actor_id = user_id,   1 orphaned and bogus
--   mastery_event_audit_log, mastery_domain_refresh_audit_log,
--   review_sessions, review_session_items, review_error_attempts,
--   score_runs, test_sessions                        — 0 and 0, all clean
--
-- So the damage is confined to practice, and the `?? studentId` fallback in
-- review-canonical.ts never fired. 164 live rows are repairable; 41 are not.
--
-- PART A — THE LIVE ROWS. `user_id` is still present, so the correct actor_id is a lookup
-- away in `profiles`. Deterministic, no judgement, no information acquired that we did not
-- already hold about a living user.
--
-- PART B — THE 41 ORPHANED ROWS ARE DELETED, NOT REWRITTEN. They belonged to the account
-- deleted on 2026-09-23. Their actor_id is that account's primary key; `anonymized_actors`
-- records its real actor (a different uuid) and NOTHING groups under it — 0 sessions, 0 items,
-- measured. Rewriting them to the ledger's actor would mean re-linking retained data belonging
-- to someone who asked to be forgotten, on an inference that the two values correspond.
--
-- Owner ruling 2026-09-25, and the reasoning is the Article 11 model this vertical is built on:
-- when the subject can no longer be identified you do not acquire more information to repair
-- their record — you remove it. Forty practice items from one deleted account carry no
-- analytical value and cannot be reconstructed safely. Note also that the rows are unusable as
-- pseudonymous training data in their present state, because their grouping key is wrong; they
-- could only acquire value BY the re-linking the ruling forbids.
--
-- THE PREDICATE CARRIES NO HARDCODED UUID. An orphaned row (identity already severed) whose
-- actor_id matches neither a live `profiles.actor_id` nor an `anonymized_actors` row is a row
-- whose grouping identifier was invented. That selects exactly the 41. It does NOT select the
-- seven orphaned `flow` sessions from the June 2026 anonymizations, whose actor_ids ARE in the
-- ledger — verified before writing this.
--
-- IDEMPOTENT. Re-applying corrects nothing and deletes nothing, because both predicates are
-- satisfied only by rows that are still wrong.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

DO $correct$
DECLARE
  v_ps_bad_before    bigint;
  v_psi_bad_before   bigint;
  v_ps_orph_before   bigint;
  v_psi_orph_before  bigint;
  v_ps_fixed         bigint;
  v_psi_fixed        bigint;
  v_ps_deleted       bigint;
  v_psi_deleted      bigint;
  v_violations_after bigint;
BEGIN
  -- ---------- census before ----------
  SELECT count(*) INTO v_ps_bad_before  FROM public.practice_sessions
    WHERE user_id IS NOT NULL AND actor_id = user_id;
  SELECT count(*) INTO v_psi_bad_before FROM public.practice_session_items
    WHERE user_id IS NOT NULL AND actor_id = user_id;
  SELECT count(*) INTO v_ps_orph_before FROM public.practice_sessions
    WHERE user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p          WHERE p.actor_id = practice_sessions.actor_id)
      AND NOT EXISTS (SELECT 1 FROM public.anonymized_actors l  WHERE l.actor_id = practice_sessions.actor_id);
  SELECT count(*) INTO v_psi_orph_before FROM public.practice_session_items
    WHERE user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p          WHERE p.actor_id = practice_session_items.actor_id)
      AND NOT EXISTS (SELECT 1 FROM public.anonymized_actors l  WHERE l.actor_id = practice_session_items.actor_id);

  RAISE NOTICE 'ACTOR_ID BEFORE: practice_sessions live_bad=% orphan_bogus=% | practice_session_items live_bad=% orphan_bogus=%',
    v_ps_bad_before, v_ps_orph_before, v_psi_bad_before, v_psi_orph_before;

  -- ---------- PART A: correct the live rows from profiles ----------
  UPDATE public.practice_sessions s
     SET actor_id = p.actor_id
    FROM public.profiles p
   WHERE p.id = s.user_id
     AND s.actor_id = s.user_id
     AND p.actor_id <> p.id;
  GET DIAGNOSTICS v_ps_fixed = ROW_COUNT;

  UPDATE public.practice_session_items i
     SET actor_id = p.actor_id
    FROM public.profiles p
   WHERE p.id = i.user_id
     AND i.actor_id = i.user_id
     AND p.actor_id <> p.id;
  GET DIAGNOSTICS v_psi_fixed = ROW_COUNT;

  -- ---------- PART B: delete the orphaned rows ----------
  -- Children before parents: practice_session_items.session_id references practice_sessions.
  DELETE FROM public.practice_session_items i
   WHERE i.user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p         WHERE p.actor_id = i.actor_id)
     AND NOT EXISTS (SELECT 1 FROM public.anonymized_actors l WHERE l.actor_id = i.actor_id);
  GET DIAGNOSTICS v_psi_deleted = ROW_COUNT;

  DELETE FROM public.practice_sessions s
   WHERE s.user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p         WHERE p.actor_id = s.actor_id)
     AND NOT EXISTS (SELECT 1 FROM public.anonymized_actors l WHERE l.actor_id = s.actor_id);
  GET DIAGNOSTICS v_ps_deleted = ROW_COUNT;

  RAISE NOTICE 'ACTOR_ID CORRECTED: practice_sessions=% practice_session_items=%', v_ps_fixed, v_psi_fixed;
  RAISE NOTICE 'ACTOR_ID DELETED:   practice_sessions=% practice_session_items=%', v_ps_deleted, v_psi_deleted;

  -- ---------- census after: the schema-wide check must be clean ----------
  -- The gate this migration exists to satisfy, asserted unconditionally so a partial repair
  -- cannot commit. public.actor_id_integrity_violations() is created by 20261002000000, which
  -- applies immediately before this — deliberately that way round, so the check is real here
  -- rather than skipped. If the function is missing this raises, which is the correct failure.
  SELECT count(*) INTO v_violations_after FROM public.actor_id_integrity_violations();
  IF v_violations_after > 0 THEN
    RAISE EXCEPTION 'ACTOR_ID: % violation class(es) remain after correction — refusing to commit a partial repair', v_violations_after;
  END IF;
  RAISE NOTICE 'ACTOR_ID AFTER: actor_id_integrity_violations() returns 0 rows';
END $correct$;

COMMIT;
