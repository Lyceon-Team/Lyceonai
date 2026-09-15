// @vitest-environment jsdom
/**
 * Every authenticated shell mounts the notification bell, and a shell that does not cannot ship.
 *
 * @spec [contracts/notifications.contract.md §3 (the bell is the in-app surface for every
 *        recipient); Doc-01_V8 §36.1 step 6 (both parties are notified — a guardian shell with
 *        no bell is a recipient with no surface); lyceon-coding-standards §14]
 *        | @implemented [2026-09-11]
 *
 * plain English: two gates.
 *
 * (1) DISCOVERY. Every file in this directory whose name contains "shell" is a shell. Each one
 *     must be registered in RENDER below (so it is actually rendered here) and its source must
 *     mount <NotificationBell />. A new FooShell.tsx fails this test until both are true, and a
 *     registration whose file no longer exists fails it too. Nothing here depends on someone
 *     remembering to add a case: the directory listing is the list.
 *
 * (2) RENDERING. Each registered shell is rendered with a signed-in user and the bell must be
 *     inside its <header> — in the chrome, not somewhere in the body. Rendered with no user the
 *     bell must be absent: that is the negative control, and it proves the positive assertion
 *     is looking at something that can change.
 *
 * PracticeShell is exempt by name with its reason stated. An exemption is visible in the diff
 * that adds it; an omission is not — which is the whole point of discovering rather than listing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { GuardianShell } from "./GuardianShell";
import NotificationsPage from "@/pages/notifications";

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
// The bell's only network call on mount is the unread count; the page also loads an empty
// feed and marks-all-seen. Every call is answered with the empty/zero shape for its route.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: url.includes("unread-count")
        ? { unread: 0 }
        : url.includes("mark-all")
          ? { marked: 0 }
          : { items: [], nextCursor: null },
      requestId: "test",
    }),
  })),
}));

const LAYOUT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Shells this test renders. Keyed by file name so discovery can check the registry. */
const RENDER: Record<
  string,
  (children: React.ReactNode) => React.ReactElement
> = {
  "app-shell.tsx": (children) => <AppShell>{children}</AppShell>,
  "GuardianShell.tsx": (children) => <GuardianShell>{children}</GuardianShell>,
};

/** Shells that deliberately carry no bell. Adding one here is a reviewed decision, not an omission. */
const EXEMPT: Record<string, string> = {
  "PracticeShell.tsx":
    "the practice runner header (score, streak, progress) is a focused-mode surface with no " +
    "user menu either; whether it should carry a bell is an owner decision, recorded here so " +
    "it cannot be mistaken for an oversight",
};

function discoverShellFiles(): string[] {
  return fs
    .readdirSync(LAYOUT_DIR)
    .filter(
      (f) => /shell/i.test(f) && f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
    )
    .sort();
}

function withClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

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

function signedOut(): typeof authState {
  return {
    user: null,
    isLoading: false,
    authLoading: false,
    isAuthenticated: false,
    isGuardian: false,
    signOut: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = signedOut();
});

describe("shell discovery (gate 1)", () => {
  const discovered = discoverShellFiles();

  it("finds the student and guardian shells", () => {
    expect(discovered).toEqual(
      expect.arrayContaining(["app-shell.tsx", "GuardianShell.tsx"]),
    );
  });

  it("every shell file is either rendered by this test or exempt with a reason", () => {
    const unaccounted = discovered.filter(
      (f) => !(f in RENDER) && !(f in EXEMPT),
    );
    expect(
      unaccounted,
      `shell file(s) with neither a render case nor a stated exemption: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("every rendered shell's source mounts <NotificationBell />", () => {
    for (const file of Object.keys(RENDER)) {
      const source = fs.readFileSync(path.join(LAYOUT_DIR, file), "utf8");
      expect(source, `${file} does not mount the bell`).toMatch(
        /<NotificationBell\s*\/>/,
      );
    }
  });

  it("no registration or exemption names a file that does not exist", () => {
    for (const file of [...Object.keys(RENDER), ...Object.keys(EXEMPT)]) {
      expect(discovered, `${file} is registered but not on disk`).toContain(
        file,
      );
    }
  });

  it("no exempt shell is also rendered (an exemption must be a real absence)", () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(file in RENDER, `${file} is both exempt and rendered`).toBe(false);
      const source = fs.readFileSync(path.join(LAYOUT_DIR, file), "utf8");
      expect(
        source,
        `${file} is exempt but mounts the bell — drop the exemption`,
      ).not.toMatch(/<NotificationBell\s*\/>/);
    }
  });
});

describe.each(Object.entries(RENDER))(
  "shell %s renders the bell (gate 2)",
  (file, renderShell) => {
    const role: TestUser["role"] =
      file === "GuardianShell.tsx" ? "guardian" : "student";

    it("mounts the bell inside its <header> for a signed-in user", () => {
      authState = signedIn(role);
      const { container } = withClient(
        renderShell(<div data-testid="shell-body">body</div>),
      );

      expect(screen.getByTestId("shell-body")).toBeTruthy();
      const header = container.querySelector("header");
      expect(header, `${file} renders no <header>`).not.toBeNull();
      const bell = header?.querySelector(
        '[data-testid="button-notifications"]',
      );
      expect(bell, `${file}: bell is not in the header`).not.toBeNull();
      expect(bell?.getAttribute("aria-label")).toBe("Notifications");
      // The same signed-in chrome carries the user menu, so a guardian can reach Settings and Sign Out.
      expect(
        header?.querySelector('[data-testid="button-user-menu"]'),
      ).not.toBeNull();
    });

    it("NEGATIVE CONTROL: no bell when there is no signed-in user", () => {
      authState = signedOut();
      withClient(renderShell(<div data-testid="shell-body">body</div>));

      expect(screen.getByTestId("shell-body")).toBeTruthy();
      expect(screen.queryByTestId("button-notifications")).toBeNull();
      expect(screen.queryByTestId("button-user-menu")).toBeNull();
    });
  },
);

/**
 * Gate 3 — the /notifications page is mounted in BOTH shells (owner brief 2026-09-15 Part B1
 * "Mount it in both shells"; B3 (5)). The page picks its shell by role, so it is rendered once
 * per role and the assertion is on the shell's own chrome: the guardian shell header for a
 * guardian, the student shell (no guardian header) for a student — with the page body inside
 * <main> and the bell in the header either way. The route registration is checked from source
 * so a page nobody can navigate to cannot pass.
 */
describe("the /notifications page renders inside each shell by role (gate 3)", () => {
  it("is registered as a route in App.tsx behind RequireRole for student, guardian and admin", () => {
    const appSource = fs.readFileSync(
      path.resolve(LAYOUT_DIR, "../../App.tsx"),
      "utf8",
    );
    const idx = appSource.indexOf('path="/notifications"');
    expect(idx, "no /notifications route in App.tsx").toBeGreaterThan(-1);
    const after = appSource.slice(idx, idx + 400);
    expect(after).toMatch(
      /RequireRole allow=\{\["student", "guardian", "admin"\]\}/,
    );
    expect(after).toMatch(/<NotificationsPage \/>/);
  });

  it("a guardian gets the page inside GuardianShell (guardian header, bell in header)", async () => {
    authState = signedIn("guardian");
    const { container } = withClient(<NotificationsPage />);
    expect(await screen.findByTestId("notifications-page")).toBeTruthy();
    const header = container.querySelector("header");
    expect(header?.getAttribute("data-testid")).toBe("guardian-shell-header");
    expect(
      header?.querySelector('[data-testid="button-notifications"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('main [data-testid="notifications-page"]'),
    ).not.toBeNull();
  });

  it("a student gets the page inside AppShell (student header, bell in header)", async () => {
    authState = signedIn("student");
    const { container } = withClient(<NotificationsPage />);
    expect(await screen.findByTestId("notifications-page")).toBeTruthy();
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-testid")).not.toBe(
      "guardian-shell-header",
    );
    expect(
      header?.querySelector('[data-testid="button-notifications"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('main [data-testid="notifications-page"]'),
    ).not.toBeNull();
  });

  it("the bell dropdown links to the page (See all)", () => {
    const source = fs.readFileSync(
      path.resolve(LAYOUT_DIR, "../notifications/NotificationBell.tsx"),
      "utf8",
    );
    expect(source).toMatch(/href="\/notifications"/);
  });
});
