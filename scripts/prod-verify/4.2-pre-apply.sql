-- ===========================================================================
-- 4.2 PRE-APPLY — before 20260820000000_mastery_levels.sql
--                 and  20260820010000_canonical_skill_catalog.sql
-- ===========================================================================
-- READ-ONLY. Paste into the Supabase SQL editor and run. Nothing here writes.
--
-- Confirms three things before Karl applies either migration:
--   1. neither object already exists (both migrations are additive; an existing
--      object of the same name means something else got there first)
--   2. the mastery constants hash, captured BEFORE the change so the post-apply
--      check compares against production rather than only against CI
--   3. the question bank can actually serve the catalog — 8 domains present
--
-- The last statement yields the verdict, because a SQL console commonly shows
-- only the final result grid.
-- ===========================================================================

-- 1. Object presence. to_regclass returns NULL rather than raising.
SELECT
    to_regclass('public.mastery_levels')            AS mastery_levels_exists,
    to_regclass('public.canonical_skill_catalog')   AS skill_catalog_exists;

-- 2. The constants hash as production has it right now. RECORD THIS VALUE —
--    4.2-post-apply.sql asserts the same figure afterwards. RULE 2: naming a
--    level must not move the scoring hash.
SELECT md5(public.canonicalize_mastery_constants_serialized()) AS constants_md5_before;

-- 3. What the catalog will contain once the view exists. This is the same
--    expression the view uses, run inline.
SELECT q.section,
       q.domain,
       count(DISTINCT s.skill) AS skills
FROM public.questions q
CROSS JOIN LATERAL unnest(q.skill_codes) AS s(skill)
WHERE q.status = 'published'
  AND btrim(s.skill) <> ''
GROUP BY q.section, q.domain
ORDER BY q.section, q.domain;

-- VERDICT
SELECT
    CASE
        WHEN to_regclass('public.mastery_levels') IS NOT NULL
          OR to_regclass('public.canonical_skill_catalog') IS NOT NULL
            THEN 'STOP: an object of the same name already exists — do not apply'
        WHEN (SELECT count(DISTINCT q.domain)
              FROM public.questions q
              WHERE q.status = 'published') <> 8
            THEN 'STOP: published questions do not cover all 8 canonical domains — the catalog would be incomplete'
        ELSE 'OK: neither object exists, 8 domains present — safe to apply 20260820000000 then 20260820010000'
    END AS verdict;
