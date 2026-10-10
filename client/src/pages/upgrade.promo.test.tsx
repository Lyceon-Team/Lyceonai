// @vitest-environment jsdom
/**
 * @spec [owner brief (Karl) 2026-10-10: "/upgrade?promo=<CODE>": pre-select the Monthly plan;
 *        the code goes to the server, which decides] | @implemented [2026-10-10]
 *
 * plain English: the page reads `promo` from its own URL. A code-shaped value pre-selects
 * Monthly (its card takes the filled action and says the code will be applied if still valid)
 * and is sent with the Monthly checkout only; a mangled value is ignored. Mocks as in
 * upgrade.page.test.tsx.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpgradePage from "./upgrade";
import { practiceQuotaSchema } from "@lyceon/shared/practice-quota";

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

const PLANS = [
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
];

describe("Upgrade page: /upgrade?promo=<CODE>", () => {
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
    getBillingPlansMock.mockResolvedValue(PLANS);
    startSubscriptionCheckoutMock.mockResolvedValue(
      "https://checkout.test/session",
    );
  });

  async function openAt(url: string) {
    window.history.replaceState({}, "", url);
    render(<UpgradePage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId("upgrade-plan-monthly")).toBeTruthy(),
    );
  }

  it("pre-selects Monthly and sends the code with the Monthly checkout", async () => {
    await openAt("/upgrade?promo=FOUNDING50");
    const monthly = screen.getByTestId("upgrade-plan-monthly");
    expect(monthly.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByTestId("upgrade-plan-yearly").getAttribute("data-selected"),
    ).toBeNull();
    expect(screen.getByTestId("upgrade-promo-note").textContent).toContain(
      "FOUNDING50",
    );
    // The pre-selection is visible: Monthly takes the emphasised border that "Best value"
    // (Yearly, from these prices) would otherwise have.
    expect(monthly.className).toContain("border-2");
    expect(screen.getByTestId("upgrade-plan-yearly").className).not.toContain(
      "border-2",
    );

    fireEvent.click(screen.getByTestId("upgrade-choose-monthly"));
    await waitFor(() =>
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("monthly", {
        promo: "FOUNDING50",
      }),
    );
  });

  it("another plan chosen from a promo link goes to checkout without the code", async () => {
    await openAt("/upgrade?promo=FOUNDING50");
    fireEvent.click(screen.getByTestId("upgrade-choose-yearly"));
    await waitFor(() =>
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledTimes(1),
    );
    expect(startSubscriptionCheckoutMock.mock.calls[0]).toEqual(["yearly"]);
  });

  it("a mangled code is ignored: no pre-selection, no note, the normal checkout", async () => {
    await openAt("/upgrade?promo=%3Cscript%3E");
    expect(
      screen.getByTestId("upgrade-plan-monthly").getAttribute("data-selected"),
    ).toBeNull();
    expect(screen.queryByTestId("upgrade-promo-note")).toBeNull();
    fireEvent.click(screen.getByTestId("upgrade-choose-monthly"));
    await waitFor(() =>
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledTimes(1),
    );
    expect(startSubscriptionCheckoutMock.mock.calls[0]).toEqual(["monthly"]);
  });
});
