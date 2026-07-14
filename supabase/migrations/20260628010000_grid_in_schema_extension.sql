-- Grid-In Schema Extension Migration
-- @spec [Doc-02A_V6, §16; Doc-02-Preamble_V3, §12 INV-02-08; SCL-018]
-- @implemented [2026-06-28]
-- Adds item_type discriminator and correct_variants for grid-in (student-produced
-- response) questions. MCQ rows are unchanged (DEFAULT 'mcq', correct_variants NULL).
-- Fail-closed shape-integrity CHECK makes a malformed row impossible at the schema layer.
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED

-- ============================================================================
-- UP MIGRATION
-- ============================================================================

ALTER TABLE public.questions
  ADD COLUMN item_type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (item_type IN ('mcq', 'grid_in'));

ALTER TABLE public.questions
  ADD COLUMN correct_variants TEXT[];

ALTER TABLE public.questions
  ADD CONSTRAINT questions_item_shape_chk CHECK (
    (item_type = 'mcq'
       AND jsonb_typeof(options) = 'array'
       AND jsonb_array_length(options) = 4
       AND correct_variants IS NULL)
    OR
    (item_type = 'grid_in'
       AND jsonb_typeof(options) = 'array'
       AND jsonb_array_length(options) = 0
       AND correct_variants IS NOT NULL
       AND array_length(correct_variants, 1) >= 1)
  );

-- ============================================================================
-- DOWN MIGRATION (rollback — run these statements to reverse)
-- ============================================================================
-- ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_item_shape_chk;
-- ALTER TABLE public.questions DROP COLUMN IF EXISTS correct_variants;
-- ALTER TABLE public.questions DROP COLUMN IF EXISTS item_type;
--
-- Rollback is safe: dropping the constraint and columns removes the grid-in
-- extension entirely. Existing MCQ rows are unaffected. Any grid-in rows would
-- need to be retired/deleted before rollback (correct_variants column dropped).

-- ============================================================================
-- APPLY INSTRUCTIONS FOR KARL
-- ============================================================================
-- Run the UP statements (lines 15-32) against prod via Supabase SQL editor or CLI:
--
--   ALTER TABLE public.questions
--     ADD COLUMN item_type TEXT NOT NULL DEFAULT 'mcq'
--       CHECK (item_type IN ('mcq', 'grid_in'));
--
--   ALTER TABLE public.questions
--     ADD COLUMN correct_variants TEXT[];
--
--   ALTER TABLE public.questions
--     ADD CONSTRAINT questions_item_shape_chk CHECK (
--       (item_type = 'mcq'
--          AND jsonb_typeof(options) = 'array'
--          AND jsonb_array_length(options) = 4
--          AND correct_variants IS NULL)
--       OR
--       (item_type = 'grid_in'
--          AND jsonb_typeof(options) = 'array'
--          AND jsonb_array_length(options) = 0
--          AND correct_variants IS NOT NULL
--          AND array_length(correct_variants, 1) >= 1)
--     );
--
-- Existing MCQ rows satisfy the CHECK via DEFAULT 'mcq' + NULL correct_variants +
-- existing 4-element options arrays. No data migration needed.
--
-- To reverse (DOWN):
--   ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_item_shape_chk;
--   ALTER TABLE public.questions DROP COLUMN IF EXISTS correct_variants;
--   ALTER TABLE public.questions DROP COLUMN IF EXISTS item_type;
