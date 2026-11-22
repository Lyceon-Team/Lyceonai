// @vitest-environment jsdom
/**
 * The optional card on file on an open invite: saved, pending, and the form that saves one.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3, 9; SCL-286; DESIGN.md §5 (2-3 options
 *        are radios; one filled primary action; loading and error states)]
 *        | @implemented [2026-11-22]
 *
 * plain English: mounted through the real App router at /guardian with one open invite. Every
 * response the scripted network returns is first parsed by the shared schema the card uses, so
 * a fixture cannot drift from the wire shape the PG suite proves the routes emit. The plans come
 * through `billingPlansResponseSchema` and the sentence is checked against the shared builder.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mountApp, net, pending, scriptedFetch } from "./test-harness";
import {
  guardianInvitesResponseSchema,
  type GuardianInviteView,
} from "@lyceon/shared/guardian-invite-schema";
import {
  guardianInviteCardResponseSchema,
  guardianInviteChargeDisclosure,
} from "@lyceon/shared/guardian-invite-card-schema";
import { billingPlansResponseSchema } from "@lyceon/shared/billing-schema";

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
void scriptedFetch;

const INVITE: GuardianInviteView = {
  id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a01",
  issuedAt: "2026-11-22T10:00:00.000Z",
  expiresAt: "2026-12-06T10:00:00.000Z",
  expired: false,
  emailed: true,
  card: null,
};
const STRIPE_URL = "https://checkout.stripe.test/cs_test_setup_1";

const PLANS = billingPlansResponseSchema.parse({
  plans: [
    {
      plan: "monthly",
      label: "Monthly",
      amountCents: 2999,
      currency: "usd",
      intervalLabel: "per month",
      interval: "month",
      intervalCount: 1,
      stripePriceIdConfigured: true,
    },
    {
      plan: "quarterly",
      label: "Quarterly",
      amountCents: 7999,
      currency: "usd",
      intervalLabel: "every 3 months",
      interval: "month",
      intervalCount: 3,
      stripePriceIdConfigured: true,
    },
    {
      plan: "yearly",
      label: "Yearly",
      amountCents: null,
      currency: null,
      intervalLabel: null,
      interval: null,
      intervalCount: null,
      stripePriceIdConfigured: false,
    },
  ],
});

let invite: GuardianInviteView = INVITE;
const posted: { url: string; body: unknown }[] = [];
const assign = vi.fn();

beforeEach(() => {
  net.reset();
  invite = INVITE;
  posted.length = 0;
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
  net.handlers.push((url, init) => {
    if (url === "/api/guardian/invites" && (init?.method ?? "GET") === "GET") {
      return json(
        guardianInvitesResponseSchema.parse({ data: { invites: [invite] } }),
      );
    }
    if (url === "/api/billing/plans") return json(PLANS);
    if (url.endsWith("/card") && init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return json(
        guardianInviteCardResponseSchema.parse({ data: { url: STRIPE_URL } }),
      );
    }
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function filled(el: HTMLElement): boolean {
  return el.className.split(/\s+/).includes("bg-primary");
}

describe("the card on file (ruling 3)", () => {
  it("an open invite offers to save a card, as a ghost action", async () => {
    mountApp(Router, "/guardian");
    const open = await screen.findByTestId("invite-card-open");
    expect(filled(open)).toBe(false);
  });

  it("radios for each priced plan, the ruled sentence for the one chosen, Terms required, then Stripe", async () => {
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-card-open"));
    // Two priced plans are offered; the plan with no price is not.
    expect(await screen.findByTestId("invite-card-plan-monthly")).toBeTruthy();
    expect(screen.getByTestId("invite-card-plan-quarterly")).toBeTruthy();
    expect(screen.queryByTestId("invite-card-plan-yearly")).toBeNull();
    expect(
      (screen.getByTestId("invite-card-plan-monthly") as HTMLInputElement).type,
    ).toBe("radio");

    fireEvent.click(screen.getByTestId("invite-card-plan-quarterly"));
    const sentence = screen.getByTestId("invite-card-disclosure").textContent;
    expect(sentence).toBe(guardianInviteChargeDisclosure(PLANS.plans[1]!));
    expect(sentence).toBe(
      "You'll be charged $79.99/3 months when your teen joins. Renews until you cancel.",
    );

    // Save card is outline: Send invite stays the one filled action.
    const save = screen.getByTestId("invite-card-save");
    expect(filled(save)).toBe(false);
    fireEvent.click(save);
    expect(
      await screen.findByText("Agree to the Billing Terms to save a card."),
    ).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.click(screen.getByTestId("invite-card-terms"));
    fireEvent.click(save);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: `/api/guardian/invites/${INVITE.id}/card`,
      body: { plan: "quarterly", acceptBillingTerms: true },
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
  });

  it("no plan chosen: nothing is posted", async () => {
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-card-open"));
    fireEvent.click(await screen.findByTestId("invite-card-terms"));
    fireEvent.click(screen.getByTestId("invite-card-save"));
    expect(await screen.findByText("Choose a plan.")).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it("a saved card says so, with its plan", async () => {
    invite = { ...INVITE, card: { plan: "monthly", status: "saved" } };
    mountApp(Router, "/guardian");
    const saved = await screen.findByTestId("invite-card-saved");
    expect(saved.textContent).toContain("Card saved for the Monthly plan");
    expect(screen.getByTestId("invite-card-change")).toBeTruthy();
  });

  it("a card still being saved says so", async () => {
    invite = { ...INVITE, card: { plan: "yearly", status: "pending" } };
    mountApp(Router, "/guardian");
    expect(await screen.findByTestId("invite-card-pending")).toBeTruthy();
  });

  it("an expired invite offers no card", async () => {
    invite = { ...INVITE, expired: true };
    mountApp(Router, "/guardian");
    await screen.findByTestId("invite-row");
    expect(screen.queryByTestId("invite-card-open")).toBeNull();
  });

  it("loading and error states for the plans (DESIGN.md §5)", async () => {
    net.handlers.unshift((url) =>
      url === "/api/billing/plans" ? pending() : undefined,
    );
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-card-open"));
    expect(await screen.findByTestId("invite-card-plans-loading")).toBeTruthy();
    cleanup();
    net.handlers.unshift((url) =>
      url === "/api/billing/plans" ? json({ error: "x" }, 502) : undefined,
    );
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-card-open"));
    // The plans query retries once (as on /upgrade) before it shows the error.
    expect(
      await screen.findByTestId(
        "invite-card-plans-error",
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
  });
});
