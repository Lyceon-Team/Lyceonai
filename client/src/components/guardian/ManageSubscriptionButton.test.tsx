// @vitest-environment jsdom
/**
 * @spec [Doc-01_V8 §31.4] | @implemented [2026-09-02]
 *
 * plain English: the Stripe Customer Portal MANAGES an existing subscription
 * and cannot create one, so the control that opens it must not appear to a
 * guardian who has nothing to manage.
 *
 * THE OBSERVED FAILURE THIS PINS. Guardian `c6d3fc60` clicked "Manage
 * Subscription" on `/guardian` and landed on a portal reading "No payment
 * method / No invoice history". The portal was right; the question was wrong.
 * The button took no props, queried nothing, and rendered for every guardian
 * who could load the page.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManageSubscriptionButton } from "./SubscriptionPaywall";

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

function renderButton(props: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManageSubscriptionButton {...props} />
    </QueryClientProvider>,
  );
}

describe("ManageSubscriptionButton", () => {
  it("renders when there is a paid, active subscription to manage", () => {
    renderButton({ effectiveAccess: true, isPaid: true });
    expect(screen.getByTestId("manage-subscription-button")).toBeTruthy();
  });

  it("does NOT render for a guardian with access but nothing paid", () => {
    const { container } = renderButton({
      effectiveAccess: true,
      isPaid: false,
    });
    expect(container.firstChild).toBeNull();
  });

  it("does NOT render for a guardian with no access", () => {
    const { container } = renderButton({
      effectiveAccess: false,
      isPaid: false,
    });
    expect(container.firstChild).toBeNull();
  });

  /**
   * While `/api/billing/status` is in flight both props are `undefined`. A
   * control that appears and then vanishes is worse than one that arrives a
   * beat late, so the undefined case stays hidden.
   */
  it("does NOT render while the billing status is still unknown", () => {
    const { container } = renderButton({});
    expect(container.firstChild).toBeNull();
  });

  /**
   * The payment-update card is the one place the portal is unambiguously
   * right: `needsPaymentUpdate` means a subscription EXISTS and is failing,
   * which is exactly what the portal fixes — even though `effectiveAccess` is
   * false while it fails.
   */
  it("renders under forcePortal, which is the failed-payment remedy", () => {
    renderButton({
      effectiveAccess: false,
      isPaid: false,
      forcePortal: true,
      label: "Update Payment Method",
    });
    expect(screen.getByText("Update Payment Method")).toBeTruthy();
  });
});
