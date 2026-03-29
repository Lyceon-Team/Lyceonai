-- Canonical per-user notifications contract
-- Additive + cleanup migration

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  message TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  cta_url TEXT,
  action_url TEXT,
  cta_text TEXT,
  action_text TEXT,
  channel_origin TEXT,
  metadata JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'body'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN body TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'message'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN message TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'cta_url'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN cta_url TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'action_url'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN action_url TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'cta_text'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN cta_text TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'action_text'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN action_text TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'channel_origin'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN channel_origin TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'read_at'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN read_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'archived_at'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN archived_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

UPDATE public.notifications
SET
  body = COALESCE(NULLIF(body, ''), NULLIF(message, ''), title),
  message = COALESCE(NULLIF(message, ''), NULLIF(body, ''), title),
  cta_url = COALESCE(NULLIF(cta_url, ''), NULLIF(action_url, '')),
  action_url = COALESCE(NULLIF(action_url, ''), NULLIF(cta_url, '')),
  cta_text = COALESCE(NULLIF(cta_text, ''), NULLIF(action_text, '')),
  action_text = COALESCE(NULLIF(action_text, ''), NULLIF(cta_text, '')),
  updated_at = NOW()
WHERE body IS NULL
   OR message IS NULL
   OR cta_url IS NULL
   OR action_url IS NULL
   OR cta_text IS NULL
   OR action_text IS NULL;

UPDATE public.notifications
SET
  archived_at = COALESCE(archived_at, NOW()),
  is_read = TRUE,
  read_at = COALESCE(read_at, NOW()),
  updated_at = NOW()
WHERE user_id IS NULL
  AND archived_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notifications_active_user_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_active_user_check
      CHECK (user_id IS NOT NULL OR archived_at IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  study_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  streak_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  plan_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  guardian_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  digest_frequency TEXT NOT NULL DEFAULT 'daily',
  quiet_hours JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'email_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN email_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'study_reminders_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN study_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'streak_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN streak_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'plan_updates_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN plan_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'guardian_updates_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN guardian_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'marketing_enabled'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'digest_frequency'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN digest_frequency TEXT NOT NULL DEFAULT 'daily';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_notification_preferences'
      AND column_name = 'quiet_hours'
  ) THEN
    ALTER TABLE public.user_notification_preferences ADD COLUMN quiet_hours JSONB;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_notification_preferences_digest_frequency_check'
      AND conrelid = 'public.user_notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_notification_preferences
      ADD CONSTRAINT user_notification_preferences_digest_frequency_check
      CHECK (digest_frequency IN ('never', 'daily', 'weekly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON public.notifications(user_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read)
  WHERE archived_at IS NULL AND is_read = FALSE;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_select_own'
  ) THEN
    CREATE POLICY notifications_select_own
      ON public.notifications
      FOR SELECT
      USING (auth.uid() = user_id AND archived_at IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_update_own'
  ) THEN
    CREATE POLICY notifications_update_own
      ON public.notifications
      FOR UPDATE
      USING (auth.uid() = user_id AND archived_at IS NULL)
      WITH CHECK (auth.uid() = user_id AND archived_at IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_service'
  ) THEN
    CREATE POLICY notifications_service
      ON public.notifications
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role')
      WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_select_own'
  ) THEN
    CREATE POLICY user_notification_preferences_select_own
      ON public.user_notification_preferences
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_update_own'
  ) THEN
    CREATE POLICY user_notification_preferences_update_own
      ON public.user_notification_preferences
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_service'
  ) THEN
    CREATE POLICY user_notification_preferences_service
      ON public.user_notification_preferences
      FOR ALL
      USING (auth.jwt() ->> 'role' = 'service_role')
      WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
  END IF;
END $$;

COMMIT;
