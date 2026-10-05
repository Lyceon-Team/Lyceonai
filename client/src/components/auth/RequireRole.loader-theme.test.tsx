// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOT_FOUND_ROUTE,
  STUDENT_ROUTE_SHELLS,
  type ShellSpec,
} from "@/lib/route-shells";
import { RequireRole } from "./RequireRole";

/**
 * @spec [student-UI register UI-59, OQ-60 (e) (owner ruling 2026-10-05: "let `RequireRole`'s
 *        loader follow the device theme on Bare routes"); DESIGN.md §2 "Bare card"]
 *        | @implemented [2026-10-05]
 *
 * plain English: while auth loads, the route guard draws the full-page loader in place of the
 * shell. On every Bare route the loader carries no theme lock (it follows the device theme, as
 * the Bare card does since UI-59), so a dark device sees no light frame first. Everywhere else
 * it stays pinned light. The Bare routes are read from the route table, not listed by hand.
 */

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
const nav = vi.hoisted(() => ({ location: "/" }));

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
    user: null,
    authLoading: true,
    isAdmin: false,
    isGuardian: false,
    accountUnavailable: false,
    signOut: async () => undefined,
  }),
}));

vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));

const entries: readonly (readonly [string, ShellSpec])[] =
  Object.entries(STUDENT_ROUTE_SHELLS);
const BARE_ROUTES = entries
  .filter(([route, spec]) => spec.shell === "bare" && route !== NOT_FOUND_ROUTE)
  .map(([route]) => route);

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

describe("OQ-60 (e): RequireRole's loader follows the device theme on Bare routes", () => {
  beforeEach(() => {
    queryMock.useQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
    }));
  });
  afterEach(() => {
    cleanup();
  });

  it("presence: the table has the Bare routes the guard wraps", () => {
    expect(BARE_ROUTES).toEqual(
      expect.arrayContaining([
        "/profile/complete",
        "/update-password",
        "/guardian-required",
      ]),
    );
  });

  it.each(BARE_ROUTES)("%s: the loader carries no theme lock", (route) => {
    const loader = loaderAt(route);
    expect(loader.classList.contains("lyc")).toBe(true);
    expect(loader.hasAttribute("data-theme-lock")).toBe(false);
  });

  it.each([
    "/dashboard",
    "/review/session/00000000-0000-4000-8000-000000000001",
    "/guardian",
    "/admin/crisis-review",
    "/constructor",
  ])("%s (not a Bare route): the loader stays pinned light", (route) => {
    expect(loaderAt(route).getAttribute("data-theme-lock")).toBe("light");
  });
});
