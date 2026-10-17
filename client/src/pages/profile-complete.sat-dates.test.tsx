// @vitest-environment jsdom
/**
 * Onboarding's "When's your SAT?" for a guardian-intent account that switches to Student: the
 * dates are offered, bounded by the served bound.
 *
 * @spec [owner rulings (Karl): 2026-10-11 on #1204 ruling 2 ("A test proves a date beyond the
 *       bound is never offered anywhere"); 2026-10-12 on #1211 ("don't accept the error row for
 *       guardian-intent → Student switches … any signed-in account (including one whose role
 *       isn't saved yet) can read latest_test_date … Test: a guardian-intent account that
 *       switches to Student at onboarding sees the dates (no error row)")]
 * | @implemented [2026-10-12]
 *
 * plain English: the REAL onboarding page with a real React Query client; only the network is
 * stubbed, and it answers as the server does for this account: its stored role is still
 * `guardian` (the switch is saved by onboarding's own submit), so the student-only
 * `GET /api/calendar/profile` is 403, while the role-agnostic `GET /api/sat-dates/bound` serves
 * the bound. The page opens on Guardian (the stored role); the person switches to Student, gives
 * a 16-year-old's date of birth and opens the picker: the dates are there, none past the bound,
 * no error row, and no calendar route was asked.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { satDateBoundResponseSchema } from "@lyceon/shared/calendar";
import { waitForSatDates } from "@/components/sat-dates/sat-date-picker.testing";

// The served bound; hoisted so the network stub below serves the same value the test asserts.
const calls = vi.hoisted(() => ({
  urls: [] as string[],
  latest: "2027-06-05",
}));
const LATEST_TEST_DATE = calls.latest;

vi.mock("wouter", () => ({
  useLocation: () => ["/profile/complete", vi.fn()],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ refreshUser: vi.fn(async () => undefined) }),
}));
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "a1111111-1111-4111-8111-111111111113",
            // Guardian-intent: the stored role until onboarding's submit saves the switch.
            role: "guardian",
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
    apiRequest: vi.fn(async (url: string) => {
      calls.urls.push(url);
      if (url === "/api/sat-dates/bound") {
        return new Response(
          JSON.stringify({
            ...satDateBoundResponseSchema.parse({
              latest_test_date: calls.latest,
            }),
            requestId: "r",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/calendar")) {
        // As `requireStudentOrAdmin` answers a stored guardian.
        return new Response(
          JSON.stringify({ error: "Student access required", requestId: "r" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 500,
      });
    }),
  };
});

import ProfileComplete from "./profile-complete";
import { queryClient as moduleClient } from "@/lib/queryClient";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  // jsdom lacks these; the Radix role select calls them (as in the guardian first-load test).
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  calls.urls = [];
  moduleClient.clear();
});

describe("onboarding: a guardian-intent account that switches to Student sees the dates", () => {
  it("offers dates up to the served bound, none after it, with no error row and no calendar request", async () => {
    render(
      <QueryClientProvider client={moduleClient as QueryClient}>
        <ProfileComplete />
      </QueryClientProvider>,
    );
    // The page opens on the stored role: Guardian, so no SAT question yet.
    const trigger = await screen.findByTestId("select-role");
    await waitFor(() => expect(trigger.textContent).toContain("Guardian"));
    expect(screen.queryByTestId("onboarding-sat-dates-trigger")).toBeNull();

    // The switch to Student, as a person makes it.
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Student" }));
    fireEvent.change(screen.getByTestId("input-display-name"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(16) },
    });
    await screen.findByTestId("onboarding-sat-dates-trigger");

    const offered = await waitForSatDates("onboarding-sat-dates");
    expect(screen.queryByTestId("onboarding-sat-dates-dates-error")).toBeNull();
    expect(offered).toContain(LATEST_TEST_DATE);
    expect(offered.every((d) => d <= LATEST_TEST_DATE)).toBe(true);
    expect(offered).not.toContain("2027-08-28");
    expect(calls.urls).toContain("/api/sat-dates/bound");
    expect(calls.urls.filter((u) => u.startsWith("/api/calendar"))).toEqual([]);
  });
});

/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: "Date of birth starts
 *       empty"; Doc-01_V8 §37.1 (under-13 gating)] | @implemented [2026-10-13]
 * plain English: the field opens empty (it used to hold today − 13 years). Nothing that depends on
 * the age shows until a date is entered: no age line, no under-13 notice, no SAT question. A
 * 12-year-old's date shows the guardian notice and still no SAT question; a 16-year-old's shows the
 * SAT question. Submitting with no date asks for one and sends nothing.
 */
describe("first-run P1: the date of birth starts empty", () => {
  async function asStudent(): Promise<void> {
    render(
      <QueryClientProvider client={moduleClient as QueryClient}>
        <ProfileComplete />
      </QueryClientProvider>,
    );
    const trigger = await screen.findByTestId("select-role");
    await waitFor(() => expect(trigger.textContent).toContain("Guardian"));
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Student" }));
    fireEvent.change(screen.getByTestId("input-display-name"), {
      target: { value: "Sam" },
    });
  }

  it("opens empty; the SAT question appears only once a 13+ date is entered", async () => {
    await asStudent();
    const dob = screen.getByTestId("input-date-of-birth") as HTMLInputElement;
    expect(dob.value).toBe("");
    expect(screen.queryByText(/Age detected/)).toBeNull();
    expect(screen.queryByTestId("text-under-13-next-step")).toBeNull();
    expect(screen.queryByTestId("onboarding-sat-dates-trigger")).toBeNull();

    fireEvent.change(dob, { target: { value: yearsAgo(12) } });
    expect(await screen.findByTestId("text-under-13-next-step")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-sat-dates-trigger")).toBeNull();

    fireEvent.change(dob, { target: { value: yearsAgo(16) } });
    expect(
      await screen.findByTestId("onboarding-sat-dates-trigger"),
    ).toBeTruthy();
    expect(screen.queryByTestId("text-under-13-next-step")).toBeNull();
  });

  it("submitting with no date asks for one and sends nothing", async () => {
    await asStudent();
    const dob = screen.getByTestId("input-date-of-birth") as HTMLInputElement;
    // The field is required: the browser asks for it before the form submits.
    expect(dob.required).toBe(true);
    expect(dob.validity.valueMissing).toBe(true);
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    // A submit that gets past the browser meets the page's own check.
    fireEvent.submit(dob.form as HTMLFormElement);
    expect(
      await screen.findByText("Please enter your date of birth to continue."),
    ).toBeTruthy();
    expect(calls.urls.filter((u) => u.startsWith("/api/profile"))).toEqual([]);
  });
});
