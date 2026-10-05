// @vitest-environment jsdom
/**
 * UI-41: the App shell's rail, its lock states, the mobile bar, the panel slot and the footer.
 *
 * @spec [student-UI register UI-41; §2 Free versus paid (LISA and Full-Length open the modal in
 *        place with no navigation and no call to the gated endpoint; ruling 3: Calendar keeps the
 *        lock as a hint and navigates); OQ-29 (map on GET /api/profile, reason plan | age; under
 *        13 gets the age message); OQ-4 (five tabs); OQ-47 (bell in the rail above Help, ruled
 *        2026-10-03); OQ-48 (the admin exception); owner ruling (Karl, 2026-10-05; supersedes
 *        OQ-4's tab bar and OQ-48's menu order: tabs Home, Practice, Review, Calendar, LISA;
 *        avatar menu Full-Length, Settings, Help, Sign out); DESIGN.md §1 (3px focus ring,
 *        nothing below 14px), §2; issue #829 (one anchor per nav item, with its href)]
 *        | @implemented [2026-10-03; mobile tab bar and menu 2026-10-05]
 *
 * THE MAP IS THE SERVER'S. Every fixture below is the output of `resolveFeatureAccess`, the
 * function GET /api/profile calls, with only the entitlement answers stubbed (and the real age
 * gate). It reaches the shell the way production does: as the `featureAccess` field of the cached
 * profile response, parsed by `useFeatureAccess`. No hand-written map is used.
 *
 * Driven by `RAIL_ITEMS`, the array the rail renders, so an added item is covered at once.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { AppShell, AppShellPanel, RAIL_ITEMS } from "./app-shell";
import { GuardianShell } from "./GuardianShell";
import { HELP_PATH } from "./LegalFooter";
import { resolveFeatureAccess } from "../../../../server/lib/feature-access";

type TestUser = {
  id: string;
  email: string;
  display_name: string;
  role: "student" | "guardian" | "admin";
};

let authState: {
  user: TestUser | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
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
vi.mock("../../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));
const entitlement = { paid: false };
vi.mock("../../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";

/** The real producer's map for a student (OQ-29), with the entitlement answer chosen. */
async function serverMap(opts: {
  paid: boolean;
  under13: boolean;
}): Promise<FeatureAccessMap> {
  entitlement.paid = opts.paid;
  const map = await resolveFeatureAccess({
    id: STUDENT_ID,
    role: "student",
    is_under_13: opts.under13,
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

function signedIn(role: TestUser["role"]): typeof authState {
  return {
    user: {
      id: STUDENT_ID,
      email: `${role}@example.test`,
      display_name: role === "guardian" ? "Pat Guardian" : "Sam Student",
      role,
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: role === "admin",
    isGuardian: role === "guardian",
    signOut: vi.fn(async () => undefined),
  };
}

/** Every URL the page asked the network for during the test. */
let fetched: string[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authState = signedIn("student");
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  const nesting = consoleError.mock.calls
    .map((args: unknown[]) => args.map(String).join(" "))
    .filter((line: string) =>
      /validateDOMNesting|cannot be a descendant/.test(line),
    );
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
  expect(nesting, nesting.join("\n")).toEqual([]);
});

type Rendered = ReturnType<typeof render> & { history: string[] };

function renderShell(
  map: FeatureAccessMap | null,
  opts: {
    path?: string;
    node?: React.ReactElement;
  } = {},
): Rendered {
  const { hook, history } = memoryLocation({
    path: opts.path ?? "/dashboard",
    record: true,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The profile response as GET /api/profile sends it (featureAccess at the top level).
  queryClient.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial={false}>
          {opts.node ?? (
            <AppShell>
              <div data-testid="page-body" />
            </AppShell>
          )}
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  return Object.assign(rendered, { history });
}

const GATED_URL = /\/api\/(tests|tutor|calendar|exam|students\/[^/]+\/mastery)/;

const byKey = (key: string) => {
  const item = RAIL_ITEMS.find((i) => i.key === key);
  if (item === undefined) throw new Error(`no rail item ${key}`);
  return item;
};

describe("the rail, from RAIL_ITEMS (DESIGN.md §2 order)", () => {
  it("has the six items in the design's order (negative control for the loops below)", () => {
    expect(RAIL_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Practice",
      "Review",
      "Full-Length",
      "Calendar",
      "LISA",
    ]);
  });

  it("paid student: every item is one anchor with its href, no lock, and clicking navigates", async () => {
    const map = await serverMap({ paid: true, under13: false });
    for (const item of RAIL_ITEMS) {
      const { container, history } = renderShell(map);
      const matches = container.querySelectorAll(
        `[data-testid="rail-${item.key}"]`,
      );
      expect(matches).toHaveLength(1);
      const el = matches[0] as HTMLElement;
      expect(el.tagName).toBe("A");
      expect(el.getAttribute("href")).toBe(item.href);
      expect(el.textContent).toContain(item.label);
      expect(screen.queryByTestId(`rail-${item.key}-lock`)).toBeNull();
      fireEvent.click(el);
      expect(history.at(-1)).toBe(item.href);
      cleanup();
    }
  });

  it("marks only the active item aria-current=page", async () => {
    const map = await serverMap({ paid: true, under13: false });
    renderShell(map, { path: "/practice/topics" });
    for (const item of RAIL_ITEMS) {
      const el = screen.getByTestId(`rail-${item.key}`);
      expect(el.getAttribute("aria-current")).toBe(
        item.key === "practice" ? "page" : null,
      );
    }
  });

  it("no anchor is nested in another anywhere in the shell", async () => {
    const { container } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });
});

describe("free plan locks (reason plan)", () => {
  it.each(["full-length", "lisa"] as const)(
    "%s: a lock, and a click opens the upgrade modal in place with no navigation and no gated request",
    async (key) => {
      const item = byKey(key);
      const feature = item.lock?.feature;
      if (feature === undefined) throw new Error("expected a lockable item");
      const { history } = renderShell(
        await serverMap({ paid: false, under13: false }),
      );

      const el = screen.getByTestId(`rail-${key}`);
      expect(screen.getByTestId(`rail-${key}-lock`)).toBeTruthy();
      // A button: there is no href to follow, so nothing can navigate.
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("href")).toBeNull();
      expect(el.getAttribute("aria-label")).toBe(
        `${item.label}, included with a paid plan`,
      );

      fireEvent.click(el);

      const modal = await screen.findByTestId("upgrade-modal");
      expect(modal.textContent).toContain(
        UPGRADE_MODAL_COPY[feature].plan.title,
      );
      expect(screen.getByTestId("upgrade-modal-see-plans")).toBeTruthy();
      expect(history).toEqual(["/dashboard"]);
      expect(fetched.filter((u) => GATED_URL.test(u))).toEqual([]);
    },
  );

  it("calendar: the lock is a hint and the link navigates (ruling 3), no modal", async () => {
    const { history } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    const el = screen.getByTestId("rail-calendar");
    expect(screen.getByTestId("rail-calendar-lock")).toBeTruthy();
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/calendar");
    fireEvent.click(el);
    expect(history.at(-1)).toBe("/calendar");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("home, practice and review carry no lock on the free plan", async () => {
    renderShell(await serverMap({ paid: false, under13: false }));
    for (const key of ["home", "practice", "review"]) {
      expect(screen.queryByTestId(`rail-${key}-lock`)).toBeNull();
      expect(screen.getByTestId(`rail-${key}`).tagName).toBe("A");
    }
  });
});

describe("under-13 (reason age, OQ-29)", () => {
  it("LISA opens the modal with the age message and no plans button", async () => {
    const map = await serverMap({ paid: true, under13: true });
    // The producer, not this test, decides the reason.
    expect(map.tutor_access).toEqual({ access: "locked", reason: "age" });
    const { history } = renderShell(map);

    const el = screen.getByTestId("rail-lisa");
    expect(el.getAttribute("aria-label")).toBe(
      "LISA, not available on your account",
    );
    fireEvent.click(el);

    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.age.title,
    );
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.age.body,
    );
    expect(screen.queryByTestId("upgrade-modal-see-plans")).toBeNull();
    expect(history).toEqual(["/dashboard"]);
  });
});

describe("no map (a non-student, or not loaded)", () => {
  it("draws no lock and every item navigates", () => {
    renderShell(null);
    for (const item of RAIL_ITEMS) {
      expect(screen.queryByTestId(`rail-${item.key}-lock`)).toBeNull();
      expect(screen.getByTestId(`rail-${item.key}`).tagName).toBe("A");
    }
  });
});

describe("mobile (owner ruling, Karl, 2026-10-05; supersedes OQ-4's tab bar and OQ-48's order)", () => {
  /** The tab bar's entries, in the order they render (lock glyphs excluded). */
  function tabLabels(bar: HTMLElement): (string | null)[] {
    return Array.from(bar.querySelectorAll('[data-testid^="tab-"]'))
      .filter((el) => !el.getAttribute("data-testid")?.endsWith("-lock"))
      .map((el) => el.textContent);
  }

  /** The open avatar menu's items, in the order they render. */
  function openMenuItemIds(): string[] {
    const trigger = screen.getByTestId("button-user-menu");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("data-testid") ?? "");
  }

  it("the bottom bar has exactly Home, Practice, Review, Calendar, LISA, and no Full-Length", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const bar = screen.getByTestId("app-tab-bar");
    expect(tabLabels(bar)).toEqual([
      "Home",
      "Practice",
      "Review",
      "Calendar",
      "LISA",
    ]);
    expect(within(bar).queryByTestId("tab-full-length")).toBeNull();
    expect(bar.textContent).not.toContain("Full-Length");
    // The bar shows below lg only; the rail is hidden below lg and keeps all six (unchanged).
    expect(bar.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    const rail = screen.getByTestId("app-rail");
    expect(rail.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(within(rail).getAllByRole("link").map((el) => el.textContent)).toEqual([
      "Home",
      "Practice",
      "Review",
      "Full-Length",
      "Calendar",
      "LISA",
    ]);
  });

  it("free plan: Calendar on the bar keeps its lock as a hint and navigates; LISA opens the modal", async () => {
    const { history } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    const bar = screen.getByTestId("app-tab-bar");
    expect(within(bar).getByTestId("tab-lisa").tagName).toBe("BUTTON");
    const calendar = within(bar).getByTestId("tab-calendar");
    expect(within(bar).getByTestId("tab-calendar-lock")).toBeTruthy();
    expect(calendar.tagName).toBe("A");
    expect(calendar.getAttribute("href")).toBe("/calendar");
    fireEvent.click(calendar);
    expect(history.at(-1)).toBe("/calendar");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("every rail item is on the tab bar or in the avatar menu: never both, never neither", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const bar = screen.getByTestId("app-tab-bar");
    const menu = openMenuItemIds();
    for (const item of RAIL_ITEMS) {
      const onBar = within(bar).queryByTestId(`tab-${item.key}`) !== null;
      const inMenu = menu.includes(`menu-${item.key}`);
      expect([item.key, onBar !== inMenu]).toEqual([item.key, true]);
    }
  });

  it("the avatar menu reads Full-Length, Settings, Help, Sign out, in that order", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    expect(openMenuItemIds()).toEqual([
      "menu-full-length",
      "menu-profile",
      "menu-help",
      "menu-logout",
    ]);
    expect(screen.getByTestId("menu-full-length").textContent).toBe(
      "Full-Length",
    );
    expect(screen.getByTestId("menu-profile").textContent).toContain(
      "Settings",
    );
    expect(screen.getByTestId("menu-help").textContent).toBe("Help");
    expect(screen.getByTestId("menu-logout").textContent).toContain("Sign Out");
    expect(screen.queryByTestId("menu-calendar")).toBeNull();
  });

  it("paid: Full-Length in the menu has no lock and navigates to /tests", async () => {
    const { history } = renderShell(
      await serverMap({ paid: true, under13: false }),
    );
    openMenuItemIds();
    const entry = screen.getByTestId("menu-full-length");
    expect(screen.queryByTestId("menu-full-length-lock")).toBeNull();
    expect(entry.getAttribute("aria-label")).toBe("Full-Length");
    fireEvent.click(entry);
    expect(history.at(-1)).toBe("/tests");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("free plan: Full-Length in the menu shows the lock and opens the upgrade modal in place, with no navigation and no gated request", async () => {
    const { history } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    openMenuItemIds();
    const entry = screen.getByTestId("menu-full-length");
    expect(screen.getByTestId("menu-full-length-lock")).toBeTruthy();
    expect(entry.getAttribute("aria-label")).toBe(
      "Full-Length, included with a paid plan",
    );
    fireEvent.click(entry);
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.exam_full_length.plan.title,
    );
    expect(history).toEqual(["/dashboard"]);
    expect(fetched.filter((u) => GATED_URL.test(u))).toEqual([]);
  });

  it("an admin keeps the menu at every width, same order, Crisis review before Sign out (OQ-48)", async () => {
    authState = signedIn("admin");
    renderShell(null);
    // The admin's menu is not wrapped in lg:hidden (W2-7), and no avatar link replaces it.
    expect(
      screen.getByTestId("button-user-menu").closest(".lg\\:hidden"),
    ).toBeNull();
    expect(screen.queryByTestId("rail-account")).toBeNull();
    expect(openMenuItemIds()).toEqual([
      "menu-full-length",
      "menu-profile",
      "menu-help",
      "menu-crisis-review",
      "menu-logout",
    ]);
  });
});

describe("Help, the account avatar and the bell", () => {
  it("Help links to the help destination and the avatar links to Settings", async () => {
    renderShell(await serverMap({ paid: true, under13: false }), {
      path: "/profile",
    });
    expect(screen.getByTestId("rail-help").getAttribute("href")).toBe(
      HELP_PATH,
    );
    const avatar = screen.getByTestId("rail-account");
    expect(avatar.getAttribute("href")).toBe("/profile");
    expect(avatar.getAttribute("aria-current")).toBe("page");
    expect(avatar.textContent).toBe("S");
  });

  it("the bell is in the rail directly above Help, and not hidden below lg (OQ-47)", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const header = screen.getByTestId("app-shell-header");
    const bellSlot = within(header).getByTestId("rail-bell");
    expect(
      within(bellSlot)
        .getByTestId("button-notifications")
        .getAttribute("aria-label"),
    ).toBe("Notifications");
    // Directly above Help in the rail column (the header IS the rail at lg).
    expect(bellSlot.nextElementSibling).toBe(screen.getByTestId("rail-help"));
    // Reachable on mobile: the slot carries no hide class, so it stays in the top bar below lg.
    expect(bellSlot.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(bellSlot.closest(".lg\\:hidden")).toBeNull();
    // Exactly one bell in the shell: not duplicated into the tab bar or the content.
    expect(screen.getAllByTestId("button-notifications")).toHaveLength(1);
  });
});

describe("the right panel slot and the footer", () => {
  it("renders no panel unless the route asks for one", () => {
    renderShell(null);
    expect(screen.queryByTestId("app-shell-panel")).toBeNull();
    expect(screen.queryByTestId("legal-footer")).toBeNull();
  });

  it("portals a page's panel content into a panel of the route's width", () => {
    renderShell(null, {
      node: (
        <AppShell panel={340} footer>
          <div data-testid="page-body">
            <AppShellPanel>
              <p data-testid="panel-content">mini month</p>
            </AppShellPanel>
          </div>
        </AppShell>
      ),
    });
    const panel = screen.getByTestId("app-shell-panel");
    expect(panel.getAttribute("data-panel-width")).toBe("340");
    expect(panel.tagName).toBe("ASIDE");
    expect(within(panel).getByTestId("panel-content")).toBeTruthy();
    // It is in the panel, not left in the page body.
    expect(
      within(screen.getByTestId("page-body")).queryByTestId("panel-content"),
    ).toBeNull();
  });

  it("the footer carries the four legal links to the existing routes", () => {
    renderShell(null, {
      node: (
        <AppShell footer>
          <div />
        </AppShell>
      ),
    });
    const footer = screen.getByTestId("legal-footer");
    expect(footer.textContent).toContain("© 2026 Lyceon");
    const links = Array.from(footer.querySelectorAll("a")).map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["Privacy Policy", "/legal/privacy-policy"],
      ["Terms", "/legal/student-terms"],
      ["Trust and Safety", "/legal/trust-and-safety"],
      ["Help and FAQs", HELP_PATH],
    ]);
  });
});

// ── Keyboard and the visual floor ─────────────────────────────────────────────

/** The elements a Tab press reaches, in document order (user-event is not a dependency). */
function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getAttribute("tabindex") !== "-1");
}

const FOCUS_RING = [
  "focus-visible:outline-[3px]",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-lyc-focus",
];

describe("keyboard", () => {
  it("the wordmark, every rail item (locked or not), Help and the avatar are in the tab order with the 3px focus ring", async () => {
    const { container } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    const order = tabbables(container);
    const targets = [
      screen.getByTestId("logo-link"),
      ...RAIL_ITEMS.map((i) => screen.getByTestId(`rail-${i.key}`)),
      screen.getByTestId("rail-help"),
      screen.getByTestId("rail-account"),
    ];
    for (const el of targets) {
      expect(order, el.getAttribute("data-testid") ?? "").toContain(el);
      for (const cls of FOCUS_RING)
        expect(el.className.split(/\s+/)).toContain(cls);
      el.focus();
      expect(document.activeElement).toBe(el);
    }
    // Rail order follows DESIGN.md §2: wordmark, the six, then Help, then the avatar.
    const positions = targets.map((el) => order.indexOf(el));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("the guardian shell's wordmark still points at /guardian (its home), with a title", () => {
    authState = signedIn("guardian");
    renderShell(null, {
      path: "/guardian",
      node: (
        <GuardianShell>
          <div />
        </GuardianShell>
      ),
    });
    const logo = screen.getByTestId("logo-link");
    expect(logo.getAttribute("href")).toBe("/guardian");
    expect(logo.getAttribute("title")).toBeTruthy();
  });
});

describe("nothing below 14px in the shell files (DESIGN.md §1)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    "app-shell.tsx",
    "FocusShell.tsx",
    "BareCardShell.tsx",
    "LegalFooter.tsx",
    "StudentRouteFrame.tsx",
  ];
  const SMALL =
    /\btext-(xs|\[(?:[0-9]|1[0-3])px\]|\[0?\.[0-9]+rem\])|\btext-\[(?:0?\.[0-8][0-9]*)rem\]/;

  it.each(files)("%s uses no text class below 14px", (file) => {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    expect(source.length).toBeGreaterThan(0);
    expect(source).not.toMatch(SMALL);
  });

  it("the pattern catches the classes it exists to catch (negative control)", () => {
    for (const bad of [
      "text-xs",
      "text-[13px]",
      "text-[10px]",
      "text-[0.65rem]",
    ]) {
      expect(bad).toMatch(SMALL);
    }
    for (const ok of [
      "text-lyc-meta",
      "text-[17px]",
      "text-[18px]",
      "text-lyc-body",
    ]) {
      expect(ok).not.toMatch(SMALL);
    }
  });
});
