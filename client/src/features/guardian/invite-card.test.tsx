// @vitest-environment jsdom
/**
 * The guardian's no-student state, card first: step 1 "Pick a plan and add your card.", step 2
 * "Invite your teen." locked until step 1 is done, and the call link.
 *
 * @spec [owner brief "/parent page + card-first parent onboarding" (Karl, 2026-11-22) Part 2;
 *        owner ruling 2026-11-22 (2); rulings 2026-11-21 (counsel-approved) 2, 5, 8; SCL-282,
 *        SCL-287; DESIGN.md §5 (one filled primary action; loading and error states)]
 *        | @implemented [2026-11-22]
 *
 * plain English: mounted through the real App router at /guardian with no linked students.
 * Every response the scripted network returns is first parsed by the shared schema the card
 * itself uses, so a fixture cannot drift from the wire shape the PG suite proves the routes emit.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUARDIAN_AUTH,
  json,
  mountApp,
  net,
  pending,
  scriptedFetch,
} from "./test-harness";
import {
  guardianInviteDraftResponseSchema,
  guardianInviteLinkResponseSchema,
  guardianInvitesResponseSchema,
  type GuardianInviteView,
} from "@lyceon/shared/guardian-invite-schema";
import { PARENT_CALL_URL } from "@lyceon/shared/external-links";
import { guardianInviteCardResponseSchema } from "@lyceon/shared/guardian-invite-card-schema";
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
void GUARDIAN_AUTH;
void scriptedFetch;

const INVITE: GuardianInviteView = {
  id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a01",
  issuedAt: "2026-11-22T10:00:00.000Z",
  expiresAt: "2026-12-06T10:00:00.000Z",
  expired: false,
  emailed: false,
  card: null,
};
const CARDED: GuardianInviteView = {
  ...INVITE,
  card: { plan: "monthly", status: "saved" },
};
const URL_ = `https://lyceon.test/join/${"Q".repeat(43)}`;
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
  ],
});

function invitesBody(invites: GuardianInviteView[]): unknown {
  return guardianInvitesResponseSchema.parse({ data: { invites } });
}
function linkBody(emailed: boolean): unknown {
  return guardianInviteLinkResponseSchema.parse({
    data: { invite: { ...CARDED, emailed }, url: URL_, emailed },
  });
}

/** The filled variant: the exact `bg-primary` class (outline carries only `hover:bg-primary`). */
function filled(el: HTMLElement): boolean {
  return el.className.split(/\s+/).includes("bg-primary");
}

let invites: GuardianInviteView[] = [];
const posted: { url: string; body: unknown }[] = [];
const assign = vi.fn();

beforeEach(() => {
  net.reset();
  invites = [];
  posted.length = 0;
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
  net.handlers.push((url, init) => {
    if (url === "/api/guardian/invites" && (init?.method ?? "GET") === "GET") {
      return json(invitesBody(invites));
    }
    if (url === "/api/billing/plans") return json(PLANS);
    if (url === "/api/guardian/invites" && init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
      return json(
        guardianInviteDraftResponseSchema.parse({ data: { invite: INVITE } }),
        201,
      );
    }
    if (url.endsWith("/card") && init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return json(
        guardianInviteCardResponseSchema.parse({ data: { url: STRIPE_URL } }),
      );
    }
    if (url.startsWith("/api/guardian/invites/") && init?.method === "POST") {
      const body: unknown = JSON.parse(String(init.body ?? "{}"));
      posted.push({ url, body });
      const emailed =
        typeof body === "object" && body !== null && "email" in body;
      return json(linkBody(emailed));
    }
    if (url.startsWith("/api/guardian/invites/") && init?.method === "DELETE") {
      posted.push({ url, body: null });
      return new Response(null, { status: 204 });
    }
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the no-student state, card first (ruling 2026-11-22, 2)", () => {
  it("shows step 1 then step 2, with Save card as the one filled action and step 2 locked", async () => {
    mountApp(Router, "/guardian");
    const step1 = await screen.findByTestId("invite-step1");
    const step2 = screen.getByTestId("invite-step2");
    expect(step1.textContent).toContain("Pick a plan and add your card.");
    expect(step2.textContent).toContain("Invite your teen.");
    // Step 1 comes first in the document.
    expect(
      step1.compareDocumentPosition(step2) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const save = await screen.findByTestId("invite-card-save");
    expect(filled(save)).toBe(true);
    const locked = screen.getByTestId("invite-step2-locked");
    expect((locked as HTMLFieldSetElement).disabled).toBe(true);
    for (const b of Array.from(locked.querySelectorAll("button"))) {
      expect(filled(b as HTMLElement)).toBe(false);
    }
    expect(screen.queryByTestId("invite-send")).toBeNull();
    expect(filled(screen.getByTestId("guardian-no-students-add"))).toBe(false);
    const call = screen.getByTestId("guardian-book-call");
    expect(call.getAttribute("href")).toBe(PARENT_CALL_URL);
    expect(call.getAttribute("target")).toBe("_blank");
    expect(call.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("with no invite, Save card needs both Terms, starts a draft, then opens Stripe for it", async () => {
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-card-plan-monthly"));
    fireEvent.click(screen.getByTestId("invite-card-terms"));
    fireEvent.click(screen.getByTestId("invite-card-save"));
    expect(
      await screen.findByText(
        "Agree to the Parent / Guardian Terms to continue.",
      ),
    ).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.click(screen.getByTestId("invite-terms"));
    fireEvent.click(screen.getByTestId("invite-card-save"));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0]).toEqual({
      url: "/api/guardian/invites",
      body: { acceptParentGuardianTerms: true },
    });
    expect(posted[1]).toEqual({
      url: `/api/guardian/invites/${INVITE.id}/card`,
      body: { plan: "monthly", acceptBillingTerms: true },
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
  });

  it("with a card saved, step 1 is done and step 2 opens with Send invite as the filled action", async () => {
    invites = [CARDED];
    mountApp(Router, "/guardian");
    const saved = await screen.findByTestId("invite-card-saved");
    expect(saved.textContent).toContain("Card saved for the Monthly plan");
    expect(screen.queryByTestId("invite-step2-locked")).toBeNull();
    const send = screen.getByTestId("invite-send");
    expect(filled(send)).toBe(true);
    expect(filled(screen.getByTestId("invite-card-change"))).toBe(false);
    expect(filled(screen.getByTestId("invite-new-link"))).toBe(false);

    fireEvent.change(screen.getByTestId("invite-email"), {
      target: { value: "teen@example.test" },
    });
    fireEvent.click(send);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: `/api/guardian/invites/${CARDED.id}/resend`,
      body: { email: "teen@example.test" },
    });
    expect(await screen.findByTestId("invite-sent")).toBeTruthy();
  });

  it("Copy link shows the new link once; Cancel cancels", async () => {
    invites = [CARDED];
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-new-link"));
    await waitFor(() =>
      expect(posted.at(-1)?.url).toBe(
        `/api/guardian/invites/${CARDED.id}/link`,
      ),
    );
    const link = await screen.findByTestId("invite-fresh-link");
    expect((link.querySelector("input") as HTMLInputElement).value).toBe(URL_);
    fireEvent.click(screen.getByTestId("invite-cancel"));
    await waitFor(() =>
      expect(posted.at(-1)?.url).toBe(`/api/guardian/invites/${CARDED.id}`),
    );
  });

  it("an emailed invite shows when it works until, and Resend in place of Send invite", async () => {
    invites = [{ ...CARDED, emailed: true }];
    mountApp(Router, "/guardian");
    expect(await screen.findByText("Waiting for your teen")).toBeTruthy();
    expect(screen.getByTestId("invite-status").textContent).toContain(
      "works until",
    );
    expect(screen.getByTestId("invite-resend").textContent).toBe("Resend");
    expect(screen.queryByTestId("invite-send")).toBeNull();
  });

  it("a draft with no card keeps step 2 locked and step 1 on that draft", async () => {
    invites = [INVITE];
    mountApp(Router, "/guardian");
    expect(await screen.findByTestId("invite-step2-locked")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("invite-card-plan-monthly"));
    fireEvent.click(screen.getByTestId("invite-card-terms"));
    // No Parent Terms box: the draft already recorded them.
    expect(screen.queryByTestId("invite-terms")).toBeNull();
    fireEvent.click(screen.getByTestId("invite-card-save"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toBe(`/api/guardian/invites/${INVITE.id}/card`);
  });

  it("at 3 open invites with cards, no new invite can be started", async () => {
    invites = [
      CARDED,
      { ...CARDED, id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a02" },
      { ...CARDED, id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a03" },
    ];
    mountApp(Router, "/guardian");
    expect(await screen.findAllByTestId("invite-row")).toHaveLength(3);
    expect(screen.queryByTestId("invite-another")).toBeNull();
  });

  it("loading and error states (DESIGN.md §5)", async () => {
    net.handlers.unshift((url) =>
      url === "/api/guardian/invites" ? pending() : undefined,
    );
    mountApp(Router, "/guardian");
    expect(await screen.findByTestId("invite-loading")).toBeTruthy();
    cleanup();
    net.handlers.unshift((url) =>
      url === "/api/guardian/invites" ? json({ error: "x" }, 500) : undefined,
    );
    mountApp(Router, "/guardian");
    expect(await screen.findByTestId("invite-load-error")).toBeTruthy();
  });
});
