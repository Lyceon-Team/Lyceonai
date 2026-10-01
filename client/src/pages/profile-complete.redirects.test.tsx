// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileComplete from "./profile-complete";

const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());

let profilePayload: {
  authenticated?: boolean;
  user?: Record<string, unknown> | null;
} = {
  authenticated: false,
  user: null,
};

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: queryMock.useQuery,
    useMutation: queryMock.useMutation,
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/profile/complete", navigateMock],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({}),
}));

describe("ProfileComplete redirect continuity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.useMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    queryMock.useQuery.mockImplementation(
      ({ queryKey }: { queryKey: unknown }) => {
        const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
        if (key === "/api/profile") {
          return {
            data: profilePayload,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
        }
        return {
          data: undefined,
          isLoading: false,
          error: null,
        };
      },
    );
  });

  it("redirects unauthenticated users declaratively to /login", () => {
    profilePayload = { authenticated: false, user: null };

    render(<ProfileComplete />);

    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/login",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("redirects already-complete profiles declaratively to /dashboard", () => {
    profilePayload = {
      authenticated: true,
      user: {
        role: "student",
        requiredProfileComplete: true,
        profileCompletedAt: "2026-03-24T10:00:00.000Z",
      },
    };

    render(<ProfileComplete />);

    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/dashboard",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  /**
   * @spec [AS-5; register UI-03] | @implemented [2026-09-29] — the return path that rode
   * through onboarding (`/profile/complete?next=…`) is where a complete profile lands, if the
   * role may open it; a guardian is never sent to a student page; a disallowed value is dropped.
   */
  describe("return path (?next=) through onboarding", () => {
    afterEach(() => {
      window.history.replaceState({}, "", "/profile/complete");
    });

    it("UI-03 already-complete student with next=/calendar → /calendar", () => {
      window.history.replaceState({}, "", "/profile/complete?next=%2Fcalendar");
      profilePayload = {
        authenticated: true,
        user: {
          role: "student",
          requiredProfileComplete: true,
          profileCompletedAt: "2026-03-24T10:00:00.000Z",
        },
      };
      render(<ProfileComplete />);
      expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
        "/calendar",
      );
    });

    it("UI-03 already-complete guardian with next=/calendar → /guardian", () => {
      window.history.replaceState({}, "", "/profile/complete?next=%2Fcalendar");
      profilePayload = {
        authenticated: true,
        user: {
          role: "guardian",
          requiredProfileComplete: true,
          profileCompletedAt: "2026-03-24T10:00:00.000Z",
        },
      };
      render(<ProfileComplete />);
      expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
        "/guardian",
      );
    });

    it("UI-03 a disallowed next is dropped → role default", () => {
      window.history.replaceState(
        {},
        "",
        "/profile/complete?next=%2F%2Fevil.example.com%2Fcalendar",
      );
      profilePayload = {
        authenticated: true,
        user: {
          role: "student",
          requiredProfileComplete: true,
          profileCompletedAt: "2026-03-24T10:00:00.000Z",
        },
      };
      render(<ProfileComplete />);
      expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
        "/dashboard",
      );
    });

    it("G2-04 wins over next: complete under-13 with no active link and next=/calendar → /guardian-required", () => {
      window.history.replaceState({}, "", "/profile/complete?next=%2Fcalendar");
      profilePayload = {
        authenticated: true,
        user: {
          role: "student",
          requiredProfileComplete: true,
          profileCompletedAt: "2026-09-29T00:00:00.000Z",
          guardianConsentRequired: true,
        },
      };
      render(<ProfileComplete />);
      expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
        "/guardian-required",
      );
    });
  });

  // G2-04: the under-13 screen moved to its own page (/guardian-required), built from the
  // canonical link-code and guardian panels. Profile completion no longer renders it: a
  // COMPLETED under-13 student with no active link is sent there instead.
  it("a completed under-13 student with no active guardian link is sent to /guardian-required", () => {
    profilePayload = {
      authenticated: true,
      user: {
        role: "student",
        requiredProfileComplete: true,
        profileCompletedAt: "2026-09-29T00:00:00.000Z",
        guardianConsentRequired: true,
      },
    };

    render(<ProfileComplete />);

    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/guardian-required",
    );
  });

  it("an incomplete under-13 profile sees the form, with no guardian email field", () => {
    profilePayload = {
      authenticated: true,
      user: {
        role: "student",
        requiredProfileComplete: false,
        profileCompletedAt: null,
        guardianConsentRequired: true,
      },
    };

    render(<ProfileComplete />);

    expect(screen.queryByTestId("redirect")).toBeNull();
    expect(screen.getByTestId("button-complete-profile")).toBeInTheDocument();
    expect(screen.queryByTestId("input-guardian-email")).toBeNull();
    expect(screen.queryByTestId("guardian-connect-required")).toBeNull();
  });
});
