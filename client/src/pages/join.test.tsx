// @vitest-environment jsdom
/**
 * `/join/:token` through the real App router.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 4, 6, 7; SCL-282; DESIGN.md §5]
 *       | @implemented [2026-11-22]
 *
 * plain English: every state the page can be in, each from a response first parsed by the shared
 * schema the page itself uses (the PG suite proves the real routes emit those shapes): the four
 * closed states, the open invite signed out (the guardian's first name, the Privacy v6 §5.1 line,
 * one filled action), a non-student, a student who still has to onboard (sent there with /join as
 * the return path), and a student who joins (refreshed, then on to the dashboard).
 */
import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  joinClaimResponseSchema,
  joinConsentLine,
  joinLookupResponseSchema,
  JOIN_STATE_MESSAGE,
} from "@lyceon/shared/guardian-invite-schema";
import { json, mountApp } from "@/features/guardian/test-harness";

const TOKEN = "Z".repeat(43);
const auth = vi.hoisted(() => ({
  state: {
    user: null as Record<string, unknown> | null,
    isAuthenticated: false,
    authLoading: false,
    isAdmin: false,
    isGuardian: false,
  },
  refreshUser: vi.fn(async () => undefined),
}));
const claimed = vi.hoisted(() => ({ outcome: "claimed" as string, calls: 0 }));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    ...auth.state,
    refreshUser: auth.refreshUser,
    signOut: vi.fn(async () => undefined),
  }),
}));
vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(async () => "t"),
  clearCsrfToken: vi.fn(),
  csrfFetch: vi.fn(async (url: string) => {
    if (url === "/api/join/claim") {
      claimed.calls += 1;
      return new Response(
        JSON.stringify(
          joinClaimResponseSchema.parse({
            data: { outcome: claimed.outcome },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404 });
  }),
}));

const { Router } = await import("@/App");

function serveLookup(data: unknown): void {
  const body = joinLookupResponseSchema.parse({ data });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/join/lookup" ? json(body) : json({}, 404),
    ),
  );
}

const OPEN = {
  state: "open",
  guardianFirstName: "Robin",
  expiresAt: "2026-12-06T00:00:00.000Z",
};

beforeEach(() => {
  auth.state = {
    user: null,
    isAuthenticated: false,
    authLoading: false,
    isAdmin: false,
    isGuardian: false,
  };
  auth.refreshUser.mockClear();
  claimed.outcome = "claimed";
  claimed.calls = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/join/:token", () => {
  it.each(["claimed", "cancelled", "expired", "not_found"] as const)(
    "a %s token gets its own clear line",
    async (state) => {
      serveLookup({ state });
      mountApp(Router, `/join/${TOKEN}`);
      expect(await screen.findByTestId(`join-${state}`)).toBeTruthy();
      expect(screen.getByText(JOIN_STATE_MESSAGE[state])).toBeTruthy();
    },
  );

  it("open and signed out: the guardian's first name, the consent line, sign up as the one filled action", async () => {
    serveLookup(OPEN);
    const { history } = mountApp(Router, `/join/${TOKEN}`);
    expect(await screen.findByText("Robin invited you to Lyceon")).toBeTruthy();
    expect(screen.getByTestId("join-consent").textContent).toBe(
      joinConsentLine("Robin"),
    );
    fireEvent.click(screen.getByTestId("join-sign-up"));
    const next = encodeURIComponent(`/join/${TOKEN}`);
    await waitFor(() => expect(history.at(-1)).toContain(`next=${next}`));
    expect(history.at(-1)).toContain("mode=signup");
    expect(history.at(-1)).toContain("role=student");
  });

  it("a guardian (any non-student) is told the invite is for a student account", async () => {
    serveLookup(OPEN);
    auth.state = {
      ...auth.state,
      isAuthenticated: true,
      user: {
        id: "g1",
        role: "guardian",
        profile_completed_at: "2026-11-01T00:00:00Z",
      },
    };
    mountApp(Router, `/join/${TOKEN}`);
    expect(await screen.findByTestId("join-not-student")).toBeTruthy();
    expect(screen.queryByTestId("join-claim")).toBeNull();
  });

  it("a student who has not onboarded is sent to onboarding with /join as the return path", async () => {
    serveLookup(OPEN);
    auth.state = {
      ...auth.state,
      isAuthenticated: true,
      user: {
        id: "s1",
        role: "student",
        profile_completed_at: null,
        requiredProfileComplete: false,
      },
    };
    const { history } = mountApp(Router, `/join/${TOKEN}`);
    await waitFor(() =>
      expect(history.at(-1)).toBe(
        `/profile/complete?next=${encodeURIComponent(`/join/${TOKEN}`)}`,
      ),
    );
  });

  it("a student joins: the claim is posted, the user refreshed, then the dashboard", async () => {
    serveLookup(OPEN);
    auth.state = {
      ...auth.state,
      isAuthenticated: true,
      user: {
        id: "s1",
        role: "student",
        profile_completed_at: "2026-11-01T00:00:00Z",
        requiredProfileComplete: true,
      },
    };
    const { history } = mountApp(Router, `/join/${TOKEN}`);
    expect(await screen.findByText("Join Robin on Lyceon")).toBeTruthy();
    fireEvent.click(screen.getByTestId("join-claim"));
    await waitFor(() => expect(history.at(-1)).toBe("/dashboard"));
    expect(claimed.calls).toBe(1);
    expect(auth.refreshUser).toHaveBeenCalledTimes(1);
  });

  it("a claim that loses the race shows the used-invite line, and does not navigate", async () => {
    serveLookup(OPEN);
    claimed.outcome = "claimed_by_other";
    auth.state = {
      ...auth.state,
      isAuthenticated: true,
      user: {
        id: "s1",
        role: "student",
        profile_completed_at: "2026-11-01T00:00:00Z",
        requiredProfileComplete: true,
      },
    };
    const { history } = mountApp(Router, `/join/${TOKEN}`);
    fireEvent.click(await screen.findByTestId("join-claim"));
    expect(await screen.findByTestId("join-claimed_by_other")).toBeTruthy();
    expect(history.at(-1)).toBe(`/join/${TOKEN}`);
  });
});

void React;
