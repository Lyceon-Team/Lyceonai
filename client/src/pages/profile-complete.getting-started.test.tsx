// @vitest-environment jsdom
/**
 * Onboarding's SAT question also asks for the target score, and records "Not sure yet" for
 * whichever of the two the student leaves empty.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §1 ("the step that asks for the SAT date also asks for the
 *       target score … 'Not sure yet' for the date and for the score is recorded"); rulings
 *       2026-10-13: 2 ("the full 400–1600 list, with 'Not sure yet' first")]
 * | @implemented [2026-10-13]
 *
 * plain English: the REAL onboarding page with a real React Query client; only the network is
 * stubbed (as in profile-complete.sat-dates.test.tsx). After the profile PATCH, the page saves
 * the date and score through the one study-profile write (PUT /api/calendar/profile) and sends
 * "Not sure yet" (POST /api/home/getting-started/not-sure) only for a field left empty.
 *   O1 the score picker is shown with "Not sure yet" first, then 1600 … 400
 *   O2 date + score: one PUT carrying both, no not-sure call
 *   O3 both empty: no PUT; not-sure for both
 *   O4 date only: a PUT with the date and no score; not-sure for the score only
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  profileUpsertResponseSchema,
  satDateBoundResponseSchema,
} from "@lyceon/shared/calendar";
import {
  closeSatDates,
  toggleSatDate,
  waitForSatDates,
} from "@/components/sat-dates/sat-date-picker.testing";

const net = vi.hoisted(() => ({
  log: [] as { method: string; url: string; body: unknown }[],
  latest: "2027-06-05",
}));

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
            id: "a1111111-1111-4111-8111-111111111114",
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  const qc = new QC({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient: qc,
    apiRequest: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      net.log.push({ method, url, body });
      if (url === "/api/sat-dates/bound") {
        return json({
          ...satDateBoundResponseSchema.parse({
            latest_test_date: net.latest,
          }),
          requestId: "r",
        });
      }
      if (url === "/api/profile") {
        return json({
          success: true,
          profile: {},
          guardianConsentRequired: false,
        });
      }
      if (url === "/api/calendar/profile" && method === "PUT") {
        const goal = body as {
          target_exam_dates?: string[];
          target_score?: number;
        };
        const dates = goal.target_exam_dates ?? [];
        return json({
          ...profileUpsertResponseSchema.parse({
            profile: {
              timezone: "America/Chicago",
              target_exam_date: dates[0] ?? null,
              target_exam_dates: dates,
              target_score: goal.target_score ?? null,
              study_days_mask: null,
              daily_minutes: null,
              full_length_weekday: null,
              full_length_interval_weeks: null,
              planner_mode: "auto",
              setup_completed_at: null,
            },
          }),
          requestId: "r",
        });
      }
      if (url.startsWith("/api/home/getting-started")) {
        const { deriveGettingStarted } =
          await import("@lyceon/shared/getting-started-schema");
        return json({
          data: deriveGettingStarted(
            {
              email_eligible: true,
              test_date_done: true,
              qotd_done: false,
              email_done: false,
              email_skipped: false,
              blind_spots_done: false,
              review_done: false,
              calendar_done: false,
              lisa_done: false,
              guardian_done: false,
              dismissed: false,
            },
            { plan: "free", lisaAvailable: true },
          ),
        });
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

const NOT_SURE_URL = "/api/home/getting-started/not-sure";

function sent(method: string, url: string): unknown[] {
  return net.log
    .filter((c) => c.method === method && c.url === url)
    .map((c) => c.body);
}

beforeEach(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  net.log.length = 0;
  moduleClient.clear();
});

async function mountAsStudentOf16(): Promise<void> {
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
}

function chooseScore(score: number): void {
  fireEvent.change(screen.getByTestId("onboarding-target-score-select"), {
    target: { value: String(score) },
  });
}

async function submitAndSettle(): Promise<void> {
  fireEvent.click(screen.getByTestId("button-complete-profile"));
  await waitFor(() =>
    expect(
      net.log.some((c) => c.method === "PATCH" && c.url === "/api/profile"),
    ).toBe(true),
  );
  // The date/score saves run inside the same mutation, after the PATCH: settled = all sent.
  await waitFor(() => expect(moduleClient.isMutating()).toBe(0));
}

describe("onboarding: the SAT question also asks for the target score (final brief v2 §1)", () => {
  it("O1: the score picker is shown, 'Not sure yet' first, then 1600 down to 400", async () => {
    await mountAsStudentOf16();
    const select = screen.getByTestId(
      "onboarding-target-score-select",
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toBe("Not sure yet");
    expect(labels[1]).toBe("1600");
    expect(labels[labels.length - 1]).toBe("400");
    expect(labels).toHaveLength(1 + (1600 - 400) / 10 + 1);
    expect(select.value).toBe("");
  });

  it("O2: a date and a score are one PUT carrying both, and no 'Not sure yet' is sent", async () => {
    await mountAsStudentOf16();
    await waitForSatDates("onboarding-sat-dates");
    toggleSatDate("onboarding-sat-dates", net.latest);
    closeSatDates("onboarding-sat-dates");
    chooseScore(1450);
    await submitAndSettle();
    expect(sent("PUT", "/api/calendar/profile")).toHaveLength(1);
    expect(sent("PUT", "/api/calendar/profile")[0]).toMatchObject({
      target_exam_dates: [net.latest],
      target_score: 1450,
    });
    expect(sent("POST", NOT_SURE_URL)).toEqual([]);
  });

  it("O3: both left at 'Not sure yet' — no study-profile write; 'Not sure yet' for both", async () => {
    await mountAsStudentOf16();
    await submitAndSettle();
    expect(sent("POST", NOT_SURE_URL)).toHaveLength(1);
    expect(sent("POST", NOT_SURE_URL)[0]).toEqual({
      test_date: true,
      target_score: true,
    });
    expect(sent("PUT", "/api/calendar/profile")).toEqual([]);
  });

  it("O4: a date only — the PUT carries the date and no score; 'Not sure yet' for the score only", async () => {
    await mountAsStudentOf16();
    await waitForSatDates("onboarding-sat-dates");
    toggleSatDate("onboarding-sat-dates", net.latest);
    closeSatDates("onboarding-sat-dates");
    await submitAndSettle();
    expect(sent("POST", NOT_SURE_URL)).toHaveLength(1);
    expect(sent("POST", NOT_SURE_URL)[0]).toEqual({ target_score: true });
    const puts = sent("PUT", "/api/calendar/profile");
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ target_exam_dates: [net.latest] });
    expect(puts[0]).not.toHaveProperty("target_score");
  });
});
