-- CB Corpus tables — additive DDL, does not touch existing tables.
-- These hold College Board official question items and their SCL taxonomy tags.
-- Service-role only; ZERO anon/authenticated grants (these must never serve to clients).
--
-- ROLLBACK: DROP TABLE IF EXISTS public.cb_distractor_clusters, public.cb_question_clusters,
--           public.cb_question_sub_skills, public.cb_questions CASCADE;
-- LYCEON-MIGRATION-REVIEWED

-- =========================================================================
-- 1. cb_questions — College Board official question items
-- =========================================================================
CREATE TABLE public.cb_questions (
  id              text PRIMARY KEY,
  section         text NOT NULL,
  domain          text NOT NULL,
  cb_skill        text NOT NULL,
  difficulty      text NOT NULL,
  stem            text NOT NULL,
  passage         text,
  options         jsonb,
  correct_answer  text,
  explanation     text,
  item_type       text NOT NULL,
  assets          jsonb,
  source_ref      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cb_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_questions TO service_role;

-- =========================================================================
-- 2. cb_question_sub_skills — SCL sub-skill tags for CB items
-- =========================================================================
CREATE TABLE public.cb_question_sub_skills (
  question_id       text NOT NULL REFERENCES public.cb_questions(id),
  sub_skill_id      text NOT NULL REFERENCES public.sub_skills(id),
  taxonomy_version  text NOT NULL,
  tagged_by         text NOT NULL,
  tagged_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, sub_skill_id, taxonomy_version)
);

ALTER TABLE public.cb_question_sub_skills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_question_sub_skills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_question_sub_skills TO service_role;

-- =========================================================================
-- 3. cb_question_clusters — SCL cluster tags for CB items
-- =========================================================================
CREATE TABLE public.cb_question_clusters (
  question_id       text NOT NULL REFERENCES public.cb_questions(id),
  cluster_id        text NOT NULL REFERENCES public.clusters(id),
  taxonomy_version  text NOT NULL,
  tagged_by         text NOT NULL,
  tagged_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, cluster_id, taxonomy_version)
);

ALTER TABLE public.cb_question_clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_question_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_question_clusters TO service_role;

-- =========================================================================
-- 4. cb_distractor_clusters — per-distractor cluster tags for CB items
-- =========================================================================
CREATE TABLE public.cb_distractor_clusters (
  question_id       text NOT NULL REFERENCES public.cb_questions(id),
  option_key        text NOT NULL,
  cluster_id        text NOT NULL REFERENCES public.clusters(id),
  taxonomy_version  text NOT NULL
);

ALTER TABLE public.cb_distractor_clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_distractor_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_distractor_clusters TO service_role;

CREATE INDEX idx_cb_distractor_clusters_qid ON public.cb_distractor_clusters(question_id);
