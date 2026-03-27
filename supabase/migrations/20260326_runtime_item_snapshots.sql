-- 20260326_runtime_item_snapshots.sql
-- Materialize question snapshots onto runtime item tables so delivery/grade/review
-- reads from persisted session items instead of querying raw questions at serve-time.

BEGIN;

-- ---------------------------------------------------------------------------
-- Practice session item snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.practice_session_items
  ADD COLUMN IF NOT EXISTS question_section text,
  ADD COLUMN IF NOT EXISTS question_stem text,
  ADD COLUMN IF NOT EXISTS question_options jsonb,
  ADD COLUMN IF NOT EXISTS question_difficulty jsonb,
  ADD COLUMN IF NOT EXISTS question_correct_answer text,
  ADD COLUMN IF NOT EXISTS question_explanation text;

UPDATE public.practice_session_items psi
SET
  question_section = COALESCE(NULLIF(psi.question_section, ''), q.section, q.section_code),
  question_stem = COALESCE(NULLIF(psi.question_stem, ''), q.stem),
  question_options = COALESCE(psi.question_options, to_jsonb(q.options)),
  question_difficulty = COALESCE(psi.question_difficulty, to_jsonb(q.difficulty)),
  question_correct_answer = COALESCE(NULLIF(psi.question_correct_answer, ''), q.correct_answer),
  question_explanation = COALESCE(NULLIF(psi.question_explanation, ''), q.explanation)
FROM public.questions q
WHERE q.id = psi.question_id
  AND (
    psi.question_section IS NULL
    OR psi.question_stem IS NULL
    OR psi.question_options IS NULL
    OR psi.question_difficulty IS NULL
    OR psi.question_correct_answer IS NULL
    OR psi.question_explanation IS NULL
  );

-- ---------------------------------------------------------------------------
-- Review session item snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.review_session_items
  ADD COLUMN IF NOT EXISTS question_section text,
  ADD COLUMN IF NOT EXISTS question_stem text,
  ADD COLUMN IF NOT EXISTS question_options jsonb,
  ADD COLUMN IF NOT EXISTS question_difficulty jsonb,
  ADD COLUMN IF NOT EXISTS question_correct_answer text,
  ADD COLUMN IF NOT EXISTS question_explanation text;

-- Backfill by source question UUID when available.
UPDATE public.review_session_items rsi
SET
  question_section = COALESCE(NULLIF(rsi.question_section, ''), q.section, q.section_code),
  question_stem = COALESCE(NULLIF(rsi.question_stem, ''), q.stem),
  question_options = COALESCE(rsi.question_options, to_jsonb(q.options)),
  question_difficulty = COALESCE(rsi.question_difficulty, to_jsonb(q.difficulty)),
  question_correct_answer = COALESCE(NULLIF(rsi.question_correct_answer, ''), q.correct_answer),
  question_explanation = COALESCE(NULLIF(rsi.question_explanation, ''), q.explanation)
FROM public.questions q
WHERE q.id::text = rsi.source_question_id
  AND (
    rsi.question_section IS NULL
    OR rsi.question_stem IS NULL
    OR rsi.question_options IS NULL
    OR rsi.question_difficulty IS NULL
    OR rsi.question_correct_answer IS NULL
    OR rsi.question_explanation IS NULL
  );

-- Backfill remaining rows by canonical_id.
UPDATE public.review_session_items rsi
SET
  question_section = COALESCE(NULLIF(rsi.question_section, ''), q.section, q.section_code),
  question_stem = COALESCE(NULLIF(rsi.question_stem, ''), q.stem),
  question_options = COALESCE(rsi.question_options, to_jsonb(q.options)),
  question_difficulty = COALESCE(rsi.question_difficulty, to_jsonb(q.difficulty)),
  question_correct_answer = COALESCE(NULLIF(rsi.question_correct_answer, ''), q.correct_answer),
  question_explanation = COALESCE(NULLIF(rsi.question_explanation, ''), q.explanation)
FROM public.questions q
WHERE q.canonical_id = rsi.question_canonical_id
  AND (
    rsi.question_section IS NULL
    OR rsi.question_stem IS NULL
    OR rsi.question_options IS NULL
    OR rsi.question_difficulty IS NULL
    OR rsi.question_correct_answer IS NULL
    OR rsi.question_explanation IS NULL
  );

-- ---------------------------------------------------------------------------
-- Full-length exam question snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.full_length_exam_questions
  ADD COLUMN IF NOT EXISTS question_canonical_id text,
  ADD COLUMN IF NOT EXISTS question_stem text,
  ADD COLUMN IF NOT EXISTS question_section text,
  ADD COLUMN IF NOT EXISTS question_section_code text,
  ADD COLUMN IF NOT EXISTS question_type text,
  ADD COLUMN IF NOT EXISTS question_options jsonb,
  ADD COLUMN IF NOT EXISTS question_difficulty jsonb,
  ADD COLUMN IF NOT EXISTS question_domain text,
  ADD COLUMN IF NOT EXISTS question_skill text,
  ADD COLUMN IF NOT EXISTS question_subskill text,
  ADD COLUMN IF NOT EXISTS question_skill_code text,
  ADD COLUMN IF NOT EXISTS question_source_type integer,
  ADD COLUMN IF NOT EXISTS question_diagram_present boolean,
  ADD COLUMN IF NOT EXISTS question_tags jsonb,
  ADD COLUMN IF NOT EXISTS question_competencies jsonb,
  ADD COLUMN IF NOT EXISTS question_correct_answer text,
  ADD COLUMN IF NOT EXISTS question_answer_text text,
  ADD COLUMN IF NOT EXISTS question_explanation text,
  ADD COLUMN IF NOT EXISTS question_option_metadata jsonb,
  ADD COLUMN IF NOT EXISTS question_exam text,
  ADD COLUMN IF NOT EXISTS question_structure_cluster_id text;

UPDATE public.full_length_exam_questions fleq
SET
  question_canonical_id = COALESCE(NULLIF(fleq.question_canonical_id, ''), q.canonical_id),
  question_stem = COALESCE(NULLIF(fleq.question_stem, ''), q.stem),
  question_section = COALESCE(NULLIF(fleq.question_section, ''), q.section, q.section_code),
  question_section_code = COALESCE(NULLIF(fleq.question_section_code, ''), q.section_code),
  question_type = COALESCE(NULLIF(fleq.question_type, ''), q.question_type),
  question_options = COALESCE(fleq.question_options, to_jsonb(q.options)),
  question_difficulty = COALESCE(fleq.question_difficulty, to_jsonb(q.difficulty)),
  question_domain = COALESCE(NULLIF(fleq.question_domain, ''), q.domain),
  question_skill = COALESCE(NULLIF(fleq.question_skill, ''), q.skill),
  question_subskill = COALESCE(NULLIF(fleq.question_subskill, ''), q.subskill),
  question_skill_code = COALESCE(NULLIF(fleq.question_skill_code, ''), q.skill_code),
  question_source_type = COALESCE(fleq.question_source_type, q.source_type),
  question_diagram_present = COALESCE(fleq.question_diagram_present, q.diagram_present),
  question_tags = COALESCE(fleq.question_tags, to_jsonb(q.tags)),
  question_competencies = COALESCE(fleq.question_competencies, to_jsonb(q.competencies)),
  question_correct_answer = COALESCE(NULLIF(fleq.question_correct_answer, ''), q.correct_answer),
  question_answer_text = COALESCE(NULLIF(fleq.question_answer_text, ''), q.answer_text),
  question_explanation = COALESCE(NULLIF(fleq.question_explanation, ''), q.explanation),
  question_option_metadata = COALESCE(fleq.question_option_metadata, to_jsonb(q.option_metadata)),
  question_exam = COALESCE(NULLIF(fleq.question_exam, ''), q.exam),
  question_structure_cluster_id = COALESCE(NULLIF(fleq.question_structure_cluster_id, ''), q.structure_cluster_id)
FROM public.questions q
WHERE q.id = fleq.question_id
  AND (
    fleq.question_canonical_id IS NULL
    OR fleq.question_stem IS NULL
    OR fleq.question_section IS NULL
    OR fleq.question_type IS NULL
    OR fleq.question_options IS NULL
    OR fleq.question_correct_answer IS NULL
  );

COMMIT;
