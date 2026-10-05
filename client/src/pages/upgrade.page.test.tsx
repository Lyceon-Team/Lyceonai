// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpgradePage from "./upgrade";

const getBillingPlansMock = vi.fn();
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
});
