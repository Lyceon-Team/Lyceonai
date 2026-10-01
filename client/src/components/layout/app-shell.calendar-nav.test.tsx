// @vitest-environment jsdom
/**
 * The calendar is REACHABLE — there is a tab, every student sees it, and it goes to /calendar.
 *
 * @spec [Doc_05F_Study_Calendar, §17.1 the student's own calendar, §16 entitlement,
 *        §7.12 access boundary]
 *       [lyceon-coding-standards §11.3 — UI may show or hide by role, the server always enforces]
 * | @implemented [2026-09-22]
 *
 * WHY THIS FILE EXISTS. The calendar shipped complete and unreachable: the deletion PR removed
 * its nav item and nothing put one back, so for a student the page existed only if they typed
 * the URL. Every test in the suite passed throughout — none of them asked whether anyone could
 * GET there. A feature nobody can reach is not a smaller feature, it is an absent one, and the
 * absence has to be able to turn a test red.
 *
 * THE SECOND ASSERTION IS THE LOAD-BEARING ONE. A free student must see the tab too. §16 makes
 * the calendar premium for the SUBJECT, and the instinct is to hide the tab from anyone who
 * cannot use the page — but hiding it is exactly how it became unreachable, and it is also the
 * client deciding access, which §7.12 forbids. The page answers 402 with the shared
 * PremiumUpgradePrompt; that IS the upsell path. A missing tab is not a paywall, it is a
 * dead end, so "the tab is hidden for a free student" must fail here.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

type TestUser = {
  id: string;
  email: string;
  display_name: string;
  role: "student" | "guardian";
  /** Whatever the client happens to believe about entitlement. Never a gate. */
  has_active_entitlement?: boolean;
};

let authState: {
  user: TestUser | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isGuardian: boolean;
  signOut: () => Promise<void>;
};

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { unread: 0 }, requestId: "test" }),
  })),
}));

function signIn(user: Partial<TestUser> & { role: "student" | "guardian" }) {
  authState = {
    user: {
      id: "student-1",
      email: "student@example.test",
      display_name: "Sam",
      ...user,
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isGuardian: user.role === "guardian",
    signOut: vi.fn(async () => {}),
  };
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <div>page body</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  signIn({ role: "student", has_active_entitlement: true });
});

describe("the student shell offers a way to the calendar (§17.1)", () => {
  it("renders a Calendar tab in the header chrome", () => {
    renderShell();
    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    // In the CHROME, not somewhere in the body: a link the page happens to render is not
    // navigation, and would disappear with the page.
    const tabs = within(header as HTMLElement).getAllByTestId("nav-calendar");
    expect(tabs.length).toBeGreaterThan(0);
  });

  it("points at /calendar", () => {
    renderShell();
    const header = document.querySelector("header") as HTMLElement;
    // Query the anchor that CARRIES the href rather than walking up from the testid.
    //
    // NOTE, and it is not this brief's to fix: NavLink writes `<Link href><a …></Link>`,
    // which is the wouter v2 idiom. Under wouter v3 that renders a NESTED anchor —
    // `<a href="/calendar"><a data-testid="nav-calendar">` — and React warns
    // "validateDOMNesting: <a> cannot appear as a descendant of <a>". The inner anchor,
    // the one holding the testid, therefore has no href at all. Every nav item in this
    // shell has looked like that since the wouter 3 upgrade, and the same pattern appears
    // in sixteen files across the client, so correcting it is a change to shared chrome
    // and not a calendar change. Asserting on `a[href]` is both the honest assertion —
    // that attribute is what a middle-click, a new tab and a screen reader read — and the
    // one that keeps passing unchanged once the nesting is repaired.
    const anchor = header.querySelector('a[href="/calendar"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.textContent).toContain("Calendar");
  });

  it("shows it to a FREE student — the 402 page is the upsell, a hidden tab is a dead end", () => {
    signIn({ role: "student", has_active_entitlement: false });
    renderShell();
    expect(screen.getAllByTestId("nav-calendar").length).toBeGreaterThan(0);
  });

  it("sits beside Practice and Review rather than somewhere of its own", () => {
    renderShell();
    // Order matters to the brief ("beside Practice and Review"), and reading the rendered
    // order is what proves it — asserting the array in the source would assert the source.
    const labels = screen
      .getAllByTestId(/^nav-/)
      .map((el) => el.getAttribute("data-testid"))
      .filter((id): id is string => id !== null);
    const first = (id: string) => labels.indexOf(id);
    expect(first("nav-calendar")).toBeGreaterThanOrEqual(0);
    expect(first("nav-calendar")).toBeLessThan(first("nav-practice"));
    expect(first("nav-practice")).toBeLessThan(first("nav-review"));
  });

  it("negative control: a page that has no tab is not found by the same query", () => {
    // Without a control, every assertion above could be passing against a query that
    // matches anything. /mastery is a real, reachable page that is deliberately NOT in the
    // header, so it is the right thing to look for and not find.
    //
    // The first draft of this control asserted that a SIGNED-OUT shell renders no nav.
    // That was wrong about this component, not about the code: AppHeader renders navItems
    // unconditionally and the route guards do the gating, so the assertion failed while
    // nothing was broken. Recorded because "the control failed" is exactly the moment to
    // check which of the two is mistaken.
    renderShell();
    expect(screen.queryAllByTestId("nav-mastery")).toHaveLength(0);
    expect(
      (document.querySelector("header") as HTMLElement).querySelector(
        'a[href="/mastery"]',
      ),
    ).toBeNull();
  });
});
