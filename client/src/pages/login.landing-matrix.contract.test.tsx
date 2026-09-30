// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // G2-04: a COMPLETED under-13 student with no active guardian link is not "incomplete" any
  // more — they go to the linking page, not back through profile completion.
  it("completed under-13 student with no active guardian link → /guardian-required", () => {
    authState = {
      user: { ...completeStudent, guardianConsentRequired: true },
      isAuthenticated: true,
      authLoading: false,
    };
    render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledWith("/guardian-required");
  });

  it("an incomplete profile still goes to /profile/complete before the linking page", () => {
    authState = {
      user: {
        ...completeStudent,
        profile_completed_at: null,
        requiredProfileComplete: false,
        guardianConsentRequired: true,
      },
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

  /**
   * @spec [AS-5 allowlisted `next`; owner brief 2026-09-15 Part B2] the return path written by
   * RequireRole is honoured after auth (B2.1), an off-origin value is discarded for the role
   * default (B2.2 — observed failing when the sanitiser was bypassed), onboarding still wins,
   * and a signed-in visit with no `next` is unchanged (B2.3).
   */
  describe("return path (?next=)", () => {
    afterEach(() => {
      window.history.replaceState({}, "", "/login");
    });

    it("B2.1 completed guardian + next=/guardian?code=ABC234 → lands on /guardian with the code", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=%2Fguardian%3Fcode%3DABC234",
      );
      authState = {
        user: completeGuardian,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/guardian?code=ABC234");
    });

    it("B2.2 a crafted absolute URL in next is discarded → role default", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=" +
          encodeURIComponent("https://evil.example.com/guardian"),
      );
      authState = {
        user: completeGuardian,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/guardian");
    });

    it("B2.2b a protocol-relative host in next is discarded → role default", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=" + encodeURIComponent("//evil.example.com/guardian"),
      );
      authState = {
        user: completeStudent,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });

    // WAS: expected plain "/profile/complete" — onboarding won AND dropped the return path.
    // Register UI-03 (2026-09-29): onboarding still wins, but carries `next` through it.
    it("onboarding still wins over a return path, and carries it along", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=%2Fguardian%3Fcode%3DABC234",
      );
      authState = {
        user: {
          ...completeGuardian,
          profile_completed_at: null,
          requiredProfileComplete: false,
        },
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith(
        "/profile/complete?next=%2Fguardian%3Fcode%3DABC234",
      );
    });

    it("UI-03 incomplete student + next=/calendar → /profile/complete?next=%2Fcalendar", () => {
      window.history.replaceState({}, "", "/login?next=%2Fcalendar");
      authState = {
        user: {
          role: "student",
          profile_completed_at: null,
          requiredProfileComplete: false,
          guardianConsentRequired: false,
        },
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith(
        "/profile/complete?next=%2Fcalendar",
      );
    });

    it("UI-03 completed student + next=/tests/<id> → the exam deep link", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=%2Ftests%2Fs-1%2Freport",
      );
      authState = {
        user: completeStudent,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/tests/s-1/report");
    });

    it("UI-03 completed guardian + next=/calendar → /guardian (never a student page)", () => {
      window.history.replaceState({}, "", "/login?next=%2Fcalendar");
      authState = {
        user: completeGuardian,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/guardian");
    });

    it("UI-03 a disallowed next is dropped even through onboarding → plain /profile/complete", () => {
      window.history.replaceState(
        {},
        "",
        "/login?next=" +
          encodeURIComponent("https://evil.example.com/calendar"),
      );
      authState = {
        user: {
          role: "student",
          profile_completed_at: null,
          requiredProfileComplete: false,
          guardianConsentRequired: false,
        },
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/profile/complete");
    });

    it("G2-04: the linking page also wins over a return path", () => {
      window.history.replaceState({}, "", "/login?next=%2Fpractice");
      authState = {
        user: { ...completeStudent, guardianConsentRequired: true },
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/guardian-required");
    });

    it("B2.3 no next → unchanged role landing", () => {
      window.history.replaceState({}, "", "/login");
      authState = {
        user: completeGuardian,
        isAuthenticated: true,
        authLoading: false,
      };
      render(React.createElement(Login));
      expect(navigateMock).toHaveBeenCalledWith("/guardian");
    });
  });
});
