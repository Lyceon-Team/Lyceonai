// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./login";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 / contracts/auth-login-e2e.contract.md] Direct
 * proof for the post-auth landing matrix that Stage 3 verified by inspection. login.tsx is the
 * imperative landing authority: an authenticated, fully-onboarded student lands on /dashboard, a
 * guardian on /guardian, an incomplete account on /profile/complete (the DOB/COPPA gate), admins
 * bypass onboarding, and an unauthenticated / still-loading / 202 (user:null) state never redirects.
 */

const navigateMock = vi.hoisted(() => vi.fn());

type AuthUser = {
  role: "student" | "guardian" | "admin";
  profile_completed_at: string | null;
  requiredProfileComplete?: boolean;
  requiredConsentsComplete?: boolean;
  guardianConsentRequired?: boolean;
};

let authState: {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authLoading: boolean;
} = { user: null, isAuthenticated: false, authLoading: false };

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigateMock],
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));

vi.mock("@/components/auth/SupabaseAuthForm", () => ({
  SupabaseAuthForm: () =>
    React.createElement("div", { "data-testid": "auth-form" }),
}));

const completeStudent: AuthUser = {
  role: "student",
  profile_completed_at: "2026-03-24T10:00:00.000Z",
  requiredProfileComplete: true,
  requiredConsentsComplete: true,
  guardianConsentRequired: false,
};

const completeGuardian: AuthUser = {
  ...completeStudent,
  role: "guardian",
};

describe("Login landing matrix (imperative navigate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = { user: null, isAuthenticated: false, authLoading: false };
  });

  it("completed student → /dashboard", () => {
    authState = {
      user: completeStudent,
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("completed guardian → /guardian", () => {
    authState = {
      user: completeGuardian,
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/guardian");
  });

  it("incomplete student (profile_completed_at null) → /profile/complete", () => {
    authState = {
      user: {
        role: "student",
        profile_completed_at: null,
        requiredProfileComplete: false,
        requiredConsentsComplete: false,
        guardianConsentRequired: false,
      },
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/profile/complete");
  });

  it("incomplete via guardianConsentRequired → /profile/complete", () => {
    authState = {
      user: { ...completeStudent, guardianConsentRequired: true },
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/profile/complete");
  });

  it("admin bypasses onboarding → /dashboard even when incomplete", () => {
    authState = {
      user: { role: "admin", profile_completed_at: null },
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("authLoading → never redirects (shows skeleton)", () => {
    authState = { user: null, isAuthenticated: false, authLoading: true };
    render(React.createElement(Login));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("unauthenticated (202 user:null) → never redirects", () => {
    authState = { user: null, isAuthenticated: false, authLoading: false };
    render(React.createElement(Login));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
