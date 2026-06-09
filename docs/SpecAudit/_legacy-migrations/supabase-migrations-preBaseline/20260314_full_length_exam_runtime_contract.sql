-- Full-length exam canonical contract hardening
-- Adds canonical form identity, multi-tab client instance binding, and break timer anchor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'full_length_exam_sessions'
      AND column_name = 'test_form_id'
  ) THEN
    ALTER TABLE public.full_length_exam_sessions
      ADD COLUMN test_form_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'full_length_exam_sessions'
      AND column_name = 'client_instance_id'
  ) THEN
    ALTER TABLE public.full_length_exam_sessions
      ADD COLUMN client_instance_id TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'full_length_exam_sessions'
      AND column_name = 'break_started_at'
  ) THEN
    ALTER TABLE public.full_length_exam_sessions
      ADD COLUMN break_started_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_full_length_exam_sessions_user_client_active
  ON public.full_length_exam_sessions (user_id, client_instance_id)
  WHERE status IN ('not_started', 'in_progress', 'break');
