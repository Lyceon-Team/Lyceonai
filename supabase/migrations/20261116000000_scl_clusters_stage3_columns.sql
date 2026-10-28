-- ---------------------------------------------------------------------------
-- SCL-256 · Stage 3 — Add cluster columns for the finalized v1 taxonomy
-- SPEC-CHANGE_SCL.md §4 (schema)
--
-- Additive only: adds columns to public.clusters that the finalized v1
-- taxonomy data requires beyond the initial (id, name, family, definition,
-- taxonomy_version) set from 20261115000000.
--
-- Renames 'name' to 'display_name' to match the canonical taxonomy JSON.
--
-- Rollback:
--   ALTER TABLE public.clusters RENAME COLUMN display_name TO name;
--   ALTER TABLE public.clusters
--     DROP COLUMN IF EXISTS evidence_ids,
--     DROP COLUMN IF EXISTS evidence_count,
--     DROP COLUMN IF EXISTS core,
--     DROP COLUMN IF EXISTS skills_seen_in,
--     DROP COLUMN IF EXISTS method_in,
--     DROP COLUMN IF EXISTS playbook_move,
--     DROP COLUMN IF EXISTS aliases;
--
-- LYCEON-MIGRATION-REVIEWED
-- ---------------------------------------------------------------------------

-- Rename 'name' → 'display_name' to match canonical taxonomy field name
ALTER TABLE public.clusters RENAME COLUMN name TO display_name;

-- Evidence provenance
ALTER TABLE public.clusters ADD COLUMN evidence_ids   text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.clusters ADD COLUMN evidence_count  integer NOT NULL DEFAULT 0;

-- Diagnostic core flag (136 of 230 clusters)
ALTER TABLE public.clusters ADD COLUMN core boolean NOT NULL DEFAULT false;

-- Which CB skills this cluster appears in
ALTER TABLE public.clusters ADD COLUMN skills_seen_in text[] NOT NULL DEFAULT '{}';

-- Skills where this cluster is the default method (>80% of questions) — stored as JSONB
-- because the source data is {skill_name: fraction}, not a flat list
ALTER TABLE public.clusters ADD COLUMN method_in jsonb NOT NULL DEFAULT '{}';

-- Desmos playbook move name (desmos family only; NULL for non-desmos)
ALTER TABLE public.clusters ADD COLUMN playbook_move text;

-- Alternate names for the cluster
ALTER TABLE public.clusters ADD COLUMN aliases text[] NOT NULL DEFAULT '{}';
