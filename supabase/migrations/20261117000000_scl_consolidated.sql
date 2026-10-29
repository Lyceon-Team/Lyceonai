-- ---------------------------------------------------------------------------
-- SCL-256 · Sub-skill / Cluster Layer — consolidated v1 schema
-- SPEC-CHANGE_SCL.md §4 (schema), §5 (write contract), §6 (versioning)
--
-- Single migration that creates all five SCL tables in their final v1 shape.
-- Replaces the two-step 20261115/20261116 pair with one atomic apply.
--
-- Self-healing: drops any prior partial SCL tables so both a fresh database
-- and the current (dropped) prod land in the same final state.
--
-- Five tables for the two-level taxonomy below the 29 CB skills:
--   1. sub_skills          — canonical sub-skill definitions (mirror of repo JSON)
--   2. clusters            — canonical cluster definitions  (mirror of repo JSON)
--   3. question_sub_skills — M:N per-question sub-skill tags
--   4. question_clusters   — M:N per-question cluster tags
--   5. distractor_clusters — per-distractor failed-cluster tags
--
-- Additive only — no changes to public.questions or any existing table.
-- RLS: zero policies, service_role only (internal; §5 ruling #7).
--
-- Rollback: DROP the five tables in reverse FK order.
--   DROP TABLE IF EXISTS public.distractor_clusters;
--   DROP TABLE IF EXISTS public.question_clusters;
--   DROP TABLE IF EXISTS public.question_sub_skills;
--   DROP TABLE IF EXISTS public.clusters;
--   DROP TABLE IF EXISTS public.sub_skills;
-- public.questions is untouched by both apply and rollback.
--
-- LYCEON-MIGRATION-REVIEWED
-- ---------------------------------------------------------------------------

-- Self-healing: drop any prior partial SCL tables (reverse FK order)
DROP TABLE IF EXISTS public.distractor_clusters CASCADE;
DROP TABLE IF EXISTS public.question_clusters CASCADE;
DROP TABLE IF EXISTS public.question_sub_skills CASCADE;
DROP TABLE IF EXISTS public.clusters CASCADE;
DROP TABLE IF EXISTS public.sub_skills CASCADE;

-- =========================================================================
-- 1. sub_skills — canonical sub-skill definitions
-- =========================================================================
CREATE TABLE public.sub_skills (
  id               text PRIMARY KEY,
  skill_code       text NOT NULL,
  section          text NOT NULL,
  domain           text NOT NULL,
  name             text NOT NULL,
  definition       text NOT NULL,
  inclusion_test   text NOT NULL,
  evidence_ids     text[] NOT NULL DEFAULT '{}',
  taxonomy_version text NOT NULL
);

ALTER TABLE public.sub_skills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sub_skills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sub_skills TO service_role;

-- =========================================================================
-- 2. clusters — canonical cluster definitions (final v1 shape)
-- =========================================================================
CREATE TABLE public.clusters (
  id               text PRIMARY KEY,
  display_name     text NOT NULL,
  family           text NOT NULL CHECK (family IN ('by_hand_doing','by_hand_recognizing','desmos')),
  definition       text NOT NULL,
  evidence_ids     text[] NOT NULL DEFAULT '{}',
  evidence_count   integer NOT NULL DEFAULT 0,
  core             boolean NOT NULL DEFAULT false,
  skills_seen_in   text[] NOT NULL DEFAULT '{}',
  method_in        jsonb NOT NULL DEFAULT '{}'::jsonb,
  playbook_move    text,
  aliases          text[] NOT NULL DEFAULT '{}',
  taxonomy_version text NOT NULL
);

ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clusters TO service_role;

-- =========================================================================
-- 3. question_sub_skills — per-question sub-skill tags (M:N)
-- =========================================================================
CREATE TABLE public.question_sub_skills (
  question_id      text NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  sub_skill_id     text NOT NULL REFERENCES public.sub_skills(id),
  taxonomy_version text NOT NULL,
  tagged_by        text NOT NULL,
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, sub_skill_id)
);

ALTER TABLE public.question_sub_skills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_sub_skills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question_sub_skills TO service_role;

-- =========================================================================
-- 4. question_clusters — per-question cluster tags (M:N)
-- =========================================================================
CREATE TABLE public.question_clusters (
  question_id      text NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  cluster_id       text NOT NULL REFERENCES public.clusters(id),
  taxonomy_version text NOT NULL,
  tagged_by        text NOT NULL,
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, cluster_id)
);

ALTER TABLE public.question_clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question_clusters TO service_role;

-- =========================================================================
-- 5. distractor_clusters — per-distractor failed-cluster tags
-- =========================================================================
CREATE TABLE public.distractor_clusters (
  question_id      text NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_key       text NOT NULL,
  cluster_id       text NOT NULL REFERENCES public.clusters(id),
  taxonomy_version text NOT NULL,
  PRIMARY KEY (question_id, option_key, cluster_id)
);

ALTER TABLE public.distractor_clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.distractor_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.distractor_clusters TO service_role;

-- =========================================================================
-- Indexes for the cross-skill diagnosis query (§4)
-- =========================================================================
CREATE INDEX ON public.question_sub_skills (sub_skill_id);
CREATE INDEX ON public.question_clusters   (cluster_id);
CREATE INDEX ON public.distractor_clusters (cluster_id);
