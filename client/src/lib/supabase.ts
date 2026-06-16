import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * @spec [Doc-01_V8 Identity/Access; Coding Standards §6.1 | OAUTH-001 / AUTH-001]
 * @implemented 2026-06-15
 * plain English: Browser-side Supabase client built with @supabase/ssr. It is used ONLY to start the
 * native Google OAuth flow (signInWithOAuth, PKCE). @supabase/ssr persists the PKCE code verifier in a
 * cookie, so the server's /auth/callback route can complete exchangeCodeForSession. The session itself
 * remains server-authoritative (httpOnly cookies written by the server); this client never holds the
 * session for authorization decisions. trade-off: requires VITE_SUPABASE_URL/ANON_KEY at build time.
 */
let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set",
      );
    }
    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}

// Types for Supabase auth
export interface SupabaseProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: "student" | "admin" | "guardian";
  is_under_13: boolean;
  guardian_consent: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  // Onboarding and status flags
  profile_completed_at?: string | null;
  requiredConsentsComplete?: boolean;
  requiredProfileComplete?: boolean;
  guardianConsentRequired?: boolean;
}
