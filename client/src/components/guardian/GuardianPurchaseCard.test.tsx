// @vitest-environment jsdom
/**
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for a linked student;
 *        §36.4 per-student granularity; Charter §6] | @implemented [2026-09-02]
 *
 * plain English: the guardian picks WHICH linked student a subscription is for,
 * from a card that is present precisely when some linked student is unpaid.
 * These assert what renders and what is actually sent to the billing client.
 *
 * THE CASE THAT MATTERS IS THE FIRST ONE. The defect this replaces was not that
 * the picker was wrong; it was that the picker was gated on the guardian's own
 * access and therefore vanished exactly when a second student needed paying
 * for. So the load-bearing test renders this card for a guardian whose
 * `effectiveAccess` is TRUE — the state that hid it — and asserts it is there.
 * Restoring the old gate makes that test fail, which is the point of writing it
 * this way rather than testing the picker in isolation.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardianPurchaseCard } from "./GuardianPurchaseCard";
import type { LinkedStudent } from "@/hooks/useGuardianStudents";
import { makeLinkedStudent } from "../../../../packages/shared/src/__fixtures__/linked-student";

const startSubscriptionCheckoutMock = vi.fn();
const getBillingPlansMock = vi.fn();

vi.mock("@/lib/billing-client", () => ({
  getBillingPlans: (...args: unknown[]) => getBillingPlansMock(...args),
  startSubscriptionCheckout: (...args: unknown[]) =>
    startSubscriptionCheckoutMock(...args),
}));

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_B = "22222222-2222-4222-8222-222222222222";

/**
 * Rows come from the shared factory, which parses them through
 * `linkedStudentSchema` — the contract `guardian-student-schema.test.ts` proves
 * against real Postgres columns. Naming the columns here instead would be a
 * private copy of the schema, which is what the guardian schema-truth gate's
 * RULE B exists to refuse.
 */
function student(
  id: string,
  name: string | null,
  email: string,
  entitled: boolean,
): LinkedStudent {
  return makeLinkedStudent({ id, email, displayName: name, entitled });
}

function renderCard(students: LinkedStudent[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GuardianPurchaseCard students={students} />
    </QueryClientProvider>,
  );
}

describe("guardian purchase card", () => {
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

  /**
   * THE REGRESSION THIS EXISTS FOR. Guardian `c6d3fc60` in production: two
   * active links, student A premium, student B with zero entitlement rows. The
   * §31.3 fold reports access from A, so the old paywall returned its children
   * and the only picker in the app went with it. Student B could not be paid
   * for from anywhere in the deployed UI.
   *
   * The card takes no `effectiveAccess` input at all — that is the fix, stated
   * as a test: it cannot be hidden by the guardian's own access because it
   * never learns it.
   */
  it("renders for a guardian who ALREADY has access, when a linked student is unpaid", async () => {
    renderCard([
      student(STUDENT_A, "Ada", "a@test.com", true),
      student(STUDENT_B, "Blake", "b@test.com", false),
    ]);

    expect(await screen.findByTestId("guardian-purchase-card")).toBeTruthy();
    expect(screen.getByTestId("student-select")).toBeTruthy();
  });

  it("never offers a student who already holds an entitlement", async () => {
    renderCard([
      student(STUDENT_A, "Ada", "a@test.com", true),
      student(STUDENT_B, "Blake", "b@test.com", false),
    ]);

    const select = await screen.findByTestId("student-select");
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );

    expect(values).toContain(STUDENT_B);
    expect(values).not.toContain(STUDENT_A);
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("does not render at all when every linked student is entitled", () => {
    const { container } = renderCard([
      student(STUDENT_A, "Ada", "a@test.com", true),
      student(STUDENT_B, "Blake", "b@test.com", true),
    ]);
    expect(container.firstChild).toBeNull();
  });

  it("does not render with zero links — the link panel owns that state", () => {
    const { container } = renderCard([]);
    expect(container.firstChild).toBeNull();
  });

  it("sends the SELECTED student id with the checkout request", async () => {
    renderCard([
      student(STUDENT_A, "Ada", "a@test.com", true),
      student(STUDENT_B, "Blake", "b@test.com", false),
    ]);

    const select = await screen.findByTestId("student-select");
    fireEvent.change(select, { target: { value: STUDENT_B } });
    fireEvent.click(await screen.findByText("Monthly"));
    fireEvent.click(screen.getByTestId("guardian-purchase-submit"));

    await waitFor(() => {
      expect(startSubscriptionCheckoutMock).toHaveBeenCalledWith("monthly", {
        studentProfileId: STUDENT_B,
      });
    });
  });

  /**
   * No selection means NO REQUEST, and the control enforces that by being
   * unclickable rather than by explaining itself after the fact. The onClick
   * guard behind it stays as defence, but the disabled attribute is what a user
   * actually meets, so that is what is asserted.
   */
  it("does NOT send a request until a student is chosen", async () => {
    renderCard([student(STUDENT_B, "Blake", "b@test.com", false)]);

    fireEvent.click(await screen.findByText("Monthly"));
    const submit = screen.getByTestId(
      "guardian-purchase-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(startSubscriptionCheckoutMock).not.toHaveBeenCalled();
  });

  /**
   * Edge case 4. The server owns this refusal; the card's job is to show it
   * rather than replace it with generic retry copy.
   */
  it("surfaces STUDENT_ALREADY_FUNDED instead of swallowing it", async () => {
    startSubscriptionCheckoutMock.mockRejectedValue(
      new Error("This student is already covered by your subscription."),
    );
    renderCard([student(STUDENT_B, "Blake", "b@test.com", false)]);

    const select = await screen.findByTestId("student-select");
    fireEvent.change(select, { target: { value: STUDENT_B } });
    fireEvent.click(await screen.findByText("Monthly"));
    fireEvent.click(screen.getByTestId("guardian-purchase-submit"));

    await waitFor(() => {
      expect(
        screen.getByText(/already covered by your subscription/i),
      ).toBeTruthy();
    });
  });

  /**
   * Edge case 5. Adding a student to an existing guardian subscription returns
   * `item_added` and does NOT redirect, so the card must say the purchase
   * completed — otherwise the button appears to do nothing.
   */
  it("reports completion on the add-item path, which does not redirect", async () => {
    startSubscriptionCheckoutMock.mockResolvedValue({
      kind: "item_added",
      subscriptionItemId: "si_1",
    });
    renderCard([student(STUDENT_B, "Blake", "b@test.com", false)]);

    const select = await screen.findByTestId("student-select");
    fireEvent.change(select, { target: { value: STUDENT_B } });
    fireEvent.click(await screen.findByText("Monthly"));
    fireEvent.click(screen.getByTestId("guardian-purchase-submit"));

    await waitFor(() => {
      expect(
        screen.getByText(/added to your existing subscription/i),
      ).toBeTruthy();
    });
  });
});
