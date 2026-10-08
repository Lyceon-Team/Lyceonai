// @vitest-environment jsdom
/**
 * UI-41: the App shell's rail, its lock states, the mobile bar, the panel slot and the footer.
 *
 * @spec [student-UI register UI-41; §2 Free versus paid (LISA and Full-Length open the modal in
 *        place with no navigation and no call to the gated endpoint; ruling 3: Calendar keeps the
 *        lock as a hint and navigates); OQ-29 (map on GET /api/profile, reason plan | age; under
 *        13 gets the age message); OQ-4 (five tabs); OQ-47 (bell in the rail above Help, ruled
 *        2026-10-03); OQ-48 (the admin exception); owner ruling (Karl, 2026-10-05; supersedes
 *        OQ-4, OQ-48 and the Full-Length part of OQ-62: tabs Home, Review, Practice, Calendar,
 *        LISA; avatar menu Settings, Help, Sign out, admins add Crisis review; Full-Length on
 *        neither phone surface; desktop rail unchanged); register §8 F-70 (the avatar dropdown
 *        follows the page theme); DESIGN.md §1 (3px focus ring, nothing below 14px), §2; issue
 *        #829 (one anchor per nav item, with its href)]
 *        | @implemented [2026-10-03; mobile tab bar and menu 2026-10-05]
 *
 * THE MAP IS THE SERVER'S. Every fixture below is the output of `resolveFeatureAccess`, the
 * function GET /api/profile calls, with only the entitlement answers stubbed (and the real age
 * gate). It reaches the shell the way production does: as the `featureAccess` field of the cached
 * profile response, parsed by `useFeatureAccess`. No hand-written map is used.
 *
 * Driven by `RAIL`, the rail written out below as DESIGN.md §2 gives it (the shell keeps its
 * `RAIL_ITEMS` private). The first rail test proves the rendered rail is exactly `RAIL`, in
 * order, so the loops cover every item the shell draws: an added item fails it until listed.
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
import type {
  FeatureAccessMap,
  LockableFeatureKey,
} from "@lyceon/shared/feature-access";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { AppShell, AppShellPanel } from "./app-shell";
import { GuardianShell } from "./GuardianShell";
import { HELP_PATH } from "./LegalFooter";
import { ActiveThemeLockProvider } from "./theme-lock";
import type { ThemeLock } from "@/lib/route-shells";
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

type RailSpec = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly lock: {
    readonly feature: LockableFeatureKey;
    readonly behaviour: "modal" | "navigate";
  } | null;
};

/** The rail, DESIGN.md §2 order; locks per ruling 3 (Calendar navigates, the others open the modal). */
const RAIL: readonly RailSpec[] = [
  { key: "home", label: "Home", href: "/dashboard", lock: null },
  { key: "practice", label: "Practice", href: "/practice", lock: null },
  { key: "review", label: "Review", href: "/review", lock: null },
  {
    key: "full-length",
    label: "Full-Length",
    href: "/tests",
    lock: { feature: "exam_full_length", behaviour: "modal" },
  },
  {
    key: "calendar",
    label: "Calendar",
    href: "/calendar",
    lock: { feature: "calendar_access", behaviour: "navigate" },
  },
  {
    key: "lisa",
    label: "LISA",
    href: "/chat",
    lock: { feature: "tutor_access", behaviour: "modal" },
  },
];

const byKey = (key: string) => {
  const item = RAIL.find((i) => i.key === key);
  if (item === undefined) throw new Error(`no rail item ${key}`);
  return item;
};

/** The rail's entries, in the order they render (lock glyphs excluded). */
function railEntries(): HTMLElement[] {
  return Array.from(
    screen
      .getByTestId("app-rail")
      .querySelectorAll<HTMLElement>('[data-testid^="rail-"]'),
  ).filter((el) => !el.getAttribute("data-testid")?.endsWith("-lock"));
}

describe("the rail (DESIGN.md §2 order)", () => {
  it("renders exactly the six items in the design's order (negative control for the loops below)", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const entries = railEntries();
    expect(entries.map((el) => el.getAttribute("data-testid"))).toEqual(
      RAIL.map((i) => `rail-${i.key}`),
    );
    expect(entries.map((el) => el.textContent)).toEqual([
      "Home",
      "Practice",
      "Review",
      "Full-Length",
      "Calendar",
      "LISA",
    ]);
    // QA2-H: below the six, the rail column's own entries: the bell (now labelled), Help, then the
    // avatar. The bell is not a seventh nav item; it is a popover, not a page link.
    const header = screen.getByTestId("app-shell-header");
    const column = Array.from(
      header.querySelectorAll<HTMLElement>(':scope > [data-testid^="rail-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(column).toEqual(["rail-bell", "rail-help", "rail-account"]);
    expect(
      [screen.getByTestId("rail-bell"), screen.getByTestId("rail-help")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Notifications", "Help"]);
  });

  it("each lock is the one RAIL lists: a modal lock is a button, a navigate lock a link", async () => {
    renderShell(await serverMap({ paid: false, under13: false }));
    for (const item of RAIL) {
      const el = screen.getByTestId(`rail-${item.key}`);
      expect([
        item.key,
        screen.queryByTestId(`rail-${item.key}-lock`) !== null,
      ]).toEqual([item.key, item.lock !== null]);
      expect([item.key, el.tagName]).toEqual([
        item.key,
        item.lock?.behaviour === "modal" ? "BUTTON" : "A",
      ]);
    }
  });

  it("paid student: every item is one anchor with its href, no lock, and clicking navigates", async () => {
    const map = await serverMap({ paid: true, under13: false });
    for (const item of RAIL) {
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
    for (const item of RAIL) {
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
    for (const item of RAIL) {
      expect(screen.queryByTestId(`rail-${item.key}-lock`)).toBeNull();
      expect(screen.getByTestId(`rail-${item.key}`).tagName).toBe("A");
    }
  });
});

describe("mobile (owner ruling, Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62)", () => {
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

  it("the tab bar is exactly Home, Review, Practice, Calendar, LISA (Practice in the middle); the rail keeps its six", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const bar = screen.getByTestId("app-tab-bar");
    expect(tabLabels(bar)).toEqual([
      "Home",
      "Review",
      "Practice",
      "Calendar",
      "LISA",
    ]);
    // The bar shows below lg only; the rail is hidden below lg and keeps all six (unchanged).
    expect(bar.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    const rail = screen.getByTestId("app-rail");
    expect(rail.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(
      within(rail)
        .getAllByRole("link")
        .map((el) => el.textContent),
    ).toEqual([
      "Home",
      "Practice",
      "Review",
      "Full-Length",
      "Calendar",
      "LISA",
    ]);
  });

  it("each tab is its rail item: the same href, and it navigates", async () => {
    const map = await serverMap({ paid: true, under13: false });
    for (const key of ["home", "review", "practice", "calendar", "lisa"]) {
      const { history } = renderShell(map, { path: "/profile" });
      const tab = within(screen.getByTestId("app-tab-bar")).getByTestId(
        `tab-${key}`,
      );
      expect(tab.tagName).toBe("A");
      expect(tab.getAttribute("href")).toBe(byKey(key).href);
      fireEvent.click(tab);
      expect(history.at(-1)).toBe(byKey(key).href);
      cleanup();
    }
  });

  it("free plan: Calendar on the bar keeps its lock as a hint and navigates", async () => {
    const { history } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    const bar = screen.getByTestId("app-tab-bar");
    const calendar = within(bar).getByTestId("tab-calendar");
    expect(within(bar).getByTestId("tab-calendar-lock")).toBeTruthy();
    expect(calendar.tagName).toBe("A");
    expect(calendar.getAttribute("href")).toBe("/calendar");
    fireEvent.click(calendar);
    expect(history.at(-1)).toBe("/calendar");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("free plan: LISA on the bar opens the upgrade modal in place, with no navigation and no gated request", async () => {
    const { history } = renderShell(
      await serverMap({ paid: false, under13: false }),
    );
    const bar = screen.getByTestId("app-tab-bar");
    const lisa = within(bar).getByTestId("tab-lisa");
    expect(within(bar).getByTestId("tab-lisa-lock")).toBeTruthy();
    expect(lisa.tagName).toBe("BUTTON");
    fireEvent.click(lisa);
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.plan.title,
    );
    expect(history).toEqual(["/dashboard"]);
    expect(fetched.filter((u) => GATED_URL.test(u))).toEqual([]);
  });

  it.each(["student", "admin"] as const)(
    "%s: Full-Length is on neither phone surface (not the tab bar, not the avatar menu), and is still on the rail",
    async (role) => {
      authState = signedIn(role);
      renderShell(await serverMap({ paid: true, under13: false }));
      // Presence first: the rail carries it, the bar and the menu are populated.
      expect(screen.getByTestId("rail-full-length").textContent).toBe(
        "Full-Length",
      );
      const bar = screen.getByTestId("app-tab-bar");
      expect(tabLabels(bar).length).toBe(5);
      expect(within(bar).queryByTestId("tab-full-length")).toBeNull();
      expect(bar.textContent).not.toContain("Full-Length");
      const menu = openMenuItemIds();
      expect(menu).toContain("menu-profile");
      expect(menu).not.toContain("menu-full-length");
      expect(screen.getByTestId("user-menu").textContent).not.toMatch(
        /full-length/i,
      );
    },
  );

  it("the avatar menu is exactly Settings, Help, Sign out", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    expect(openMenuItemIds()).toEqual([
      "menu-profile",
      "menu-help",
      "menu-logout",
    ]);
    expect(screen.getByTestId("menu-profile").textContent).toContain(
      "Settings",
    );
    expect(screen.getByTestId("menu-help").textContent).toBe("Help");
    // QA 3: sentence case.
    expect(screen.getByTestId("menu-logout").textContent).toBe("Sign out");
  });

  it("QA 14: every menu entry carries an icon hidden from assistive tech, and the trigger is named", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    expect(
      screen.getByTestId("button-user-menu").getAttribute("aria-label"),
    ).toBe("Account menu");
    const ids = openMenuItemIds();
    // Presence first: the three entries rendered.
    expect(ids).toEqual(["menu-profile", "menu-help", "menu-logout"]);
    for (const id of ids) {
      const icons = screen.getByTestId(id).querySelectorAll("svg");
      expect([id, icons.length]).toEqual([id, 1]);
      expect([id, icons[0]?.getAttribute("aria-hidden")]).toEqual([id, "true"]);
    }
    // The accessible name is the label alone (the icon adds nothing to it).
    expect(screen.getByRole("menuitem", { name: "Help" })).toBe(
      screen.getByTestId("menu-help"),
    );
  });

  it("Help in the avatar menu goes to the help destination", async () => {
    const { history } = renderShell(
      await serverMap({ paid: true, under13: false }),
    );
    openMenuItemIds();
    fireEvent.click(screen.getByTestId("menu-help"));
    expect(history.at(-1)).toBe(HELP_PATH);
  });

  it("an admin keeps the menu at every width: Settings, Help, Crisis review, Sign out (OQ-48)", async () => {
    authState = signedIn("admin");
    renderShell(null);
    // The admin's menu is not wrapped in lg:hidden (W2-7), and there is exactly one.
    expect(
      screen.getByTestId("button-user-menu").closest(".lg\\:hidden"),
    ).toBeNull();
    expect(screen.getAllByTestId("button-user-menu")).toHaveLength(1);
    expect(openMenuItemIds()).toEqual([
      "menu-profile",
      "menu-help",
      "menu-crisis-review",
      "menu-logout",
    ]);
  });
});

describe("F-70: the avatar dropdown follows the page theme", () => {
  function renderLocked(lock: ThemeLock, role: TestUser["role"] = "student") {
    authState = signedIn(role);
    const node =
      role === "guardian" ? (
        <GuardianShell>
          <div />
        </GuardianShell>
      ) : (
        <AppShell themeLock={lock}>
          <div data-testid="page-body" />
        </AppShell>
      );
    return renderShell(null, {
      node: <ActiveThemeLockProvider>{node}</ActiveThemeLockProvider>,
    });
  }

  /** Open the menu and return it (presence first: it rendered, with its entries). */
  function openMenu(): HTMLElement {
    const trigger = screen.getByTestId("button-user-menu");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = screen.getByTestId("user-menu");
    expect(within(menu).getByTestId("menu-profile")).toBeTruthy();
    return menu;
  }

  it("over an unlocked page the open menu sits in its own .lyc root with no lock, so it takes the page's theme (dark page, dark menu)", () => {
    renderLocked(null);
    const menu = openMenu();
    const root = menu.closest<HTMLElement>(".lyc");
    expect(root).not.toBeNull();
    // Portalled onto <body>: its own token root, not the shell's.
    expect(root?.closest("[data-shell]")).toBeNull();
    expect(root?.hasAttribute("data-theme-lock")).toBe(false);
  });

  it("over a page pinned light the open menu is pinned light", () => {
    renderLocked("light");
    const root = openMenu().closest<HTMLElement>(".lyc");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-theme-lock")).toBe("light");
  });

  it("draws with the student tokens, not the app-wide light set, and nothing below 14px", () => {
    renderLocked(null);
    const menu = openMenu();
    const classes = menu.className.split(/\s+/);
    expect(classes).toContain("bg-lyc-sheet");
    expect(classes).toContain("border-lyc-rule");
    expect(classes).not.toContain("bg-background");
    expect(classes).not.toContain("bg-popover");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBe(3);
    for (const item of items) {
      const c = item.className.split(/\s+/);
      expect([item.dataset.testid, c.includes("focus:bg-lyc-hover")]).toEqual([
        item.dataset.testid,
        true,
      ]);
      expect(c).not.toContain("focus:bg-accent");
    }
    expect(menu.innerHTML).not.toMatch(/\btext-xs\b/);
  });

  it("the guardian shell's menu keeps the app-wide tokens (control)", () => {
    renderLocked(null, "guardian");
    const menu = openMenu();
    expect(menu.closest(".lyc")).toBeNull();
    expect(menu.className.split(/\s+/)).toContain("bg-background");
  });
});

describe("Help, the account avatar and the bell", () => {
  it("QA 3: the avatar opens the account menu at every width (desktop included), with Sign out; current on Settings", async () => {
    const { history } = renderShell(
      await serverMap({ paid: true, under13: false }),
      { path: "/profile" },
    );
    expect(screen.getByTestId("rail-help").getAttribute("href")).toBe(
      HELP_PATH,
    );
    // One trigger, a button (not a link to Settings), hidden at no width.
    const triggers = screen.getAllByTestId("button-user-menu");
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0]!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.closest("a")).toBeNull();
    for (let el: HTMLElement | null = trigger; el; el = el.parentElement) {
      expect(el.className.split(/\s+/)).not.toContain("hidden");
      expect(el.className.split(/\s+/)).not.toContain("lg:hidden");
    }
    const avatar = within(trigger).getByTestId("account-avatar");
    expect(avatar.textContent).toBe("S");
    expect(avatar.getAttribute("data-current")).toBe("true");
    // Desktop (the test DOM's default): the menu opens beside the rail.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = screen.getByTestId("user-menu");
    expect(menu.getAttribute("data-side")).toBe("right");
    fireEvent.click(within(menu).getByTestId("menu-logout"));
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(history.at(-1)).toBe("/profile");
  });

  it("QA 3: on a phone the same menu opens under the top bar", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "not all and (min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    renderShell(await serverMap({ paid: true, under13: false }));
    const trigger = screen.getByTestId("button-user-menu");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("user-menu").getAttribute("data-side")).toBe(
      "bottom",
    );
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

/**
 * @spec [production QA 2026-10-07 item 14 (Karl: "the rail highlights the current section on
 *        /mastery and /notifications")] | @implemented [2026-10-07]
 * plain English: /mastery has no rail item, so it lights Home's (Home's mastery rows and "See
 * every skill" are its way in); /notifications is the bell's own page, so the bell is current.
 * Presence first: the item that should be lit is found, then exactly it is lit.
 */
/** The rail's shared on/off pair (app-shell.tsx ON_CLASS / OFF_CLASS), written out. */
const ON = ["bg-lyc-rail-on-bg", "text-lyc-rail-on-ink"];
const OFF = ["bg-transparent", "text-lyc-rail-ink"];

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter((c) => c.length > 0);
}

describe("QA 14: the rail shows the current section on pages with no item of their own", () => {
  function current(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[aria-current="page"]')).map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
  }

  it.each(["/mastery", "/mastery/anything"])(
    "%s lights Home on the rail and the tab bar, and nothing else",
    async (path) => {
      const { container } = renderShell(
        await serverMap({ paid: true, under13: false }),
        { path },
      );
      expect(screen.getByTestId("rail-home").getAttribute("aria-current")).toBe(
        "page",
      );
      expect(current(container).sort()).toEqual(["rail-home", "tab-home"]);
    },
  );

  it("/notifications marks the bell current (and its slot drawn as the current item), nothing else", async () => {
    const { container } = renderShell(
      await serverMap({ paid: true, under13: false }),
      { path: "/notifications" },
    );
    const bell = screen.getByTestId("button-notifications");
    expect(bell.getAttribute("aria-current")).toBe("page");
    expect(current(container)).toEqual(["button-notifications"]);
    // QA2-H: drawn with the rail's shared "on" pair, on the button itself.
    expect(classesOf(bell)).toEqual(expect.arrayContaining(ON));
    expect(classesOf(bell).filter((c) => OFF.includes(c))).toEqual([]);
  });

  it("control: on /dashboard the bell is not current", async () => {
    const { container } = renderShell(
      await serverMap({ paid: true, under13: false }),
    );
    const bell = screen.getByTestId("button-notifications");
    expect(bell.hasAttribute("aria-current")).toBe(false);
    expect(current(container).sort()).toEqual(["rail-home", "tab-home"]);
    expect(classesOf(bell)).toEqual(expect.arrayContaining(OFF));
    expect(classesOf(bell).filter((c) => ON.includes(c))).toEqual([]);
  });
});

/**
 * @spec [production re-test 2026-10-08 item H (Karl: "Rail bell: add the 'Notifications' label
 *        and the shared active style (light and dark)")] | @implemented [2026-10-08]
 * plain English: the bell is drawn as a rail item. Its classes are a rail item's classes: every
 * class an inactive rail item (Practice, on /notifications) carries, with the "off" pair swapped
 * for the "on" pair when current, and nothing of a second hand-written copy of the colours. The
 * pair is the rail tokens, which carry light and dark themselves (student-tokens.css), so one
 * class set serves both themes. The label is visible text from lg up and the accessible name
 * stays "Notifications" (with the unread count when there is one).
 */
describe("QA2-H: the bell is a labelled rail item with the shared active style", () => {
  it("shows the visible label Notifications, icon above label, named Notifications", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const bell = screen.getByTestId("button-notifications");
    expect(bell.tagName).toBe("BUTTON");
    expect(bell.getAttribute("aria-label")).toBe("Notifications");
    const label = within(bell).getByText("Notifications");
    expect(label.tagName).toBe("SPAN");
    // Visible on the desktop rail (from lg up); the phone top bar keeps the 40px icon button.
    expect(classesOf(label)).toEqual(["hidden", "lg:inline"]);
    // Icon first, label second (the rail's "icon above label").
    expect(bell.lastElementChild).toBe(label);
    expect(bell.firstElementChild?.querySelector("svg")).not.toBeNull();
  });

  it("carries every class of an inactive rail item, the on pair swapped in on /notifications", async () => {
    renderShell(await serverMap({ paid: true, under13: false }), {
      path: "/notifications",
    });
    const item = classesOf(screen.getByTestId("rail-practice"));
    // Presence: the reference item is an inactive rail item, so it carries the off pair.
    expect(item).toEqual(expect.arrayContaining(OFF));
    const shared = item.filter((c) => !OFF.includes(c));
    expect(shared.length).toBeGreaterThan(8);
    const bell = classesOf(screen.getByTestId("button-notifications"));
    expect(bell).toEqual(expect.arrayContaining([...shared, ...ON]));
    // No fork: the slot carries no colour of its own for the button.
    expect(screen.getByTestId("rail-bell").className).toBe(
      "flex justify-center",
    );
  });

  it("off /notifications it carries exactly an inactive rail item's colours (control)", async () => {
    renderShell(await serverMap({ paid: true, under13: false }));
    const item = classesOf(screen.getByTestId("rail-practice"));
    const bell = classesOf(screen.getByTestId("button-notifications"));
    expect(bell).toEqual(expect.arrayContaining(item));
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
      ...RAIL.map((i) => screen.getByTestId(`rail-${i.key}`)),
      // QA2-H: the bell, a rail item between LISA and Help.
      screen.getByTestId("button-notifications"),
      screen.getByTestId("rail-help"),
      screen.getByTestId("button-user-menu"),
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
