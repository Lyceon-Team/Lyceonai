-- Retire the 15 off-spec sum/difference-of-cubes questions — OWNER-RUN (Karl), production.
-- Claude does not run this; nothing here has been executed against production.
--
-- @spec [docs/questions_governance.md §A.5 "No sum/difference-of-cubes factoring (CUBES_OFFSPEC)";
--        docs/SpecAudit/50-questions-ingestion/INGESTION-LOGIC.md step 8 (retire via status='retired',
--        never hard delete; ids never reused)] | @implemented [2026-10-29]
-- plain English: the official CB bank has zero cube-factoring questions in 1,618 (OCR corpus,
--   content/official-corpus), so a^3 ± b^3 factoring is off-spec for the Digital SAT (owner ruling
--   2026-10-29, Karl). These 15 published items are moved to status 'retired' with retired_at set.
--   Rows are kept, never deleted. One transaction: every guard below RAISEs, which aborts the
--   transaction, so either all 15 retire or nothing changes. Re-running after a successful run
--   aborts at the first guard (0 published), which is the intended idempotent no-op.
--   servable_questions = status 'published' AND no issue_flags, so the serving count drops by the
--   number of these 15 that were servable; the guard requires all 15 to have been servable.

BEGIN;

CREATE TEMP TABLE cube_retire_ids (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO cube_retire_ids (id) VALUES
  ('SATM2AROSXO'), ('SATM23CRWWE'), ('SATM23WY19V'), ('SATM24Z5LEL'), ('SATM252V7HV'),
  ('SATM25XSPL6'), ('SATM27ZGM43'), ('SATM2MN1IYQ'), ('SATM2OH2O7H'), ('SATM2PPCM43'),
  ('SATM2RHEP1Q'), ('SATM2W3U7IP'), ('SATM2YX3SGJ'), ('SATM2ZS7ODX'), ('SATM2ZXTAYN');

-- Eyeball: each row should be an a^3 ± b^3 factoring item (Advanced Math, Equivalent Expressions).
SELECT q.id, q.status, q.domain, q.skill_codes, left(q.stem, 140) AS stem_start
FROM public.questions q
JOIN cube_retire_ids r USING (id)
ORDER BY q.id;

-- Before counts.
CREATE TEMP TABLE cube_retire_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.questions q JOIN cube_retire_ids r USING (id)
     WHERE q.status = 'published')                                       AS published_15,
  (SELECT count(*) FROM public.servable_questions s JOIN cube_retire_ids r USING (id)) AS servable_15,
  (SELECT count(*) FROM public.servable_questions)                       AS servable_total;
SELECT * FROM cube_retire_before;
-- Expected: published_15 = 15, servable_15 = 15.

DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM cube_retire_before;
  IF b.published_15 <> 15 THEN
    RAISE EXCEPTION 'expected 15 published cube questions, found % — aborting, nothing changed', b.published_15;
  END IF;
  IF b.servable_15 <> 15 THEN
    RAISE EXCEPTION 'expected all 15 to be servable, found % — aborting, nothing changed', b.servable_15;
  END IF;
END $$;

UPDATE public.questions q
   SET status = 'retired',
       retired_at = now()
  FROM cube_retire_ids r
 WHERE q.id = r.id
   AND q.status = 'published';

-- After counts: 0 published cube questions remain; serving count dropped by exactly 15.
SELECT
  (SELECT count(*) FROM public.questions q JOIN cube_retire_ids r USING (id)
     WHERE q.status = 'published')                                       AS published_15_after,
  (SELECT count(*) FROM public.questions q JOIN cube_retire_ids r USING (id)
     WHERE q.status = 'retired')                                         AS retired_15_after,
  (SELECT servable_total FROM cube_retire_before)
    - (SELECT count(*) FROM public.servable_questions)                   AS servable_drop;
-- Expected: published_15_after = 0, retired_15_after = 15, servable_drop = 15.

DO $$
DECLARE pub int; ret int; still_servable int;
BEGIN
  SELECT count(*) INTO pub FROM public.questions q JOIN cube_retire_ids r USING (id) WHERE q.status = 'published';
  SELECT count(*) INTO ret FROM public.questions q JOIN cube_retire_ids r USING (id) WHERE q.status = 'retired';
  SELECT count(*) INTO still_servable FROM public.servable_questions s JOIN cube_retire_ids r USING (id);
  IF pub <> 0 OR ret <> 15 OR still_servable <> 0 THEN
    RAISE EXCEPTION 'post-check failed: published=%, retired=%, still servable=% — rolling back', pub, ret, still_servable;
  END IF;
END $$;
-- servable_drop is reported rather than asserted: a question published by another session
-- during this transaction would shift the total. The 15-id checks above are the assertion.

COMMIT;
