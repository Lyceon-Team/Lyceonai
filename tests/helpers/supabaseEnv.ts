import { describe } from "vitest";

export const REQUIRED_SUPABASE_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function getMissingSupabaseEnv(): string[] {
  return REQUIRED_SUPABASE_ENV.filter((key) => !process.env[key]);
}

export function describeIfSupabaseEnv(): typeof describe {
  const missing = getMissingSupabaseEnv();
  if (missing.length > 0) {
    console.warn(`Skipping integration tests: ${missing[0]} not set`);
    return describe.skip;
  }
  return describe;
}
