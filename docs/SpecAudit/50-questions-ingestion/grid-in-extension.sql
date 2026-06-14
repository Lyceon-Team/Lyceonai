-- ============================================================================
-- Questions Ingestion wave — genesis-extending migration: grid-in (SPR) support
-- HALT-5 ruling = (b): extend the schema so SAT Math student-produced-response
--   (grid-in) items can be represented, because the live exam runtime (Doc 04A
--   §7.3.1) and scoring (Doc 04B V4.3) already handle them via a variant set,
--   and ~?% of real CB Math is grid-in (intermixed with MCQ in the same source
--   files — proven 2026-06-14 against `docs/SAT Qeustions S.D`).
--
-- @spec [Doc-02A_V6 §16 questions canonical record] [Doc-04A §7.3.1] [Doc-04B V4.3]
-- STATUS: WRITTEN, NOT APPLIED. Owner-run in the Supabase SQL editor, AFTER this
--   logic is approved and Codex-audited — same discipline as the reseed
--   (`../30-genesis-recut/RESEED-MAPPING.md`): agents never hold service_role.
-- Additive + reversible. Run inside one transaction. Genesis bank is empty, so
--   the ADD-NOT-NULL-with-DEFAULT and the new CHECK validate against zero rows.
--
-- Live precondition VERIFIED 2026-06-14 (read-only, project MVP): the §14 id CHECK
--   is live exactly as genesis: questions_id_check = (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$').
-- ============================================================================

BEGIN;

-- 1. item_type discriminator (mcq | grid_in). Default 'mcq' is backward-safe;
--    every real insert sets it explicitly. (Doc 02A §16 had no discriminator.)
ALTER TABLE public.questions
  ADD COLUMN item_type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (item_type IN ('mcq', 'grid_in'));

-- 2. correct_variants — the accepted-answer set for grid-ins (Doc 04B variant match).
--    INTERNAL + ANSWER-BEARING: like correct_answer/explanation/option_metadata it
--    MUST NEVER be served pre-submit (Doc 02 Preamble §12 INV-02-08). The student-safe
--    projection nulls it; the anti-leak probe must assert it (see INGESTION-LOGIC §HALT-8).
ALTER TABLE public.questions
  ADD COLUMN correct_variants TEXT[];

-- 3. grid-ins have no options → relax the genesis NOT NULL. MCQ shape is re-enforced
--    by the discriminated CHECK below, so this does not weaken MCQ integrity.
ALTER TABLE public.questions
  ALTER COLUMN options DROP NOT NULL;

-- 4. Discriminated shape CHECK — the structural contract the QA validator mirrors
--    (shared/question-ingestion-qa.ts). correct_answer stays NOT NULL (genesis):
--      mcq     → correct_answer is an A–D key, options present, no variant set
--      grid_in → correct_answer is the canonical VALUE (e.g. '0.2'), no options,
--                a non-empty variant set that INCLUDES correct_answer.
ALTER TABLE public.questions
  ADD CONSTRAINT questions_item_type_shape CHECK (
    (
      item_type = 'mcq'
      AND options IS NOT NULL
      AND correct_answer ~ '^[A-D]$'
      AND correct_variants IS NULL
    )
    OR (
      item_type = 'grid_in'
      AND options IS NULL
      AND correct_answer !~ '^[A-D]$'
      AND correct_variants IS NOT NULL
      AND array_length(correct_variants, 1) >= 1
      AND correct_answer = ANY (correct_variants)
    )
  );

COMMIT;

-- ============================================================================
-- DOWN (reversible) — run only to back this out; safe while bank is empty.
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_item_type_shape;
-- -- Re-tighten options only if no grid-in rows exist (else this will fail, by design):
-- ALTER TABLE public.questions ALTER COLUMN options SET NOT NULL;
-- ALTER TABLE public.questions DROP COLUMN IF EXISTS correct_variants;
-- ALTER TABLE public.questions DROP COLUMN IF EXISTS item_type;
-- COMMIT;
