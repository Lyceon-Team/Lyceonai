import { describe, expect, it } from "vitest";
import {
  humanAuthError,
  resolveAuthErrorMessage,
  authError,
} from "../../client/src/lib/auth-error-messages";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] Every user-facing auth failure is a clear,
 * human, recoverable message — never a raw error code, an internal reason, or a server/exception
 * string. Codes stay specific for diagnostics; `resolveAuthErrorMessage` is the display chokepoint
 * every auth surface routes through, so no raw string can reach the UI (and accounts can't be enumerated).
 */

const CODES = [
  // OAuth / callback redirect codes
  "post_auth_finalize",
  "supabase_exchange",
  "google_oauth_failed",
  "account_exists",
  "consent_capture_failed",
  // Email/password form codes (Stage 3)
  "signup_failed",
  "signup_consent_failed",
  "signin_failed",
  "reset_password_failed",
  "update_password_failed",
  // Sign-out failure (Stage 3 follow-up — full auth-surface chokepoint)
  "signout_failed",
];

const GENERIC = "Something went wrong while signing you in. Please try again.";

describe("humanAuthError (AS-3 standard error UX)", () => {
  it("returns null when there is no error code", () => {
    expect(humanAuthError(null)).toBeNull();
    expect(humanAuthError(undefined)).toBeNull();
    expect(humanAuthError("")).toBeNull();
  });

  it("maps every known code to a human, recoverable message that never leaks the code", () => {
    for (const code of CODES) {
      const message = humanAuthError(code);
      expect(message).toBeTruthy();
      // human sentence, not the raw code
      expect(message).not.toContain(code);
      expect(message).not.toContain("_");
      expect(message?.endsWith(".")).toBe(true);
    }
  });

  it("never leaks the internal reason for the consent fail-closed path (signup_consent_failed)", () => {
    // This is the AS1-OUTBOX-DROP-001 fail-closed code: the user must see a generic, recoverable retry
    // message — NOT "consent recording failed" or any internal mechanism.
    const message = (
      humanAuthError("signup_consent_failed") ?? ""
    ).toLowerCase();
    expect(message).not.toContain("consent");
    expect(message).not.toContain("outbox");
    expect(message).toMatch(/try again/);
  });

  it("falls back to a safe generic recoverable message for unknown codes", () => {
    const message = humanAuthError("some_unmapped_code");
    expect(message).toBe(GENERIC);
    expect(message).not.toContain("some_unmapped_code");
  });
});

describe("resolveAuthErrorMessage (display chokepoint — never a raw string)", () => {
  it("maps a coded error (authError) to its human message", () => {
    for (const code of CODES) {
      const err = authError(code);
      expect((err as { code?: string }).code).toBe(code);
      expect(resolveAuthErrorMessage(err)).toBe(humanAuthError(code));
    }
  });

  it("returns the generic message for an error with no code (network / unexpected)", () => {
    expect(resolveAuthErrorMessage(new TypeError("Failed to fetch"))).toBe(
      GENERIC,
    );
    expect(resolveAuthErrorMessage(new Error("anything"))).toBe(GENERIC);
  });

  it("NEVER surfaces a raw server/exception string — even a leaky message maps to generic", () => {
    // An unexpected error whose .message is a raw/internal string must not reach the UI.
    const leaky = new Error(
      "duplicate key value violates unique constraint idx_profiles_email_active",
    );
    const shown = resolveAuthErrorMessage(leaky);
    expect(shown).toBe(GENERIC);
    expect(shown).not.toContain("constraint");
    expect(shown).not.toContain("profiles");
  });

  it("maps an error carrying an unknown code to generic (never the raw code)", () => {
    const err = Object.assign(new Error("x"), { code: "totally_unknown_code" });
    const shown = resolveAuthErrorMessage(err);
    expect(shown).toBe(GENERIC);
    expect(shown).not.toContain("totally_unknown_code");
  });

  it("is defensive against non-Error values", () => {
    expect(resolveAuthErrorMessage(null)).toBe(GENERIC);
    expect(resolveAuthErrorMessage(undefined)).toBe(GENERIC);
    expect(resolveAuthErrorMessage("a raw string error")).toBe(GENERIC);
  });
});
