// @vitest-environment jsdom
/**
 * G4-09 — the return from Stripe Checkout lands on a poller, not on a redirect.
 *
 * @spec [Guardian_Closure_Plan G4-09; billing-routes.ts `success_url` = `/guardian?checkout=success`
 *       (unchanged — no Stripe logic changes)] | @implemented [2026-09-30]
 *
 * plain English: Checkout sends a guardian back to `/guardian?checkout=success`. The Wave 4
 * home redirects straight to the first student, so without the poller in front of it the
 * processing state (and its bounded polling) never ran for a guardian at all. This walks the
 * REAL route switch: while the webhook has not landed the processing state shows and no
 * redirect happens; once it has, the guardian lands on the Dashboard as normal.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
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

let status: Record<string, unknown> = billingStatus();

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
  net.handlers.push((url) =>
    url === "/api/billing/status" ? json(status) : undefined,
  );
  window.history.replaceState(null, "", "/guardian?checkout=success");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("checkout return (G4-09)", () => {
  it("holds the processing state, without redirecting, until the webhook lands", async () => {
    status = billingStatus({
      plan: "free",
      stripeStatus: "missing",
      effectiveAccess: false,
      isPaid: false,
    });
    const { history } = mountApp(Router, "/guardian?checkout=success");
    expect(await screen.findByTestId("checkout-processing")).toBeTruthy();
    expect(net.log).toContain("GET /api/billing/status");
    expect(history.at(-1)).toBe("/guardian?checkout=success");
  });

  it("lands on the first student's Dashboard once access is confirmed", async () => {
    status = billingStatus();
    const { history } = mountApp(Router, "/guardian?checkout=success");
    await waitFor(() => expect(history.at(-1)).toBe(`/guardian/${ADA}`));
    expect(screen.queryByTestId("checkout-processing")).toBeNull();
  });
});
