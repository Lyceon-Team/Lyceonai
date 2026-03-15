-- V4 Settings table for runtime configuration
-- Allows toggling worker enabled state from Admin UI without restarting server

CREATE TABLE IF NOT EXISTS public.ingestion_v4_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Seed default values
INSERT INTO public.ingestion_v4_settings (key, value)
VALUES ('worker_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- RLS: Allow service role to read/write, admin role to update
ALTER TABLE public.ingestion_v4_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.ingestion_v4_settings
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read settings" ON public.ingestion_v4_settings
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- RPC function to get a setting
CREATE OR REPLACE FUNCTION get_v4_setting(setting_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result text;
BEGIN
  SELECT value INTO result
  FROM public.ingestion_v4_settings
  WHERE key = setting_key;
  RETURN result;
END;
$$;

-- RPC function to set a setting (admin only - validated at API layer)
CREATE OR REPLACE FUNCTION set_v4_setting(setting_key text, setting_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.ingestion_v4_settings (key, value, updated_at)
  VALUES (setting_key, setting_value, now())
  ON CONFLICT (key) DO UPDATE SET value = setting_value, updated_at = now();
END;
$$;
