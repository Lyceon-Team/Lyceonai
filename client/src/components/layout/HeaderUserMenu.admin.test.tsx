// @vitest-environment jsdom
/**
 * @spec [Doc-03_V3 §21.3; Coding Standards §11.3; closure plan W2-7]
 * @implemented 2026-09-24
 *
 * plain English: an admin can reach the crisis review queue from inside the
 * app — the user menu carries a "Crisis review" entry that goes to
 * /admin/crisis-review. A student and a guardian never see it. (Hiding is
 * presentation; the route and the API enforce admin server-side.)
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", navigate],
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

let authState: {
  user: { id: string; email: string; display_name: string } | null;
  isLoading: boolean;
  isAdmin: boolean;
};
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => authState,
}));

import { HeaderUserMenu } from "./HeaderUserMenu";

function openMenu(): void {
  const trigger = screen.getByTestId("button-user-menu");
  // Radix opens the menu on keyboard activation of the trigger.
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function renderMenu(): void {
  render(
    <HeaderUserMenu
      signOut={async () => undefined}
      isSigningOut={false}
      fallbackName="User"
    />,
  );
}

beforeEach(() => {
  navigate.mockClear();
});

describe("W2-7 — admin entry point to /admin/crisis-review", () => {
  it("an admin sees 'Crisis review' and it navigates to the queue", () => {
    authState = {
      user: { id: "a1", email: "admin@lyceon.test", display_name: "Admin" },
      isLoading: false,
      isAdmin: true,
    };
    renderMenu();
    openMenu();

    const item = screen.getByTestId("menu-crisis-review");
    expect(item.textContent).toContain("Crisis review");
    fireEvent.click(item);
    expect(navigate).toHaveBeenCalledWith("/admin/crisis-review");
  });

  it("a non-admin does not see it", () => {
    authState = {
      user: { id: "s1", email: "student@lyceon.test", display_name: "S" },
      isLoading: false,
      isAdmin: false,
    };
    renderMenu();
    openMenu();

    // The menu is open (Settings is there) — the entry is absent, not hidden.
    expect(screen.getByTestId("menu-profile")).toBeTruthy();
    expect(screen.queryByTestId("menu-crisis-review")).toBeNull();
  });
});
