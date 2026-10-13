// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpgradePage from "./upgrade";
import { practiceQuotaSchema } from "@lyceon/shared/practice-quota";
import { PLAN_PAID_ADDS, planFreeIncludes } from "@/lib/plan-copy";
import { helpFaqs } from "./help";

const getBillingPlansMock = vi.fn();

/**
 * OQ-68 (d), UI-64: the free sentence's daily number is `GET /api/practice/quota`'s
 * `freeDailyLimit`. The fixture serves 37, not the seeded 40, so a literal cannot pass.
 */
const FREE_DAILY_LIMIT = 37;
const quotaNet = vi.hoisted(() => ({
  log: [] as string[],
  status: 200,
  body: null as unknown,
}));

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string): Promise<Response> => {
    quotaNet.log.push(url);
    if (url.split("?")[0] !== "/api/practice/quota") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(quotaNet.body), {
      status: quotaNet.status,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "00000000-0000-4000-8000-000000000164", role: "student" },
    authLoading: false,
  }),
}));
const startSubscriptionCheckoutMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/billing-client", () => ({
  getBillingPlans: (...args: unknown[]) => getBillingPlansMock(...args),
  startSubscriptionCheckout: (...args: unknown[]) =>
    startSubscriptionCheckoutMock(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("Upgrade page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotaNet.log = [];
    quotaNet.status = 200;
    quotaNet.body = practiceQuotaSchema.parse({
      unlimited: false,
      limit: FREE_DAILY_LIMIT,
      remaining: FREE_DAILY_LIMIT,
      resetAt: "2026-10-09T05:00:00.000Z",
      freeDailyLimit: FREE_DAILY_LIMIT,
    });
    startSubscriptionCheckoutMock.mockResolvedValue(
      "https://checkout.test/session",
    );
  });

  it("renders monthly, quarterly, and yearly plan cards", async () => {
    getBillingPlansMock.mockResolvedValueOnce([
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 9999,
        currency: "usd",
        intervalLabel: "per month",
        interval: "month",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
      {
        plan: "quarterly",
        label: "Quarterly",
        amountCents: 19999,
        currency: "usd",
        intervalLabel: "per 3 months",
        interval: "month",
        intervalCount: 3,
        stripePriceIdConfigured: true,
      },
      {
        plan: "yearly",
        label: "Yearly",
        amountCents: 69999,
        currency: "usd",
        intervalLabel: "per year",
        interval: "year",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ]);

    render(<UpgradePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-plan-monthly")).toBeTruthy();
      expect(screen.getByTestId("upgrade-plan-quarterly")).toBeTruthy();
      expect(screen.getByTestId("upgrade-plan-yearly")).toBeTruthy();
    });
  });

  it("sends selected plan when user chooses a plan", async () => {
    getBillingPlansMock.mockResolvedValueOnce([
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 9999,
        currency: "usd",
        intervalLabel: "per month",
        interval: "month",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
      {
        plan: "quarterly",
        label: "Quarterly",
        amountCents: 19999,
        currency: "usd",
        intervalLabel: "per 3 months",
        interval: "month",
        intervalCount: 3,
        stripePriceIdConfigured: true,
      },
      {
        plan: "yearly",
        label: "Yearly",
        amountCents: 69999,
        currency: "usd",
        intervalLabel: "per year",
        interval: "year",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ]);

    render(<UpgradePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-choose-monthly")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("upgrade-choose-monthly"));
    fireEvent.click(screen.getByTestId("upgrade-choose-quarterly"));
    fireEvent.click(screen.getByTestId("upgrade-choose-yearly"));

    await waitFor(() => {
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("monthly");
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("quarterly");
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("yearly");
    });
  });

  /**
   * UI-58 (UI-41 note: the in-body back link was interim duplication of the shell; DESIGN.md §1
   * one filled action). Presence first: the three cards are on screen.
   */
  it("UI-58: no in-body back link, and one filled action (the best-value plan)", async () => {
    getBillingPlansMock.mockResolvedValueOnce([
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 9999,
        currency: "usd",
        intervalLabel: "per month",
        interval: "month",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
      {
        plan: "yearly",
        label: "Yearly",
        amountCents: 69999,
        currency: "usd",
        intervalLabel: "per year",
        interval: "year",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ]);
    render(<UpgradePage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("upgrade-plan-yearly")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Choose Your Lyceon Plan",
    );
    expect(screen.queryByText("Back to Dashboard")).toBeNull();
    expect(document.querySelector('a[href="/dashboard"]')).toBeNull();
    const filled = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).filter((b) => b.className.includes("bg-lyc-primary-bg"));
    expect(filled.map((b) => b.getAttribute("data-testid"))).toEqual([
      "upgrade-choose-yearly",
    ]);
  });

  /**
   * OQ-59 (h) (owner ruling 2026-10-05): the plan copy is the Help FAQ's approved free/paid
   * wording, and the projection reads as FREE. Presence first: the cards are on screen and the
   * two sentences render; then the shipped wording that listed the projection as paid is gone.
   */
  it("OQ-59 (h): the Help FAQ's free/paid sentences, and no 'projection access' as a paid feature", async () => {
    getBillingPlansMock.mockResolvedValueOnce([
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 9999,
        currency: "usd",
        intervalLabel: "per month",
        interval: "month",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ]);
    render(<UpgradePage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("upgrade-plan-monthly")).toBeTruthy();
    });
    // The two sentences ARE the FAQ answer (one source, so they cannot drift).
    expect(helpFaqs(FREE_DAILY_LIMIT)[0]?.a).toBe(
      `${planFreeIncludes(FREE_DAILY_LIMIT)} ${PLAN_PAID_ADDS}`,
    );
    expect(screen.getByTestId("page-header-description").textContent).toBe(
      PLAN_PAID_ADDS,
    );
    // OQ-68 (d), UI-64: the served daily limit, once the quota read has answered.
    await waitFor(() =>
      expect(screen.getByTestId("upgrade-free-includes").textContent).toBe(
        planFreeIncludes(FREE_DAILY_LIMIT),
      ),
    );
    const free = screen.getByTestId("upgrade-free-includes").textContent ?? "";
    expect(free).toContain("37 practice questions a day");
    expect(free).not.toMatch(/\b40\b|forty/i);
    expect(free).toContain("your projected score");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/projection access/i);
    expect(text).not.toMatch(/Full KPI/i);
    expect(text).not.toMatch(/full-test analytics/i);
    expect(text).not.toMatch(/One secure checkout flow/i);
  });
});
