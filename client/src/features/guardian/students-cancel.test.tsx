// @vitest-environment jsdom
/**
 * The guardian's cancel control sits in the row of the student it pays for.
 *
 * @spec [SCL-271; SCL-272 (payer-only, decided by the server); owner ruling
 *        Karl 2026-11-03 clause 4 ("a cancel button on the guardian billing
 *        surface when the guardian is the payer ... the server decides who the
 *        payer is, and the UI only shows the button to that person")]
 * | @implemented [2026-11-03]
 *
 * plain English: walks the REAL `/guardian/students` page with three linked
 * students and a cancel-state answer naming exactly one of them. Expected
 * outcome: the control appears in that student's row and in no other, and it
 * carries that student's name — so a guardian funding several students cannot
 * cancel the wrong one by clicking the wrong row.
 *
 * WHY THIS IS NOT COVERED BY THE DIALOG'S OWN TEST. The dialog renders whatever
 * row it is handed; what this page decides is WHICH row goes to WHICH student,
 * through a map keyed on `studentProfileId`. A fixture with one student could
 * not disprove a mis-keyed lookup, because every lookup would return the only
 * row there is — so the answer here names ONE student out of THREE, which is the
 * shape that can fail (CLAUDE.md: "a fixture that collapses two values cannot
 * disprove their independence").
 *
 * The row is produced by the server's own `describeCancellable`, not typed by
 * hand, for the reason set out in
 * `client/src/components/billing/CancelSubscriptionDialog.test.tsx`.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancellableSubscriptionSchema,
  type CancellableSubscription,
} from "@lyceon/shared/billing-schema";
import { describeCancellable } from "../../../../server/lib/stripe/cancellation-subject";
import {
  ADA,
  BO,
  CY,
  billingStatus,
  json,
  mountApp,
  net,
  roster,
} from "./test-harness";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");

const PAGE = "/guardian/students";
const PERIOD_END = Math.floor(Date.now() / 1000) + 9 * 86_400;

/** The row `GET /cancel-state` would carry for one funded student. */
async function rowFor(studentProfileId: string): Promise<CancellableSubscription> {
  const described = await describeCancellable(
    {} as unknown as import("stripe").Stripe,
    {
      id: `sub_${studentProfileId.slice(0, 8)}`,
      status: "active",
      cancel_at: null,
      cancel_at_period_end: false,
      customer: "cus_guardian",
      items: {
        data: [
          {
            current_period_end: PERIOD_END,
            metadata: { student_profile_id: studentProfileId },
          },
        ],
      },
      metadata: {},
    } as unknown as import("stripe").Stripe.Subscription,
    Math.floor(Date.now() / 1000),
  );
  if (described === null) throw new Error("the server declined to describe it");
  return cancellableSubscriptionSchema.parse(described);
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`linked-student-${id}`);
}

beforeEach(async () => {
  net.reset();
  net.roster = roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo" },
    { id: CY, name: "Cy", unpaid: true },
  ]);
  const funded = await rowFor(BO);
  net.handlers.push((url) => {
    if (url === "/api/billing/status") return json(billingStatus());
    if (url === "/api/billing/plans")
      return json({ plans: [], requestId: "r" });
    if (url === "/api/billing/cancel-state")
      return json({ subscriptions: [funded], requestId: "r" });
    return undefined;
  });
});

afterEach(cleanup);

describe("the guardian's cancel control (SCL-272 clause 4)", () => {
  it("appears only in the row of the student the server says this guardian pays for", async () => {
    mountApp(Router, PAGE);
    await screen.findByTestId(`linked-student-${ADA}`);

    const control = await screen.findByTestId(
      `button-cancel-subscription-${BO}`,
    );
    // Presence first, so the two absences below are absences in a page that
    // rendered its rows rather than in a page that rendered nothing.
    expect(within(row(BO)).getByTestId(`button-cancel-subscription-${BO}`)).toBe(
      control,
    );
    // It names the student, because a guardian funding several needs to know
    // which one this button ends.
    expect(control.textContent).toBe("Cancel for Bo");

    expect(
      within(row(ADA)).queryByTestId(`button-cancel-subscription-${ADA}`),
    ).toBeNull();
    expect(
      within(row(CY)).queryByTestId(`button-cancel-subscription-${CY}`),
    ).toBeNull();
    // And no stray control anywhere else on the page.
    expect(
      screen.getAllByRole("button", { name: /^cancel for/i }),
    ).toHaveLength(1);
  });

  /**
   * SCL-272 makes our endpoint the single cancellation path, so two sentences on
   * this page that sent guardians to the Stripe portal to cancel became wrong in
   * the same change. A false signpost is worse than none: it sends someone to a
   * surface that will not do the thing, which is the complaint this whole change
   * started from.
   */
  it("no longer sends guardians to the portal to cancel", async () => {
    mountApp(Router, PAGE);
    const copy = await screen.findByTestId("billing-manage-copy");

    expect(copy.textContent ?? "").toContain("payment method and invoices");
    expect(copy.textContent ?? "").toContain("from that student\u2019s row");
    expect(copy.textContent ?? "").not.toContain("cancellations");
  });
});
