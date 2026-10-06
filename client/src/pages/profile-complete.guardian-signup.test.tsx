// @vitest-environment jsdom
/**
 * G1-02 — a parent completes their profile as a guardian and reaches /guardian.
 *
 * @spec [Guardian_Closure_Plan G1-02; owner rulings R1, R10] | @implemented [2026-09-29]
 *
 * plain English: renders the REAL profile-completion page with a real React Query client.
 * The network is the only thing stubbed (`apiRequest`), and the responses are the SHAPES the
 * real PATCH handler sends (tests/ci/guardian-signup.pg.ci.test.ts proves the server side).
 * What it proves:
 *   1. choosing Guardian shows the date-of-birth field and sends it (R10);
 *   2. on success the auth context is REFRESHED before navigating, so /guardian sees
 *      role='guardian' — without it the dashboard's `isGuardian` gate still read the
 *      pre-completion 'student' and bounced the new guardian to /dashboard;
 *   3. a coded 403 shows the SERVER's message, not "We couldn't save your profile".
 */
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError } from "@/lib/api-error";

const calls = vi.hoisted(() => ({
  order: [] as string[],
  patchBody: null as Record<string, unknown> | null,
  patchResult: null as null | (() => Promise<Response>),
}));

const navigateMock = vi.hoisted(() =>
  vi.fn((to: string) => {
    calls.order.push(`navigate:${to}`);
  }),
);
const refreshUserMock = vi.hoisted(() =>
  vi.fn(async () => {
    calls.order.push("refreshUser");
  }),
);

vi.mock("wouter", () => ({
  useLocation: () => ["/profile/complete", navigateMock],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ refreshUser: refreshUserMock }),
}));
// GET /api/profile — a fresh account: a student row with nothing completed, as the
// handle_new_user trigger leaves it.
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "a1111111-1111-4111-8111-111111111111",
            role: "student",
            display_name: null,
            requiredProfileComplete: false,
            profileCompletedAt: null,
            guardianConsentRequired: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  const qc = new QC({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient: qc,
    apiRequest: vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH")
        throw new Error(`unexpected apiRequest ${url}`);
      calls.patchBody = JSON.parse(String(init.body)) as Record<
        string,
        unknown
      >;
      if (!calls.patchResult) throw new Error("no PATCH result configured");
      return calls.patchResult();
    }),
  };
});

import ProfileComplete from "./profile-complete";
import { queryClient as moduleClient } from "@/lib/queryClient";

// Radix Select needs these in jsdom.
beforeEach(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  calls.order = [];
  calls.patchBody = null;
  calls.patchResult = null;
  navigateMock.mockClear();
  refreshUserMock.mockClear();
  moduleClient.clear();
});

async function renderAndChooseGuardian(): Promise<void> {
  render(
    <QueryClientProvider client={moduleClient as QueryClient}>
      <ProfileComplete />
    </QueryClientProvider>,
  );
  const trigger = await screen.findByTestId("select-role");
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Guardian" }));
  fireEvent.change(screen.getByTestId("input-display-name"), {
    target: { value: "Pat Parent" },
  });
  fireEvent.change(screen.getByTestId("input-date-of-birth"), {
    target: { value: "1980-05-01" },
  });
}

describe("G1-02 guardian sign-up on /profile/complete", () => {
  it("sends the guardian's date of birth, refreshes the session role, THEN goes to /guardian", async () => {
    calls.patchResult = async () =>
      new Response(
        JSON.stringify({
          success: true,
          profile: {
            role: "guardian",
            profileCompletedAt: "2026-09-29T00:00:00Z",
          },
          guardianConsentRequired: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    await renderAndChooseGuardian();
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-complete-profile"));
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/guardian"));
    expect(calls.patchBody).toMatchObject({
      role: "guardian",
      dateOfBirth: "1980-05-01",
    });
    expect(calls.order).toEqual(["refreshUser", "navigate:/guardian"]);
  });

  it("a coded 403 shows the server's own message", async () => {
    const message = "Guardian accounts are for adults 18 or older.";
    calls.patchResult = async () => {
      throw new HttpApiError({
        status: 403,
        code: "GUARDIAN_UNDER_18",
        message,
      });
    };

    await renderAndChooseGuardian();
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-complete-profile"));
    });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't save your profile/i)).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

/**
 * F13 (owner ruling 2026-10-05, Step 0 decision 4): the homepage's "I'm a parent or guardian"
 * button signs up with `next=/guardian`, which makes Guardian the form's DEFAULT role. A default
 * only: the visitor can still pick Student, and whatever is submitted is what the server judges.
 */
describe("F13 guardian intent from the homepage", () => {
  function renderAt(search: string): void {
    window.history.replaceState(null, "", `/profile/complete${search}`);
    render(
      <QueryClientProvider client={moduleClient as QueryClient}>
        <ProfileComplete />
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("without the intent, the form defaults to Student (presence of the control first)", async () => {
    renderAt("");
    const trigger = await screen.findByTestId("select-role");
    expect(trigger.textContent).toContain("Student");
  });

  it("with next=/guardian, the form defaults to Guardian", async () => {
    renderAt(`?next=${encodeURIComponent("/guardian")}`);
    const trigger = await screen.findByTestId("select-role");
    await waitFor(() => expect(trigger.textContent).toContain("Guardian"));
  });

  it("the default can be changed: choosing Student submits role student", async () => {
    calls.patchResult = async () =>
      new Response(
        JSON.stringify({
          success: true,
          profile: {
            role: "student",
            profileCompletedAt: "2026-10-05T00:00:00Z",
          },
          guardianConsentRequired: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    renderAt(`?next=${encodeURIComponent("/guardian")}`);
    const trigger = await screen.findByTestId("select-role");
    await waitFor(() => expect(trigger.textContent).toContain("Guardian"));
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Student" }));
    fireEvent.change(screen.getByTestId("input-display-name"), {
      target: { value: "Sam Student" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-complete-profile"));
    });
    await waitFor(() => expect(calls.patchBody).not.toBeNull());
    expect(calls.patchBody).toMatchObject({ role: "student" });
  });

  it("a student-only return path does not make Guardian the default", async () => {
    renderAt(`?next=${encodeURIComponent("/dashboard")}`);
    const trigger = await screen.findByTestId("select-role");
    expect(trigger.textContent).toContain("Student");
  });
});
