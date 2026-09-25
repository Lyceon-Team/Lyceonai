-- ============================================================================
-- Doc 05F §21 enabled_block_types — full_length joins practice and review
--
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar §9.1 ("enabled_block_types may not name an
--        engine without [a contract test] passing against the real engine"),
--        §9.4 (G-08-02), §21; formula sheet §8 item 12]
-- @implemented [2026-09-25]
--
-- plain English: the full-length adapter is real (server/services/calendar/
-- adapters/full-length.ts) and tests/ci/calendar.launch-contract.full_length.test.ts
-- passes against the real exam engine, so the generator may now place
-- full-length tests and the exam review after them.
--
-- expected outcome: enabled_block_types = ["practice","review","full_length"].
-- calendar_build_plan_input stops nulling the student's full_length_weekday and
-- starts reading exam facts; calendar_plan_to_output stops filtering
-- full_length members out. Gate C-07 now asserts full_length is enabled AND
-- its adapter is not the fail-open stub.
--
-- edge cases: a student with no full_length_weekday gets no automatic exams
-- (§7.1), exactly as before; a student who has never sat an exam gets
-- exams{} all NULL, which is the cold state the formula already has.
--
-- Same split as 20260928000000 (review): the switch is its own file so it can
-- be applied LAST, after the seam it depends on.
--
-- Authored only. The owner applies it, LAST.
-- ============================================================================

UPDATE public.calendar_runtime_config
   SET value = '["practice","review","full_length"]'::jsonb
 WHERE key = 'enabled_block_types';

-- The update must have matched exactly one row. A silent zero-row UPDATE would
-- leave full_length disabled while every report above said it had been enabled.
DO $verify$
DECLARE
  v_value jsonb;
BEGIN
  SELECT value INTO v_value
  FROM public.calendar_runtime_config WHERE key = 'enabled_block_types';

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'enabled_block_types is missing from calendar_runtime_config; nothing was enabled';
  END IF;
  IF NOT (v_value @> '["practice","review","full_length"]'::jsonb) THEN
    RAISE EXCEPTION 'enabled_block_types is % after the update, expected practice, review and full_length', v_value;
  END IF;
  IF to_regprocedure('public.exam_next_form_for_student(uuid)') IS NULL THEN
    RAISE EXCEPTION 'full_length enabled before its seam: apply 20261004000000 first';
  END IF;

  RAISE NOTICE 'enabled_block_types = % (full_length enabled)', v_value;
END
$verify$;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   UPDATE public.calendar_runtime_config
--      SET value = '["practice","review"]'::jsonb
--    WHERE key = 'enabled_block_types';
--
-- One config row, no schema change, so a rollback cannot lose data. Full-length
-- blocks already written stay in their plan versions (append-only); the output
-- filter hides them from the next regeneration, and a student holding one on a
-- hand-edited day sees it as before (its launch still works: the adapter is real).
