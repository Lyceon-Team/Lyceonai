// @vitest-environment jsdom
/**
 * G4-10 — the Linked students & billing page, option (c).
 *
 * @spec [Guardian_Closure_Plan G4-10; owner ruling 2026-09-30 (option (c): one "Manage billing"
 *       button opening the existing guardian portal session unchanged; each student row shows
 *       its subscription status and "Choose a plan" when it has ended; Remove confirms first;
 *       no Stripe logic changes)] | @implemented [2026-09-30]
 *
 * plain English: walks the REAL route switch at `/guardian/students` with three linked
 * students — one active, one whose subscription ended, one never subscribed — and proves the
 * three named behaviours: status per student, ONE billing button, and no unlink without a
 * confirmation. The route's refusals are proved server-side in
 * `tests/ci/identity-entitlement.contract.test.ts` ("G4-10").
 */
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  net.reset();
  net.roster = roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo", lapsed: true },
    { id: CY, name: "Cy", unpaid: true },
  ]);
  net.handlers.push((url, init) => {
    if (url === "/api/billing/status") return json(billingStatus());
    if (url === "/api/billing/plans")
      return json({ plans: [], requestId: "r" });
    if (url === "/api/billing/portal" && init?.method === "POST") {
      return json({
        url: "https://billing.stripe.test/session",
        requestId: "r",
      });
    }
    if (url.startsWith("/api/guardian/link/") && init?.method === "DELETE") {
      return json({ ok: true, requestId: "r" });
    }
    return undefined;
  });
});

afterEach(cleanup);

function row(id: string): HTMLElement {
  return screen.getByTestId(`linked-student-${id}`);
}

describe("Linked students & billing (G4-10)", () => {
  it("shows each student's own subscription status, and 'Choose a plan' only where it is not active", async () => {
    mountApp(Router, PAGE);
    await screen.findByTestId(`linked-student-${ADA}`);

    expect(within(row(ADA)).getByText("Ada")).toBeTruthy();
    expect(
      within(row(ADA)).getByTestId("linked-student-status").textContent,
    ).toBe("Active");
    expect(
      within(row(BO)).getByTestId("linked-student-status").textContent,
    ).toBe("Subscription ended");
    expect(
      within(row(CY)).getByTestId("linked-student-status").textContent,
    ).toBe("No subscription");

    expect(
      within(row(ADA)).queryByRole("button", { name: /choose a plan/i }),
    ).toBeNull();
    expect(
      within(row(BO)).getByRole("button", { name: /choose a plan/i }),
    ).toBeTruthy();
    expect(
      within(row(CY)).getByRole("button", { name: /choose a plan/i }),
    ).toBeTruthy();

    // "Choose a plan" opens the existing purchase surface for THAT student.
    fireEvent.click(
      within(row(CY)).getByRole("button", { name: /choose a plan/i }),
    );
    const card = await screen.findByTestId("guardian-purchase-card");
    expect(
      (within(card).getByTestId("student-select") as HTMLSelectElement).value,
    ).toBe(CY);
  });

  it("has ONE 'Manage billing' button, for every student paid for, opening the existing portal", async () => {
    mountApp(Router, PAGE);
    await screen.findByTestId(`linked-student-${ADA}`);

    const buttons = await screen.findAllByRole("button", {
      name: /manage billing/i,
    });
    expect(buttons).toHaveLength(1);
    expect(screen.getByTestId("billing-manage-copy").textContent).toMatch(
      /every student you pay for/i,
    );
    // No per-student billing control anywhere in the rows.
    for (const id of [ADA, BO, CY]) {
      expect(
        within(row(id)).queryByRole("button", { name: /manage billing/i }),
      ).toBeNull();
    }

    fireEvent.click(buttons[0]!);
    await waitFor(() =>
      expect(
        net.log.filter((l) => l === "POST /api/billing/portal"),
      ).toHaveLength(1),
    );
  });

  it("never unlinks without a confirmation, and unlinks exactly the student confirmed", async () => {
    mountApp(Router, PAGE);
    await screen.findByTestId(`linked-student-${ADA}`);
    const deletes = (): string[] =>
      net.log.filter((l) => l.startsWith("DELETE "));

    fireEvent.click(within(row(BO)).getByRole("button", { name: /remove/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/remove bo\?/i)).toBeTruthy();
    // It says what Remove does NOT do: the subscription is billing's, not the link's.
    expect(within(dialog).getByText(/does not cancel/i)).toBeTruthy();
    expect(deletes()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deletes()).toEqual([]);

    fireEvent.click(within(row(BO)).getByRole("button", { name: /remove/i }));
    const again = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(again).getByRole("button", { name: /^remove bo$/i }),
    );
    await waitFor(() =>
      expect(deletes()).toEqual([`DELETE /api/guardian/link/${BO}`]),
    );
  });

  it("is reached from the profile menu", async () => {
    const { history } = mountApp(Router, `/guardian/${ADA}`);
    const trigger = await screen.findByTestId("button-user-menu");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByTestId("menu-linked-students"));
    await waitFor(() => expect(history.at(-1)).toBe(PAGE));
    expect(await screen.findByTestId("guardian-students-page")).toBeTruthy();
  });
});
