import { describe, expect, it } from "vitest";
import { humanAuthError } from "../../client/src/lib/auth-error-messages";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] Every user-facing auth failure is a clear,
 * human, recoverable message — never a raw error code. Codes stay server-side for diagnostics.
 */

const CODES = [
  "post_auth_finalize",
  "supabase_exchange",
  "google_oauth_failed",
  "account_exists",
];

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

  it("falls back to a safe generic recoverable message for unknown codes", () => {
    const message = humanAuthError("some_unmapped_code");
    expect(message).toBe(
      "Something went wrong while signing you in. Please try again.",
    );
    expect(message).not.toContain("some_unmapped_code");
  });
});
