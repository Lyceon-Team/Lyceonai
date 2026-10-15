// @vitest-environment jsdom
/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 1: a lazy-route load
 *        failure reloads once automatically (loop-guarded), and "the error screen renders inside
 *        the app shell with rail/tabs". Test both.] | @implemented [2026-10-13]
 *
 * plain English: a real `React.lazy` page whose import rejects with Chromium's message, rendered
 * through the real StudentRouteFrame:
 *   1. first failure, empty storage: exactly one reload, and no error screen;
 *   2. the same failure again (the reload's record is in storage): no reload, and the error screen
 *      inside the App shell, with the rail and the phone tab bar around it, and "Reload page" its
 *      one filled action (which reloads when pressed);
 *   3. storage that throws: no automatic reload at all, the in-shell error screen at once;
 *   4. an ordinary render error: no automatic reload, the in-shell error screen;
 *   5. the Focus shell keeps its top bar around the screen.
 * App's root boundary is covered for a chunk failure above the shells: one reload, then the card.
 */
import React, { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import type { StudentShellRoute } from "@/lib/route-shells";
import { CHUNK_RELOAD_STORAGE_KEY } from "@/lib/chunk-reload";
import { StudentRouteFrame } from "./StudentRouteFrame";

const reloadPage = vi.fn();
vi.mock("@/lib/reload-page", () => ({ reloadPage: () => reloadPage() }));

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

const CHUNK_MESSAGE =
  "Failed to fetch dynamically imported module: https://lyceon.ai/assets/practice-3f9a1c.js";

/** A fresh lazy page whose import rejects (React caches a lazy's result, so one per render). */
function failingChunk(): React.ComponentType {
  return lazy(() => Promise.reject(new TypeError(CHUNK_MESSAGE)));
}

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

let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.sessionStorage.clear();
  reloadPage.mockClear();
  // React reports every caught error to the console; the boundary is the surfaced failure.
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleSpy.mockRestore();
  cleanup();
  vi.restoreAllMocks();
});

function expectInAppShell(screenEl: HTMLElement): void {
  const shell = screenEl.closest<HTMLElement>('[data-shell="app"]');
  expect(shell).not.toBeNull();
  expect(screen.getByTestId("app-rail")).toBeTruthy();
  expect(screen.getByTestId("app-tab-bar")).toBeTruthy();
  expect(screenEl.closest("main#main")).not.toBeNull();
}

describe("P0-1: a page chunk that fails to load", () => {
  it("reloads once on the first failure and shows no error screen", async () => {
    const Page = failingChunk();
    await act(async () => {
      renderFrame("/practice", "/practice", <Page />);
    });
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("route-error")).toBeNull();
    expect(screen.queryByTestId("error-screen")).toBeNull();
    // The guard is written before the reload, so the next load cannot reload again.
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toContain(
      "practice-3f9a1c.js",
    );
  });

  it("after that reload, the same failure shows the error screen inside the App shell, and never reloads again", async () => {
    // The first load (above) reloaded and left its record; this is the load after it.
    const First = failingChunk();
    await act(async () => {
      renderFrame("/practice", "/practice", <First />);
    });
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    cleanup();

    const Second = failingChunk();
    await act(async () => {
      renderFrame("/practice", "/practice", <Second />);
    });
    const errorScreen = await screen.findByTestId("route-error");
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expectInAppShell(errorScreen);
    expect(
      within(errorScreen).getByRole("heading", { level: 1 }).textContent,
    ).toBe("This page didn't load");
    // The one filled action is Reload page, and it reloads.
    const reload = within(errorScreen).getByTestId("route-error-reload");
    expect(reload.className).toContain("bg-lyc-primary-bg");
    expect(
      document.querySelectorAll('[data-shell="app"] .bg-lyc-primary-bg'),
    ).toHaveLength(1);
    // The raw error never reaches the screen.
    expect(document.body.textContent ?? "").not.toContain("dynamically");
    fireEvent.click(reload);
    expect(reloadPage).toHaveBeenCalledTimes(2);
  });

  it("never reloads automatically when storage cannot guard the next load", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const Page = failingChunk();
    await act(async () => {
      renderFrame("/practice", "/practice", <Page />);
    });
    const errorScreen = await screen.findByTestId("route-error");
    expect(reloadPage).not.toHaveBeenCalled();
    expectInAppShell(errorScreen);
  });

  it("an ordinary render error shows the in-shell screen and does not reload", async () => {
    function Boom(): never {
      throw new Error("page bug");
    }
    await act(async () => {
      renderFrame("/practice", "/practice", <Boom />);
    });
    const errorScreen = await screen.findByTestId("route-error");
    expect(reloadPage).not.toHaveBeenCalled();
    expectInAppShell(errorScreen);
    expect(document.body.textContent ?? "").not.toContain("page bug");
  });

  it("in the Focus shell the top bar stays around the error screen", async () => {
    window.sessionStorage.setItem(
      CHUNK_RELOAD_STORAGE_KEY,
      JSON.stringify({
        entries: { "https://lyceon.ai/assets/practice-3f9a1c.js": Date.now() },
        last: Date.now(),
      }),
    );
    const Page = failingChunk();
    await act(async () => {
      renderFrame(
        "/practice/session/:sessionId",
        "/practice/session/00000000-0000-4000-8000-000000000009",
        <Page />,
      );
    });
    const errorScreen = await screen.findByTestId("route-error");
    const shell = errorScreen.closest<HTMLElement>('[data-shell="focus"]');
    expect(shell).not.toBeNull();
    expect(
      within(shell as HTMLElement).getByTestId("focus-shell-header"),
    ).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

describe("P0-1: App's root boundary (a chunk above the shells)", () => {
  it("reloads once, then shows its card on the next failure", async () => {
    const { ErrorBoundary } = await import("@/App");
    const First = failingChunk();
    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback={null}>
            <First />
          </Suspense>
        </ErrorBoundary>,
      );
    });
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("error-screen")).toBeNull();
    cleanup();

    const Second = failingChunk();
    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback={null}>
            <Second />
          </Suspense>
        </ErrorBoundary>,
      );
    });
    expect(await screen.findByTestId("error-screen")).toBeTruthy();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
