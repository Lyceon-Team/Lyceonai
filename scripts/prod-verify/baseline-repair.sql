-- ============================================================================
-- BASELINE REPAIR — give students who completed a diagnostic the baseline they
-- are owed
-- ============================================================================
-- WRITES to public.student_section_projection_snapshots only. Touches no session,
-- no mastery row, no projection.
--
-- HOW TO RUN
--   Run baseline-repair-preview.sql first and keep its output. Then paste this
--   whole file into the SQL console. Two statements; the verdict is the last.
--
-- IDEMPOTENT AND RE-RUNNABLE. The insert is guarded by NOT EXISTS on
-- (student_id, snapshot_kind='diagnostic_baseline'), so a second run writes
-- nothing and reports 0 repaired. Re-running is safe and is the intended way to
-- pick up students whose projection has become computable since the last run.
--
-- ============================================================================
-- WHAT IT COPIES, AND WHY THAT IS A REPAIR RATHER THAN A FABRICATION
-- ============================================================================
-- Every value comes from the student's CURRENT live row in
-- student_section_projections — the numbers the mastery pipeline actually
-- computed. Nothing is invented, interpolated, or defaulted.
--
-- A student whose live projection still has a NULL projected_score_mid in either
-- section is deliberately SKIPPED. Their evidence gate has not passed, so there is
-- no honest baseline to record; they belong in baseline_pending until the pipeline
-- produces real numbers. Writing a partial or zero baseline for them would be
-- fabricating a score, which the honest-signal contract forbids outright.
--
-- ============================================================================
-- WHY THE BASELINE IS NOT THE SAME FACT AS "THE DIAGNOSTIC IS DONE"
-- ============================================================================
-- Do not be tempted to make the diagnostic CTA depend on this table. The whole
-- reason a student got stuck is that a product decision ("has this student taken
-- the diagnostic?") was answered by a compute artifact ("did the projection
-- materialize?"). Those are different questions, and the second one failed for
-- seven weeks. `diagnostic_completed` is derived from the session; this table only
-- ever drives the score display.
--
-- ============================================================================
-- SNAPSHOT SEMANTICS
-- ============================================================================
-- snapshot_kind='diagnostic_baseline' is immutable once written — the partial
-- unique index idx_baseline_once_per_student_section (student_id, section) WHERE
-- snapshot_kind='diagnostic_baseline' enforces one per student per section,
-- forever. This file never updates an existing baseline; if one exists, the
-- student is not in the repair set at all.
--
-- The recorded numbers are therefore the projection as of REPAIR time, not as of
-- diagnostic-completion time. That is a real and unavoidable difference: the
-- completion-time projection was all-NULL, which is why there is nothing to
-- recover. The honest framing is "first computable baseline", and the row's
-- refreshed_at_t_now carries when that was.
--
-- EXPECTED
--   repaired_students   = the count `repairable` showed in the preview
--   skipped_no_evidence = students with a completed diagnostic whose projection
--                         is still NULL — reported, not an error
--   verdict = 'OK — baseline repair complete'
-- ============================================================================

DO $repair$
DECLARE
  v_before        integer;
  v_after         integer;
  v_inserted      integer;
  v_students      integer;
  v_other_kinds_before integer;
  v_other_kinds_after  integer;
BEGIN
  SELECT count(*) INTO v_before
    FROM public.student_section_projection_snapshots
   WHERE snapshot_kind = 'diagnostic_baseline';

  -- NEGATIVE CONTROL baseline: periodic snapshots must not be touched.
  SELECT count(*) INTO v_other_kinds_before
    FROM public.student_section_projection_snapshots
   WHERE snapshot_kind <> 'diagnostic_baseline';

  WITH eligible AS (
    SELECT sp.*
    FROM public.student_section_projections sp
    WHERE
      -- completed diagnostic
      EXISTS (
        SELECT 1 FROM public.practice_sessions ps
         WHERE ps.user_id = sp.student_id
           AND ps.mode = 'diagnostic'
           AND ps.status = 'completed'
      )
      -- no baseline yet, for ANY section (all-or-nothing per student)
      AND NOT EXISTS (
        SELECT 1 FROM public.student_section_projection_snapshots sn
         WHERE sn.student_id = sp.student_id
           AND sn.snapshot_kind = 'diagnostic_baseline'
      )
      -- both sections computable NOW — the evidence gate that failed at
      -- completion time must pass, or there is no honest baseline to write
      AND NOT EXISTS (
        SELECT 1 FROM public.student_section_projections need
         WHERE need.student_id = sp.student_id
           AND need.projected_score_mid IS NULL
      )
      AND (
        SELECT count(*) FROM public.student_section_projections have
         WHERE have.student_id = sp.student_id
           AND have.projected_score_mid IS NOT NULL
      ) >= 2
  )
  INSERT INTO public.student_section_projection_snapshots (
    student_id, section, projected_score_mid, projected_score_low,
    projected_score_high, range_width, relevant_question_count, mastery_term,
    fl1_score, fl2_score, fl_count_used, blend_denominator,
    projection_constants_hash, mastery_model_version, refreshed_at_t_now,
    snapshot_kind
  )
  SELECT
    e.student_id, e.section, e.projected_score_mid, e.projected_score_low,
    e.projected_score_high, e.range_width, e.relevant_question_count,
    e.mastery_term, e.fl1_score, e.fl2_score, e.fl_count_used,
    e.blend_denominator, e.projection_constants_hash, e.mastery_model_version,
    e.refreshed_at_t_now,
    'diagnostic_baseline'
  FROM eligible e;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT count(*) INTO v_after
    FROM public.student_section_projection_snapshots
   WHERE snapshot_kind = 'diagnostic_baseline';

  SELECT count(*) INTO v_other_kinds_after
    FROM public.student_section_projection_snapshots
   WHERE snapshot_kind <> 'diagnostic_baseline';

  -- NEGATIVE CONTROL: nothing outside diagnostic_baseline may have moved.
  IF v_other_kinds_after <> v_other_kinds_before THEN
    RAISE EXCEPTION
      'BASELINE_REPAIR NEGATIVE CONTROL FAILED: non-baseline snapshots went % -> %; rolling back',
      v_other_kinds_before, v_other_kinds_after;
  END IF;

  -- Baselines are written in section PAIRS. An odd insert count means a student
  -- got one section and not the other, which the eligibility predicate is written
  -- to make impossible — so it means the predicate is wrong, not the data.
  IF v_inserted % 2 <> 0 THEN
    RAISE EXCEPTION
      'BASELINE_REPAIR: inserted % rows, which is odd — baselines must be written as (M, RW) pairs; rolling back',
      v_inserted;
  END IF;

  SELECT count(DISTINCT student_id) INTO v_students
    FROM public.student_section_projection_snapshots
   WHERE snapshot_kind = 'diagnostic_baseline';

  RAISE NOTICE 'BASELINE_REPAIR ok: inserted % row(s) for % student(s); baseline rows % -> %; % non-baseline snapshot(s) untouched',
    v_inserted, v_inserted / 2, v_before, v_after, v_other_kinds_after;
END $repair$;

-- Post-state. This is the last result.
SELECT
  (SELECT count(DISTINCT sn.student_id)
     FROM public.student_section_projection_snapshots sn
    WHERE sn.snapshot_kind = 'diagnostic_baseline')                  AS students_with_baseline,
  (SELECT count(*) FROM public.student_section_projection_snapshots
    WHERE snapshot_kind = 'diagnostic_baseline')                     AS baseline_rows,
  -- students who completed a diagnostic and STILL have no baseline: their
  -- projection is not computable yet. Reported, not an error — they belong in
  -- baseline_pending, and re-running this file later will pick them up.
  (SELECT count(*) FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.practice_sessions ps
                   WHERE ps.user_id = p.id AND ps.mode = 'diagnostic'
                     AND ps.status = 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.student_section_projection_snapshots sn
                       WHERE sn.student_id = p.id
                         AND sn.snapshot_kind = 'diagnostic_baseline'))
                                                                     AS skipped_no_evidence,
  (SELECT count(*) FROM public.student_section_projection_snapshots
    WHERE snapshot_kind <> 'diagnostic_baseline')                    AS periodic_snapshots_untouched,
  CASE
    WHEN (SELECT count(*) FROM public.student_section_projection_snapshots
           WHERE snapshot_kind = 'diagnostic_baseline') % 2 <> 0
      THEN 'STOP — an odd number of baseline rows exists; a student has one section and not the other'
    ELSE 'OK — baseline repair complete'
  END                                                                AS verdict;
