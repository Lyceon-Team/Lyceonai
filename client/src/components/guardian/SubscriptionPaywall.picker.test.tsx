// @vitest-environment jsdom
/**
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for linked student;
 *        §36.4 per-student granularity; Charter §6] | @implemented [2026-08-31]
 *
 * plain English: the guardian picks WHICH linked student a subscription is for.
 * These assert both halves — what is rendered, and what is actually sent to the
 * billing client. Edge cases covered: no links at all, and no selection made.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPaywall } from "./SubscriptionPaywall";

const csrfFetchMock = vi.fn();
const startSubscriptionCheckoutMock = vi.fn();
const getBillingPlansMock = vi.fn();

vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

vi.mock("@/lib/billing-client", () => ({
  getBillingPlans: (...args: unknown[]) => getBillingPlansMock(...args),
  startSubscriptionCheckout: (...args: unknown[]) =>
    startSubscriptionCheckoutMock(...args),
}));

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_B = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Not entitled, so the paywall (and therefore the picker) renders. */
const UNPAID_STATUS = {
  accountId: null,
  plan: "free",
  stripeStatus: "inactive",
  currentPeriodEnd: null,
  stripeSubscriptionId: null,
  effectiveAccess: false,
  needsPaymentUpdate: false,
  isPaid: false,
};

function routeFetch(students: unknown[]) {
  csrfFetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/guardian/students")) {
      return Promise.resolve(jsonResponse({ students }));
    }
    return Promise.resolve(jsonResponse(UNPAID_STATUS));
  });
}

function renderPaywall() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionPaywall>
        <div>protected</div>
      </SubscriptionPaywall>
    </QueryClientProvider>,
  );
}

describe("guardian student picker on the checkout surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBillingPlansMock.mockResolvedValue([
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 9999,
        currency: "usd",
        intervalLabel: "per month",
        stripePriceIdConfigured: true,
      },
    ]);
    startSubscriptionCheckoutMock.mockResolvedValue({
      kind: "checkout_session",
      url: "https://checkout.test/s",
      sessionId: "cs_1",
    });
  });

  it("lists the guardian's linked students by name, exactly as the server returned them", async () => {
    routeFetch([
      { id: STUDENT_A, email: "a@test.com", display_name: "Ada", created_at: "2026-01-01" },
      { id: STUDENT_B, email: "b@test.com", display_name: null, created_at: "2026-02-01" },
    ]);

    renderPaywall();

    const select = await screen.findByTestId("student-select");
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).textContent,
    );
    // Ada by display_name; the unnamed student falls back to email. Both are
    // present — the client renders what it is given and filters nothing.
    expect(options).toEqual(["Select a student...", "Ada", "b@test.com"]);
  });

  it("does NOT send a request until a student is chosen", async () => {
    routeFetch([
      { id: STUDENT_A, email: "a@test.com", display_name: "Ada", created_at: "2026-01-01" },
    ]);

    renderPaywall();
    await screen.findByTestId("student-select");

    // Choose a plan but no student.
    fireEvent.click(await screen.findByText(/Monthly/i));

    const subscribe = screen.getByRole("button", { name: /Subscribe Now/i });
    expect(subscribe).toBeDisabled();

    fireEvent.click(subscribe);
    // The state half: nothing was sent, so the server never answers 400.
    expect(startSubscriptionCheckoutMock).not.toHaveBeenCalled();
  });

  it("passes the SELECTED student id into the checkout call", async () => {
    routeFetch([
      { id: STUDENT_A, email: "a@test.com", display_name: "Ada", created_at: "2026-01-01" },
      { id: STUDENT_B, email: "b@test.com", display_name: "Bo", created_at: "2026-02-01" },
    ]);

    renderPaywall();

    const select = await screen.findByTestId("student-select");
    fireEvent.change(select, { target: { value: STUDENT_B } });
    fireEvent.click(await screen.findByText(/Monthly/i));

    const subscribe = screen.getByRole("button", { name: /Subscribe Now/i });
    await waitFor(() => expect(subscribe).not.toBeDisabled());
    fireEvent.click(subscribe);

    await waitFor(() =>
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("monthly", {
        studentProfileId: STUDENT_B,
      }),
    );
  });

  it("explains the zero-link case instead of showing an empty dropdown", async () => {
    routeFetch([]);

    renderPaywall();

    expect(await screen.findByText(/No linked students yet/i)).toBeTruthy();
    expect(screen.queryByTestId("student-select")).toBeNull();
  });
});
