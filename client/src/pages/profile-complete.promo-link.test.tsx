// @vitest-environment jsdom
/**
 * The last leg of the promo link: finishing onboarding goes on to `/upgrade?promo=ALPHA`.
 *
 * @spec [owner brief "Follow-up to #1188" (Karl, 2026-10-11) item 2: "email sign-up from
 *       /upgrade?promo=ALPHA returns to that link after confirmation and onboarding"; AS-3 landing
 *       matrix; register UI-03] | @implemented [2026-10-11]
 *
 * plain English: the REAL onboarding page, with only the network stubbed (as in
 * profile-complete.marketing-opt-in.test.tsx). The confirmation link lands a new student on
 * `/profile/complete?next=/upgrade?promo=ALPHA` (tests/ci/oauth-callback.contract.test.ts); here
 * the student completes the form and the page navigates to the link, query intact. An unsafe
 * `next` is still dropped for the role default.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("wouter", () => ({
  useLocation: () => [
    "/profile/complete",
    (to: string) => {
      nav.to.push(to);
    },
  ],
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
    apiRequest: vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            profile: { role: "student" },
            guardianConsentRequired: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  };
});

import ProfileComplete from "./profile-complete";
import { queryClient as moduleClient } from "@/lib/queryClient";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function completeOnboardingFrom(url: string): Promise<void> {
  window.history.replaceState({}, "", url);
  render(
    <QueryClientProvider client={moduleClient as QueryClient}>
      <ProfileComplete />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByTestId("input-display-name"), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByTestId("input-date-of-birth"), {
    target: { value: yearsAgo(16) },
  });
  fireEvent.click(screen.getByTestId("button-complete-profile"));
  await waitFor(() => expect(nav.to).toHaveLength(1));
}

beforeEach(() => {
  nav.to.length = 0;
  moduleClient.clear();
});

describe("onboarding hands a new student on to the promo link", () => {
  it("completing the profile navigates to /upgrade?promo=ALPHA, query intact", async () => {
    await completeOnboardingFrom(
      "/profile/complete?next=%2Fupgrade%3Fpromo%3DALPHA",
    );
    expect(nav.to).toEqual(["/upgrade?promo=ALPHA"]);
  });

  it("an unsafe next is still dropped for the role default", async () => {
    await completeOnboardingFrom(
      "/profile/complete?next=https%3A%2F%2Fevil.example%2Fupgrade%3Fpromo%3DALPHA",
    );
    expect(nav.to).toEqual(["/dashboard"]);
  });
});
