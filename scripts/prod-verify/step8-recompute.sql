-- ============================================================================
-- STEP 8 — recompute mastery for the four profiles with answered items
-- ============================================================================
-- WRITES. Run only after steps 1–6 are green, 3.1 is passing, the residue purge
-- has run, and step8-preflight.sql reports 'OK — ready to recompute'.
--
-- HOW TO RUN
--   Paste this whole file into the SQL console. Two statements: the guarded
--   recompute, then a summary row. The verdict is the last result.
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
-- population has changed, the guards below refuse rather than silently
-- recomputing a different set.
--
-- THE GUARDS ARE DUPLICATED FROM step8-preflight.sql ON PURPOSE. That file is
-- read-only and advisory; a write path must not depend on an operator having run
-- a different file first, and state can change between the two runs. These
-- checks are the fail-closed ones.
--
-- PROVENANCE: backfill_recompute_student sets
-- app.mastery_refresh_trigger = 'backfill_recompute', so every audit row it
-- produces is stamped triggered_by = 'backfill_recompute' and stays
-- distinguishable from live event-time writes. step8-verify.sql asserts this.
--
-- ATOMICITY: the whole recompute runs inside one DO block, so any guard that
-- fires rolls back every profile recomputed before it. There is no partial
-- outcome to reason about. See README.md rule 4 on why there is no explicit
-- BEGIN/COMMIT here.
-- ============================================================================

DO $recompute$
DECLARE
  v_target     uuid;
  v_targets    uuid[];
  v_observed   integer;
  v_pinned     integer;
  v_unrepaired integer;
  v_residue    integer;
  v_seal       boolean;
BEGIN
  -- ---- fail-closed preconditions ----
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
    INTO v_seal;
  IF NOT v_seal THEN
    RAISE EXCEPTION 'STEP8 PREFLIGHT: psi_resolved_requires_occurred_at missing — 1.1 has not been applied';
  END IF;

  SELECT count(*) INTO v_residue
    FROM public.mastery_event_audit_log WHERE constants_snapshot_hash = 'seedhash';
  IF v_residue > 0 THEN
    RAISE EXCEPTION
      'STEP8 PREFLIGHT: % seed-residue audit row(s) present — run purge-seed-residue.sql first',
      v_residue;
  END IF;

  -- ---- resolve and validate the pinned set ----
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

  -- ---- recompute ----
  FOREACH v_target IN ARRAY v_targets LOOP
    RAISE NOTICE 'STEP8: recomputing %', v_target;
    PERFORM public.backfill_recompute_student(v_target);
  END LOOP;

  RAISE NOTICE 'STEP8: recompute complete for % profile(s)', v_pinned;
END $recompute$;

-- Summary. Non-zero rows here mean apply_mastery_event ran to completion, which
-- it had not done once in production before this workstream. The full acceptance
-- check is step8-verify.sql — this is just the immediate did-it-write signal.
SELECT
  (SELECT count(*) FROM public.student_skill_mastery)                    AS skill_mastery_rows,
  (SELECT count(*) FROM public.student_domain_mastery)                   AS domain_mastery_rows,
  (SELECT count(*) FROM public.student_projection_refresh_state)         AS projection_refresh_rows,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
    WHERE triggered_by = 'backfill_recompute')                           AS backfill_stamped_rows,
  CASE
    WHEN (SELECT count(*) FROM public.student_domain_mastery) = 0
      THEN 'STOP — recompute reported success but domain mastery is still empty'
    WHEN (SELECT count(*) FROM public.student_projection_refresh_state) = 0
      THEN 'STOP — recompute reported success but projection refresh state is still empty'
    ELSE 'OK — recompute complete; now run step8-verify.sql'
  END                                                                    AS verdict;
