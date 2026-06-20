// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireRole } from "./RequireRole";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 / contracts/auth-login-e2e.contract.md] Proof
 * for the declarative gate that protects feature pages: RequireRole redirects an incomplete non-admin
 * account to /profile/complete BEFORE rendering the guarded page, renders children once onboarding is
 * complete, sends an unauthenticated user to /login, and never gates an admin on onboarding.
 */

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));

let authState: {
  user: { id: string } | null;
  authLoading: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
} = { user: null, authLoading: false, isAdmin: false, isGuardian: false };

let location = "/dashboard";
let authData: { user: Record<string, unknown> | null } = { user: null };

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMock.useQuery,
}));

vi.mock("wouter", () => ({
  useLocation: () => [location],
  Redirect: ({ to }: { to: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-to": to }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

const child = React.createElement("div", { "data-testid": "child" }, "feature");

describe("RequireRole declarative onboarding gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    location = "/dashboard";
    authState = {
      user: null,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    authData = { user: null };
    queryMock.useQuery.mockImplementation(() => ({
      data: authData,
      isLoading: false,
    }));
  });

  it("redirects an unauthenticated user to /login", () => {
    authState = {
      user: null,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/login",
    );
  });

  it("redirects an incomplete student to /profile/complete before the feature page", () => {
    authState = {
      user: { id: "u1" },
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    authData = {
      user: {
        profileCompletedAt: null,
        requiredProfileComplete: false,
        requiredConsentsComplete: false,
        guardianConsentRequired: false,
      },
    };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("redirect").getAttribute("data-to")).toBe(
      "/profile/complete",
    );
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("renders children once onboarding is complete", () => {
    authState = {
      user: { id: "u1" },
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    authData = {
      user: {
        profileCompletedAt: "2026-03-24T10:00:00.000Z",
        requiredProfileComplete: true,
        requiredConsentsComplete: true,
        guardianConsentRequired: false,
      },
    };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("never gates an admin on onboarding (renders children even when incomplete)", () => {
    authState = {
      user: { id: "a1" },
      authLoading: false,
      isAdmin: true,
      isGuardian: false,
    };
    authData = {
      user: { profileCompletedAt: null, requiredProfileComplete: false },
    };
    render(React.createElement(RequireRole, { allow: ["admin"] }, child));
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("does not re-redirect when already on /profile/complete (no loop)", () => {
    location = "/profile/complete";
    authState = {
      user: { id: "u1" },
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    authData = {
      user: { profileCompletedAt: null, requiredProfileComplete: false },
    };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.queryByTestId("redirect")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
