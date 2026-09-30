// @vitest-environment jsdom
/**
 * @spec [Guardian_Closure_Plan G2-06 (G-NEW-09)] | @implemented [2026-09-29]
 *
 * plain English: a request refused with 403 PROFILE_INCOMPLETE (the server's "age unknown" answer
 * on every learning endpoint) sends the student to /profile/complete — from any query or mutation,
 * through the query client's caches — and nothing else does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError, onboardingRedirectFor } from "./api-error";
import { queryClient, redirectForOnboarding } from "./queryClient";

const refused = (status: number, code?: string): HttpApiError =>
  new HttpApiError({ status, message: "refused", ...(code ? { code } : {}) });

describe("onboardingRedirectFor", () => {
  it("403 PROFILE_INCOMPLETE → /profile/complete", () => {
    expect(onboardingRedirectFor(refused(403, "PROFILE_INCOMPLETE"))).toBe(
      "/profile/complete",
    );
  });

  it("anything else → no redirect", () => {
    expect(
      onboardingRedirectFor(refused(403, "GUARDIAN_LINK_REQUIRED")),
    ).toBeNull();
    expect(onboardingRedirectFor(refused(403))).toBeNull();
    expect(
      onboardingRedirectFor(refused(400, "PROFILE_INCOMPLETE")),
    ).toBeNull();
    expect(onboardingRedirectFor(new Error("PROFILE_INCOMPLETE"))).toBeNull();
  });
});

describe("redirectForOnboarding", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/practice");
  });

  it("navigates once for a PROFILE_INCOMPLETE refusal", () => {
    const navigate = vi.fn();
    redirectForOnboarding(refused(403, "PROFILE_INCOMPLETE"), navigate);
    expect(navigate).toHaveBeenCalledWith("/profile/complete");
  });

  it("does nothing when already on /profile/complete (no loop)", () => {
    window.history.replaceState({}, "", "/profile/complete");
    const navigate = vi.fn();
    redirectForOnboarding(refused(403, "PROFILE_INCOMPLETE"), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does nothing for other errors", () => {
    const navigate = vi.fn();
    redirectForOnboarding(refused(500), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("is wired into the query client for every query and mutation", () => {
    expect(queryClient.getQueryCache().config.onError).toBeTypeOf("function");
    expect(queryClient.getMutationCache().config.onError).toBeTypeOf(
      "function",
    );
  });
});
