-- ============================================================================
-- Doc 05F §21 / formula sheet §8 item 12 — enable the review block type
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §21 enabled_block_types,
--        Doc_05F_formula_sheet.md §8 item 12 (G-08-02)]
-- @implemented [2026-09-22]
--
-- THIS IS THE LAST COMMIT OF ITS PR, AND THAT IS THE POINT. Everything it turns
-- on must already be true when it lands:
--
--   * the review ADAPTER is real, not the fail-open stub (it creates through
--     startOrReplayReviewSession, reads answered items, reports lifecycle);
--   * its contract test passes against the REAL engine on a REAL database;
--   * the launch path prefetches review's own state key and its own chunk;
--   * the plan INPUT already tells the generator which engines are on
--     (20260925000000), so enabling review MOVES seconds rather than creating
--     them -- writer gate Z-47 measures exactly that.
--
-- Flipping it any earlier would put live Start controls on review blocks with
-- nothing behind them.
--
-- WHAT CHANGES THE MOMENT THIS APPLIES. calendar_plan_to_output stops filtering
-- review members out, so the next regeneration for any student with servable
-- queue work plans review blocks. Nothing backfills: plan versions are
-- append-only (INV-08-05) and existing plans stand until their next
-- regeneration, which is the ordinary weekly run.
--
-- The FORMULA does not change and is not touched. The generator has always
-- computed review blocks; this only stops them being discarded on the way out.
-- Proved on a throwaway database before this file was written: with the flag
-- off the plan carried practice only, and with it on the same student's plan
-- carried review blocks while practice shrank by exactly their seconds.
--
-- full_length stays OFF. Its adapter is still the fail-open stub, so a
-- full-length block would render a control that cannot work. It joins the list
-- when the exam vertical ships and its contract test passes against a real
-- engine, exactly as review just did.
--
-- expected outcome: enabled_block_types = ["practice","review"], and ops
-- assertion A3 (every planned type is in the LIVE list) keeps passing because it
-- reads the list rather than naming one.
--
-- trade-offs: a student with a large queue will see review take a visible share
-- of their day. That is the design -- §13 sizes it against the queue the engine
-- can actually serve (20260924000000's servable join) -- but it is a change they
-- will notice, so it belongs in a release note rather than arriving silently.
--
-- edge cases: a student with an EMPTY queue gets no review block and sees no
-- change at all; `review_due_by_date` is [] for them either way.
--
-- Authored only. The owner applies it, LAST.
-- ============================================================================

UPDATE public.calendar_runtime_config
   SET value = '["practice","review"]'::jsonb
 WHERE key = 'enabled_block_types';

-- The update must have matched exactly one row. A silent zero-row UPDATE would
-- leave review disabled while every report above said it had been enabled.
DO $verify$
DECLARE
  v_value jsonb;
BEGIN
  SELECT value INTO v_value
  FROM public.calendar_runtime_config WHERE key = 'enabled_block_types';

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'enabled_block_types is missing from calendar_runtime_config; nothing was enabled';
  END IF;
  IF NOT (v_value @> '["practice"]'::jsonb AND v_value @> '["review"]'::jsonb) THEN
    RAISE EXCEPTION 'enabled_block_types is % after the update, expected practice and review', v_value;
  END IF;
  IF v_value @> '["full_length"]'::jsonb THEN
    RAISE EXCEPTION 'enabled_block_types now contains full_length, whose adapter is still a stub: %', v_value;
  END IF;

  RAISE NOTICE 'enabled_block_types = % (review enabled, full_length still off)', v_value;
END
$verify$;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   UPDATE public.calendar_runtime_config
--      SET value = '["practice"]'::jsonb
--    WHERE key = 'enabled_block_types';
--
-- One config row, no schema change, so a rollback cannot lose data.
--
-- WHAT THE ROLLBACK RESTORES, stated so it is a decision and not a surprise:
-- review blocks stop being PLANNED from the next regeneration. Blocks already
-- written stay in their plan versions (append-only) and a student can still
-- start one -- the adapter is real whatever the flag says, and `isLaunchable`
-- is about the engine existing, not about the flag. So a rollback stops new
-- review work being scheduled; it does not strand work already scheduled.
--
-- It does NOT restore the budget behaviour: 20260925000000 makes the generator
-- stop reserving seconds for a disabled engine, so a rolled-back student's days
-- go back to being full of practice rather than short. That is the correct
-- outcome and is why that migration lands first.
-- ============================================================================
