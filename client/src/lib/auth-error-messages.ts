/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-20
 * plain English: the SINGLE source of truth for auth error copy. Maps opaque server/client error CODES
 * (kept specific for diagnostics/logging) to clear, human, recoverable sentences. Standard error UX
 * (Jakob's Law): users see what to do next, never a raw code or an internal reason. Unknown/absent codes
 * fall back to a safe generic message — so no raw server string or unexpected (network) error text ever
 * reaches the UI. `resolveAuthErrorMessage` is the display chokepoint every auth surface routes through.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // OAuth / callback redirect codes (?error=<code> on /login)
  google_oauth_failed: "We couldn't sign you in with Google. Please try again.",
  supabase_exchange:
    "Your sign-in link expired or was already used. Please sign in again.",
  account_exists:
    "An account already exists for this email. Please sign in with the method you used originally.",
  post_auth_finalize:
    "We couldn't finish signing you in. Please try again — if it keeps happening, contact support.",
  consent_capture_failed:
    "We couldn't complete your sign-in just now. Please try again in a moment.",
  // Email/password form codes. The displayed copy is generic + non-enumerable and NEVER leaks the
  // internal reason (e.g. signup_consent_failed is the AS1 fail-closed path — the user just sees a
  // recoverable retry message, not "consent recording failed").
  signup_failed:
    "We couldn't complete your sign-up. Please check your details and try again.",
  signup_consent_failed:
    "We couldn't complete your sign-up just now. Please try again in a moment.",
  signin_failed: "Invalid email or password.",
  reset_password_failed:
    "We couldn't send a password reset email. Please try again.",
  update_password_failed: "We couldn't update your password. Please try again.",
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

/**
 * Build an Error carrying a specific `code` for the catch site to map. The `.message` is set to the
 * human copy too (logging/fallback), but display layers should use `resolveAuthErrorMessage` — never
 * `.message` directly. `code` may be omitted for an unexpected failure (→ generic copy, no code).
 */
export function authError(code?: string): Error & { code?: string } {
  const err = new Error(humanAuthError(code) ?? GENERIC_AUTH_ERROR) as Error & {
    code?: string;
  };
  if (code) err.code = code;
  return err;
}

/**
 * Display chokepoint: turn ANY caught error into a human, recoverable string. A handled error carries a
 * `.code` (mapped via humanAuthError); an unexpected error (network TypeError, etc.) has no code and
 * falls back to the generic message. By construction this NEVER returns a raw server/exception string —
 * the UI cannot leak an internal message or enumerate accounts.
 */
export function resolveAuthErrorMessage(err: unknown): string {
  const rawCode =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  const code = typeof rawCode === "string" ? rawCode : null;
  return humanAuthError(code) ?? GENERIC_AUTH_ERROR;
}
