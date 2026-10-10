-- ===========================================================================
-- READ-ONLY production check: every upcoming QOTD day passes the readability rules.
-- ===========================================================================
-- @spec [owner brief "QOTD — readability filter (Karl's option B)" (Karl, 2026-10-09)
--        "Production check: after deploy, Claude runs a read-only query confirming every
--        upcoming day passes all rules"] | @implemented [2026-10-09]
--
-- plain English: one row per scheduled day AFTER today (America/Chicago), with each rule's
-- result and a PASS/FAIL `verdict`, then one OVERALL row (STOP also when nothing is scheduled). The rules mirror shared/qotd/readability.ts (the source of truth):
-- multiple choice; no "Text 1" + "Text 2"; Math passage + stem <= 400 visible characters (tags
-- removed, whitespace collapsed; +1 for the joining space when both exist); Reading and Writing
-- passage <= 300. Expected after the first 07:15 UTC run following deploy: passes = true on
-- every row, and the final OVERALL row's verdict reads 'OK: ...'. SELECT only; no writes.
-- ===========================================================================
WITH up AS (
  SELECT s.qotd_date, q.id, q.section, q.item_type,
         btrim(regexp_replace(regexp_replace(coalesce(q.passage, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')) AS passage,
         btrim(regexp_replace(regexp_replace(coalesce(q.stem, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')) AS stem
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
   WHERE s.qotd_date > (now() AT TIME ZONE 'America/Chicago')::date
),
r AS (
  SELECT qotd_date, id, section, item_type,
         item_type = 'mcq' AS is_mcq,
         NOT (passage ~* '\mtext\s*1\M' AND passage ~* '\mtext\s*2\M') AS not_paired,
         CASE WHEN section = 'M'
              THEN length(passage) + length(stem) + CASE WHEN passage <> '' AND stem <> '' THEN 1 ELSE 0 END
              ELSE length(passage) END AS counted_chars
    FROM up
),
v AS (
  SELECT r.*,
         (is_mcq AND not_paired
          AND counted_chars <= CASE WHEN section = 'M' THEN 400 ELSE 300 END) AS passes
    FROM r
)
SELECT qotd_date, id, section, item_type, is_mcq, not_paired, counted_chars, verdict
FROM (
  SELECT 1 AS seq, qotd_date, id, section, item_type, is_mcq, not_paired, counted_chars,
         CASE WHEN passes THEN 'PASS' ELSE 'FAIL' END AS verdict
    FROM v
  UNION ALL
  SELECT 2, NULL::date, 'OVERALL', NULL::text, NULL::text, NULL::boolean, NULL::boolean,
         count(*)::integer,
         CASE WHEN count(*) = 0
              THEN 'STOP: no upcoming day is scheduled, so nothing was checked'
              WHEN count(*) FILTER (WHERE NOT passes) = 0
              THEN 'OK: all ' || count(*)::text || ' upcoming day(s) pass every readability rule'
              ELSE 'STOP: ' || count(*) FILTER (WHERE NOT passes)::text || ' of ' || count(*)::text
                   || ' upcoming day(s) FAIL, read the rows above'
         END AS verdict
    FROM v
) AS o
ORDER BY seq, qotd_date;
