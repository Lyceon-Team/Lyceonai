-- Full-length published-form lifecycle canonicalization
-- Introduces test_forms/test_form_items as source of truth for fixed-order full-test delivery.

CREATE TABLE IF NOT EXISTS public.test_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'draft',
  name TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_forms_status_check'
      AND conrelid = 'public.test_forms'::regclass
  ) THEN
    ALTER TABLE public.test_forms
      ADD CONSTRAINT test_forms_status_check CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.test_form_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.test_forms(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  module_index INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_form_items_question_id_fkey'
      AND conrelid = 'public.test_form_items'::regclass
  ) THEN
    ALTER TABLE public.test_form_items
      ADD CONSTRAINT test_form_items_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.questions(canonical_id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_form_items_section_check'
      AND conrelid = 'public.test_form_items'::regclass
  ) THEN
    ALTER TABLE public.test_form_items
      ADD CONSTRAINT test_form_items_section_check CHECK (section IN ('rw', 'math'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_form_items_module_index_check'
      AND conrelid = 'public.test_form_items'::regclass
  ) THEN
    ALTER TABLE public.test_form_items
      ADD CONSTRAINT test_form_items_module_index_check CHECK (module_index IN (1, 2));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_form_items_ordinal_positive_check'
      AND conrelid = 'public.test_form_items'::regclass
  ) THEN
    ALTER TABLE public.test_form_items
      ADD CONSTRAINT test_form_items_ordinal_positive_check CHECK (ordinal >= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_form_items_form_section_module_ordinal
  ON public.test_form_items (form_id, section, module_index, ordinal);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_form_items_form_section_module_question
  ON public.test_form_items (form_id, section, module_index, question_id);

CREATE INDEX IF NOT EXISTS idx_test_form_items_form_id
  ON public.test_form_items (form_id);

CREATE OR REPLACE FUNCTION public.prevent_published_form_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published test forms are immutable';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'published' AND NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'published test forms are immutable';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_forms_immutable ON public.test_forms;
CREATE TRIGGER trg_test_forms_immutable
  BEFORE UPDATE OR DELETE ON public.test_forms
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_form_mutation();

CREATE OR REPLACE FUNCTION public.prevent_published_form_item_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_form_id UUID;
  target_status TEXT;
BEGIN
  target_form_id := COALESCE(NEW.form_id, OLD.form_id);

  SELECT status
    INTO target_status
    FROM public.test_forms
   WHERE id = target_form_id;

  IF target_status = 'published' THEN
    RAISE EXCEPTION 'published test form items are immutable';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_test_form_items_immutable ON public.test_form_items;
CREATE TRIGGER trg_test_form_items_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.test_form_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_form_item_mutation();

ALTER TABLE public.full_length_exam_sessions
  ALTER COLUMN test_form_id DROP DEFAULT;
