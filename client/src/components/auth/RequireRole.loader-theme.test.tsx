// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDENT_ROUTE_SHELLS, type ShellSpec } from "@/lib/route-shells";
import { RequireRole } from "./RequireRole";

/**
 * @spec [student-UI register UI-59, OQ-60 (e) (owner ruling 2026-10-05: "let `RequireRole`'s
 *        loader follow the device theme on Bare routes"); production QA 2026-10-07 items 5 and
 *        12 (Karl: page skeletons in the page's own shell instead of the full-page cream
 *        "Loading…" flash, which broke dark mode); DESIGN.md §2]
 *        | @implemented [2026-10-05; every student shell 2026-10-07]
 *
 * plain English: while auth loads, the route guard draws the route's loading state in place of
 * the shell. On every student route it is that route's own shell, sketched
 * (`data-route-skeleton` = app | focus | bare), under the route's own theme lock from the route
 * table: no lock (the device theme) on the themed routes, light on the routes still pinned light
 * and on the timed module. Everywhere else (guardian, admin, unknown) it stays the light
 * full-page loader. Every route in the table is checked, read from the table, with its
 * parameters filled in; a guardian on a shared route gets the light loader (their page is in the
 * guardian shell). Named "Loading..." in every case.
 */

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
const nav = vi.hoisted(() => ({ location: "/" }));
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; role: "student" | "guardian" | "admin" },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: queryMock.useQuery,
}));

vi.mock("wouter", () => ({
  useLocation: () => [nav.location],
  Redirect: ({ to }: { to: string }) =>
    React.createElement("div", { "data-testid": "redirect", "data-to": to }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: auth.user,
    authLoading: true,
    isAdmin: false,
    isGuardian: auth.user?.role === "guardian",
    accountUnavailable: false,
    signOut: async () => undefined,
  }),
}));

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

const entries: readonly (readonly [string, ShellSpec])[] =
  Object.entries(STUDENT_ROUTE_SHELLS);

/** A concrete pathname for a table key (each `:param` filled with a sample segment). */
function pathFor(route: string): string {
  return route.replace(/:[A-Za-z]+/g, (p) =>
    p === ":section"
      ? "M"
      : p === ":module"
        ? "1"
        : "00000000-0000-4000-8000-000000000001",
  );
}

function loaderAt(pathname: string): HTMLElement {
  nav.location = pathname;
  render(
    React.createElement(
      RequireRole,
      { allow: ["student", "guardian", "admin"] },
      React.createElement("div", { "data-testid": "child" }),
    ),
  );
  expect(screen.queryByTestId("child")).toBeNull();
  return screen.getByRole("status", { name: "Loading..." });
}

describe("RequireRole's loader is the route's own shell, in the route's own theme", () => {
  beforeEach(() => {
    auth.user = null;
    queryMock.useQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
    }));
  });
  afterEach(() => {
    cleanup();
  });

  it("presence: the table has app, focus and bare routes, locked and unlocked", () => {
    const shells = new Set(entries.map(([, s]) => s.shell));
    expect([...shells].sort()).toEqual(["app", "bare", "focus"]);
    expect(entries.some(([, s]) => s.themeLock === "light")).toBe(true);
    expect(entries.some(([, s]) => s.themeLock === null)).toBe(true);
  });

  it.each(entries.map(([route, spec]) => [route, spec] as const))(
    "%s: its own shell's skeleton, with the table's lock",
    (route, spec) => {
      const loader = loaderAt(pathFor(route));
      expect(loader.getAttribute("data-route-skeleton")).toBe(spec.shell);
      expect(loader.classList.contains("lyc")).toBe(true);
      expect(loader.getAttribute("data-theme-lock")).toBe(spec.themeLock);
    },
  );

  it("the themed App-shell pages carry no lock (a dark device sees a dark frame)", () => {
    for (const route of ["/dashboard", "/mastery", "/notifications"]) {
      const loader = loaderAt(route);
      expect([route, loader.getAttribute("data-route-skeleton")]).toEqual([
        route,
        "app",
      ]);
      expect([route, loader.hasAttribute("data-theme-lock")]).toEqual([
        route,
        false,
      ]);
      cleanup();
    }
  });

  it.each([
    "/guardian",
    "/admin/crisis-review",
    "/constructor",
    "/",
    "/dashboard/extra",
  ])("%s (not a student route): the light full-page loader", (route) => {
    const loader = loaderAt(route);
    expect(loader.hasAttribute("data-route-skeleton")).toBe(false);
    expect(loader.getAttribute("data-theme-lock")).toBe("light");
  });

  it("a guardian on a shared route (/profile) gets the light loader, not the student shell", () => {
    auth.user = { id: "g", role: "guardian" };
    const loader = loaderAt("/profile");
    expect(loader.hasAttribute("data-route-skeleton")).toBe(false);
    expect(loader.getAttribute("data-theme-lock")).toBe("light");
  });
});
