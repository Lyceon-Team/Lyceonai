-- ---------------------------------------------------------------------------
-- canonical_skill_catalog — which skills exist in each domain, from the DB.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc 05B §4.2 domain canonicality; Coding Standards §2 layering
--        ("DB access: centralized utilities only"); owner ruling 2026-08-20
--        RULE 5 (drill-down: domain first, then its skills)]
-- @implemented 2026-08-20
--
-- plain English: the drill-down needs to know which skills belong to a domain
-- BEFORE a student has answered anything in them — otherwise opening Algebra
-- shows an empty panel instead of five skills marked "Not enough answers yet".
-- The question bank already knows: every published question carries a canonical
-- (section, domain) pair and a skill_codes array. This view is that fact,
-- deduplicated.
--
-- WHAT IT REPLACES.
--   `SAT_TAXONOMY`, a hardcoded object in apps/api/src/routes/mastery.ts that
--   invented its own slugs — `math`/`rw` for section, `advanced_math` for domain,
--   `linear_equations` for skill. The database stores `M`/`RW` (CHECK-constrained),
--   `Advanced Math`, and `Linear Equations in One Variable`. Nothing ever matched,
--   so the skill tree resolved every node to NULL and the mastery page rendered
--   "No Mastery Data Yet" for every student regardless of their data. Deriving the
--   catalog from `questions` means the join keys are the same values on both
--   sides by construction, and it satisfies the Lane-A "DB is source of truth"
--   gate the hardcoded object was evading.
--
-- ANTI-LEAK: this view projects (section, domain, skill) and nothing else. No
-- stem, no options, no `correct_answer`, no `explanation` — safe by projection,
-- not by permission. `security_invoker='true'` matches `servable_questions` so
-- the caller's own grants on `questions` still apply rather than the view owner's.
--
-- expected outcome: 8 canonical domains with their published skills; a domain
-- whose questions are all draft/retired disappears from the view entirely.
-- trade-offs: the catalog tracks the question bank, so publishing the first
-- question for a new skill adds it — correct, because an unpublished skill has
-- nothing to practise.
-- edge cases: `skill_codes` is `text[] NOT NULL`; an empty array contributes no
-- rows, which is what `unnest` does and what we want.
--
-- rollback:
--   DROP VIEW IF EXISTS public.canonical_skill_catalog;
--   (Read-only view over an existing table; the drop leaves `questions`
--    untouched and no other object depends on it at this migration.)
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW public.canonical_skill_catalog
    WITH (security_invoker = 'true') AS
SELECT DISTINCT
    q.section,
    q.domain,
    s.skill
FROM public.questions q
CROSS JOIN LATERAL unnest(q.skill_codes) AS s(skill)
WHERE q.status = 'published'
  AND btrim(s.skill) <> '';

COMMENT ON VIEW public.canonical_skill_catalog IS
    'Distinct (section, domain, skill) over published questions. The drill-down catalog: replaces the hardcoded SAT_TAXONOMY whose slugs never matched the canonical DB values. Projection-only, carries no question content.';

GRANT SELECT ON public.canonical_skill_catalog TO service_role;

COMMIT;
