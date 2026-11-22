// @vitest-environment jsdom
/**
 * The guardian's no-student state: the "Waiting for your teen" invite card and the call link.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 2, 5, 8; SCL-282; DESIGN.md §5 (one filled
 *        primary action; loading and error states)] | @implemented [2026-11-22]
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
  guardianInviteLinkResponseSchema,
  guardianInvitesResponseSchema,
  type GuardianInviteView,
} from "@lyceon/shared/guardian-invite-schema";
import { PARENT_CALL_URL } from "@lyceon/shared/external-links";

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
  emailed: true,
};
const URL_ = `https://lyceon.test/join/${"Q".repeat(43)}`;

function invitesBody(invites: GuardianInviteView[]): unknown {
  return guardianInvitesResponseSchema.parse({ data: { invites } });
}
function linkBody(emailed: boolean): unknown {
  return guardianInviteLinkResponseSchema.parse({
    data: { invite: { ...INVITE, emailed }, url: URL_, emailed },
  });
}

/** The filled variant: the exact `bg-primary` class (outline carries only `hover:bg-primary`). */
function filled(el: HTMLElement): boolean {
  return el.className.split(/\s+/).includes("bg-primary");
}

let invites: GuardianInviteView[] = [];
const posted: { url: string; body: unknown }[] = [];

beforeEach(() => {
  net.reset();
  invites = [];
  posted.length = 0;
  net.handlers.push((url, init) => {
    if (url === "/api/guardian/invites" && (init?.method ?? "GET") === "GET") {
      return json(invitesBody(invites));
    }
    if (url.startsWith("/api/guardian/invites") && init?.method === "POST") {
      const body: unknown = JSON.parse(String(init.body ?? "{}"));
      posted.push({ url, body });
      const emailed =
        typeof body === "object" && body !== null && "email" in body;
      return json(
        linkBody(emailed),
        url === "/api/guardian/invites" ? 201 : 200,
      );
    }
    if (url.startsWith("/api/guardian/invites/") && init?.method === "DELETE") {
      posted.push({ url, body: null });
      return new Response(null, { status: 204 });
    }
    return undefined;
  });
});
afterEach(cleanup);

describe("the no-student state (rulings 2, 8)", () => {
  it("shows the invite card with Send invite as the one filled action, and the call link", async () => {
    mountApp(Router, "/guardian");
    const send = await screen.findByTestId("invite-send");
    // shadcn's default (filled) variant is the only one carrying bg-primary.
    expect(filled(send)).toBe(true);
    expect(filled(screen.getByTestId("invite-copy-instead"))).toBe(false);
    expect(filled(screen.getByTestId("guardian-no-students-add"))).toBe(false);
    const call = screen.getByTestId("guardian-book-call");
    expect(call.getAttribute("href")).toBe(PARENT_CALL_URL);
    expect(call.getAttribute("target")).toBe("_blank");
    expect(call.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("Copy a link instead needs the Terms, then shows the link once", async () => {
    mountApp(Router, "/guardian");
    fireEvent.click(await screen.findByTestId("invite-copy-instead"));
    expect(
      await screen.findByText(/Agree to the Parent \/ Guardian Terms/),
    ).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.click(screen.getByTestId("invite-terms"));
    fireEvent.click(screen.getByTestId("invite-copy-instead"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: "/api/guardian/invites",
      body: { acceptParentGuardianTerms: true },
    });
    const link = await screen.findByTestId("invite-fresh-link");
    expect((link.querySelector("input") as HTMLInputElement).value).toBe(URL_);
  });

  it("Send invite posts the address with the Terms and confirms it was sent", async () => {
    mountApp(Router, "/guardian");
    fireEvent.change(await screen.findByTestId("invite-email"), {
      target: { value: "teen@example.test" },
    });
    fireEvent.click(screen.getByTestId("invite-terms"));
    fireEvent.click(screen.getByTestId("invite-send"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({
      email: "teen@example.test",
      acceptParentGuardianTerms: true,
    });
    expect(await screen.findByTestId("invite-sent")).toBeTruthy();
  });

  it("an open invite shows when it works until, with Resend, Copy new link and Cancel", async () => {
    invites = [INVITE];
    mountApp(Router, "/guardian");
    expect(await screen.findByText("Waiting for your teen")).toBeTruthy();
    expect(screen.getByTestId("invite-status").textContent).toContain(
      "works until",
    );
    fireEvent.click(screen.getByTestId("invite-new-link"));
    await waitFor(() =>
      expect(posted.at(-1)?.url).toBe(
        `/api/guardian/invites/${INVITE.id}/link`,
      ),
    );
    expect(await screen.findByTestId("invite-fresh-link")).toBeTruthy();
    fireEvent.click(screen.getByTestId("invite-cancel"));
    await waitFor(() =>
      expect(posted.at(-1)?.url).toBe(`/api/guardian/invites/${INVITE.id}`),
    );
  });

  it("at 3 open invites the form gives way to the limit line", async () => {
    invites = [
      INVITE,
      { ...INVITE, id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a02" },
      { ...INVITE, id: "0b0e6f9e-2f7a-4d77-9c11-2d6d5c1f0a03" },
    ];
    mountApp(Router, "/guardian");
    expect(await screen.findByText(/You have 3 open invites/)).toBeTruthy();
    expect(screen.queryByTestId("invite-new")).toBeNull();
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
