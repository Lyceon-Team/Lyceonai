-- ---------------------------------------------------------------------------
-- mastery_levels — the canonical display name for each mastery level.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc 05 Parent §4.5 level boundaries, Acceptance Criteria #19/#20;
--        owner ruling 2026-08-20 RULE 1 (the six names), RULE 2 (names only,
--        never boundaries), RULE 3 (`unmeasured` is a ROW, not a code branch)]
-- @implemented 2026-08-20
--
-- plain English: `mastery_level` is an integer 0-4, or NULL when the formula had
-- too little evidence to score the entity. This table gives each of those six
-- states one student- and guardian-facing name. It is read-only reference data:
-- nothing writes to it at runtime, and no function reads it while computing.
--
-- WHY A TABLE AND NOT A CASE STATEMENT.
--   NULL was conflated with level 0 in four separate places, and every one of
--   them was a switch/CASE whose author simply did not write the NULL arm. A row
--   cannot be forgotten by a code path: a join either finds it or the query comes
--   back short, and coming back short is loud. `unmeasured` is therefore a row
--   keyed by `level_key` sitting beside `level = NULL`, not a branch someone has
--   to remember.
--
-- WHAT THIS TABLE MUST NEVER ACQUIRE (RULE 2).
--   Band boundaries. The score-to-level thresholds live in `mastery_constants`
--   (`mastery_level_0_max`, `mastery_level_1_min`, ...) and are consumed by
--   `lookup_mastery_level`. This table names the integer the formula has ALREADY
--   computed and takes no part in computing it. Copying a boundary here would
--   create a second source of truth for the same number and drag presentation
--   into the formula's blast radius. `scripts/ci/mastery-levels-gate.sh` rejects
--   any column whose name looks like a threshold, and separately asserts
--   `canonicalize_mastery_constants_serialized()` is byte-identical across this
--   migration — the scoring hash must not move.
--
-- expected outcome: six rows, one per level plus `unmeasured`; no function
-- behaviour changes; the mastery constants hash is unchanged.
-- trade-offs: changing a name now needs a migration, which is the point — the
-- names are a locked owner ruling, not configuration.
-- edge cases: `sort_order` exists so a UI can order the six without relying on
-- `level`, which is NULL for `unmeasured` and would sort unpredictably.
--
-- rollback:
--   DROP TABLE IF EXISTS public.mastery_levels;
--   (Additive and free-standing: no other object references it at this
--    migration, so the drop is complete and leaves no dangling dependency.)
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS public.mastery_levels (
    level_key     text     PRIMARY KEY,
    level         smallint,
    display_name  text     NOT NULL,
    sort_order    smallint NOT NULL,

    -- The formula emits 0-4 and nothing else; student_skill_mastery and
    -- student_domain_mastery both CHECK the same range.
    CONSTRAINT mastery_levels_level_range
        CHECK (level IS NULL OR (level >= 0 AND level <= 4)),

    -- RULE 3, enforced rather than documented: `unmeasured` is the ONLY row that
    -- may carry a NULL level, and it may not carry anything else. Written as an
    -- equivalence so it fails in both directions — a future edit can neither give
    -- level 0 the unmeasured key nor give `unmeasured` a real level.
    CONSTRAINT mastery_levels_unmeasured_is_null
        CHECK ((level_key = 'unmeasured') = (level IS NULL)),

    CONSTRAINT mastery_levels_display_name_not_blank
        CHECK (length(btrim(display_name)) > 0)
);

-- Exactly one label per emitted level. Partial, because `unmeasured` is the one
-- row with a NULL level and NULLs do not collide under a plain unique index —
-- which would silently have permitted a second unmeasured row.
CREATE UNIQUE INDEX IF NOT EXISTS mastery_levels_level_unique
    ON public.mastery_levels (level)
    WHERE level IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mastery_levels_sort_order_unique
    ON public.mastery_levels (sort_order);

COMMENT ON TABLE public.mastery_levels IS
    'Display name per mastery level (0-4) plus the unmeasured state. Reference data: read-only at runtime, names only, never score boundaries (owner ruling 2026-08-20 RULE 2).';
COMMENT ON COLUMN public.mastery_levels.level IS
    'The integer the mastery formula emits, or NULL for the unmeasured state. NULL is not zero.';

-- The six rows. Owner ruling 2026-08-20 RULE 1.
INSERT INTO public.mastery_levels (level_key, level, display_name, sort_order) VALUES
    ('unmeasured', NULL, 'Not enough answers yet', 0),
    ('L0',            0, 'Foundations',            1),
    ('L1',            1, 'Building',               2),
    ('L2',            2, 'Developing',             3),
    ('L3',            3, 'Proficient',             4),
    ('L4',            4, 'Strong',                 5)
ON CONFLICT (level_key) DO UPDATE
    SET level        = EXCLUDED.level,
        display_name = EXCLUDED.display_name,
        sort_order   = EXCLUDED.sort_order;

-- Posture mirrors public.mastery_constants: RLS on, service_role only, no
-- policies — denial by absence. The table holds zero student data and is joined
-- server-side by the read services, so no `authenticated` grant is needed and
-- the exposed surface stays smaller than the tables it labels.
ALTER TABLE public.mastery_levels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.mastery_levels TO service_role;

COMMIT;
