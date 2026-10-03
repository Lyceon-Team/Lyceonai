// @vitest-environment jsdom
/**
 * F-65: a portalled overlay takes the theme lock of the shell under it.
 *
 * @spec [student-UI register §8 F-65 ("the upgrade modal ignores the shell's light lock"); OQ-49
 *        (every shell pinned light until its page is themed); UI-50 (/dashboard is the first
 *        route off the lock)] | @implemented [2026-10-03]
 *
 * plain English: the upgrade modal is mounted at the app root and portals onto <body>, outside
 * every shell. Over a shell pinned light it must carry `data-theme-lock="light"` on its own
 * `.lyc` root (so the light token set applies even with dark requested); over an unlocked shell
 * (Home, after UI-50) it must carry none, and follow the device theme with the page. The tree is
 * the app's: the root provider, the real upgrade modal, the real App shell and Bare card.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  UpgradeModalProvider,
  useUpgradeModal,
} from "@/components/billing/UpgradeModal";
import type { ThemeLock } from "@/lib/route-shells";
import { AppShell } from "./app-shell";
import { BareCard } from "./BareCardShell";
import { ActiveThemeLockProvider } from "./theme-lock";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: null,
    isLoading: false,
    authLoading: false,
    isAuthenticated: false,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

function OpenLisa(): JSX.Element {
  const { open } = useUpgradeModal();
  return (
    <button type="button" onClick={() => open("tutor_access")}>
      open
    </button>
  );
}

function mount(shell: (lock: ThemeLock) => JSX.Element, lock: ThemeLock) {
  const { hook } = memoryLocation({ path: "/dashboard" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  const tree = (l: ThemeLock): JSX.Element => (
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <ActiveThemeLockProvider>
          <UpgradeModalProvider autoOpenOnDenial={false}>
            {shell(l)}
          </UpgradeModalProvider>
        </ActiveThemeLockProvider>
      </Router>
    </QueryClientProvider>
  );
  const rendered = render(tree(lock));
  return { rerender: (l: ThemeLock) => rendered.rerender(tree(l)) };
}

/** The modal's own `.lyc` root: the portal wrapper around the dialog. */
function modalRoot(): HTMLElement {
  const dialog = screen.getByTestId("upgrade-modal");
  const root = dialog.closest<HTMLElement>(".lyc");
  // Presence: the modal rendered, outside the shell (on <body>), inside its own token root.
  expect(root).not.toBeNull();
  if (root === null) throw new Error("no .lyc root on the modal");
  expect(root.closest("[data-shell]")).toBeNull();
  return root;
}

afterEach(() => cleanup());

const appShell = (lock: ThemeLock): JSX.Element => (
  <AppShell panel={360} footer themeLock={lock}>
    <OpenLisa />
  </AppShell>
);
const bareCard = (lock: ThemeLock): JSX.Element => (
  <BareCard themeLock={lock}>
    <OpenLisa />
  </BareCard>
);

describe("F-65: the upgrade modal follows the shell's theme lock", () => {
  it("over an App shell pinned light, the modal is pinned light", () => {
    mount(appShell, "light");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(modalRoot().getAttribute("data-theme-lock")).toBe("light");
  });

  it("over an unlocked App shell (Home, UI-50), the modal carries no lock", () => {
    mount(appShell, null);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(modalRoot().hasAttribute("data-theme-lock")).toBe(false);
  });

  it("over a Bare card pinned light, the modal is pinned light", () => {
    mount(bareCard, "light");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(modalRoot().getAttribute("data-theme-lock")).toBe("light");
  });

  it("tracks the shell on screen: a shell that drops its lock drops it from the open modal", () => {
    const { rerender } = mount(appShell, "light");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(modalRoot().getAttribute("data-theme-lock")).toBe("light");
    rerender(null);
    expect(modalRoot().hasAttribute("data-theme-lock")).toBe(false);
  });
});
