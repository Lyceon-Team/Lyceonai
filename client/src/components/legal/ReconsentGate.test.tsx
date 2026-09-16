// @vitest-environment jsdom
/**
 * @spec [LYCEON consent capture §6; owner ruling 2026-09-16 — the re-consent
 *        prompt is non-blocking for guardians; Coding Standards §14]
 * @implemented 2026-09-16
 *
 * plain English: the five claims the non-blocking ruling rests on, each written
 * so the obvious way to break it turns this file red. Every one was proved by a
 * plant — watched failing against a deliberately broken tree before trusting it
 * green.
 *
 *   R1  a guardian with an outstanding document sees the prompt AND can dismiss it
 *   R2  after dismissing, the dashboard behind it is fully usable
 *   R3  the prompt returns at the next sign-in
 *   R4  accepting posts to the server, which resolves slug/version/hash itself
 *   R5  dismissing writes nothing — no request, no storage claiming consent
 *
 * These drive the REAL `RequireRole` against a real `ReconsentModal`, because
 * the thing under test is the gate's decision, not the modal in isolation. A
 * test that rendered the modal directly would pass with the gate wired the old
 * blocking way for everybody, which is precisely the regression to catch.
 *
 * WHAT IS STUBBED AND WHY. `useSupabaseAuth` and `csrfFetch` only — the seams
 * where this component meets the network and the session. Role, outstanding
 * documents and the server's answer are the inputs the claims vary; everything
 * between them is the code under test.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GUARDIAN_ID = "99999999-9999-4999-8999-999999999999";
const STUDENT_ID = "88888888-8888-4888-8888-888888888888";

const signOutMock = vi.fn();
const authState = {
  user: { id: GUARDIAN_ID } as { id: string } | null,
  authLoading: false,
  isAdmin: false,
  isGuardian: true,
};

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ ...authState, signOut: signOutMock }),
}));

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
  clearCsrfToken: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/guardian", vi.fn()],
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));

vi.mock("@lyceon/shared/return-path", () => ({
  loginPathWithReturn: (p: string) => `/login?next=${encodeURIComponent(p)}`,
}));

/** An outstanding Parent / Guardian Terms, shaped as `/api/profile` emits it. */
const OUTSTANDING = [
  {
    slug: "parent-guardian-terms",
    docKey: "parent_guardian_terms",
    title: "LYCEON Parent / Guardian Terms",
    version: "2.0",
    effectiveDate: "2026-09-11",
    acceptedVersion: "1.0",
  },
];

function profilePayload(outstandingLegal: unknown[]): unknown {
  return {
    authenticated: true,
    user: {
      id: GUARDIAN_ID,
      role: "guardian",
      profileCompletedAt: "2026-01-01T00:00:00Z",
      requiredProfileComplete: true,
      guardianConsentRequired: false,
      outstandingLegal,
    },
  };
}

async function renderGate(
  outstandingLegal: unknown[] = OUTSTANDING,
  allow: Array<"student" | "guardian" | "admin"> = ["guardian"],
) {
  csrfFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/profile") {
      return {
        ok: true,
        status: 200,
        json: async () => profilePayload(outstandingLegal),
      };
    }
    if (url === "/api/legal/reaccept") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, recorded: 1 }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const { RequireRole } = await import("@/components/auth/RequireRole");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      <RequireRole allow={allow}>
        <div data-testid="guardian-dashboard">
          <button data-testid="dashboard-action">Buy a subscription</button>
          <span data-testid="student-name">{STUDENT_ID}</span>
        </div>
      </RequireRole>
    </QueryClientProvider>,
  );
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authState.user = { id: GUARDIAN_ID };
  authState.isGuardian = true;
  authState.isAdmin = false;
});

afterEach(() => {
  window.sessionStorage.clear();
});

// ── R1 ──────────────────────────────────────────────────────────────────

describe("R1 — a guardian sees the prompt and can dismiss it", () => {
  it("shows the prompt, marked dismissible, naming the document", async () => {
    await renderGate();

    const modal = await screen.findByTestId("reconsent-modal");
    expect(modal).toBeTruthy();
    // The mode is on the element, so "dismissible" is observable rather than
    // inferred from the presence of a button that might be there for other
    // reasons.
    expect(modal.getAttribute("data-dismissible")).toBe("true");
    expect(screen.getByText("LYCEON Parent / Guardian Terms")).toBeTruthy();
  });

  it("offers a close control and `Not now`, never `Sign out`", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");

    expect(screen.getByTestId("reconsent-dismiss")).toBeTruthy();
    expect(screen.getByTestId("reconsent-not-now")).toBeTruthy();
    // Signing out is the blocked person's only exit. Offering it here would
    // imply a consequence a guardian does not face.
    expect(screen.queryByTestId("reconsent-sign-out")).toBeNull();
  });

  it("closes on `Not now`", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");

    fireEvent.click(screen.getByTestId("reconsent-not-now"));

    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );
  });

  it("links the document rather than restating it", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");

    const link = screen
      .getByText("LYCEON Parent / Guardian Terms")
      .closest("a");
    expect(link?.getAttribute("href")).toBe("/legal/parent-guardian-terms");
  });
});

// ── R2 ──────────────────────────────────────────────────────────────────

describe("R2 — after dismissing, the dashboard is fully usable", () => {
  it("renders the dashboard BEHIND the prompt, and still after dismissal", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");

    // Non-blocking means the children are mounted even while the prompt is up —
    // the blocking mode returns the modal INSTEAD of them.
    expect(screen.getByTestId("guardian-dashboard")).toBeTruthy();

    fireEvent.click(screen.getByTestId("reconsent-not-now"));

    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );
    expect(screen.getByTestId("guardian-dashboard")).toBeTruthy();
    // Not merely present: reachable and clickable, with nothing over it.
    const action = screen.getByTestId("dashboard-action");
    expect(action).toBeTruthy();
    fireEvent.click(action);
    expect(screen.getByTestId("student-name").textContent).toBe(STUDENT_ID);
  });

  it("walls a STUDENT with the same outstanding document", async () => {
    // The counterpart, and the reason R2 is not vacuous: if the gate blocked
    // nobody, every assertion above would pass while the ruling had been
    // applied to everyone. Students are unchanged — the modal REPLACES the
    // product, so the dashboard is not in the tree at all.
    // The allow-list has to match the role, or RequireRole redirects on ROLE
    // before the consent gate runs and the test proves nothing.
    authState.isGuardian = false;
    await renderGate(OUTSTANDING, ["student"]);

    const modal = await screen.findByTestId("reconsent-modal");
    expect(modal.getAttribute("data-dismissible")).toBe("false");
    expect(screen.queryByTestId("guardian-dashboard")).toBeNull();
    expect(screen.queryByTestId("reconsent-not-now")).toBeNull();
    expect(screen.queryByTestId("reconsent-dismiss")).toBeNull();
    expect(screen.getByTestId("reconsent-sign-out")).toBeTruthy();
  });
});

// ── R3 ──────────────────────────────────────────────────────────────────

describe("R3 — the prompt returns at the next sign-in", () => {
  it("survives a remount (navigation) but not a sign-out", async () => {
    const first = await renderGate();
    await screen.findByTestId("reconsent-modal");
    fireEvent.click(screen.getByTestId("reconsent-not-now"));
    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );

    // Navigation remounts RequireRole. The dismissal must survive it, or one
    // click would buy exactly one page.
    first.unmount();
    await renderGate();
    // WAIT FOR SOMETHING POSITIVE FIRST. An earlier draft went straight to
    // `waitFor(... toBeNull())` here, which passed on the first tick — before
    // the profile query had resolved and before the prompt could have rendered
    // at all. It therefore passed against a tree with the storage read deleted,
    // and the plant caught it. The dashboard appearing proves the query landed;
    // only then does the prompt's absence mean anything.
    await screen.findByTestId("guardian-dashboard");
    expect(screen.queryByTestId("reconsent-modal")).toBeNull();

    // Signing out ends the session, and the prompt is owed again. This is the
    // clear that sessionStorage alone does NOT give us: it survives sign-out
    // and dies only with the tab.
    const { clearReconsentDismissal } = await import("./reconsent-dismissal");
    clearReconsentDismissal();

    await renderGate();
    expect(await screen.findByTestId("reconsent-modal")).toBeTruthy();
  });

  it("is wired into the auth context's sign-out, not left to the caller", async () => {
    // Behaviour above proves the function works; this proves it is CALLED.
    // Without the call the prompt would never return within a tab.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../contexts/SupabaseAuthContext.tsx"),
      "utf-8",
    );
    const start = src.indexOf("const clearAuthState");
    expect(start, "clearAuthState not found").toBeGreaterThan(-1);
    // To the function's own closing brace. A fixed character count made this
    // assertion a hostage to comment length — it went red when the WHY was
    // written down, which is the wrong thing to punish.
    const body = src.slice(start, src.indexOf("\n  };", start));
    expect(body).toContain("clearReconsentDismissal()");
  });

  it("does not leak a dismissal across accounts in one tab", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");
    fireEvent.click(screen.getByTestId("reconsent-not-now"));
    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );

    authState.user = { id: "77777777-7777-4777-8777-777777777777" };
    await renderGate();
    expect(await screen.findByTestId("reconsent-modal")).toBeTruthy();
  });
});

// ── R4 ──────────────────────────────────────────────────────────────────

describe("R4 — accepting records the acceptance", () => {
  it("posts to /api/legal/reaccept with NO body", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");

    fireEvent.click(screen.getByTestId("reconsent-accept"));

    await waitFor(() => {
      const call = csrfFetchMock.mock.calls.find(
        (c) => c[0] === "/api/legal/reaccept",
      );
      expect(call, "no POST to /api/legal/reaccept").toBeTruthy();
      expect((call?.[1] as { method?: string })?.method).toBe("POST");
      // The client names no document and no version. Slug, version and hash are
      // resolved server-side from legal/ at the moment of acceptance — a client
      // that sent them would be asserting what it was shown.
      expect((call?.[1] as { body?: unknown })?.body).toBeUndefined();
    });
  });

  it("the server route resolves slug, version and hash and stamps the source", async () => {
    // The wire half is above; this is the half that decides what lands in the
    // row. Asserted against the route source because the claim is about which
    // values it uses, and a stubbed Supabase would let a hardcoded version pass.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../../../server/routes/legal-routes.ts"),
      "utf-8",
    );
    const reaccept = route.slice(route.indexOf('legalRouter.post("/reaccept"'));

    expect(reaccept).toContain("resolveLegalVersion");
    expect(reaccept).toContain("docSlug: current.slug");
    expect(reaccept).toContain("docVersion: current.version");
    expect(reaccept).toContain("contentHash: current.contentHash");
    expect(reaccept).toContain('consentSource: "reconsent_prompt"');
    // Never a literal version or hash, in either mode.
    expect(reaccept).not.toMatch(/docVersion:\s*["'`]/);
    expect(reaccept).not.toMatch(/sha256:[0-9a-f]{64}/);
  });
});

// ── R5 ──────────────────────────────────────────────────────────────────

describe("R5 — dismissing writes nothing", () => {
  it("sends no request at all", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");
    csrfFetchMock.mockClear();

    fireEvent.click(screen.getByTestId("reconsent-not-now"));
    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );

    // Not "no reaccept call" — NO call. A dismissal that quietly posted
    // anything would be the partial state this design refuses.
    expect(csrfFetchMock).not.toHaveBeenCalled();
  });

  it("stores only a dismissal flag, never anything resembling consent", async () => {
    await renderGate();
    await screen.findByTestId("reconsent-modal");
    fireEvent.click(screen.getByTestId("reconsent-not-now"));
    await waitFor(() =>
      expect(screen.queryByTestId("reconsent-modal")).toBeNull(),
    );

    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k !== null) keys.push(k);
    }
    expect(keys).toEqual([`lyceon.reconsent.dismissed.${GUARDIAN_ID}`]);

    const stored = window.sessionStorage.getItem(keys[0]!) ?? "";
    for (const forbidden of [
      "accept",
      "consent",
      "sha256",
      "2.0",
      "parent-guardian-terms",
    ]) {
      expect(
        stored.toLowerCase().includes(forbidden),
        `the dismissal flag carries "${forbidden}"`,
      ).toBe(false);
    }
  });

  it("offers no `don't show again`", async () => {
    // A control that suppressed the prompt for good while writing nothing would
    // tell a person their choice was saved when the only thing saved is silence.
    await renderGate();
    const modal = await screen.findByTestId("reconsent-modal");
    const text = (modal.textContent ?? "").toLowerCase();
    for (const phrase of [
      "don't show",
      "do not show",
      "dont show",
      "remind me",
      "never show",
    ]) {
      expect(text.includes(phrase), `prompt offers "${phrase}"`).toBe(false);
    }
  });
});
