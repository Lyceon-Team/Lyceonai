// @vitest-environment jsdom
/**
 * @spec [contracts/auth-standard-flow.contract.md AS-5 (allowlisted `next`), AS-3 (landing matrix);
 *        Doc-05F §17.1 (/calendar); register UI-03] | @implemented [2026-09-29]
 *
 * plain English: the whole client chain for a first-time student, one real producer feeding the
 * next real consumer — "signed out, open /calendar, sign in, onboard, land on /calendar":
 *   RequireRole (signed out at /calendar)      → /login?next=%2Fcalendar
 *   Login (signed in, profile incomplete)       → /profile/complete?next=%2Fcalendar
 *   RequireRole (at /profile/complete?next=…)   → renders the page, no redirect loop
 *   ProfileComplete (PATCH succeeds)            → /calendar
 * Each hop's input is the previous hop's OUTPUT, never a hand-written URL, so a hop that drops
 * `next` breaks the chain here even if its own file's tests stay green. The PATCH result mirrors
 * the shape server/routes/profile-routes.ts returns (`{ success, profile: { …, role }, guardianConsentRequired }`).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

type MutationOptions = {
  onSuccess: (result: unknown) => Promise<void>;
};

let mutationOptions: MutationOptions | null = null;
let profilePayload: unknown = null;
let authState: {
  user: Record<string, unknown> | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
} = {
  user: null,
  isAuthenticated: false,
  authLoading: false,
  isAdmin: false,
  isGuardian: false,
};

vi.mock("wouter", () => ({
  useLocation: () => [window.location.pathname, navigateMock],
  Redirect: ({ to }: { to: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-to": to }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: queryMock.useQuery,
    useMutation: queryMock.useMutation,
  };
});

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  // profile-complete awaits refreshUser() before navigating (G1-02); a resolved no-op here.
  useSupabaseAuth: () => ({ ...authState, refreshUser: async () => undefined }),
}));

vi.mock("@/components/auth/SupabaseAuthForm", () => ({
  SupabaseAuthForm: () =>
    React.createElement("div", { "data-testid": "auth-form" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn(async () => undefined) },
}));

import Login from "./login";
import ProfileComplete from "./profile-complete";
import { RequireRole } from "@/components/auth/RequireRole";
import {
  GUARDIAN_SIGNUP_HREF,
  START_DIAGNOSTIC_HREF,
} from "@/lib/marketing-links";

function redirectTarget(): string {
  const to = screen.getByTestId("redirect").getAttribute("data-to");
  expect(to).not.toBeNull();
  return to ?? "";
}

describe("UI-03 — a return path survives sign-in AND first-time onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptions = null;
    queryMock.useQuery.mockImplementation(() => ({
      data: profilePayload,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }));
    queryMock.useMutation.mockImplementation((opts: MutationOptions) => {
      mutationOptions = opts;
      return { mutate: vi.fn(), isPending: false };
    });
  });

  it("signed out at /calendar → sign in → onboarding → /calendar", async () => {
    // Hop 1: signed out, opening /calendar.
    window.history.replaceState({}, "", "/calendar");
    authState = {
      user: null,
      isAuthenticated: false,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    const { unmount: unmount1 } = render(
      React.createElement(
        RequireRole,
        { allow: ["student", "admin"] },
        React.createElement("div", { "data-testid": "calendar" }),
      ),
    );
    const loginUrl = redirectTarget();
    expect(loginUrl).toBe("/login?next=%2Fcalendar");
    unmount1();

    // Hop 2: the login page, signed in, first-time (incomplete) student.
    window.history.replaceState({}, "", loginUrl);
    authState = {
      user: {
        role: "student",
        profile_completed_at: null,
        requiredProfileComplete: false,
        guardianConsentRequired: false,
      },
      isAuthenticated: true,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    const { unmount: unmount2 } = render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const onboardingUrl = String(navigateMock.mock.calls[0]?.[0]);
    expect(onboardingUrl).toBe("/profile/complete?next=%2Fcalendar");
    unmount2();

    // Hop 3: RequireRole in front of /profile/complete must render it (no loop, no drop).
    window.history.replaceState({}, "", onboardingUrl);
    // G2-02 (merged from `main`): the guard parses the role and never defaults it.
    authState = { ...authState, user: { id: "u1", role: "student" } };
    profilePayload = {
      authenticated: true,
      user: {
        id: "u1",
        role: "student",
        profileCompletedAt: null,
        requiredProfileComplete: false,
        guardianConsentRequired: false,
        outstandingLegal: [],
      },
    };
    const { unmount: unmount3 } = render(
      React.createElement(
        RequireRole,
        { allow: ["student", "guardian", "admin"] },
        React.createElement("div", { "data-testid": "onboarding" }),
      ),
    );
    expect(screen.getByTestId("onboarding")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
    unmount3();

    // Hop 4: the onboarding page completes the profile and lands on the return path.
    render(React.createElement(ProfileComplete));
    expect(mutationOptions).not.toBeNull();
    navigateMock.mockClear();
    await mutationOptions?.onSuccess({
      success: true,
      profile: {
        id: "u1",
        role: "student",
        profileCompletedAt: "2026-09-29T00:00:00Z",
      },
      guardianConsentRequired: false,
      guardianConsentRequestId: null,
    });
    expect(navigateMock).toHaveBeenCalledWith("/calendar");
  });

  it("a guardian who completes onboarding with next=/calendar lands on /guardian, not a student page", async () => {
    window.history.replaceState({}, "", "/profile/complete?next=%2Fcalendar");
    profilePayload = {
      authenticated: true,
      user: {
        id: "g1",
        role: "student",
        profileCompletedAt: null,
        requiredProfileComplete: false,
      },
    };
    render(React.createElement(ProfileComplete));
    await mutationOptions?.onSuccess({
      success: true,
      profile: { id: "g1", role: "guardian" },
      guardianConsentRequired: false,
    });
    expect(navigateMock).toHaveBeenCalledWith("/guardian");
    expect(navigateMock).not.toHaveBeenCalledWith("/calendar");
  });

  // @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 3] |
  // @implemented [2026-10-10] | the homepage's real href, through sign-up and onboarding.
  it('"Start the free diagnostic" → sign up → onboarding → the diagnostic', async () => {
    window.history.replaceState({}, "", START_DIAGNOSTIC_HREF);
    authState = {
      user: {
        role: "student",
        profile_completed_at: null,
        requiredProfileComplete: false,
        guardianConsentRequired: false,
      },
      isAuthenticated: true,
      authLoading: false,
      isAdmin: false,
      isGuardian: false,
    };
    const { unmount } = render(React.createElement(Login));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const onboardingUrl = String(navigateMock.mock.calls[0]?.[0]);
    expect(onboardingUrl).toBe(
      "/profile/complete?next=%2Fpractice%2Fdiagnostic",
    );
    unmount();

    window.history.replaceState({}, "", onboardingUrl);
    profilePayload = {
      authenticated: true,
      user: {
        id: "d1",
        role: "student",
        profileCompletedAt: null,
        requiredProfileComplete: false,
      },
    };
    render(React.createElement(ProfileComplete));
    navigateMock.mockClear();
    await mutationOptions?.onSuccess({
      success: true,
      profile: { id: "d1", role: "student" },
      guardianConsentRequired: false,
    });
    expect(navigateMock).toHaveBeenCalledWith("/practice/diagnostic");
  });

  it("the diagnostic return path is never honoured for a guardian", async () => {
    window.history.replaceState(
      {},
      "",
      "/profile/complete?next=%2Fpractice%2Fdiagnostic",
    );
    profilePayload = {
      authenticated: true,
      user: {
        id: "g2",
        role: "guardian",
        profileCompletedAt: null,
        requiredProfileComplete: false,
      },
    };
    render(React.createElement(ProfileComplete));
    await mutationOptions?.onSuccess({
      success: true,
      profile: { id: "g2", role: "guardian" },
      guardianConsentRequired: false,
    });
    expect(navigateMock).toHaveBeenCalledWith("/guardian");
  });

  // @spec [owner brief 2026-10-10 rule 2] | the account a guardian-intent sign-up created is a
  // guardian, so onboarding defaults to Guardian even where the link carried no `next` (an
  // email-confirmation link lands on plain /profile/complete).
  it("a guardian-created account opens onboarding on Guardian without any next", () => {
    expect(GUARDIAN_SIGNUP_HREF).toContain("role=guardian");
    window.history.replaceState({}, "", "/profile/complete");
    profilePayload = {
      authenticated: true,
      user: {
        id: "g3",
        role: "guardian",
        profileCompletedAt: null,
        requiredProfileComplete: false,
      },
    };
    render(React.createElement(ProfileComplete));
    expect(screen.getByTestId("select-role").textContent).toContain("Guardian");
  });

  it("a disallowed next on the onboarding URL is dropped for the role default", async () => {
    window.history.replaceState(
      {},
      "",
      "/profile/complete?next=" +
        encodeURIComponent("https://evil.example.com/calendar"),
    );
    profilePayload = {
      authenticated: true,
      user: {
        id: "u1",
        role: "student",
        profileCompletedAt: null,
        requiredProfileComplete: false,
      },
    };
    render(React.createElement(ProfileComplete));
    await mutationOptions?.onSuccess({
      success: true,
      profile: { id: "u1", role: "student" },
      guardianConsentRequired: false,
    });
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });
});
