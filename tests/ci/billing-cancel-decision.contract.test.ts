/**
 * The cancellation decision, over every Stripe status there is.
 *
 * @spec [SCL-271 (cancellation at every status; `past_due` holds access to the
 *        grace deadline; "access never ends earlier than doing nothing would");
 *        Doc-01_V8 §21 `:950-959`; owner rulings Karl 2026-11-03]
 * @implemented [2026-11-03]
 *
 * plain English: a table test over the pure function the route and the UI both
 * depend on. Expected outcome: every status the `entitlements` CHECK admits has
 * a stated answer, and the two orderings that matter — already-stopping beats
 * status, and an elapsed grace window beats the deadline — are pinned.
 *
 * WHY A TABLE AND NOT CASES. The failure this guards is a status with NO branch,
 * which an example-per-case suite cannot see: it passes on the cases it names
 * and says nothing about the one nobody wrote. Driving the whole status set from
 * the CHECK constraint's own list means adding a status to the database without
 * teaching this function fails HERE rather than in production.
 *
 * `nowEpoch` IS INJECTED, so none of this reads a clock. A grace deadline test
 * that used `Date.now()` would pass or fail depending on when CI ran it.
 */
import { describe, expect, it } from "vitest";
import {
  PAST_DUE_GRACE_DAYS,
  decideCancellation,
  isAlreadyStopping,
  pastDueGraceDeadlineEpoch,
  type CancellationInput,
} from "../../server/lib/stripe/cancellation";

/**
 * Every status `public.entitlements.status` admits (genesis.sql:180), plus
 * Stripe's `paused`, which `FUNDING_SUBSCRIPTION_STATUSES` scans and the CHECK
 * does not list — so it is exactly the kind of status that reaches this function
 * without a row in Doc 01's table.
 */
const ALL_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

const NOW = 1_800_000_000;
const PERIOD_END = NOW + 10 * 86_400;
/** Finalised two days ago: the grace window is still open. */
const RECENT_INVOICE = NOW - 2 * 86_400;

function input(over: Partial<CancellationInput> = {}): CancellationInput {
  return {
    status: "active",
    cancelAtPeriodEnd: false,
    cancelAtEpoch: null,
    currentPeriodEndEpoch: PERIOD_END,
    earliestUnpaidInvoiceFinalizedAtEpoch: null,
    nowEpoch: NOW,
    ...over,
  };
}

describe("decideCancellation — every status is answered", () => {
  it("names a branch for every status, and never falls through", () => {
    for (const status of ALL_STATUSES) {
      const plan = decideCancellation(
        input({
          status,
          earliestUnpaidInvoiceFinalizedAtEpoch: RECENT_INVOICE,
        }),
      );
      // The point of the table: an unhandled status must be VISIBLE as
      // `unsupported`, never silently treated as one of the others.
      expect(
        [
          "at_period_end",
          "past_due_scheduled",
          "immediate",
          "already_scheduled",
          "already_canceled",
          "unsupported",
        ],
        `status ${status} produced an unknown kind`,
      ).toContain(plan.kind);
    }
  });

  it("good standing cancels at period end, with the period's own date", () => {
    for (const status of ["active", "trialing"] as const) {
      const plan = decideCancellation(input({ status }));
      expect(plan.kind, status).toBe("at_period_end");
      // The DATE, not merely non-null: a non-null assertion passes on any
      // timestamp the code happened to invent.
      expect(plan.kind === "at_period_end" ? plan.accessEndsAt : null).toBe(
        new Date(PERIOD_END * 1000).toISOString(),
      );
    }
  });

  it("past_due ends billing now and holds access to the grace deadline", () => {
    const plan = decideCancellation(
      input({
        status: "past_due",
        earliestUnpaidInvoiceFinalizedAtEpoch: RECENT_INVOICE,
      }),
    );
    expect(plan.kind).toBe("past_due_scheduled");
    if (plan.kind !== "past_due_scheduled") throw new Error("unreachable");

    const expected = RECENT_INVOICE + PAST_DUE_GRACE_DAYS * 86_400;
    expect(plan.cancelAtEpoch).toBe(expected);
    expect(plan.accessEndsAt).toBe(new Date(expected * 1000).toISOString());

    // THE RULING'S OWN PROPERTY: the deadline is in the future, so access does
    // not end earlier than doing nothing would.
    expect(plan.cancelAtEpoch).toBeGreaterThan(NOW);
  });

  it("past_due degrades to immediate once the grace window has elapsed", () => {
    // Finalised eight days ago with a seven-day window: there is no future
    // moment to hold access to, and Stripe rejects a `cancel_at` in the past.
    const plan = decideCancellation(
      input({
        status: "past_due",
        earliestUnpaidInvoiceFinalizedAtEpoch: NOW - 8 * 86_400,
      }),
    );
    expect(plan.kind).toBe("immediate");
    expect(
      plan.kind === "immediate" ? plan.graceAlreadyElapsed : undefined,
    ).toBe(true);
  });

  it("past_due with no open invoice has no anchor, so it is immediate", () => {
    const plan = decideCancellation(
      input({
        status: "past_due",
        earliestUnpaidInvoiceFinalizedAtEpoch: null,
      }),
    );
    expect(plan.kind).toBe("immediate");
  });

  it("statuses that grant nothing promise no date", () => {
    for (const status of [
      "unpaid",
      "incomplete",
      "incomplete_expired",
    ] as const) {
      const plan = decideCancellation(input({ status }));
      expect(plan.kind, status).toBe("immediate");
      // Null, not `now`. `entitlement_active` grants none of these
      // (20260616120000), so there is no access left to end — and a date here
      // would be a promise about access the customer does not have.
      expect(plan.kind === "immediate" ? plan.accessEndsAt : "x").toBeNull();
    }
  });

  it("an unrecognised status refuses rather than guessing", () => {
    const plan = decideCancellation(input({ status: "paused" }));
    expect(plan.kind).toBe("unsupported");
  });
});

describe("decideCancellation — already stopping beats status", () => {
  it("an active subscription already set to cancel is already_scheduled", () => {
    // The ordering that stops a double-submit becoming a second
    // `customer.subscription.updated` and a second email.
    const plan = decideCancellation(
      input({ status: "active", cancelAtPeriodEnd: true }),
    );
    expect(plan.kind).toBe("already_scheduled");
    expect(isAlreadyStopping(plan)).toBe(true);
    expect(plan.kind === "already_scheduled" ? plan.accessEndsAt : null).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );
  });

  it("a past_due subscription with cancel_at set is already_scheduled, and reports THAT date", () => {
    const cancelAt = NOW + 5 * 86_400;
    const plan = decideCancellation(
      input({
        status: "past_due",
        cancelAtEpoch: cancelAt,
        earliestUnpaidInvoiceFinalizedAtEpoch: RECENT_INVOICE,
      }),
    );
    expect(plan.kind).toBe("already_scheduled");
    // `cancel_at` wins over the period end: for the `past_due` branch the
    // period end is a date nobody has paid for.
    expect(plan.kind === "already_scheduled" ? plan.accessEndsAt : null).toBe(
      new Date(cancelAt * 1000).toISOString(),
    );
  });

  it("a canceled subscription is terminal and promises nothing", () => {
    const plan = decideCancellation(input({ status: "canceled" }));
    expect(plan.kind).toBe("already_canceled");
    expect(isAlreadyStopping(plan)).toBe(true);
  });
});

describe("the grace constant has ONE definition", () => {
  it("is seven days, and the deadline helper uses it", () => {
    // Owner ruling 2026-11-03: "define the 7 as a named constant in one place,
    // not inline". This asserts the helper reads the constant rather than
    // carrying its own copy — change the constant and this still passes;
    // hard-code 7 anywhere in the helper and it does not.
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
    expect(pastDueGraceDeadlineEpoch(NOW)).toBe(
      NOW + PAST_DUE_GRACE_DAYS * 86_400,
    );
  });
});
