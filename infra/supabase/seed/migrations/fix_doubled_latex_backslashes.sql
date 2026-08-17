-- Fix doubled LaTeX backslashes in option text
-- Early-batch questions (batches 001–005) have doubled backslashes in JSONB
-- option text: e.g. \\frac{7}{3} stored instead of \frac{7}{3}, and \\$ / \\%
-- instead of \$ / \%. KaTeX renders \\ as a line break, producing garbage display.
--
-- Scope: 31 questions, 92 option elements (options JSONB array only).
-- Stems and explanations are NOT touched — the 13 stems with \\ are legitimate
-- LaTeX line breaks in \begin{cases}/aligned environments.
-- Self-targeting by regex signature — no hardcoded ID list.
--
-- Fix rule: \\<non-whitespace> → \<non-whitespace>. This halves doubled commands
-- (\\frac), doubled escaped-dollars (\\$), and doubled escaped-percents (\\%).
-- Does NOT touch \\ followed by whitespace or end-of-string — that would be a
-- legitimate LaTeX line break. (None exist in options, but the guard makes the
-- transform safe by construction.)
--
-- Negative controls:
--   SATM261P4YE — options have single backslashes; must NOT be changed.
--   SATM239UMU4 — stem has a legit \\ line break; must survive (proves stems untouched).

BEGIN;

-- ─── Pre-flight count assertion ────────────────────────────────────────────
DO $$
DECLARE
  v_q_count integer;
  v_opt_count integer;
BEGIN
  SELECT count(DISTINCT q.id), count(*)
  INTO v_q_count, v_opt_count
  FROM public.questions q,
       LATERAL jsonb_array_elements(q.options) AS elem(val)
  WHERE q.source_type = 2
    AND elem.val->>'text' ~ E'\\\\\\\\[^\\s]';

  IF v_q_count <> 31 THEN
    RAISE EXCEPTION 'Pre-flight count mismatch: expected 31 affected questions, found %', v_q_count;
  END IF;

  RAISE NOTICE 'Pre-flight OK: 31 questions, % option elements with doubled LaTeX backslashes', v_opt_count;
END $$;

-- ─── Negative controls: snapshot before ────────────────────────────────────
DO $$
DECLARE
  v_opts_before jsonb;
  v_stem_before text;
BEGIN
  -- SATM261P4YE: options already clean (single backslash)
  SELECT options INTO v_opts_before FROM public.questions WHERE id = 'SATM261P4YE';

  -- SATM239UMU4: stem has legit \\ line break — must not be touched
  SELECT stem INTO v_stem_before FROM public.questions WHERE id = 'SATM239UMU4';

  CREATE TEMP TABLE _neg_controls AS SELECT
    v_opts_before AS satm261p4ye_options,
    v_stem_before AS satm239umu4_stem;
END $$;

-- ─── Fix: rebuild options JSONB array, halving doubled backslashes ──────────
-- For each affected question, iterate its options array, apply the fix to each
-- element's "text" field where \\<non-ws> is found, and rebuild the array.
-- Only the options column is updated — stem/explanation are never in the SET.
UPDATE public.questions q
SET options = (
  SELECT jsonb_agg(
    CASE
      WHEN elem.val->>'text' ~ E'\\\\\\\\[^\\s]'
      THEN jsonb_set(
             elem.val,
             '{text}',
             to_jsonb(
               regexp_replace(
                 elem.val->>'text',
                 E'\\\\\\\\([^\\s])',
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
    WHERE e.val->>'text' ~ E'\\\\\\\\[^\\s]'
  );

-- ─── Post-check 1: zero doubled signatures remain in options bank-wide ─────
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.questions q,
       LATERAL jsonb_array_elements(q.options) AS e(val)
  WHERE q.source_type = 2
    AND e.val->>'text' ~ E'\\\\\\\\[^\\s]';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Post-check FAILED: % option elements still have doubled backslashes', v_remaining;
  END IF;

  RAISE NOTICE 'Post-check OK: zero doubled LaTeX backslashes remain in options';
END $$;

-- ─── Post-check 2: negative control — SATM261P4YE options unchanged ───────
DO $$
DECLARE
  v_after jsonb;
  v_before jsonb;
BEGIN
  SELECT options INTO v_after FROM public.questions WHERE id = 'SATM261P4YE';
  SELECT satm261p4ye_options INTO v_before FROM _neg_controls;

  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Negative control FAILED: SATM261P4YE options were modified';
  END IF;

  RAISE NOTICE 'Negative control OK: SATM261P4YE options unchanged';
END $$;

-- ─── Post-check 3: negative control — SATM239UMU4 stem unchanged ──────────
DO $$
DECLARE
  v_after text;
  v_before text;
BEGIN
  SELECT stem INTO v_after FROM public.questions WHERE id = 'SATM239UMU4';
  SELECT satm239umu4_stem INTO v_before FROM _neg_controls;

  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Negative control FAILED: SATM239UMU4 stem was modified';
  END IF;

  -- Confirm the stem still has its legit \\ (line break)
  IF v_after !~ E'\\\\\\\\' THEN
    RAISE EXCEPTION 'Negative control FAILED: SATM239UMU4 stem lost its \\\\ line break';
  END IF;

  RAISE NOTICE 'Negative control OK: SATM239UMU4 stem unchanged (legit \\\\ preserved)';
  DROP TABLE _neg_controls;
END $$;

COMMIT;
