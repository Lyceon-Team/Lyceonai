// @vitest-environment jsdom
/**
 * G4-09 (G-AUD-26): the checkout-return poller stops at its timeout.
 *
 * @spec [Guardian_Closure_Plan G4-09 — "a poller-timeout test"] | @implemented [2026-09-30]
 *
 * The defect: `refetchInterval` was `shouldPoll ? 2000 : false`, and `shouldPoll` was cleared
 * only when `effectiveAccess` came back true. After 60 seconds the screen switched to "taking
 * longer than expected" — and the query went on hitting `/api/billing/status` every two
 * seconds for as long as the tab stayed open. The timeout card was also reached only because
 * those 2-second refetches happened to re-render the component; nothing timed it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingStatusResponseSchema } from "@lyceon/shared/billing-schema";
import {
  CheckoutReturnPoller,
  POLLING_TIMEOUT_MS,
} from "./CheckoutReturnPoller";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...a: unknown[]) => csrfFetchMock(...a),
}));

/** The guardian branch's shape, through the shared schema, before the webhook has landed. */
const PENDING = billingStatusResponseSchema.parse({
  plan: "free",
  stripeStatus: "missing",
  currentPeriodEnd: null,
  stripeSubscriptionId: null,
  effectiveAccess: false,
  hasActiveLink: true,
  needsPaymentUpdate: false,
  lapsed: false,
  hasBillingAccount: true,
  isPaid: false,
  source: "guardian_linked_student",
  managedBy: "self",
  requestId: "req-1",
});

function statusCalls(): number {
  return csrfFetchMock.mock.calls.filter((c) => c[0] === "/api/billing/status")
    .length;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  window.history.replaceState(null, "", "/guardian?checkout=success");
  csrfFetchMock.mockReset();
  csrfFetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => PENDING,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("CheckoutReturnPoller (G4-09)", () => {
  it("stops polling at the timeout and shows the timeout card without waiting on a refetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CheckoutReturnPoller>
          <div data-testid="children" />
        </CheckoutReturnPoller>
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("checkout-processing")).toBeTruthy();
    const whilePolling = statusCalls();
    expect(whilePolling).toBeGreaterThan(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLLING_TIMEOUT_MS);
    });
    expect(screen.getByTestId("checkout-timeout")).toBeTruthy();
    const atTimeout = statusCalls();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // Presence first (it polled), then the absence that is the fix: nothing after the timeout.
    expect(statusCalls()).toBe(atTimeout);
    // The copy names only a control the card actually renders.
    expect(screen.queryByText(/Manage Subscription/i)).toBeNull();
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
  });
});
