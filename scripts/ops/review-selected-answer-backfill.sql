-- ===========================================================================
-- ONE-TIME BACKFILL: review answers stored as served tokens → canonical keys (register F-49)
-- ===========================================================================
-- @spec [Brief 13 Step 0b ruling 4 (owner, Karl, 2026-10-02): review stores the canonical key
--        going forward, like practice; existing rows are backfilled once through
--        option_token_map, idempotently, with counts before and after; student-UI register
--        §8 F-49] | @implemented [2026-10-02]
--
-- plain English: before this change, POST /api/review/answer stored the served option token
-- (`opt_<16 hex>`) as `review_session_items.selected_answer`, and the resolve trigger copied it
-- into `review_error_attempts.selected_answer`. Practice stores the canonical key. This maps
-- every stored token back to its canonical key through the item's own `option_token_map`, on
-- both tables.
--
-- What it touches: only rows whose `selected_answer` is a token AND whose item's map holds that
-- token. Grid-in values, canonical letters and NULLs are left alone. No status, outcome,
-- correctness or timestamp changes. `trg_review_item_resolve` fires only on a status change
-- out of served/created, so updating an answered row does not fire it.
--
-- Idempotent: a second run finds no token rows and changes 0.
-- Fails closed: if any token is still present afterwards (a token the map does not hold), the
-- transaction raises and rolls back, so nothing is half-applied. Investigate before re-running.
--
-- Production, read-only, 2026-10-02: 26 item rows and 26 attempt rows hold tokens, all 26 and
-- 26 mappable; 13 other answered review items hold grid-in values (untouched).
--
-- OWNER-RUN. Karl applies to production. DO NOT auto-apply.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/review-selected-answer-backfill.sql
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE _f49_counts (phase text, items_token int, attempts_token int) ON COMMIT DROP;

INSERT INTO _f49_counts
SELECT 'before',
       (SELECT count(*) FROM public.review_session_items WHERE selected_answer LIKE 'opt\_%'),
       (SELECT count(*) FROM public.review_error_attempts WHERE selected_answer LIKE 'opt\_%');

-- Attempt rows first, through their item's map (the item row is not read for its answer, so the
-- order of the two updates does not matter).
UPDATE public.review_error_attempts a
   SET selected_answer = i.option_token_map ->> a.selected_answer
  FROM public.review_session_items i
 WHERE a.session_item_id = i.id
   AND a.selected_answer LIKE 'opt\_%'
   AND i.option_token_map ? a.selected_answer;

UPDATE public.review_session_items i
   SET selected_answer = i.option_token_map ->> i.selected_answer
 WHERE i.selected_answer LIKE 'opt\_%'
   AND i.option_token_map ? i.selected_answer;

INSERT INTO _f49_counts
SELECT 'after',
       (SELECT count(*) FROM public.review_session_items WHERE selected_answer LIKE 'opt\_%'),
       (SELECT count(*) FROM public.review_error_attempts WHERE selected_answer LIKE 'opt\_%');

SELECT phase, items_token, attempts_token FROM _f49_counts ORDER BY phase DESC;

DO $f49$
DECLARE
  remaining_items int;
  remaining_attempts int;
BEGIN
  SELECT items_token, attempts_token INTO remaining_items, remaining_attempts
    FROM _f49_counts WHERE phase = 'after';
  IF remaining_items <> 0 OR remaining_attempts <> 0 THEN
    RAISE EXCEPTION 'F-49 backfill: % item and % attempt rows still hold a token the item map does not resolve; rolled back',
      remaining_items, remaining_attempts;
  END IF;
END
$f49$;

COMMIT;
