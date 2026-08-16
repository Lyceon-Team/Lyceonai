-- ============================================================================
-- STEP 8 — recompute mastery for the four profiles with answered items
-- ============================================================================
-- WRITES. Run only after steps 1–6 are green and 3.1 is passing.
--
-- Drives Doc 05D §7.2's backfill_recompute_student for the pinned profile set.
-- The 84 answered items were never lost — only their derivation was. This
-- rebuilds skill mastery, domain mastery, the four KPI rollups and the section
-- projections from the durable answer rows.
--
-- SCOPE — pinned, not discovered. The four profiles with answered items:
--   3f18cbe2  62 items
--   c3c97b64  14 items
--   f95b29f3   7 items
--   0ebe43d9   1 item
-- Pinned rather than SELECTed so the write set is reviewable in the diff. If the
-- population has changed, the pre-flight below refuses rather than silently
-- recomputing a different set.
--
-- PROVENANCE: backfill_recompute_student sets
-- app.mastery_refresh_trigger = 'backfill_recompute', so every audit row it
-- produces is stamped triggered_by = 'backfill_recompute' and stays
-- distinguishable from live event-time writes. step8-verify.sql asserts this.
--
-- ORDER: run purge-seed-residue.sql FIRST. The seeded student_skill_mastery row
-- makes a zero-event student look incomplete-derived to the selection driver.
--
-- USAGE: psql -f scripts/prod-verify/step8-recompute.sql
-- ============================================================================

\set ON_ERROR_STOP on
\pset footer off

\echo '=== STEP 8 PRE-FLIGHT ==='

-- Refuse to run if the prerequisites are not actually in place. Recomputing on
-- top of un-repaired data would fail per-student with
-- KPI_HISTORICAL_DATA_INVALID and leave a confusing partial result.
DO $preflight$
DECLARE
  v_unrepaired integer;
  v_residue    integer;
  v_constraint boolean;
BEGIN
  SELECT count(*) INTO v_unrepaired
    FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS NULL;
  IF v_unrepaired > 0 THEN
    RAISE EXCEPTION
      'STEP8 PREFLIGHT: % resolved row(s) still have NULL occurred_at — apply 20260816000000 first',
      v_unrepaired;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'psi_resolved_requires_occurred_at')
    INTO v_constraint;
  IF NOT v_constraint THEN
    RAISE EXCEPTION 'STEP8 PREFLIGHT: psi_resolved_requires_occurred_at missing — 1.1 has not been applied';
  END IF;

  SELECT count(*) INTO v_residue
    FROM public.mastery_event_audit_log WHERE constants_snapshot_hash = 'seedhash';
  IF v_residue > 0 THEN
    RAISE EXCEPTION
      'STEP8 PREFLIGHT: % seed-residue audit row(s) present — run purge-seed-residue.sql first',
      v_residue;
  END IF;

  RAISE NOTICE 'STEP8 PREFLIGHT ok: occurred_at repaired, constraint present, residue purged';
END $preflight$;

\echo ''
\echo '--- profiles with answered items (must match the pinned set below) ---'
SELECT pi.user_id, count(*) AS answered_items
FROM public.practice_session_items pi
WHERE pi.status = 'answered'
GROUP BY pi.user_id
ORDER BY count(*) DESC;

\echo ''
\echo '=== STEP 8 RECOMPUTE ==='

DO $recompute$
DECLARE
  v_target uuid;
  v_targets uuid[];
  v_observed integer;
  v_pinned   integer;
BEGIN
  -- Pinned set. Full uuids resolved from the short prefixes in the ruling.
  SELECT array_agg(p.id ORDER BY p.id) INTO v_targets
  FROM public.profiles p
  WHERE p.id::text LIKE '3f18cbe2%'
     OR p.id::text LIKE 'c3c97b64%'
     OR p.id::text LIKE 'f95b29f3%'
     OR p.id::text LIKE '0ebe43d9%';

  v_pinned := COALESCE(array_length(v_targets, 1), 0);
  IF v_pinned <> 4 THEN
    RAISE EXCEPTION
      'STEP8: expected to resolve 4 pinned profiles, resolved % — verify the prefixes before recomputing',
      v_pinned;
  END IF;

  -- The pinned set must still equal the observed population. If a fifth student
  -- has answered items since the ruling, stop rather than silently skip them.
  SELECT count(DISTINCT pi.user_id) INTO v_observed
  FROM public.practice_session_items pi
  WHERE pi.status = 'answered' AND pi.user_id IS NOT NULL;

  IF v_observed <> 4 THEN
    RAISE EXCEPTION
      'STEP8: % distinct students now have answered items, but 4 are pinned — re-scope before recomputing',
      v_observed;
  END IF;

  FOREACH v_target IN ARRAY v_targets LOOP
    RAISE NOTICE 'STEP8: recomputing %', v_target;
    PERFORM public.backfill_recompute_student(v_target);
  END LOOP;

  RAISE NOTICE 'STEP8: recompute complete for % profile(s)', v_pinned;
END $recompute$;

\echo ''
\echo '=== run scripts/prod-verify/step8-verify.sql now ==='
