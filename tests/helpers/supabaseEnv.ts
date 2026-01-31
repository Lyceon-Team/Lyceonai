export const SUPABASE_ENV_REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
] as const;

export function hasSupabaseSecrets(): boolean {
  return SUPABASE_ENV_REQUIRED.every((name) => Boolean(process.env[name]));
}

export function supabaseSkipMessage(): string {
  return "Skipping integration tests: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY not set";
}
