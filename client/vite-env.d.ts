/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_DESMOS_API_KEY: string;
  /** PostHog project key (public, `phc_…`); unset = analytics off. SCL-201. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host; defaults to the US region (owner decision 6, 2026-10-05). */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
