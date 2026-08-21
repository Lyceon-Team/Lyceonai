-- ===========================================================================
-- 4.2 POST-APPLY — after 20260820000000_mastery_levels.sql
--                  and  20260820010000_canonical_skill_catalog.sql
-- ===========================================================================
-- READ-ONLY. Paste into the Supabase SQL editor and run. Nothing here writes.
--
-- CI proves the LOGIC of both objects against a seeded fixture. This file proves
-- they landed correctly on PRODUCTION data, which CI has never seen: the real
-- question bank, the real constants row. The two are not interchangeable — a
-- gate that only ever ran CI fixtures is what let the SAT_TAXONOMY mismatch
-- survive for months.
--
-- Compare `constants_md5_after` against the `constants_md5_before` recorded by
-- 4.2-pre-apply.sql. They must be identical.
-- ===========================================================================

-- 1. The six labels, as applied.
SELECT level_key, level, display_name, sort_order
FROM public.mastery_levels
ORDER BY sort_order;

-- 2. Every level the formula can emit has exactly one label. Driven from
--    generate_series so a MISSING label shows up — counting the table's own rows
--    could only ever report what is there.
SELECT g.lvl AS unlabelled_level
FROM generate_series(0, 4) AS g(lvl)
LEFT JOIN public.mastery_levels ml ON ml.level = g.lvl
WHERE ml.level_key IS NULL;

-- 3. RULE 2 — the scoring hash must not have moved.
SELECT md5(public.canonicalize_mastery_constants_serialized()) AS constants_md5_after;

-- 4. The catalog as production sees it. Advisor-verified 2026-08-19: 29 skills
--    across 8 domains — Algebra 5, Problem Solving and Data Analysis 7, Geometry
--    and Trigonometry 4, Advanced Math 3, Craft and Structure 3, Information and
--    Ideas 3, Expression of Ideas 2, Standard English Conventions 2.
SELECT section, domain, count(*) AS skills
FROM public.canonical_skill_catalog
GROUP BY section, domain
ORDER BY section, domain;

-- 5. How many students each object will actually serve. Context for the read
--    surfaces, not a pass/fail condition.
SELECT
    (SELECT count(*) FROM public.canonical_skill_catalog)                          AS catalog_rows,
    (SELECT count(DISTINCT domain) FROM public.canonical_skill_catalog)            AS catalog_domains,
    (SELECT count(*) FROM public.student_domain_mastery)                           AS domain_mastery_rows,
    (SELECT count(*) FROM public.student_skill_mastery)                            AS skill_mastery_rows,
    (SELECT count(*) FROM public.student_skill_mastery WHERE mastery_level IS NULL) AS skill_rows_unmeasured;

-- VERDICT
SELECT
    CASE
        WHEN (SELECT count(*) FROM public.mastery_levels) <> 6
            THEN 'STOP: mastery_levels does not hold exactly 6 rows'
        WHEN EXISTS (
                SELECT 1 FROM generate_series(0, 4) AS g(lvl)
                LEFT JOIN public.mastery_levels ml ON ml.level = g.lvl
                WHERE ml.level_key IS NULL)
            THEN 'STOP: a level the formula can emit has no display name'
        WHEN NOT EXISTS (
                SELECT 1 FROM public.mastery_levels
                WHERE level_key = 'unmeasured' AND level IS NULL)
            THEN 'STOP: the unmeasured row is missing or does not carry a NULL level'
        WHEN (SELECT count(DISTINCT domain) FROM public.canonical_skill_catalog) <> 8
            THEN 'STOP: canonical_skill_catalog does not cover all 8 canonical domains'
        ELSE 'OK: six labels present, every level named, unmeasured is its own row, catalog covers 8 domains — compare constants_md5_after against the pre-apply value before closing out'
    END AS verdict;
