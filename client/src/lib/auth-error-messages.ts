/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-18
 * plain English: maps the server-side auth error CODES (kept opaque server-side for diagnostics) to
 * clear, human, recoverable sentences for the user. Standard error UX (Jakob's Law): users see what
 * went wrong and how to recover — never a raw code. Unknown codes fall back to a safe generic message.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_oauth_failed: "We couldn't sign you in with Google. Please try again.",
  supabase_exchange:
    "Your sign-in link expired or was already used. Please sign in again.",
  account_exists:
    "An account already exists for this email. Please sign in with the method you used originally.",
  post_auth_finalize:
    "We couldn't finish signing you in. Please try again — if it keeps happening, contact support.",
  consent_capture_failed:
    "We couldn't complete your sign-in just now. Please try again in a moment.",
};

const GENERIC_AUTH_ERROR =
  "Something went wrong while signing you in. Please try again.";

/**
 * Resolve a server auth error code to a human, recoverable message. Returns null when there is no
 * error code (nothing to show), and the generic recoverable message for an unrecognized code.
 */
export function humanAuthError(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? GENERIC_AUTH_ERROR;
}
