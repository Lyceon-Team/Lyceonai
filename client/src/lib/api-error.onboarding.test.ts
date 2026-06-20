import { describe, expect, it } from "vitest";
import { HttpApiError, resolveOnboardingErrorMessage } from "./api-error";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] The profile-completion (onboarding) surface —
 * the COPPA/DOB gate — must NEVER render a raw server/exception string. `PATCH /api/profile` returns
 * `{ error: "<string>" }` with no code, so `HttpApiError.message` carries a raw server string;
 * `resolveOnboardingErrorMessage` is the display chokepoint that maps the server's own deterministic
 * 400/403 validation conditions to curated, actionable copy and falls back to a generic recoverable
 * message for everything else — so no raw string can reach the UI.
 */

const GENERIC_LOAD =
  "We couldn't load your profile just now. Please try again.";
const GENERIC_SAVE =
  "We couldn't save your profile just now. Please try again.";

const apiError = (status: number, message: string): HttpApiError =>
  new HttpApiError({ status, message });

describe("resolveOnboardingErrorMessage — known 400/403 conditions map to curated copy", () => {
  it("maps the missing date-of-birth condition (the under-13 gate entry)", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(400, "Date of birth is required for student accounts"),
    );
    expect(shown).toBe("Please enter your date of birth to continue.");
  });

  it("maps the missing guardian-email condition (under-13 COPPA)", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(400, "Guardian email is required for users under 13"),
    );
    expect(shown).toBe("A guardian email is required for students under 13.");
  });

  it("maps the invalid-profile-data (Zod) condition", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(400, "Invalid profile data"),
    );
    expect(shown).toBe(
      "Some details look incomplete — please review the form and try again.",
    );
  });

  it("maps the support-mediated role-change condition (403)", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(403, "Role changes are support-mediated only"),
    );
    expect(shown).toBe(
      "Role changes are handled by support. Please contact support to update your role.",
    );
  });

  it("falls back to generic for an unmatched 403 (admin onboarding not supported)", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(
        403,
        "Admin profile onboarding is not supported on this endpoint",
      ),
    );
    expect(shown).toBe(GENERIC_SAVE);
    expect(shown).not.toContain("Admin");
    expect(shown).not.toContain("endpoint");
  });
});

describe("resolveOnboardingErrorMessage — anti-leak: never returns the raw string", () => {
  it("maps any 5xx to the generic message (server message hidden)", () => {
    const shown = resolveOnboardingErrorMessage(
      apiError(500, "Failed to load profile state"),
      "load",
    );
    expect(shown).toBe(GENERIC_LOAD);
    expect(shown).not.toContain("Failed to load profile state");
  });

  it("NEVER surfaces a leaky DB string even on a 400 (unmatched → generic)", () => {
    const leaky = apiError(
      400,
      "duplicate key value violates unique constraint idx_profiles_email_active",
    );
    const shown = resolveOnboardingErrorMessage(leaky, "save");
    expect(shown).toBe(GENERIC_SAVE);
    expect(shown).not.toContain("constraint");
    expect(shown).not.toContain("profiles");
    expect(shown).not.toBe(leaky.message);
  });

  it("maps the load query's plain Error('Failed to load profile (500)') to the load generic", () => {
    const shown = resolveOnboardingErrorMessage(
      new Error("Failed to load profile (500)"),
      "load",
    );
    expect(shown).toBe(GENERIC_LOAD);
    expect(shown).not.toContain("500");
  });

  it("is defensive against non-Error / non-ApiError values", () => {
    expect(resolveOnboardingErrorMessage(null)).toBe(GENERIC_SAVE);
    expect(resolveOnboardingErrorMessage(undefined)).toBe(GENERIC_SAVE);
    expect(resolveOnboardingErrorMessage("a raw string error")).toBe(
      GENERIC_SAVE,
    );
    expect(resolveOnboardingErrorMessage("a raw string error")).not.toContain(
      "raw",
    );
  });

  it("defaults to the save variant and honors the load variant", () => {
    expect(resolveOnboardingErrorMessage(new Error("x"))).toBe(GENERIC_SAVE);
    expect(resolveOnboardingErrorMessage(new Error("x"), "load")).toBe(
      GENERIC_LOAD,
    );
  });
});
