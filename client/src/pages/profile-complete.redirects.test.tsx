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
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect" data-to={to} />,
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
    queryMock.useQuery.mockImplementation(({ queryKey }: { queryKey: unknown }) => {
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
    });
  });

  it("redirects unauthenticated users declaratively to /login", () => {
    profilePayload = { authenticated: false, user: null };

    render(<ProfileComplete />);

    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe("/login");
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

    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe("/dashboard");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows guardian consent pending alert while profile remains incomplete", () => {
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

    expect(screen.getByTestId("alert-guardian-consent-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
});
