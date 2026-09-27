-- ============================================================================
-- THE STUDENT CHOOSES HOW OFTEN, NOT JUST WHICH DAY
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc 05F §7.1 student_study_profile; §8.1 setup table (R-08-27,
--        Lyceon_Doc_05F.md:122 and :449); §21 runtime config;
--        formula sheet §2 step 2 / §4 constants table]
-- @implemented [2026-09-27]
--
-- plain English: `student_study_profile` records WHICH weekday a student wants
--   full-length practice tests on, and nothing records HOW OFTEN. The cadence
--   came from `full_length_every_n_occurrences`, an operator-tuned config value
--   applied to every student alike. Practice and review take what the student
--   chose; exams did not. This adds `full_length_interval_weeks` so they do.
--
--   Expected outcome: a student picks Weekly / Every 2 weeks / Every 3 weeks /
--   Monthly (1, 2, 3, 4) or None (NULL), and placement is arithmetic on that.
--
-- WHY THE PAIR IS ONE DECISION, NOT TWO. `full_length_pair` makes the two
--   columns agree by construction: both set, or neither. The alternative —
--   two independently nullable columns — has two states that mean nothing a
--   student ever chose. A weekday with no interval is "Saturdays, at some
--   frequency nobody picked"; an interval with no weekday is "every 2 weeks,
--   on no day". The generator already reads a null weekday as "no automatic
--   exams at all" (20260917130000_calendar_v1.sql:1297), so a null PAIR is the
--   single encoding of None, and the CHECK is what keeps it single.
--
--   There is no hidden default on either half. `full_length_weekday` is
--   nullable with no DEFAULT (20260917130000_calendar_v1.sql:210) and this
--   column is the same, so an INSERT that mentions neither satisfies the pair
--   rather than tripping it. If the student picks a frequency the UI supplies a
--   day, and vice versa — that is a route and UI obligation (§8.1), and the
--   constraint is what makes a failure to honour it a rejected write instead of
--   a profile nobody can explain.
--
-- STATEMENT ORDER IS LOAD-BEARING. Column, then backfill, then the pair CHECK.
--   Adding the CHECK before the backfill would fail immediately on every
--   existing row that has a weekday: at that instant the new column is NULL on
--   all of them, so `(NULL IS NULL) = (weekday IS NULL)` is `true = false`.
--   The constraint is added last, when the data it describes is already true.
--
-- BACKFILL, AND WHY `2` IS THE SAME CADENCE THEY ALREADY HAD, not a new
--   default imposed on them: `full_length_every_n_occurrences` counted
--   OCCURRENCES of `full_length_weekday`, and a fixed weekday occurs once a
--   week, so its seeded value of 2 (20260917130000_calendar_v1.sql:741) already
--   meant "every 2 weeks". Existing students keep the spacing they have; the
--   column only makes it theirs to change.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: retire
--   `full_length_every_n_occurrences` or `full_length_min_gap_days`.
--   `public.calendar_place_full_lengths` still reads both
--   (20260917130000_calendar_v1.sql:1286-1287) through
--   `public.calendar_require_int`, which RAISES 22023 on a missing key rather
--   than defaulting (:786-789). Deleting the rows here would stop plan
--   generation for every student the moment this file is applied, and it would
--   do so between this migration and the one that rewrites the generator. The
--   two config rows are therefore retired in the SAME migration that stops
--   reading them, which is where `generator_version` is bumped too. This file
--   is additive and safe to apply on its own.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
-- Apply order: standalone. Nothing else depends on it, and it depends on
--   nothing beyond 20260917130000 (the table) and 20260917140000 (the config
--   seeds it sits beside).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PART 1 — the column
--
-- 1..4 and not a free smallint: these are the four cadences §8.1 offers, and a
-- CHECK that admits 5 would admit a frequency no surface can produce and no
-- student can have chosen. The config row in PART 3 bounds the DEFAULT the UI
-- starts from; this CHECK bounds what may ever be stored.
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_study_profile
  ADD COLUMN full_length_interval_weeks smallint
    CONSTRAINT student_study_profile_full_length_interval_weeks_check
    CHECK (full_length_interval_weeks IN (1, 2, 3, 4));

COMMENT ON COLUMN public.student_study_profile.full_length_interval_weeks IS
  'Doc 05F §8.1 (R-08-27 as amended): weeks between full-length practice tests, as the student chose it — 1, 2, 3 or 4. NULL means no automatic full-lengths, and `full_length_pair` keeps it NULL exactly when full_length_weekday is. Weeks, not a label: Weekly / Every 2 weeks / Every 3 weeks / Monthly is the UI''s rendering of 1/2/3/4, so a copy change never migrates data.';

-- ---------------------------------------------------------------------------
-- PART 2 — backfill, then the pair
--
-- The UPDATE touches only rows that already have a weekday. A row with no
-- weekday is a student with no automatic exams, and it must stay (NULL, NULL):
-- giving it an interval would both violate the pair and invent a cadence for a
-- student who declined one.
-- ---------------------------------------------------------------------------
UPDATE public.student_study_profile
   SET full_length_interval_weeks = 2
 WHERE full_length_weekday IS NOT NULL
   AND full_length_interval_weeks IS NULL;

ALTER TABLE public.student_study_profile
  ADD CONSTRAINT full_length_pair
  CHECK ((full_length_interval_weeks IS NULL) = (full_length_weekday IS NULL));

-- ---------------------------------------------------------------------------
-- PART 3 — the config default
--
-- A DEFAULT for the setup form to open on, not a cadence applied to anyone.
-- The distinction is the whole point of this change: the retired
-- `full_length_every_n_occurrences` was read by the GENERATOR, so an operator
-- edit silently re-spaced every student's exams. This row is read by the SETUP
-- SURFACE, so an operator edit changes what a new student sees first and
-- changes nothing about a student who has already chosen. The generator must
-- never read it.
-- ---------------------------------------------------------------------------
INSERT INTO public.calendar_runtime_config
  (key, value, value_type, min_value, max_value, owner, description) VALUES

  ('default_full_length_interval_weeks', '2', 'integer', '1', '4', 'product',
   'Doc 05F §8.1: weeks between full-length tests that the setup form and the settings sheet OPEN on, before the student chooses. A SURFACE default, never a cadence: the generator reads student_study_profile.full_length_interval_weeks and never this key, so editing it cannot re-space an existing student''s exams. Bounds match the column CHECK of 1..4 — this key narrows nothing and may never widen it.');

COMMIT;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   BEGIN;
--   ALTER TABLE public.student_study_profile DROP CONSTRAINT full_length_pair;
--   ALTER TABLE public.student_study_profile DROP COLUMN full_length_interval_weeks;
--   DELETE FROM public.calendar_runtime_config
--     WHERE key = 'default_full_length_interval_weeks';
--   COMMIT;
--
-- DROP COLUMN takes the column's own CHECK with it, so the two DROPs above are
-- the whole schema reversal; `full_length_pair` is dropped first only because
-- naming it explicitly documents that it goes.
--
-- WHAT A ROLLBACK COSTS. The backfilled 2s are lost, and so is any frequency a
-- student chose while the column existed. That loss is total but harmless while
-- this migration is applied ALONE, because nothing reads the column yet: the
-- generator is still running its `full_length_every_n_occurrences` cadence, so
-- placement before and after the rollback is identical. Once the generator
-- migration is applied the column IS the cadence, and rolling this file back
-- would have to be paired with rolling that one back too — which is why the
-- two config rows this file leaves alone are retired there and not here.
--
-- The config DELETE is safe in both directions: it re-inserts from this file,
-- and `calendar_runtime_config_history` keeps the audit trail either way
-- (the history table refuses UPDATE and DELETE,
-- 20260917130000_calendar_v1.sql:435-437).
