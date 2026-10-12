// @vitest-environment jsdom
/**
 * Onboarding's "When's your SAT?" offers nothing past the served bound.
 *
 * @spec [owner ruling 2026-10-11 (Karl, on #1204, ruling 2): "the calendar profile read returns
 *       the furthest accepted test date, and every SAT-date picker (onboarding, Settings, Home
 *       card, calendar) uses that one bound. A test proves a date beyond the bound is never
 *       offered anywhere."] | @implemented [2026-10-11]
 *
 * plain English: the REAL onboarding page with a real React Query client; only the network is
 * stubbed (as in profile-complete.marketing-opt-in.test.tsx). A student of 16 opens the picker;
 * the bound arrives from `GET /api/calendar/profile` (`latest_test_date`) and every offered date
 * is on or before it. The sibling suites hold the same for Settings, the Home card and the
 * calendar; SatDatePicker.test.tsx holds it for the picker itself and proves every surface
 * renders that one picker.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileReadResponseSchema } from "@lyceon/shared/calendar";
import { offeredSatDates } from "@/components/sat-dates/sat-date-picker.testing";

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
    apiRequest: vi.fn(async (url: string) => {
      calls.urls.push(url);
      if (url === "/api/calendar/profile") {
        return new Response(
          JSON.stringify({
            ...profileReadResponseSchema.parse({
              profile: null,
              latest_test_date: calls.latest,
            }),
            requestId: "r",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
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
  calls.urls = [];
  moduleClient.clear();
});

describe("onboarding: the SAT-date picker is bounded by the served latest_test_date", () => {
  it("offers dates up to the bound, the bound included, and none after it", async () => {
    render(
      <QueryClientProvider client={moduleClient as QueryClient}>
        <ProfileComplete />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByTestId("input-display-name"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(16) },
    });
    await screen.findByTestId("onboarding-sat-dates-trigger");
    // Nothing is requested until the picker opens.
    expect(calls.urls).not.toContain("/api/calendar/profile");
    offeredSatDates("onboarding-sat-dates");
    await waitFor(() =>
      expect(offeredSatDates("onboarding-sat-dates").length).toBeGreaterThan(0),
    );
    const offered = offeredSatDates("onboarding-sat-dates");
    expect(calls.urls).toContain("/api/calendar/profile");
    expect(offered).toContain(LATEST_TEST_DATE);
    expect(offered.every((d) => d <= LATEST_TEST_DATE)).toBe(true);
    expect(offered).not.toContain("2027-08-28");
  });
});
