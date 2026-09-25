-- ============================================================================
-- Doc 05F §8.1 — the target fields are DATA, not gates. R-08-17 reversed.
--
-- @spec [Doc 05F §8.1, §17.5; owner ruling 2026-09-24 (Brief 10); SCL-130]
-- AUTHORED ONLY — the owner applies this. Nothing here runs on merge.
--
-- WHAT THIS CHANGES, AND WHY IT IS ONE LINE.
--
-- `setup_requires_target_score` said: a completed setup must carry a target score.
--
--     CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL)
--
-- That made the one field nobody can supply a precondition for having a plan at all.
-- Production on 2026-09-24: 104 students, ONE study profile. Nothing in the product
-- collects a test date or a target score except the calendar's own setup sheet, and that
-- sheet sits behind `calendar_access` — so a free student could never reach it, and an
-- entitled one met a required field before they had any reason to care about it. Doc 05C
-- computes projections with no target to compare them against, and no student sees a
-- countdown, because the column that would drive it is empty for 103 of 104 rows.
--
-- The owner's ruling: nothing in setup is required and nothing blocks. A student can press
-- straight through without answering and still get a plan. Using the target to tune plan
-- aggressiveness (the original point of R-08-17) is a V2 item and is explicitly out of
-- scope, so the constraint is not protecting a live consumer — it is protecting a
-- behaviour that does not exist yet.
--
-- BOTH COLUMNS WERE ALREADY NULLABLE. Only the CHECK made them effectively required, and
-- only once setup completed. So this migration drops the constraint and touches nothing
-- else: no column is added, dropped or retyped, and every existing row still satisfies the
-- table (dropping a CHECK cannot invalidate data).
--
-- WHAT STILL CONSTRAINS THEM. `target_score` keeps its own bounds from 20260917130000 --
-- BETWEEN 400 AND 1600, and a multiple of 10 -- so a supplied value is still canonical.
-- This is about whether a value must EXIST, never about which values are legal.
--
-- WHAT "SETUP COMPLETE" NOW MEANS. It was derived in the server from the write that first
-- gave the row a target score, mirroring this CHECK. With the CHECK gone that derivation
-- would strand every student who skips the field: no `setup_completed_at`, so
-- `readStudyProfile` keeps answering `setup_required`, so the popup reopens forever and
-- R-08-04 never generates a first plan. `profile-service.ts` now stamps it on the first
-- write that finds no completed setup -- the student reached the end of the flow, which is
-- what completing setup has always actually meant. The two are changed together
-- deliberately: leaving either alone reintroduces the requirement from the other side.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK — LYCEON-MIGRATION-REVIEWED (INV-06)
-- ----------------------------------------------------------------------------
-- Re-adding the constraint restores the old behaviour exactly, and is safe ONLY while no
-- row violates it:
--
--   ALTER TABLE public.student_study_profile
--     ADD CONSTRAINT setup_requires_target_score
--     CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL);
--
-- Before running it, check what it would reject:
--
--   SELECT count(*) FROM public.student_study_profile
--    WHERE setup_completed_at IS NOT NULL AND target_score IS NULL;
--
-- Zero today (one profile exists, and it carries a score). Once any student completes setup
-- without a target score that count is non-zero and the ALTER fails on those rows — which
-- is the constraint telling the truth, not a defect. Rolling back past that point means
-- deciding what those students' target should be, and there is no correct default; that
-- absence is the reason the field stopped being required. The column comments below are
-- restored by reverting this file. Reverting the SQL alone is NOT a complete rollback:
-- `profile-service.ts`'s derivation must go back with it, or setup completes for students
-- the restored CHECK then forbids.
-- ============================================================================

ALTER TABLE public.student_study_profile
  DROP CONSTRAINT IF EXISTS setup_requires_target_score;

COMMENT ON COLUMN public.student_study_profile.target_score IS
  'Doc 05F §8.1. OPTIONAL (owner ruling 2026-09-24, SCL-130; R-08-17 reversed). 400..1600 in steps of 10 when present. NULL means the student has not set one: every surface renders that as an absence with its own copy, never as a zero and never as an error. Not read by Doc 05C, which projects without reference to a target.';

COMMENT ON COLUMN public.student_study_profile.target_exam_date IS
  'Doc 05F §8.1. OPTIONAL (owner ruling 2026-09-24, SCL-130). NULL means the student has not picked a test date -- setup offers "I haven''t picked a date yet" as a first-class answer. The countdown and the exam-cadence anchor both render an absence rather than a number when it is NULL.';

COMMENT ON COLUMN public.student_study_profile.setup_completed_at IS
  'Doc 05F §17.5. Stamped by the FIRST profile write that finds no completed setup -- the student reached the end of the flow. It no longer means "a target score exists": the setup_requires_target_score CHECK that tied the two together was dropped by 20261002000000, because nothing in setup is required.';
