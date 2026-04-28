-- 20260427_add_updated_at_trigger_to_practice_sessions.sql
-- Ensures practice_sessions.updated_at is updated on every modification.

BEGIN;

-- 1) Create the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Add the trigger to practice_sessions
DROP TRIGGER IF EXISTS tr_practice_sessions_updated_at ON public.practice_sessions;
CREATE TRIGGER tr_practice_sessions_updated_at
  BEFORE UPDATE ON public.practice_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
