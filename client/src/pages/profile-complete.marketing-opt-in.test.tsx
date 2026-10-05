// @vitest-environment jsdom
/**
 * Plan Q5: the onboarding marketing checkbox — shown only to guardians and students 13+, unticked,
 * and never sent when it is not shown.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26 ("own checkbox at signup ... guardians +
 *       students 13+; never under-13"); Doc 10 §9.21 (separate from ToS); owner Step 0 answer 1
 *       (2026-10-05)] | @implemented [2026-10-05]
 *
 * plain English: the REAL page with a real React Query client; only the network is stubbed, as
 * in profile-complete.guardian-signup.test.tsx. The server side of the same rule (an under-13
 * `true` is a 400 and nothing is written) is proved by tests/ci/marketing-consent-routes.pg.ci.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  patchBody: null as Record<string, unknown> | null,
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
            id: "a1111111-1111-4111-8111-111111111112",
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
    apiRequest: vi.fn(async (_url: string, init?: RequestInit) => {
      calls.patchBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          success: true,
          profile: {},
          guardianConsentRequired: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
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
  calls.patchBody = null;
  moduleClient.clear();
});

async function mount(): Promise<void> {
  render(
    <QueryClientProvider client={moduleClient as QueryClient}>
      <ProfileComplete />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByTestId("input-display-name"), {
    target: { value: "Sam" },
  });
}

describe("onboarding marketing checkbox (Q5)", () => {
  it("is shown, unticked, to a student of 15", async () => {
    await mount();
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(15) },
    });
    const box = screen.getByTestId("checkbox-marketing-opt-in");
    expect(box.getAttribute("data-state")).toBe("unchecked");
    expect(
      screen.getByText("Send me optional product updates and study news."),
    ).toBeTruthy();
  });

  it("is hidden for an under-13 student, and the PATCH does not carry the field", async () => {
    await mount();
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(15) },
    });
    // Ticked while 15 ...
    fireEvent.click(screen.getByTestId("checkbox-marketing-opt-in"));
    // ... then the date of birth is corrected to an under-13 one.
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(10) },
    });
    expect(screen.queryByTestId("checkbox-marketing-opt-in")).toBeNull();
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    await waitFor(() => expect(calls.patchBody).not.toBeNull());
    expect(calls.patchBody).not.toHaveProperty("marketingOptIn");
  });

  it("a tick at 13+ is sent as marketingOptIn: true", async () => {
    await mount();
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: yearsAgo(16) },
    });
    fireEvent.click(screen.getByTestId("checkbox-marketing-opt-in"));
    fireEvent.click(screen.getByTestId("button-complete-profile"));
    await waitFor(() => expect(calls.patchBody).not.toBeNull());
    expect(calls.patchBody).toMatchObject({ marketingOptIn: true });
  });
});
