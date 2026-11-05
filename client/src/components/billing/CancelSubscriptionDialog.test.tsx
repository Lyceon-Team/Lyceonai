// @vitest-environment jsdom
/**
 * The cancel control: what it says, what it shows, and who never sees it.
 *
 * @spec [SCL-271 (cancellation at every status; `past_due` ends billing now and
 *        holds access to the grace deadline); SCL-272 (payer-only self-service;
 *        the SERVER decides who the payer is); owner ruling Karl 2026-11-03
 *        clause 4 ("the UI only shows the button to that person") and the
 *        definition of done ("a confirmation step showing exactly when access
 *        ends, a final screen with that date, plus a way to undo while only
 *        scheduled"); DESIGN.md §5 UI standards] | @implemented [2026-11-03]
 *
 * plain English: four decisions rendered, each one's promise read back, plus the
 * two surfaces' shared absence case. Expected outcome: the customer is told the
 * date before they act and again after, and a student whose guardian pays finds
 * no control at all.
 *
 * THE ROWS ARE THE SERVER'S OWN OUTPUT, NOT HAND-WRITTEN. Every fixture here is
 * built by calling `describeCancellable` — the exact function `GET /cancel-state`
 * maps over its subscriptions — and then parsed through
 * `cancellableSubscriptionSchema`, the exact schema the client parses the wire
 * with. A fixture typed by hand could assert a shape nothing produces, and both
 * it and this component would then agree about something the server never sends
 * (CLAUDE.md, "derive the fixture from real output"). The route-level envelope
 * around these rows is pinned separately, in
 * `tests/ci/billing-cancel.contract.test.ts`.
 *
 * THE DATES ARE CHECKED TWICE, DELIBERATELY. Once as a value the component
 * renders rather than invents, and once as an independent fact: the `past_due`
 * deadline must equal the earliest unpaid invoice's `finalized_at` plus
 * `PAST_DUE_GRACE_DAYS`. Asserting only "some date appears" would pass on any
 * timestamp the code happened to produce — including one earlier than doing
 * nothing would have given, which is the single thing the owner's amendment
 * forbids.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingStatusResponseSchema,
  cancelResponseSchema,
  cancellableSubscriptionSchema,
  type CancellableSubscription,
} from "@lyceon/shared/billing-schema";
import { formatDate } from "@/lib/format-date";
import { CancelSubscriptionDialog } from "./CancelSubscriptionDialog";
import { BillingSection } from "@/components/settings/BillingSection";
import { PAST_DUE_GRACE_DAYS } from "../../../../server/lib/stripe/cancellation";
import {
  describeCancellable,
  planFor,
  wireDecisionOf,
} from "../../../../server/lib/stripe/cancellation-subject";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...a: unknown[]) => csrfFetchMock(...a),
  getCsrfToken: async () => "csrf-test-token",
}));

const NOW = 1_800_000_000;
const PERIOD_END = NOW + 9 * 86_400;
/** Finalised two days ago, so the seven-day grace window is still open. */
const INVOICE_FINALIZED = NOW - 2 * 86_400;
const SUB_ID = "sub_cancel_ui";

type FakeSub = {
  id: string;
  status: string;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  customer: string;
  items: {
    data: { current_period_end: number; metadata: Record<string, string> }[];
  };
  metadata: Record<string, string>;
};

function fakeSubscription(over: Partial<FakeSub> = {}): FakeSub {
  return {
    id: SUB_ID,
    status: "active",
    cancel_at: null,
    cancel_at_period_end: false,
    customer: "cus_payer",
    items: {
      data: [{ current_period_end: PERIOD_END, metadata: {} }],
    },
    metadata: {},
    ...over,
  };
}

/** Only what `describeCancellable` reads: the open-invoice list for `past_due`. */
function stripeWithOpenInvoice(finalizedAt: number | null) {
  return {
    invoices: {
      list: async () => ({
        data:
          finalizedAt === null
            ? []
            : [
                {
                  id: "in_open",
                  created: finalizedAt,
                  status_transitions: { finalized_at: finalizedAt },
                },
              ],
        has_more: false,
      }),
    },
  } as unknown as import("stripe").Stripe;
}

/**
 * One row, produced by the server's own describer and parsed by the client's own
 * schema — the two ends of the wire, with nothing typed by hand in between.
 */
async function row(
  over: Partial<FakeSub> = {},
  invoiceFinalizedAt: number | null = null,
): Promise<CancellableSubscription> {
  const stripe = stripeWithOpenInvoice(invoiceFinalizedAt);
  const described = await describeCancellable(
    stripe,
    fakeSubscription(over) as unknown as import("stripe").Stripe.Subscription,
    NOW,
  );
  if (described === null) throw new Error("the server declined to describe it");
  return cancellableSubscriptionSchema.parse(described);
}

/** What `POST /cancel` answers for the same subscription, from the same planner. */
async function cancelReply(
  over: Partial<FakeSub> = {},
  invoiceFinalizedAt: number | null = null,
) {
  const stripe = stripeWithOpenInvoice(invoiceFinalizedAt);
  const plan = await planFor(
    stripe,
    fakeSubscription(over) as unknown as import("stripe").Stripe.Subscription,
    NOW,
  );
  const decision = wireDecisionOf(plan);
  if (decision === null) throw new Error("unsupported status in a fixture");
  return cancelResponseSchema.parse({
    subscriptionId: SUB_ID,
    decision,
    accessEndsAt: plan.kind === "unsupported" ? null : plan.accessEndsAt,
    alreadyStopping:
      plan.kind === "already_scheduled" || plan.kind === "already_canceled",
    requestId: "req-cancel-ui",
  });
}

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The date as the house formatter writes it — the format the whole app shares. */
function label(iso: string): string {
  const formatted = formatDate(iso, "month-day-year");
  if (formatted === null) throw new Error(`unformattable date: ${iso}`);
  return formatted;
}

beforeEach(() => {
  csrfFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the confirmation names the date before anything happens", () => {
  it("good standing: keeps the period already paid for, and says so", async () => {
    const subscription = await row();
    expect(subscription.decision).toBe("at_period_end");
    expect(subscription.accessEndsAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));

    const confirm = screen.getByTestId("cancel-confirm");
    expect(confirm).toHaveTextContent("You will not be charged again");
    // THE DATE, before the customer commits to anything.
    expect(confirm).toHaveTextContent(label(subscription.accessEndsAt!));
    expect(confirm).toHaveTextContent("already paid for");
  });

  it("past_due: the balance is cleared AND access runs to the grace deadline", async () => {
    const subscription = await row({ status: "past_due" }, INVOICE_FINALIZED);
    expect(subscription.decision).toBe("past_due_scheduled");

    // The independent fact: the deadline is the anchor plus the one grace
    // constant, and it is LATER than now — access never ends earlier than
    // doing nothing would (owner amendment, 2026-11-03).
    const deadline = INVOICE_FINALIZED + PAST_DUE_GRACE_DAYS * 86_400;
    expect(subscription.accessEndsAt).toBe(
      new Date(deadline * 1000).toISOString(),
    );
    expect(deadline).toBeGreaterThan(NOW);

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));

    const confirm = screen.getByTestId("cancel-confirm");
    expect(confirm).toHaveTextContent("you will not owe anything");
    expect(confirm).toHaveTextContent(label(subscription.accessEndsAt!));
  });

  it("a status that grants nothing promises no date, and no empty 'until'", async () => {
    const subscription = await row({ status: "unpaid" });
    expect(subscription.decision).toBe("immediate");
    expect(subscription.accessEndsAt).toBeNull();

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));

    const confirm = screen.getByTestId("cancel-confirm");
    expect(confirm).toHaveTextContent("you will not owe anything");
    expect(confirm).toHaveTextContent("nothing changes about what you can use");
    // A null date must not render as "until " with nothing after it.
    expect(confirm.textContent ?? "").not.toMatch(/until\s*[.,]/);
  });
});

describe("the final screen repeats the date, and offers the way back", () => {
  it("shows the SERVER's date from the mutation's own answer, and an undo", async () => {
    const subscription = await row();
    const reply = await cancelReply();
    csrfFetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => reply,
    }));

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));
    fireEvent.click(screen.getByTestId("button-confirm-cancel"));

    const done = await screen.findByTestId("cancel-done");
    expect(done).toHaveTextContent(
      `Cancelled. Access continues until ${label(reply.accessEndsAt!)}.`,
    );
    expect(done).toHaveTextContent("We have emailed you a confirmation");
    expect(screen.getByTestId("button-undo-cancel")).toBeTruthy();
  });

  it("offers no undo for a cancellation that has already taken effect", async () => {
    const subscription = await row({ status: "unpaid" });
    const reply = await cancelReply({ status: "unpaid" });
    csrfFetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => reply,
    }));

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));
    fireEvent.click(screen.getByTestId("button-confirm-cancel"));

    const done = await screen.findByTestId("cancel-done");
    // Presence first: the screen rendered its own copy, so the absence below is
    // an absence in a real payload rather than in an empty one.
    expect(done).toHaveTextContent("Billing has stopped and nothing is owed");
    expect(screen.queryByTestId("button-undo-cancel")).toBeNull();
  });

  it("the undo posts the subscription the server named, not a client guess", async () => {
    const subscription = await row();
    const reply = await cancelReply();
    csrfFetchMock.mockImplementation(async (path: string) =>
      path === "/api/billing/cancel/undo"
        ? {
            ok: true,
            status: 200,
            json: async () => ({ subscriptionId: SUB_ID, restored: true }),
          }
        : { ok: true, status: 200, json: async () => reply },
    );

    wrap(<CancelSubscriptionDialog subscription={subscription} />);
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));
    fireEvent.click(screen.getByTestId("button-confirm-cancel"));
    fireEvent.click(await screen.findByTestId("button-undo-cancel"));

    await waitFor(() => {
      const undo = csrfFetchMock.mock.calls.find(
        (c) => c[0] === "/api/billing/cancel/undo",
      );
      expect(undo).toBeDefined();
      expect(String((undo?.[1] as { body?: unknown })?.body)).toContain(SUB_ID);
    });
  });
});

describe("a subscription already stopping offers no second cancellation", () => {
  it("states when it ends and offers only the undo", async () => {
    const cancelAt = NOW + 4 * 86_400;
    const subscription = await row({ status: "past_due", cancel_at: cancelAt });
    expect(subscription.decision).toBe("already_scheduled");
    expect(subscription.undoable).toBe(true);

    wrap(<CancelSubscriptionDialog subscription={subscription} forLabel="Ada" />);

    const scheduled = screen.getByTestId("cancel-scheduled");
    expect(scheduled).toHaveTextContent(
      `Cancelled for Ada — access continues until ${label(subscription.cancelAt!)}.`,
    );
    expect(screen.getByTestId("button-undo-cancel")).toBeTruthy();
    // A second Cancel would be an action with no second effect.
    expect(screen.queryByTestId("button-cancel-subscription")).toBeNull();
  });

  it("a cancelled subscription offers neither button", async () => {
    const subscription = await row({ status: "canceled" });
    expect(subscription.decision).toBe("already_canceled");

    wrap(<CancelSubscriptionDialog subscription={subscription} />);

    expect(screen.getByTestId("cancel-scheduled")).toHaveTextContent(
      "Cancelled",
    );
    expect(screen.queryByTestId("button-cancel-subscription")).toBeNull();
    expect(screen.queryByTestId("button-undo-cancel")).toBeNull();
  });
});

/**
 * The real Settings surface, over the real hook, answered the way the route
 * answers a caller who is the payer of nothing (`NO_STRIPE_CUSTOMER` → 200
 * `{subscriptions: []}`, proven in tests/ci/billing-cancel.contract.test.ts).
 * Nothing in this file gates on a role, because nothing in the client does.
 */
describe("the button exists only for the payer", () => {
  const PREMIUM_SELF = billingStatusResponseSchema.parse({
    plan: "premium",
    stripeStatus: "active",
    currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    stripeSubscriptionId: SUB_ID,
    effectiveAccess: true,
    hasActiveLink: false,
    needsPaymentUpdate: false,
    lapsed: false,
    hasBillingAccount: true,
    isPaid: true,
    managedBy: "self",
    requestId: "req-status",
  });

  function serveSettings(subscriptions: readonly CancellableSubscription[]) {
    csrfFetchMock.mockImplementation(async (path: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        path === "/api/billing/cancel-state"
          ? { subscriptions, requestId: "req-cancel-state" }
          : PREMIUM_SELF,
    }));
  }

  it("renders no cancel control when the server names no subscription", async () => {
    serveSettings([]);
    wrap(<BillingSection />);

    // Presence before absence: the card itself rendered, so the missing button
    // is a decision rather than an unmounted component.
    const self = await screen.findByTestId("settings-billing-self");
    expect(within(self).getByTestId("button-manage-billing")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId("settings-cancel-loading")).toBeNull(),
    );
    expect(screen.queryByTestId("settings-cancel")).toBeNull();
    expect(screen.queryByTestId("button-cancel-subscription")).toBeNull();
  });

  it("renders it when the server names one, and no longer offers the portal for cancelling", async () => {
    serveSettings([await row()]);
    wrap(<BillingSection />);

    expect(await screen.findByTestId("button-cancel-subscription")).toBeTruthy();
    const self = screen.getByTestId("settings-billing-self");
    // SCL-272: the portal keeps the card and the invoices, and stops being the
    // place cancellation happens.
    expect(self).toHaveTextContent("update your card or see invoices");
    expect(self.textContent ?? "").not.toContain("or cancel");
  });
});
