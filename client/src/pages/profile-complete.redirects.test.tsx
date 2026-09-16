// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfileComplete from "./profile-complete";

const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());

let profilePayload: { authenticated?: boolean; user?: any | null } = {
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

  it("shows the under-13 screen — code, copy control and guardian email", () => {
    // WAS: asserted a one-paragraph Alert saying verification "is still
    // required". Owner ruling 2026-09-16 — the under-13 condition stays (it is
    // in the Terms and is the basis of the under-13 position) but it must be a
    // useful screen, not a wall. So this asserts the MEANS are present, which is
    // what makes it a screen: the code, a way to copy it, and a way to invite.
    profilePayload = {
      authenticated: true,
      user: {
        role: "student",
        requiredProfileComplete: false,
        profileCompletedAt: null,
        guardianConsentRequired: true,
        studentLinkCode: "ABCDEF",
      },
    };

    render(<ProfileComplete />);

    expect(screen.getByTestId("guardian-connect-required")).toBeInTheDocument();
    expect(screen.getByTestId("student-link-code").textContent).toBe("ABCDEF");
    expect(screen.getByTestId("copy-link-code")).toBeInTheDocument();
    expect(screen.getByTestId("input-guardian-email")).toBeInTheDocument();
    expect(screen.getByTestId("send-guardian-invite")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("says where to find the code when it is not ready, rather than showing an empty box", () => {
    profilePayload = {
      authenticated: true,
      user: {
        role: "student",
        requiredProfileComplete: false,
        profileCompletedAt: null,
        guardianConsentRequired: true,
        studentLinkCode: null,
      },
    };

    render(<ProfileComplete />);

    expect(screen.getByTestId("student-link-code-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("student-link-code")).toBeNull();
    // The invite path still works without a code.
    expect(screen.getByTestId("input-guardian-email")).toBeInTheDocument();
  });
});
