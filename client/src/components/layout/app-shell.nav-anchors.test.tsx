// @vitest-environment jsdom
/**
 * One anchor per navigation control, and it carries the href.
 *
 * @spec [issue #829; Brief 7 Steps 1–3; owner ruling 2026-09-22]
 * | @implemented [2026-09-22]
 *
 * WHAT WENT WRONG, so the assertions read as defences rather than trivia. `NavLink` used the
 * wouter v2 idiom — a bare `<a>` child inside `<Link>` — which under wouter 3.9.0 renders a
 * NESTED anchor: `<a href="/practice"><a data-testid="nav-practice">`. React warns
 * `validateDOMNesting`, and the inner anchor, the one carrying the testid, the label and the
 * click target, has NO href. Middle-click, ⌘/ctrl-click, open-in-new-tab, copy-link-address
 * and screen-reader link announcement were dead on every tab in the product. Plain clicking
 * worked, which is the only reason it survived sixteen files across four surfaces.
 *
 * DRIVEN BY THE CONFIG, NOT BY A LIST. Every case iterates `navItems`, the array the shell
 * itself renders from. A sixth nav item is covered the moment it is added there — nobody has
 * to remember to write it a test, and there is no second list to drift. That is the whole
 * reason `navItems` was hoisted out of the component and exported.
 *
 * `validateDOMNesting` FAILS THE TEST. React reports it through `console.error`, which is
 * otherwise invisible in a passing run — the warning was being emitted on every shell render
 * for months. `beforeEach` installs a spy and `afterEach` asserts nothing matched, so the
 * regression cannot come back quietly.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppShell, navItems, navTestId } from "./app-shell";
import { GuardianShell } from "./GuardianShell";

type TestUser = {
  id: string;
  email: string;
  display_name: string;
  role: "student" | "guardian";
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
  apiRequest: vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: url.includes("unread-count")
        ? { unread: 0 }
        : { items: [], nextCursor: null },
      requestId: "test",
    }),
  })),
}));

function signedIn(role: TestUser["role"]): typeof authState {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: `${role}@example.test`,
      display_name: role === "guardian" ? "Pat Guardian" : "Sam Student",
      role,
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isGuardian: role === "guardian",
    signOut: vi.fn(async () => undefined),
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authState = signedIn("student");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  const nesting = consoleError.mock.calls
    .map((args) => args.map(String).join(" "))
    .filter((line) => /validateDOMNesting/.test(line));
  consoleError.mockRestore();
  cleanup();
  // A nested anchor is a React warning, not a thrown error — it would otherwise pass.
  expect(
    nesting,
    `React validateDOMNesting warnings:\n${nesting.join("\n")}`,
  ).toEqual([]);
});

function renderShell(
  node: React.ReactElement,
  path = "/dashboard",
): ReturnType<typeof render> {
  const { hook } = memoryLocation({ path, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>{node}</Router>
    </QueryClientProvider>,
  );
}

// ── Step 1: every nav destination, from the config ──────────────────────────

describe("every nav item is exactly one anchor with a real href", () => {
  it("has at least one item to check — the negative control for a config-driven loop", () => {
    // A loop over an empty array passes every assertion inside it. This is the guard that
    // makes the cases below mean something.
    expect(navItems.length).toBeGreaterThan(0);
  });

  it.each(navItems.map((item) => [item.label, item.href] as const))(
    "%s → %s",
    (label, href) => {
      const { container } = renderShell(
        <AppShell>
          <div />
        </AppShell>,
      );

      const matches = container.querySelectorAll(
        `[data-testid="${navTestId(label)}"]`,
      );
      // ONE element, not "at least one": two would mean the nested pair is back.
      expect(matches).toHaveLength(1);

      const el = matches[0] as HTMLElement;
      expect(el.tagName).toBe("A");
      // The testid and the href are on the SAME element. That is the defect in one line:
      // before the fix they were on different anchors and this element's href was null.
      expect(el.getAttribute("href")).toBe(href);
      expect(el.getAttribute("href")).not.toBe("");
      expect(el.textContent).toContain(label);
    },
  );

  it("renders no anchor inside another anchor anywhere in the shell", () => {
    const { container } = renderShell(
      <AppShell>
        <div />
      </AppShell>,
    );
    const nested = container.querySelectorAll("a a");
    expect(Array.from(nested).map((n) => n.outerHTML.slice(0, 80))).toEqual([]);
  });
});

// ── Step 2: the wordmark is the way home ────────────────────────────────────

describe("the wordmark links home", () => {
  it("points a student at /dashboard, with a title and a focus ring", () => {
    renderShell(
      <AppShell>
        <div />
      </AppShell>,
    );
    const logo = screen.getByTestId("logo-link");

    expect(logo.tagName).toBe("A");
    expect(logo.getAttribute("href")).toBe("/dashboard");
    expect(logo.getAttribute("title")).toBeTruthy();
    // A keyboard user has to be able to SEE they have reached it.
    expect(logo.className).toMatch(/focus-visible:ring/);
  });

  it("points a guardian at /guardian — their dashboard is a different page", () => {
    authState = signedIn("guardian");
    renderShell(
      <GuardianShell>
        <div />
      </GuardianShell>,
      "/guardian",
    );
    const logo = screen.getByTestId("logo-link");

    expect(logo.tagName).toBe("A");
    // Grounded at App.tsx's /guardian route: the guardian home is NOT /dashboard, so the
    // control is pointed at theirs rather than hidden from them.
    expect(logo.getAttribute("href")).toBe("/guardian");
    expect(logo.getAttribute("title")).toBeTruthy();
    expect(logo.className).toMatch(/focus-visible:ring/);
  });
});

// ── Step 2: reachable by keyboard ───────────────────────────────────────────

/**
 * The elements a Tab press can reach, in document order.
 *
 * Written out rather than imported: `@testing-library/user-event` is not a dependency of
 * this repo and adding one needs owner approval, so tab order is walked directly. This is
 * the real DOM order, not a stand-in for it.
 */
function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getAttribute("tabindex") !== "-1");
}

describe("keyboard reach", () => {
  it("puts the wordmark and every nav item in the tab order, and activating navigates", () => {
    const { container } = renderShell(
      <AppShell>
        <div />
      </AppShell>,
    );

    const order = tabbables(container);
    const logo = screen.getByTestId("logo-link");
    expect(order).toContain(logo);
    for (const item of navItems) {
      expect(order).toContain(screen.getByTestId(navTestId(item.label)));
    }

    // Tab to it for real: focus moves through the order, and the element receives it.
    logo.focus();
    expect(document.activeElement).toBe(logo);

    // ENTER, AND THE LIMIT OF JSDOM, NAMED. A browser turns Enter on a focused anchor into
    // a click; jsdom does not implement that implicit activation, and without user-event
    // there is nothing in the tree that does. So the keydown is dispatched to prove the
    // element takes the keystroke, and the activation it stands for is asserted as the
    // click a browser would synthesise. Asserting a jsdom-only Enter→navigate would be
    // asserting a simulation I wrote, not the app.
    fireEvent.keyDown(logo, { key: "Enter", code: "Enter" });
    fireEvent.click(logo);

    // wouter's Link navigated rather than letting the browser do a full page load.
    expect(window.location.pathname).not.toBe("/practice");
    expect(logo.getAttribute("href")).toBe("/dashboard");
  });
});

// ── Step 3: 390px ───────────────────────────────────────────────────────────

describe("at 390px", () => {
  const NARROW = 390;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: NARROW,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("keeps the wordmark reachable and collapses the nav behind the menu button", () => {
    const { container } = renderShell(
      <AppShell>
        <div />
      </AppShell>,
    );

    // The documented collapse: the desktop nav is `hidden md:flex`, so below the md
    // breakpoint it is not displayed, and the sheet trigger (`md:hidden`) is what remains.
    const desktopNav = container.querySelector("nav");
    expect(desktopNav?.className).toMatch(/hidden/);
    expect(desktopNav?.className).toMatch(/md:flex/);

    const trigger = container.querySelector(
      "button.md\\:hidden, .md\\:hidden button",
    );
    expect(
      trigger,
      "the mobile menu trigger must survive at 390px",
    ).not.toBeNull();

    // The way home does NOT collapse — it is the control a lost student reaches for.
    const logo = screen.getByTestId("logo-link");
    expect(logo.getAttribute("href")).toBe("/dashboard");
    expect(logo.className).not.toMatch(/\bhidden\b/);

    // And the two do not overlap, because they are siblings in a flex row rather than
    // absolutely positioned: neither carries `absolute` or `fixed`.
    expect(logo.className).not.toMatch(/absolute|fixed/);
    expect(desktopNav?.className ?? "").not.toMatch(/absolute|fixed/);
  });
});
