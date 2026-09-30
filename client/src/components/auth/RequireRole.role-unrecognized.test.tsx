// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireRole } from "./RequireRole";

/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23] | @implemented [2026-09-29]
 *
 * plain English: the client never guesses a role. When the server refuses the session as
 * `ROLE_UNRECOGNIZED` (the auth context's `accountUnavailable`), or a user object somehow carries
 * a role outside the shared schema, the route guard renders a neutral "account unavailable" screen
 * — not the guarded page as a student, and not a redirect to /login that would loop straight back.
 */

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));

type AuthState = {
  user: { id: string; role?: string } | null;
  authLoading: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
  accountUnavailable: boolean;
  signOut: () => Promise<void>;
};

let authState: AuthState;

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMock.useQuery,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard"],
  Redirect: ({ to }: { to: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-to": to }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

const child = React.createElement("div", { "data-testid": "child" }, "feature");

const completeProfile = {
  user: {
    profileCompletedAt: "2026-09-01T00:00:00Z",
    requiredProfileComplete: true,
    guardianConsentRequired: false,
    outstandingLegal: [],
  },
};

describe("G2-02 RequireRole never defaults an unknown role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = {
      user: null,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
      accountUnavailable: false,
      signOut: vi.fn(async () => undefined),
    };
    queryMock.useQuery.mockImplementation(() => ({
      data: completeProfile,
      isLoading: false,
    }));
  });

  it("presence: a known student with a complete profile sees the page", () => {
    authState.user = { id: "s1", role: "student" };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("a session the server refused as ROLE_UNRECOGNIZED gets the neutral screen, not /login", () => {
    authState.accountUnavailable = true;
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("account-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("redirect")).toBeNull();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("a user object with a role outside the schema gets the neutral screen, not the student page", () => {
    authState.user = { id: "t1", role: "tutor" };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("account-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("a user object with no role gets the neutral screen", () => {
    authState.user = { id: "n1" };
    render(React.createElement(RequireRole, { allow: ["student"] }, child));
    expect(screen.getByTestId("account-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
  });
});
