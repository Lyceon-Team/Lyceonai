// @vitest-environment jsdom
/**
 * G4-08 — a guardian's /profile is a guardian page: the guardian shell, guardian sections only.
 *
 * @spec [Guardian_Closure_Plan G4-08 named proof: "an RTL test: a guardian on /profile sees no
 *       student nav items"; CLAUDE.md guardian model (view-only; no LISA)] | @implemented [2026-09-30]
 *
 * plain English: the REAL route switch at `/profile`, signed in as a guardian. The page is
 * inside `GuardianShell` (one shell on every guardian page, G4-01), there is no link to any
 * student destination (Dashboard, Calendar, Practice, Tests, Review, Lisa), no Progress tab
 * (the student's own practice figures), and billing points to Linked students & billing
 * (G4-10). Presence first: the guardian's own profile and settings render before the absences
 * are checked.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navItems } from "@/components/layout/app-shell";
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
// The profile page reads through the default query function as well as `csrfFetch`.
vi.mock("@/lib/queryClient", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/queryClient")>();
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    ...actual,
    apiRequest: vi.fn(async (url: string, init?: RequestInit) =>
      fetcher(url, init),
    ),
  };
});

const { Router } = await import("@/App");

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
  net.handlers.push((url) =>
    url === "/api/billing/status" ? json(billingStatus()) : undefined,
  );
});
afterEach(cleanup);

describe("G4-08 the guardian's /profile", () => {
  it("renders inside the guardian shell with no student navigation", async () => {
    mountApp(Router, "/profile");
    expect(await screen.findByTestId("page-title")).toBeTruthy();
    expect(screen.getByTestId("guardian-shell")).toBeTruthy();
    expect(screen.getByTestId("tab-profile")).toBeTruthy();
    expect(screen.getByTestId("tab-settings")).toBeTruthy();

    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    for (const item of navItems) {
      expect(hrefs).not.toContain(item.href);
    }
    // The student's own practice figures are not a guardian section.
    expect(screen.queryByTestId("tab-progress")).toBeNull();
  });

  it("sends billing to Linked students & billing", async () => {
    mountApp(Router, "/profile");
    const tab = await screen.findByTestId("tab-billing");
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const link = await screen.findByTestId("profile-guardian-billing");
    expect(link.getAttribute("href")).toBe("/guardian/students");
  });
});
