// @vitest-environment jsdom
/**
 * @spec [production QA 2026-10-07 item 5 (Karl: route-level lazy loading with page skeletons,
 *        "the student shell's skeleton inside the page's own shell", keeping lazy routes lazy)]
 *        | @implemented [2026-10-07]
 *
 * plain English: while a page's code chunk loads, the frame keeps the page's real shell on
 * screen and shows the page skeleton inside it, instead of letting the wait fall through to the
 * router's full-page fallback. Proven with a real `React.lazy` page whose chunk never arrives,
 * under an outer Suspense standing in for the router's (it must never show), for one route of
 * each shell. A control renders a resolved page: no skeleton.
 */
import React, { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import type { StudentShellRoute } from "@/lib/route-shells";
import { StudentRouteFrame } from "./StudentRouteFrame";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "s@example.test",
      display_name: "Sam",
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { unread: 0 }, requestId: "test" }),
  })),
}));

/** A lazy page whose chunk never arrives. */
const NeverLoads = lazy(
  () => new Promise<{ default: () => JSX.Element }>(() => undefined),
);

function renderFrame(
  route: StudentShellRoute,
  path: string,
  page: React.ReactNode,
): void {
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial={false}>
          <Suspense fallback={<div data-testid="router-fallback" />}>
            <StudentRouteFrame route={route}>{page}</StudentRouteFrame>
          </Suspense>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("QA 5: a page's chunk loads inside its own shell", () => {
  it("App shell (/mastery): the rail and tab bar stay, the skeleton is in <main>", () => {
    renderFrame("/mastery", "/mastery", <NeverLoads />);
    expect(screen.queryByTestId("router-fallback")).toBeNull();
    const main = document.querySelector<HTMLElement>("main#main");
    expect(main).not.toBeNull();
    expect(main?.closest('[data-shell="app"]')).not.toBeNull();
    expect(screen.getByTestId("app-rail")).toBeTruthy();
    expect(screen.getByTestId("app-tab-bar")).toBeTruthy();
    const skeleton = within(main as HTMLElement).getByRole("status", {
      name: "Loading...",
    });
    expect(skeleton.getAttribute("data-testid")).toBe("page-skeleton");
  });

  it("Focus shell (a practice session): the top bar stays, the skeleton is in <main>", () => {
    renderFrame(
      "/practice/session/:sessionId",
      "/practice/session/00000000-0000-4000-8000-000000000009",
      <NeverLoads />,
    );
    expect(screen.queryByTestId("router-fallback")).toBeNull();
    const shell = document.querySelector<HTMLElement>('[data-shell="focus"]');
    expect(shell).not.toBeNull();
    expect(
      within(shell as HTMLElement).getByTestId("page-skeleton"),
    ).toBeTruthy();
  });

  it("Bare card (/update-password): the card stays, with the card's skeleton in it", () => {
    renderFrame("/update-password", "/update-password", <NeverLoads />);
    expect(screen.queryByTestId("router-fallback")).toBeNull();
    const card = document.querySelector<HTMLElement>('[data-shell="bare"]');
    expect(card).not.toBeNull();
    expect(
      within(card as HTMLElement).getByTestId("page-skeleton"),
    ).toBeTruthy();
  });

  it("control: a loaded page renders with no skeleton", () => {
    renderFrame("/mastery", "/mastery", <p data-testid="page-body">Mastery</p>);
    expect(screen.getByTestId("page-body")).toBeTruthy();
    expect(screen.queryByTestId("page-skeleton")).toBeNull();
  });
});
