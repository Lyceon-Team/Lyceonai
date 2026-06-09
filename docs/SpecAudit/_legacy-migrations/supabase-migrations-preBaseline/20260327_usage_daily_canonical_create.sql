BEGIN;

CREATE TABLE IF NOT EXISTS public.usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  day date NOT NULL,
  practice_questions_used integer NOT NULL DEFAULT 0,
  ai_messages_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_daily_account_day_unique UNIQUE (account_id, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_account_day
  ON public.usage_daily(account_id, day DESC);

-- Remove any pre-existing FK on this table so we can re-add the canonical one cleanly.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.usage_daily'::regclass
      AND contype = 'f'
      AND conname IN ('usage_daily_account_id_fkey', 'usage_daily_account_id_accounts_fkey')
  LOOP
    EXECUTE format('ALTER TABLE public.usage_daily DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

-- Add canonical FK as NOT VALID so historical orphan rows do not fail the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lyceon_accounts'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usage_daily_account_id_fkey'
      AND conrelid = 'public.usage_daily'::regclass
  ) THEN
    ALTER TABLE public.usage_daily
      ADD CONSTRAINT usage_daily_account_id_fkey
      FOREIGN KEY (account_id)
      REFERENCES public.lyceon_accounts(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_daily_select_own ON public.usage_daily;
DROP POLICY IF EXISTS usage_daily_service_role_all ON public.usage_daily;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lyceon_account_members'
  ) THEN
    CREATE POLICY usage_daily_select_own
      ON public.usage_daily
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.lyceon_account_members lam
          WHERE lam.account_id = usage_daily.account_id
            AND lam.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE POLICY usage_daily_service_role_all
  ON public.usage_daily
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP TRIGGER IF EXISTS set_usage_daily_updated_at ON public.usage_daily;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    CREATE TRIGGER set_usage_daily_updated_at
      BEFORE UPDATE ON public.usage_daily
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMIT;
