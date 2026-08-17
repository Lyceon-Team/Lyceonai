-- ============================================================================
-- RESOLVE THE ONE DUPLICATE DIAGNOSTIC — exact-target, single pinned row
-- ============================================================================
-- WRITES. Sets status='abandoned' on ONE pinned session and nothing else.
--
-- ============================================================================
-- ORDERING IS LOAD-BEARING
-- ============================================================================
--   AFTER  steps 3 and 4 are merged and deployed. Those close both reachable
--          routes (the practice route no longer accepts mode='diagnostic'; the
--          diagnostic route refuses when one is completed), so nothing can create
--          a replacement while this runs. Running it before that is pointless.
--   BEFORE the partial unique index on completed diagnostics is applied, so the
--          index creates cleanly and the collision below can never fire.
--
-- ============================================================================
-- WHY THIS FILE EXISTS AT ALL — AND WHY IT IS NOT A CODE BRANCH
-- ============================================================================
-- Production holds two diagnostic sessions for one student:
--
--   86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff  completed  40/40  2026-08-15 21:01:27Z
--   18187611-6dd2-4947-a35e-935874f83096  active      7/40  2026-08-17 06:57:30Z
--
-- The second exists only because a second diagnostic was startable. With the
-- once-only index in place and no other change, the 40th answer on 18187611 would
-- insert a second completed diagnostic, hit 23505, and surface as
-- practice_sessions_update_failed -> 500 on the student's final answer. It could
-- not be completed, and per ruling Q1 the automated sweep never touches
-- diagnostics, so it could not be closed either. A permanent zombie.
--
-- Owner ruling Q8 chose to resolve the one existing row rather than add a
-- completion-time branch. Steps 3 and 4 make the state uncreatable, so a branch
-- would be permanent code guarding a state that can never recur — dead code on the
-- hot path of every diagnostic completion.
--
-- ON Q1: "diagnostics are never swept to abandoned" constrains the AUTOMATED
-- SWEEP. It is not a prohibition on an abandoned diagnostic existing. A
-- deliberate, audited, one-off operator resolution is a different act from a timer
-- silently closing a student's baseline.
--
-- ============================================================================
-- THE 7 ANSWERED EVENTS STAY IN MASTERY. THIS FILE DOES NOT TOUCH THEM.
-- ============================================================================
-- They are real answers to real questions, already computed and attributable.
-- Nothing here reads or writes practice_session_items, and the negative control
-- below asserts the answered count across BOTH sessions is unchanged.
--
-- ============================================================================
-- completed_at IS DELIBERATELY NOT WRITTEN
-- ============================================================================
-- Stamping completed_at on abandonment is BUG-4 — it is what makes abandoned
-- sessions read as completed to anything that inspects the column. This file must
-- not reproduce the defect it sits next to in the same workstream.
--
-- `abandoned_at` does not exist yet; it arrives with step 9. This row is therefore
-- left with NO terminal timestamp, and step 9's backfill is what gives it one. The
-- session's last_activity_at (2026-08-17 07:01:26Z) already records when the
-- student actually stopped, which is the honest value and better than the
-- wall-clock time this file happens to run at.
--
-- EXPECTED
--   target_found        = 1     the pinned id resolves to exactly one row
--   target_status       = 'active'  before; 'abandoned' after
--   owner_has_completed = true  the premise: this student already has a baseline
--   answered_both       = 47    40 + 7, unchanged
--   total_sessions      = unchanged
--   verdict = 'OK — duplicate diagnostic resolved; 1 row abandoned, nothing else touched'
--
-- USAGE: paste into the SQL console. Two statements; the verdict is the last.
-- Run resolve-duplicate-diagnostic-preview.sql first.
-- ============================================================================

DO $resolve$
DECLARE
  -- Pinned. Not a predicate over a shape — a single named row. A predicate like
  -- (mode='diagnostic' AND status='active') would match any future in-flight
  -- diagnostic, including a legitimate one belonging to someone else.
  v_target        uuid := '18187611-6dd2-4947-a35e-935874f83096';
  v_keep          uuid := '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff';
  v_found         integer;
  v_status        text;
  v_owner         uuid;
  v_owner_done    integer;
  v_answered_pre  integer;
  v_answered_post integer;
  v_total_pre     integer;
  v_total_post    integer;
  v_keep_status   text;
  v_keep_done_at  timestamptz;
  v_updated       integer;
BEGIN
  -- ---- premises. Any failure here means this is not the situation the file was
  -- ---- written for, and it must not proceed.
  SELECT count(*) INTO v_found
    FROM public.practice_sessions WHERE id = v_target;
  IF v_found <> 1 THEN
    RAISE EXCEPTION
      'RESOLVE_DUP: pinned session % resolved to % row(s), expected exactly 1', v_target, v_found;
  END IF;

  SELECT status, user_id INTO v_status, v_owner
    FROM public.practice_sessions WHERE id = v_target;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION
      'RESOLVE_DUP: pinned session % has status ''%'', expected ''active'' — it has already been resolved, or it changed since this file was written',
      v_target, v_status;
  END IF;

  SELECT count(*) INTO v_owner_done
    FROM public.practice_sessions
   WHERE user_id = v_owner AND mode = 'diagnostic' AND status = 'completed';
  IF v_owner_done < 1 THEN
    RAISE EXCEPTION
      'RESOLVE_DUP: the owner of % holds no COMPLETED diagnostic. The premise of this file is that the student already has a baseline and this session is the surplus one. Without that, abandoning it would take away their only diagnostic.',
      v_target;
  END IF;

  -- ---- baselines for the negative controls
  SELECT count(*) INTO v_answered_pre
    FROM public.practice_session_items
   WHERE session_id IN (v_target, v_keep) AND status = 'answered';
  SELECT count(*) INTO v_total_pre FROM public.practice_sessions;
  SELECT status, completed_at INTO v_keep_status, v_keep_done_at
    FROM public.practice_sessions WHERE id = v_keep;

  -- ---- the write. Pinned id only. completed_at deliberately untouched.
  UPDATE public.practice_sessions
     SET status = 'abandoned',
         updated_at = now()
   WHERE id = v_target;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'RESOLVE_DUP: updated % row(s), expected exactly 1; rolling back', v_updated;
  END IF;

  -- ---- NEGATIVE CONTROLS
  SELECT count(*) INTO v_answered_post
    FROM public.practice_session_items
   WHERE session_id IN (v_target, v_keep) AND status = 'answered';
  IF v_answered_post <> v_answered_pre THEN
    RAISE EXCEPTION
      'RESOLVE_DUP NEGATIVE CONTROL FAILED: answered items across both sessions went % -> %; the 7 legitimate events must not move; rolling back',
      v_answered_pre, v_answered_post;
  END IF;

  SELECT count(*) INTO v_total_post FROM public.practice_sessions;
  IF v_total_post <> v_total_pre THEN
    RAISE EXCEPTION
      'RESOLVE_DUP NEGATIVE CONTROL FAILED: practice_sessions count went % -> %; rolling back',
      v_total_pre, v_total_post;
  END IF;

  IF (SELECT status FROM public.practice_sessions WHERE id = v_keep) <> v_keep_status
     OR (SELECT completed_at FROM public.practice_sessions WHERE id = v_keep)
        IS DISTINCT FROM v_keep_done_at THEN
    RAISE EXCEPTION
      'RESOLVE_DUP NEGATIVE CONTROL FAILED: the KEPT completed diagnostic % was modified; rolling back', v_keep;
  END IF;

  IF (SELECT completed_at FROM public.practice_sessions WHERE id = v_target) IS NOT NULL THEN
    RAISE EXCEPTION
      'RESOLVE_DUP: completed_at is set on the abandoned row. This file must not stamp it — that is BUG-4, and it is what makes abandoned sessions read as completed. Rolling back.';
  END IF;

  RAISE NOTICE 'RESOLVE_DUP ok: % abandoned; % answered items untouched; kept diagnostic % unchanged',
    v_target, v_answered_post, v_keep;
END $resolve$;

-- Post-state. This is the last result.
SELECT
  (SELECT status FROM public.practice_sessions
    WHERE id = '18187611-6dd2-4947-a35e-935874f83096')                AS target_status,
  (SELECT completed_at FROM public.practice_sessions
    WHERE id = '18187611-6dd2-4947-a35e-935874f83096')                AS target_completed_at,
  (SELECT status FROM public.practice_sessions
    WHERE id = '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff')                AS kept_status,
  (SELECT count(*) FROM public.practice_session_items
    WHERE session_id IN ('18187611-6dd2-4947-a35e-935874f83096',
                         '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff')
      AND status = 'answered')                                        AS answered_both,
  (SELECT count(*) FROM public.practice_sessions
    WHERE mode = 'diagnostic' AND status = 'completed')               AS completed_diagnostics,
  CASE
    WHEN (SELECT status FROM public.practice_sessions
           WHERE id = '18187611-6dd2-4947-a35e-935874f83096') <> 'abandoned'
      THEN 'STOP — the target session is not abandoned'
    WHEN (SELECT completed_at FROM public.practice_sessions
           WHERE id = '18187611-6dd2-4947-a35e-935874f83096') IS NOT NULL
      THEN 'STOP — completed_at was stamped on the abandoned row (BUG-4)'
    WHEN (SELECT status FROM public.practice_sessions
           WHERE id = '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff') <> 'completed'
      THEN 'STOP — the kept diagnostic is no longer completed'
    ELSE 'OK — duplicate diagnostic resolved; 1 row abandoned, nothing else touched'
  END                                                                 AS verdict;
