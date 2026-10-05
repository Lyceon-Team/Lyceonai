// @vitest-environment jsdom
/**
 * UI-41 proof: every student route renders inside exactly one of the three shells.
 *
 * @spec [student-UI register UI-41 (proof: "Every student route renders inside exactly one of the
 *        three shells (route table check pasted here)"); DESIGN.md §2] | @implemented [2026-10-03]
 *
 * plain English: two halves, neither a hand copy of the routes.
 *   1. COMPLETENESS, from App.tsx's source. The TypeScript parser reads every `<Route>` App.tsx
 *      declares (and its one catch-all). Each must be in `STUDENT_ROUTE_SHELLS` or in
 *      `SHELL_EXCLUDED_ROUTES`, never both and never neither; neither table may name a route
 *      App.tsx does not declare; and each student route is wrapped in exactly one
 *      `<StudentRouteFrame route="…">` naming its own path.
 *   2. RENDERING, through the real `Router` App.tsx exports. Every page module is stubbed (the
 *      test is about the frame, not the page) and the role guard passes through. At a URL for
 *      each table route, exactly one element carries `data-shell`, it is the shell the table
 *      names with the table's options, and the page renders inside it. Every excluded public and
 *      admin route renders with no student shell at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { GUARDIAN_ROUTES } from "@/features/guardian/routes";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import {
  NOT_FOUND_ROUTE,
  SHELL_EXCLUDED_ROUTES,
  STUDENT_ROUTE_SHELLS,
  type ShellSpec,
  type StudentShellRoute,
} from "./route-shells";

const { pageStub } = vi.hoisted(() => ({
  pageStub: async () => {
    const { createElement } = await import("react");
    return {
      default: () => createElement("div", { "data-testid": "page-stub" }),
    };
  },
}));

// Every page App.tsx imports, eager and lazy.
vi.mock("@/pages/home", pageStub);
vi.mock("@/pages/login", pageStub);
vi.mock("@/pages/not-found", pageStub);
vi.mock("@/features/exam/pages/ExamModulePage", pageStub);
vi.mock("@/features/exam/pages/ExamReportPage", pageStub);
vi.mock("@/features/exam/pages/ExamSessionPage", pageStub);
vi.mock("@/features/exam/pages/TestsHomePage", pageStub);
vi.mock("@/pages/UserProfile", pageStub);
vi.mock("@/pages/settings", pageStub);
vi.mock("@/pages/help", pageStub);
vi.mock("@/pages/account-recover", pageStub);
vi.mock("@/pages/admin/CrisisReviewDetail", pageStub);
vi.mock("@/pages/admin/CrisisReviewList", pageStub);
vi.mock("@/pages/blog", pageStub);
vi.mock("@/pages/blog-post", pageStub);
vi.mock("@/pages/browse-topics", pageStub);
vi.mock("@/pages/calendar", pageStub);
vi.mock("@/pages/chat", pageStub);
vi.mock("@/pages/digital-sat", pageStub);
vi.mock("@/pages/sat-question-of-the-day", pageStub);
vi.mock("@/pages/sat-question-of-the-day-day", pageStub);
vi.mock("@/pages/digital-sat-math", pageStub);
vi.mock("@/pages/digital-sat-reading-writing", pageStub);
vi.mock("@/pages/guardian-required", pageStub);
vi.mock("@/pages/legal", pageStub);
vi.mock("@/pages/legal-doc", pageStub);
vi.mock("@/pages/lyceon-dashboard", pageStub);
vi.mock("@/pages/mastery", pageStub);
vi.mock("@/pages/notifications", pageStub);
vi.mock("@/pages/practice", pageStub);
vi.mock("@/pages/profile-complete", pageStub);
vi.mock("@/pages/resume-practice", pageStub);
vi.mock("@/pages/resume-review", pageStub);
vi.mock("@/pages/review", pageStub);
vi.mock("@/pages/score-report", pageStub);
vi.mock("@/pages/trust", pageStub);
vi.mock("@/pages/trust-evidence", pageStub);
vi.mock("@/pages/update-password", pageStub);
vi.mock("@/pages/upgrade", pageStub);

vi.mock("@/components/auth/RequireRole", () => ({
  RequireRole: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "student@example.test",
      display_name: "Sam Student",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));
vi.mock("@/lib/queryClient", () => ({
  queryClient: undefined,
  apiRequest: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { unread: 0 }, requestId: "test" }),
  }),
}));

const { Router } = await import("@/App");

// ── 1. Completeness, from App.tsx's source ─────────────────────────────────────

const APP_TSX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../App.tsx",
);

type Declared = { routes: string[]; frames: string[] };

/** Every `<Route path>` (the catch-all as NOT_FOUND_ROUTE) and every `<StudentRouteFrame route>`. */
function declaredInApp(): Declared {
  const source = fs.readFileSync(APP_TSX, "utf8");
  const sf = ts.createSourceFile(
    APP_TSX,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routes: string[] = [];
  const frames: string[] = [];
  const attr = (
    el: ts.JsxOpeningLikeElement,
    name: string,
  ): string | null | undefined => {
    for (const prop of el.attributes.properties) {
      if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === name) {
        const init = prop.initializer;
        return init !== undefined && ts.isStringLiteral(init)
          ? init.text
          : null;
      }
    }
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === "Route") {
        const p = attr(node, "path");
        // `path={path}` is the GUARDIAN_ROUTES map: not a literal, checked below.
        if (p === undefined) routes.push(NOT_FOUND_ROUTE);
        else if (p !== null) routes.push(p);
      } else if (tag === "StudentRouteFrame") {
        const r = attr(node, "route");
        if (typeof r !== "string")
          throw new Error("StudentRouteFrame route must be a literal");
        frames.push(r);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { routes, frames };
}

const declared = declaredInApp();
const tableKeys = Object.keys(STUDENT_ROUTE_SHELLS);
const excludedKeys = Object.keys(SHELL_EXCLUDED_ROUTES);

describe("the route table is complete against App.tsx (UI-41)", () => {
  it("parsed a non-trivial route list (negative control for the checks below)", () => {
    expect(declared.routes.length).toBeGreaterThan(30);
    expect(declared.routes).toContain("/dashboard");
    expect(declared.routes).toContain(NOT_FOUND_ROUTE);
  });

  it("declares no path twice", () => {
    const dupes = declared.routes.filter(
      (r, i) => declared.routes.indexOf(r) !== i,
    );
    expect(dupes).toEqual([]);
  });

  it("every declared route is in exactly one of: the shell table, the exclusions", () => {
    const problems = declared.routes.flatMap((route) => {
      const inTable = tableKeys.includes(route);
      const excluded = excludedKeys.includes(route);
      if (inTable && excluded) return [`${route}: in both`];
      if (!inTable && !excluded) return [`${route}: in neither`];
      return [];
    });
    expect(problems).toEqual([]);
  });

  it("neither table names a route App.tsx does not declare", () => {
    expect(tableKeys.filter((k) => !declared.routes.includes(k))).toEqual([]);
    expect(excludedKeys.filter((k) => !declared.routes.includes(k))).toEqual(
      [],
    );
  });

  it("each student route is wrapped in exactly one StudentRouteFrame naming its own path", () => {
    for (const key of tableKeys) {
      expect(
        declared.frames.filter((f) => f === key),
        `frames for ${key}`,
      ).toHaveLength(1);
    }
    expect(declared.frames.filter((f) => !tableKeys.includes(f))).toEqual([]);
  });

  it("guardian routes are excluded as a set (their own GuardianShell), never in the table", () => {
    expect(GUARDIAN_ROUTES.length).toBeGreaterThan(0);
    for (const { path: p } of GUARDIAN_ROUTES) {
      expect(tableKeys).not.toContain(p);
      expect(declared.routes).not.toContain(p);
    }
  });
});

// ── 2. Rendering, through the real Router ──────────────────────────────────────

/** A concrete URL for a route pattern. */
function urlFor(route: string): string {
  if (route === NOT_FOUND_ROUTE) return "/no-such-page";
  return route
    .replace(":sessionId", "s-1")
    .replace(":section", "M")
    .replace(":module", "1")
    .replace(":slug", "a-slug")
    .replace(":id", "x-1");
}

function renderAt(url: string): void {
  window.history.replaceState(null, "", url);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: null,
    user: null,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <UpgradeModalProvider autoOpenOnDenial={false}>
        <Router />
      </UpgradeModalProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function expectShell(spec: ShellSpec, shell: Element): void {
  expect(shell.getAttribute("data-shell")).toBe(spec.shell);
  expect(shell.getAttribute("data-theme-lock")).toBe(spec.themeLock);
  switch (spec.shell) {
    case "app": {
      const panel = shell.querySelector('[data-testid="app-shell-panel"]');
      expect(panel?.getAttribute("data-panel-width") ?? null).toBe(
        spec.panel === null ? null : String(spec.panel),
      );
      expect(shell.querySelector('[data-testid="legal-footer"]') !== null).toBe(
        spec.footer,
      );
      expect(shell.querySelector("main")?.getAttribute("data-content")).toBe(
        spec.content,
      );
      expect(shell.querySelector('[data-testid="app-rail"]')).not.toBeNull();
      return;
    }
    case "focus": {
      const back = shell.querySelector('[data-testid="focus-back"]');
      expect(back !== null).toBe(spec.back);
      if (back !== null)
        expect(back.getAttribute("href")).toBe(spec.sectionHome);
      expect(
        shell.querySelector('[data-testid="focus-shell-header"]')?.textContent,
      ).toContain(spec.section);
      expect(shell.querySelector("nav")).toBeNull();
      return;
    }
    case "bare":
      expect(shell.querySelector("nav")).toBeNull();
      expect(shell.querySelector("header")).toBeNull();
      return;
  }
}

/**
 * The table's content against DESIGN.md §2 and §4, written out from the design rather than read
 * from the table: the render half below checks that the router obeys the table, so it cannot
 * notice a wrong row. These are the design's own words, route by route.
 */
describe("the table says what DESIGN.md §2 says", () => {
  const shellOf = (route: StudentShellRoute): string =>
    STUDENT_ROUTE_SHELLS[route].shell;

  it("Focus: the practice and review runners, the exam session and report pages", () => {
    for (const route of [
      "/practice/session/:sessionId",
      "/review/session/:sessionId",
      "/tests/:sessionId",
      "/tests/:sessionId/:section/:module",
      "/tests/:sessionId/report",
      "/score-report",
    ] as const) {
      expect(shellOf(route), route).toBe("focus");
    }
  });

  it("Focus back targets: runner to Practice or Review, exam pages to Full-Length", () => {
    const home = (route: StudentShellRoute): string | null => {
      const spec = STUDENT_ROUTE_SHELLS[route];
      return spec.shell === "focus" ? spec.sectionHome : null;
    };
    expect(home("/practice/session/:sessionId")).toBe("/practice");
    expect(home("/review/session/:sessionId")).toBe("/review");
    expect(home("/tests/:sessionId")).toBe("/tests");
    expect(home("/tests/:sessionId/report")).toBe("/tests");
  });

  it("UI-50, UI-51, UI-52, UI-54: Home, Practice, Review and Full-Length follow the device theme; the routes not yet rebuilt stay pinned light (OQ-49)", () => {
    for (const route of ["/dashboard", "/practice", "/review"] as const) {
      expect(STUDENT_ROUTE_SHELLS[route], route).toEqual({
        shell: "app",
        panel: 360,
        footer: true,
        content: "column",
        themeLock: null,
      });
    }
    const unlocked = (
      Object.keys(STUDENT_ROUTE_SHELLS) as StudentShellRoute[]
    ).filter((route) => STUDENT_ROUTE_SHELLS[route].themeLock === null);
    expect(unlocked).toEqual([
      "/dashboard",
      "/practice",
      "/review",
      "/tests",
      "/calendar",
      "/chat",
      "/mastery",
      "/upgrade",
      "/profile",
      "/help",
      "/notifications",
      "/practice/session/:sessionId",
      // UI-53 / OQ-54 (a), ruling 2026-10-05: the review runner, its LISA panel on student tokens.
      "/review/session/:sessionId",
      "/tests/:sessionId",
      "/tests/:sessionId/report",
      // UI-59: every bare-card page.
      "/login",
      "/profile/complete",
      "/update-password",
      "/account/recover",
      "/guardian-required",
      NOT_FOUND_ROUTE,
    ]);
    // The topic explorer is not rebuilt (OQ-3 open): it stays pinned light.
    expect(STUDENT_ROUTE_SHELLS["/practice/topics"].themeLock).toBe("light");
  });

  it("UI-53: both runners follow the device theme (the review runner's LISA panel is on the student tokens: OQ-54 (a), ruling 2026-10-05)", () => {
    expect(STUDENT_ROUTE_SHELLS["/practice/session/:sessionId"]).toEqual({
      shell: "focus",
      section: "Practice",
      sectionHome: "/practice",
      back: true,
      themeLock: null,
    });
    expect(STUDENT_ROUTE_SHELLS["/review/session/:sessionId"]).toEqual({
      shell: "focus",
      section: "Review",
      sectionHome: "/review",
      back: true,
      themeLock: null,
    });
  });

  it("UI-54: Full-Length home, the exam session page and the report follow the device theme", () => {
    expect(STUDENT_ROUTE_SHELLS["/tests"]).toEqual({
      shell: "app",
      panel: 360,
      footer: true,
      content: "column",
      themeLock: null,
    });
    for (const route of [
      "/tests/:sessionId",
      "/tests/:sessionId/report",
    ] as const) {
      expect(STUDENT_ROUTE_SHELLS[route], route).toEqual({
        shell: "focus",
        section: "Full-Length",
        sectionHome: "/tests",
        back: true,
        themeLock: null,
      });
    }
    // /score-report is not rebuilt by UI-54: it stays pinned light.
    expect(STUDENT_ROUTE_SHELLS["/score-report"].themeLock).toBe("light");
  });

  it("UI-55: the calendar follows the device theme, full width with its 340px panel and no footer", () => {
    expect(STUDENT_ROUTE_SHELLS["/calendar"]).toEqual({
      shell: "app",
      panel: 340,
      footer: false,
      content: "full",
      themeLock: null,
    });
  });

  it("UI-56: LISA follows the device theme, full width with its 320px panel and no footer", () => {
    expect(STUDENT_ROUTE_SHELLS["/chat"]).toEqual({
      shell: "app",
      panel: 320,
      footer: false,
      content: "full",
      themeLock: null,
    });
  });

  it("UI-57: Mastery follows the device theme, in the reading column, with no right panel and no footer", () => {
    expect(STUDENT_ROUTE_SHELLS["/mastery"]).toEqual({
      shell: "app",
      panel: null,
      footer: false,
      content: "column",
      themeLock: null,
    });
  });

  it("UI-58: the plans page, Settings, Help and Notifications follow the device theme; Settings and Help carry the footer, none has a right panel", () => {
    const column = (footer: boolean) => ({
      shell: "app",
      panel: null,
      footer,
      content: "column",
      themeLock: null,
    });
    expect(STUDENT_ROUTE_SHELLS["/profile"]).toEqual(column(true));
    expect(STUDENT_ROUTE_SHELLS["/help"]).toEqual(column(true));
    expect(STUDENT_ROUTE_SHELLS["/upgrade"]).toEqual(column(false));
    expect(STUDENT_ROUTE_SHELLS["/notifications"]).toEqual(column(false));
  });

  it("the timed module: no back arrow, light only", () => {
    expect(STUDENT_ROUTE_SHELLS["/tests/:sessionId/:section/:module"]).toEqual({
      shell: "focus",
      section: "Full-Length",
      sectionHome: "/tests",
      back: false,
      themeLock: "light",
    });
  });

  it("Bare: login, profile completion, update password, recovery, 404", () => {
    for (const route of [
      "/login",
      "/profile/complete",
      "/update-password",
      "/account/recover",
      NOT_FOUND_ROUTE,
    ] as const) {
      expect(shellOf(route), route).toBe("bare");
    }
  });

  it("UI-59: every bare-card route follows the device theme (off the OQ-49 light lock)", () => {
    for (const route of [
      "/login",
      "/profile/complete",
      "/update-password",
      "/account/recover",
      "/guardian-required",
      NOT_FOUND_ROUTE,
    ] as const) {
      expect(STUDENT_ROUTE_SHELLS[route], route).toEqual({
        shell: "bare",
        themeLock: null,
      });
    }
  });

  it("App: the right panel is 360, Calendar 340, LISA 320, Settings none", () => {
    const panel = (route: StudentShellRoute): number | null | undefined => {
      const spec = STUDENT_ROUTE_SHELLS[route];
      return spec.shell === "app" ? spec.panel : undefined;
    };
    for (const route of [
      "/dashboard",
      "/practice",
      "/review",
      "/tests",
    ] as const) {
      expect(panel(route), route).toBe(360);
    }
    expect(panel("/calendar")).toBe(340);
    expect(panel("/chat")).toBe(320);
    expect(panel("/profile")).toBeNull();
  });

  it("the legal footer is on Home, Practice, Review, Full-Length, Settings and Help only", () => {
    const withFooter = tableKeys.filter((k) => {
      const spec = STUDENT_ROUTE_SHELLS[k as StudentShellRoute];
      return spec.shell === "app" && spec.footer;
    });
    expect(withFooter.sort()).toEqual(
      [
        "/dashboard",
        "/practice",
        "/review",
        "/tests",
        "/profile",
        "/help",
      ].sort(),
    );
  });
});

describe("every student route renders inside exactly the shell the table names", () => {
  it.each(tableKeys as StudentShellRoute[])("%s", async (route) => {
    renderAt(urlFor(route));
    const page = await screen.findByTestId("page-stub");
    const shells = document.querySelectorAll("[data-shell]");
    expect(shells).toHaveLength(1);
    const shell = shells[0];
    if (shell === undefined) throw new Error("unreachable");
    expect(shell.contains(page)).toBe(true);
    expectShell(STUDENT_ROUTE_SHELLS[route], shell);
  });
});

describe("excluded public and admin routes render no student shell", () => {
  const rendered = excludedKeys.filter(
    (k) => SHELL_EXCLUDED_ROUTES[k] !== "redirect",
  );

  it("has routes to check (negative control)", () => {
    expect(rendered.length).toBeGreaterThan(5);
  });

  it.each(rendered)("%s", async (route) => {
    renderAt(urlFor(route));
    await screen.findByTestId("page-stub");
    expect(document.querySelectorAll("[data-shell]")).toHaveLength(0);
  });
});

describe("a redirect lands in its target's shell", () => {
  it("/signup redirects to /login, a bare card", async () => {
    renderAt("/signup");
    await screen.findByTestId("page-stub");
    expect(window.location.pathname).toBe("/login");
    const shells = document.querySelectorAll("[data-shell]");
    expect(shells).toHaveLength(1);
    expect(shells[0]?.getAttribute("data-shell")).toBe("bare");
  });
});
