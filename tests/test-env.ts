/**
 * Test Environment Detection Utilities
 * 
 * Provides utilities for detecting if required environment variables
 * are available for integration tests.
 * 
 * Integration tests should skip deterministically when secrets are missing
 * instead of failing with connection errors.
 */

/**
 * Check if Supabase environment variables are available
 * Required for tests that interact with Supabase database
 */
export function hasSupabaseEnv(): boolean {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Check if RLS tests can run
 * Requires service role key for admin operations
 */
export function canRunRlsTests(): boolean {
  return hasSupabaseEnv();
}

/**
 * Get skip message for integration tests requiring Supabase
 */
export function getSupabaseSkipMessage(): string {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  
  return `Supabase integration tests require: ${missing.join(', ')}`;
}
