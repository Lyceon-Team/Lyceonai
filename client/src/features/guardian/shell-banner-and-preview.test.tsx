// @vitest-environment jsdom
/**
 * The payment-health banner lives in `GuardianShell`; the template preview lives in the
 * no-students state. Both moved out of the retired single-page dashboard before its deletion.
 *
 * @spec [owner decision 2026-10-01 on #1003 ("Move the payment-problem banner into
 *       GuardianShell, using the G4-09 billing hook. Move the 2026-09-03 template preview into
 *       the no-students state."); owner ruling 2026-09-03 (a payment problem is a BANNER, never
 *       a gate; the preview is STRUCTURAL — no numerals); SCL-029 (`past_due` is entitled);
 *       Guardian_Closure_Plan G4-09] | @implemented [2026-10-01]
 *
 * plain English: through the real routes with the scripted network.
 *   - `needsPaymentUpdate` puts the banner above EVERY guardian page — a student's Dashboard,
 *     their Calendar, Linked students & billing, and the no-students page — without hiding
 *     the page under it. "Update payment method" opens the billing portal (one POST through
 *     the shared portal hook); "Dismiss" hides it. No banner when nothing needs updating, and
 *     no portal button when this guardian has no billing account to update (the student pays).
 *   - The no-students page shows the preview of what linking unlocks, with no numeral in it.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  billingStatus,
  json,
  mountApp,
  net,
  roster,
  serveDashboard,
} from "./test-harness";
import { guardianPaths } from "./paths";

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

let status: Record<string, unknown> = billingStatus();

beforeEach(() => {
  net.reset();
  status = billingStatus();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
  net.handlers.push((url, init) => {
    if (url === "/api/billing/status") return json(status);
    if (url === "/api/billing/plans")
      return json({ plans: [], requestId: "r" });
    if (url === "/api/billing/portal" && init?.method === "POST") {
      // A non-https URL: the portal client refuses to navigate to it, so jsdom is not asked
      // to leave the page. What is asserted is that the one portal call was made.
      return json({ error: "Forbidden", requestId: "r" }, 403);
    }
    return undefined;
  });
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

const PAGES: readonly [string, string, string][] = [
  ["a student's Dashboard", `/guardian/${ADA}`, "latest-test-meta"],
  [
    "a student's Calendar",
    `/guardian/${ADA}/calendar`,
    "guardian-tab-calendar",
  ],
  ["Linked students & billing", guardianPaths.students, "billing-manage"],
];

describe("the payment-health banner, in GuardianShell", () => {
  it.each(PAGES)(
    "shows above %s, and the page is still there under it",
    async (_n, path, ready) => {
      status = billingStatus({
        stripeStatus: "past_due",
        needsPaymentUpdate: true,
      });
      mountApp(Router, path);
      expect((await screen.findAllByTestId(ready)).length).toBeGreaterThan(0);
      expect(
        await screen.findByTestId("guardian-payment-health-banner"),
      ).toBeTruthy();
    },
  );

  it("shows above the no-students page too", async () => {
    net.roster = roster([]);
    status = billingStatus({
      stripeStatus: "past_due",
      needsPaymentUpdate: true,
    });
    mountApp(Router, "/guardian");
    await screen.findByTestId("guardian-no-students");
    expect(
      await screen.findByTestId("guardian-payment-health-banner"),
    ).toBeTruthy();
  });

  it("'Update payment method' opens the billing portal; 'Dismiss' hides the banner", async () => {
    status = billingStatus({
      stripeStatus: "past_due",
      needsPaymentUpdate: true,
    });
    mountApp(Router, `/guardian/${ADA}`);
    const banner = await screen.findByTestId("guardian-payment-health-banner");
    fireEvent.click(
      screen.getByRole("button", { name: "Update payment method" }),
    );
    await waitFor(() => expect(net.log).toContain("POST /api/billing/portal"));
    expect(banner.isConnected).toBe(true);
    fireEvent.click(screen.getByTestId("dismiss-payment-health-banner"));
    expect(screen.queryByTestId("guardian-payment-health-banner")).toBeNull();
  });

  it("no portal button when this guardian has no billing account (the student pays)", async () => {
    status = billingStatus({
      stripeStatus: "past_due",
      needsPaymentUpdate: true,
      hasBillingAccount: false,
    });
    mountApp(Router, `/guardian/${ADA}`);
    await screen.findByTestId("guardian-payment-health-banner");
    expect(
      screen.queryByRole("button", { name: "Update payment method" }),
    ).toBeNull();
  });

  it("no banner when nothing needs updating", async () => {
    mountApp(Router, `/guardian/${ADA}`);
    await screen.findByTestId("latest-test-meta");
    // Presence first: the status WAS read, and said nothing needs updating.
    await waitFor(() => expect(net.log).toContain("GET /api/billing/status"));
    expect(screen.queryByTestId("guardian-payment-health-banner")).toBeNull();
  });
});

describe("the template preview, in the no-students state", () => {
  it("shows what linking unlocks, with no numeral anywhere in it", async () => {
    net.roster = roster([]);
    mountApp(Router, "/guardian");
    await screen.findByTestId("guardian-no-students");
    const preview = await screen.findByTestId("guardian-template-preview");
    expect(preview.textContent).toMatch(
      /what you.ll see once you link a student/i,
    );
    // Presence first: the preview really draws the panels — every canonical domain is named.
    expect(preview.textContent).toContain("Problem Solving and Data Analysis");
    expect(preview.textContent).toContain("Standard English Conventions");
    // Structural, never sample (owner ruling 2026-09-03): not one digit.
    expect(preview.textContent).not.toMatch(/\d/);
  });
});
