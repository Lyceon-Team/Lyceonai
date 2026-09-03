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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManageSubscriptionButton } from "./SubscriptionPaywall";

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/billing-client", () => ({ openBillingPortal: vi.fn() }));

const toastCalls: Array<{ title?: string; description?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (args: { title?: string; description?: string }) => {
      toastCalls.push(args);
    },
  }),
}));

beforeEach(() => {
  toastCalls.length = 0;
  vi.clearAllMocks();
});

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
   * A LAPSED subscription is the one case the paid gate cannot cover: it grants
   * nothing, so `effectiveAccess` is false, and yet a Stripe subscription
   * object exists and the portal can reactivate it.
   *
   * This replaces a `forcePortal` prop whose only caller was the
   * `needsPaymentUpdate` interstitial deleted on 2026-09-03. Keeping the prop
   * would have left an escape hatch with no caller — and an escape hatch nobody
   * calls is the shape every dead branch on this surface started as.
   */
  it("renders for a lapsed subscription, which grants nothing but can be reactivated", () => {
    renderButton({ effectiveAccess: false, isPaid: false, lapsed: true });
    expect(screen.getByTestId("manage-subscription-button")).toBeTruthy();
  });

  /**
   * A guardian whose linked student SELF-PAID holds no Stripe Customer, so the
   * route answers `409 NO_STRIPE_CUSTOMER`. That used to leave the button
   * spinning down in silence: the component had an `onSuccess` handler and no
   * `onError`, so the rejection landed in `mutation.error` and was rendered
   * nowhere. It now goes through `useBillingPortal`, which toasts.
   */
  it("surfaces a portal failure instead of swallowing it", async () => {
    const { openBillingPortal } = await import("@/lib/billing-client");
    vi.mocked(openBillingPortal).mockRejectedValueOnce(
      Object.assign(
        new Error("No billing account exists for this profile yet"),
        {
          status: 409,
          code: "NO_STRIPE_CUSTOMER",
        },
      ),
    );

    renderButton({ effectiveAccess: true, isPaid: true });
    fireEvent.click(screen.getByTestId("manage-subscription-button"));

    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    expect(toastCalls[0]?.description).toContain("no billing account");
  });
});
