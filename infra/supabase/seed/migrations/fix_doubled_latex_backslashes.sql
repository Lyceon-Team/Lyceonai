-- Fix doubled LaTeX backslashes in option text
-- Early-batch questions (batches 001–005) have doubled backslashes in JSONB
-- option text: e.g. \\frac{7}{3} stored instead of \frac{7}{3}.
-- KaTeX renders \\ as a line break, producing garbage display.
--
-- Scope: 25 questions, 70 option elements (options JSONB array only;
-- stems and explanations confirmed clean in prod).
-- Self-targeting by regex signature — no hardcoded ID list.
--
-- Fix: halve doubled control sequences \\<letter/delimiter> → \<letter/delimiter>.
-- Does NOT touch legitimate \\ (LaTeX line break) which would be \\ followed
-- by whitespace/newline/end-of-string, not a command letter.
--
-- Negative control: SATM261P4YE has single backslashes — must NOT be changed.

BEGIN;

-- ─── Pre-flight count assertion ────────────────────────────────────────────
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(DISTINCT q.id) INTO v_count
  FROM public.questions q,
       LATERAL jsonb_array_elements(q.options) AS elem(val)
  WHERE q.source_type = 2
    AND elem.val->>'text' ~ E'\\\\\\\\[a-zA-Z({]';

  IF v_count <> 25 THEN
    RAISE EXCEPTION 'Pre-flight count mismatch: expected 25 affected questions, found %', v_count;
  END IF;

  RAISE NOTICE 'Pre-flight OK: 25 questions with doubled LaTeX backslashes';
END $$;

-- ─── Negative control: snapshot before ──────────────────────────────────────
DO $$
DECLARE
  v_before jsonb;
BEGIN
  SELECT options INTO v_before FROM public.questions WHERE id = 'SATM261P4YE';
  -- Store in a temp table for post-check comparison
  CREATE TEMP TABLE _neg_control AS SELECT v_before AS options_before;
END $$;

-- ─── Fix: rebuild options JSONB array, halving doubled backslashes ──────────
-- For each affected question, iterate its options array, apply the fix to each
-- element's "text" field, and rebuild the array.
UPDATE public.questions q
SET options = (
  SELECT jsonb_agg(
    CASE
      WHEN elem.val->>'text' ~ E'\\\\\\\\[a-zA-Z({]'
      THEN jsonb_set(
             elem.val,
             '{text}',
             to_jsonb(
               regexp_replace(
                 elem.val->>'text',
                 E'\\\\\\\\([a-zA-Z({])',
                 E'\\\\\\1',
                 'g'
               )
             )
           )
      ELSE elem.val
    END
    ORDER BY elem.ordinality
  )
  FROM jsonb_array_elements(q.options) WITH ORDINALITY AS elem(val, ordinality)
)
WHERE q.source_type = 2
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(q.options) AS e(val)
    WHERE e.val->>'text' ~ E'\\\\\\\\[a-zA-Z({]'
  );

-- ─── Post-check 1: zero doubled signatures remain bank-wide ────────────────
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.questions q,
       LATERAL jsonb_array_elements(q.options) AS e(val)
  WHERE q.source_type = 2
    AND e.val->>'text' ~ E'\\\\\\\\[a-zA-Z({]';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Post-check FAILED: % option elements still have doubled backslashes', v_remaining;
  END IF;

  RAISE NOTICE 'Post-check OK: zero doubled LaTeX backslashes remain';
END $$;

-- ─── Post-check 2: negative control unchanged ──────────────────────────────
DO $$
DECLARE
  v_after jsonb;
  v_before jsonb;
BEGIN
  SELECT options INTO v_after FROM public.questions WHERE id = 'SATM261P4YE';
  SELECT options_before INTO v_before FROM _neg_control;

  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Negative control FAILED: SATM261P4YE options were modified';
  END IF;

  RAISE NOTICE 'Negative control OK: SATM261P4YE unchanged';
  DROP TABLE _neg_control;
END $$;

COMMIT;
