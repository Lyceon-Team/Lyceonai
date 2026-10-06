// @vitest-environment jsdom
/**
 * UI-59: the bare-card pages on the student tokens.
 *
 * @spec [student-UI register UI-3A (the page list), UI-41 (route table), UI-59; DESIGN.md §1
 *        (tokens only, one filled primary per screen, nothing below 14px), §2 "Bare card"]
 *        | @implemented [2026-10-03]
 *
 * plain English: every bare page is rendered the way the app renders it: the routed pages inside
 * the real `StudentRouteFrame` with their own route key (so the shell and its theme lock come
 * from the real route table), the pending-deletion screen through App's real `DeletionGate`, and
 * the error screen through App's real `ErrorBoundary`. For each, presence first (the page's
 * heading and its primary action are on screen), then:
 *   - exactly one shell, the Bare card, with no theme lock (it follows the device theme);
 *   - the page draws no second full-screen frame, card shell or <main> of its own;
 *   - exactly one H1;
 *   - the primary action is the ONE filled (`--primary-bg`) control on the screen;
 *   - no class below 14px, no raw hex, and no colour utility outside the student tokens;
 *   - inputs keep their labels and `autocomplete` tokens, and errors are announced as alerts;
 *   - the 404 and the error screen offer the shipped way out.
 * Network, auth and toasts are stubbed; the server is not in this test (its rules have their own).
 */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentRouteFrame } from "@/components/layout/StudentRouteFrame";
import type { StudentShellRoute } from "@/lib/route-shells";

/** BareCardShell's card class: the 1.55 body leading at bare-`p` specificity, verbatim. */
const BARE_CARD_PROSE_LEADING = "[:where(&)_p]:leading-[1.55]";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const profile = vi.hoisted(() => ({ data: undefined as unknown }));
const api = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  apiRequestRaw: vi.fn(),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => auth.value,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
  toast: () => undefined,
}));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: api.apiRequest,
  apiRequestRaw: api.apiRequestRaw,
}));
vi.mock("@/hooks/useProfileQuery", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useProfileQuery")>();
  return {
    ...real,
    profileQuery: {
      queryKey: real.PROFILE_QUERY_KEY,
      queryFn: async () => profile.data,
    },
    useProfileQuery: () => ({
      data: profile.data,
      isLoading: false,
      error: null,
      refetch: () => undefined,
    }),
  };
});
// The two guardian-link panels are UI-58's, with their own suites; here they are their identity.
vi.mock("@/components/student/StudentLinkCodePanel", () => ({
  StudentLinkCodePanel: () =>
    React.createElement("div", { "data-testid": "link-code-panel" }),
}));
vi.mock("@/components/student/StudentGuardiansPanel", () => ({
  StudentGuardiansPanel: () =>
    React.createElement("div", { "data-testid": "guardians-panel" }),
}));

const { default: Login } = await import("./login");
const { default: ProfileComplete } = await import("./profile-complete");
const { default: UpdatePassword } = await import("./update-password");
const { default: AccountRecover } = await import("./account-recover");
const { default: GuardianRequired } = await import("./guardian-required");
const { default: NotFound } = await import("./not-found");
const { DeletionGate, ErrorBoundary } = await import("@/App");

const noop = async (): Promise<void> => undefined;

function signedOut(): void {
  auth.value = {
    user: null,
    isAuthenticated: false,
    authLoading: false,
    isLoading: false,
    isGuardian: false,
    signIn: vi.fn(async () => {
      const err = new Error("x") as Error & { code?: string };
      err.code = "signin_failed";
      throw err;
    }),
    signUp: vi.fn(noop),
    signInWithGoogle: vi.fn(noop),
    resetPassword: vi.fn(noop),
    signOut: vi.fn(noop),
    refreshUser: vi.fn(noop),
    updatePassword: vi.fn(async () => {
      const err = new Error("x") as Error & { code?: string };
      err.code = "update_password_failed";
      throw err;
    }),
  };
}

function signedInStudent(extra: Record<string, unknown> = {}): void {
  signedOut();
  auth.value = {
    ...auth.value,
    user: {
      id: "00000000-0000-4000-8000-000000000059",
      role: "student",
      ...extra,
    },
    isAuthenticated: true,
  };
}

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderRoute(route: StudentShellRoute, page: React.ReactNode): void {
  render(
    <QueryClientProvider client={client()}>
      <StudentRouteFrame route={route}>{page}</StudentRouteFrame>
    </QueryClientProvider>,
  );
}

/** The one shell on screen: the Bare card, following the device theme. */
function bareShell(): HTMLElement {
  const shells = document.querySelectorAll<HTMLElement>("[data-shell]");
  expect(shells).toHaveLength(1);
  const shell = shells[0];
  if (shell === undefined) throw new Error("unreachable");
  expect(shell.getAttribute("data-shell")).toBe("bare");
  expect(shell.hasAttribute("data-theme-lock")).toBe(false);
  return shell;
}

/** Filled controls: the student primary fill. */
function filledControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a")).filter(
    (el) =>
      (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .includes("bg-lyc-primary-bg"),
  );
}

const SMALL_TEXT = /^(?:[^\s:]+:)*text-(?:xs|\[(?:\d|1[0-3])(?:\.\d+)?px\])$/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
/** A colour utility from the app-wide palette or the shadcn tokens, not the student set. */
const FOREIGN_COLOUR =
  /^(?:[^\s:]+:)*(?:text|bg|border|ring|outline|decoration|fill|stroke)-(?:neutral|gray|slate|zinc|stone|red|amber|yellow|orange|emerald|green|blue|sky|indigo|purple|pink|warm-gray|brand|muted-foreground|foreground|primary|secondary|card|background|destructive|accent|popover|border|input|white|black)(?:-|\/|$)/;

/** Every class and inline style inside the shell is on the student tokens and at least 14px. */
function expectStudentTokensOnly(shell: HTMLElement): void {
  const elements = [shell, ...Array.from(shell.querySelectorAll("*"))];
  // Presence before absence: the scan reads a real page, not an empty card.
  expect(elements.length).toBeGreaterThan(5);
  const problems: string[] = [];
  for (const el of elements) {
    const tokens = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    for (const t of tokens) {
      if (SMALL_TEXT.test(t)) problems.push(`below 14px: ${t}`);
      if (HEX.test(t)) problems.push(`raw hex: ${t}`);
      if (FOREIGN_COLOUR.test(t)) problems.push(`not a student token: ${t}`);
    }
    const style = el.getAttribute("style") ?? "";
    if (HEX.test(style)) problems.push(`raw hex in style: ${style}`);
    for (const attr of ["fill", "stroke", "color"]) {
      const v = el.getAttribute(attr);
      if (v !== null && HEX.test(v)) problems.push(`raw hex in ${attr}: ${v}`);
    }
  }
  expect(problems).toEqual([]);
}

/** The page inside the card draws no frame of its own: no second <main>, card or full screen. */
function expectNoOwnFrame(shell: HTMLElement): void {
  expect(shell.querySelectorAll("main")).toHaveLength(1);
  const inner = Array.from(shell.querySelectorAll("main *"));
  expect(inner.length).toBeGreaterThan(0);
  const framed = inner.filter((el) =>
    /(?:^|\s)(?:min-h-screen|min-h-\[100dvh\]|lyc)(?:\s|$)/.test(
      el.getAttribute("class") ?? "",
    ),
  );
  expect(framed).toEqual([]);
}

function expectOneH1(shell: HTMLElement, text: string): void {
  const h1s = shell.querySelectorAll("h1");
  expect(h1s).toHaveLength(1);
  expect(h1s[0]?.textContent).toBe(text);
}

function expectOnePrimary(shell: HTMLElement, name: string): void {
  const filled = filledControls(shell);
  expect(filled.map((el) => el.textContent?.trim())).toEqual([name]);
}

beforeEach(() => {
  // Radix Select's pointer and scroll calls, which jsdom does not implement.
  const proto = Element.prototype as Element & {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  window.history.replaceState(null, "", "/");
  profile.data = undefined;
  api.apiRequest.mockReset();
  api.apiRequestRaw.mockReset();
  signedOut();
});
afterEach(() => {
  cleanup();
});

describe("/login (sign in, sign up, reset)", () => {
  it("sign in: one bare card, one H1, Sign In the one filled action, labelled inputs with autocomplete", () => {
    window.history.replaceState(null, "", "/login");
    renderRoute("/login", <Login />);
    const shell = bareShell();
    expectOneH1(shell, "Lyceon");
    expectOnePrimary(shell, "Sign In");
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe(
      "email",
    );
    expect(
      screen.getByTestId("input-signin-password").getAttribute("autocomplete"),
    ).toBe("current-password");
    expect(screen.getByLabelText("Password")).toBe(
      screen.getByTestId("input-signin-password"),
    );
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });

  it("the AS-3 redirect error is announced as an alert, in human copy", () => {
    window.history.replaceState(null, "", "/login?error=signin_failed");
    renderRoute("/login", <Login />);
    const shell = bareShell();
    const alert = within(shell).getByTestId("login-redirect-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent ?? "").not.toContain("signin_failed");
    expect((alert.textContent ?? "").length).toBeGreaterThan(10);
    expectStudentTokensOnly(shell);
  });

  it("a failed sign-in is announced as an alert", async () => {
    window.history.replaceState(null, "", "/login");
    renderRoute("/login", <Login />);
    fireEvent.change(screen.getByTestId("input-signin-email"), {
      target: { value: "student@example.test" },
    });
    fireEvent.change(screen.getByTestId("input-signin-password"), {
      target: { value: "wrong-password-1" },
    });
    fireEvent.click(screen.getByTestId("button-signin"));
    const alert = await screen.findByTestId("alert-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expectStudentTokensOnly(bareShell());
  });

  it("sign up: Sign Up the one filled action; name, email and new password keep labels and autocomplete", async () => {
    window.history.replaceState(null, "", "/login");
    renderRoute("/login", <Login />);
    const tab = screen.getByTestId("tab-signup");
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await screen.findByTestId("button-signup");
    const shell = bareShell();
    expectOneH1(shell, "Lyceon");
    expectOnePrimary(shell, "Sign Up");
    expect(
      screen.getByLabelText("Display Name").getAttribute("autocomplete"),
    ).toBe("name");
    expect(
      screen.getByTestId("input-signup-email").getAttribute("autocomplete"),
    ).toBe("email");
    expect(
      screen.getByTestId("input-signup-password").getAttribute("autocomplete"),
    ).toBe("new-password");
    // The disabled reason keeps its polite live region; the rules list keeps its own.
    expect(
      screen.getByTestId("signup-submit-reason").getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      screen
        .getByTestId("input-signup-password-requirements")
        .getAttribute("aria-live"),
    ).toBe("polite");
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });

  it("reset: Send Reset Link the one filled action", () => {
    window.history.replaceState(null, "", "/login");
    renderRoute("/login", <Login />);
    fireEvent.click(screen.getByText("Forgot password?"));
    const shell = bareShell();
    expectOneH1(shell, "Reset Password");
    expectOnePrimary(shell, "Send Reset Link");
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe(
      "email",
    );
    expectStudentTokensOnly(shell);
  });
});

describe("/profile/complete", () => {
  beforeEach(() => {
    signedInStudent();
    profile.data = {
      authenticated: true,
      user: {
        id: "00000000-0000-4000-8000-000000000059",
        role: "student",
        display_name: "",
        requiredProfileComplete: false,
        profileCompletedAt: null,
      },
    };
  });

  it("one bare card, Complete Profile the one filled action, labelled fields with autocomplete", async () => {
    renderRoute("/profile/complete", <ProfileComplete />);
    await screen.findByTestId("button-complete-profile");
    const shell = bareShell();
    expectOneH1(shell, "Complete Your Profile");
    expectOnePrimary(shell, "Complete Profile");
    expect(
      screen.getByLabelText("Display Name").getAttribute("autocomplete"),
    ).toBe("name");
    expect(
      screen.getByLabelText("Date Of Birth").getAttribute("autocomplete"),
    ).toBe("bday");
    expect(screen.getByTestId("select-role")).toBe(
      screen.getByLabelText("Role"),
    );
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });

  it("a validation error is announced as an alert", async () => {
    renderRoute("/profile/complete", <ProfileComplete />);
    await screen.findByTestId("button-complete-profile");
    fireEvent.change(screen.getByTestId("input-display-name"), {
      target: { value: "   " },
    });
    fireEvent.submit(
      screen.getByTestId("button-complete-profile").closest("form") ??
        document.body,
    );
    const alert = await screen.findByTestId("alert-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Display name is required.");
    expectStudentTokensOnly(bareShell());
  });

  it("the role list portals with its own student root (it reads the tokens off-card)", async () => {
    renderRoute("/profile/complete", <ProfileComplete />);
    const trigger = await screen.findByTestId("select-role");
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = await screen.findByRole("option", { name: "Guardian" });
    const listbox = option.closest('[role="listbox"]');
    expect(listbox).not.toBeNull();
    const root = option.closest(".lyc");
    expect(root).not.toBeNull();
    expect(root?.closest("[data-shell]")).toBeNull();
    if (root instanceof HTMLElement) expectStudentTokensOnly(root);
  });
});

describe("/update-password", () => {
  beforeEach(() => signedInStudent());

  it("Update Password the one filled action; both fields new-password; a refusal is an alert", async () => {
    renderRoute("/update-password", <UpdatePassword />);
    const shell = bareShell();
    expectOneH1(shell, "Update Password");
    expectOnePrimary(shell, "Update Password");
    expect(
      screen.getByLabelText("New Password").getAttribute("autocomplete"),
    ).toBe("new-password");
    expect(
      screen.getByLabelText("Confirm Password").getAttribute("autocomplete"),
    ).toBe("new-password");
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);

    fireEvent.change(screen.getByTestId("input-new-password"), {
      target: { value: "Recovered-pass-59" },
    });
    fireEvent.change(screen.getByTestId("input-confirm-password"), {
      target: { value: "Recovered-pass-59" },
    });
    fireEvent.click(screen.getByTestId("button-update-password"));
    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").length).toBeGreaterThan(10);
    expectStudentTokensOnly(bareShell());
  });
});

describe("/account/recover", () => {
  it("a link with no token: the invalid state, support address as an inline link, no filled action", () => {
    window.history.replaceState(null, "", "/account/recover");
    renderRoute("/account/recover", <AccountRecover />);
    const shell = bareShell();
    expectOneH1(shell, "This recovery link is invalid or expired");
    const mail = within(shell).getByRole("link");
    expect(mail.getAttribute("href") ?? "").toMatch(/^mailto:/);
    expect(filledControls(shell)).toEqual([]);
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });

  it("a good token: restored, Sign in is the one filled action and a single link (no button inside it)", async () => {
    window.history.replaceState(null, "", "/account/recover?token=t-59");
    api.apiRequestRaw.mockResolvedValue(new Response("{}", { status: 200 }));
    renderRoute("/account/recover", <AccountRecover />);
    await screen.findByText("Your account is restored");
    const shell = bareShell();
    expectOnePrimary(shell, "Sign in");
    const signIn = screen.getByTestId("recover-signin");
    expect(signIn.tagName).toBe("A");
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.querySelector("button")).toBeNull();
    expectStudentTokensOnly(shell);
  });
});

describe("/guardian-required", () => {
  it("one bare card, one H1, the panels, the Terms link, and no filled action of its own", async () => {
    signedInStudent();
    profile.data = { user: { guardianConsentRequired: true } };
    renderRoute("/guardian-required", <GuardianRequired />);
    await screen.findByTestId("link-code-panel");
    const shell = bareShell();
    expectOneH1(shell, "Connect a guardian to get started");
    expect(within(shell).getByTestId("guardians-panel")).toBeTruthy();
    expect(
      within(shell)
        .getByRole("link", { name: "Student Terms" })
        .getAttribute("href"),
    ).toBe("/legal/student-terms");
    // The page's work is the link-code panel's (UI-58: outline actions); Sign out is outline.
    expect(screen.getByTestId("guardian-required-sign-out").textContent).toBe(
      "Sign out",
    );
    expect(filledControls(shell)).toEqual([]);
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });
});

describe("404", () => {
  // The catch-all renders the SEO page (main, F6/F2; owner choice 2026-10-05 when PR 1069 merged
  // main): the same page as the static 404.html, its own card, no student shell. Its words and
  // link are pinned here and, prerendered, by tests/seo.prerender-output.test.ts.
  it("the approved SEO copy and a link home, with no developer message", () => {
    render(<NotFound />, { wrapper: ({ children }) => <>{children}</> });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Page not found",
    );
    expect(screen.getByText("Sorry, we couldn't find that page.")).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go to the homepage" });
    expect(home.getAttribute("href")).toBe("/");
    expect(document.body.textContent ?? "").not.toContain("router");
  });
});

describe("OQ-60 (f): card paragraphs take the body leading, inside the Bare card only", () => {
  it("the card carries the scoped paragraph leading; the page around it does not", () => {
    window.history.replaceState(null, "", "/account/recover");
    renderRoute("/account/recover", <AccountRecover />);
    const shell = bareShell();
    // Presence: the card has paragraphs for the rule to reach.
    expect(shell.querySelectorAll("main p").length).toBeGreaterThan(0);
    const card = shell.querySelector("main");
    expect(card?.classList.contains(BARE_CARD_PROSE_LEADING)).toBe(true);
    // Scoped to the card: the `.lyc` page frame and <body> do not carry it.
    expect(shell.classList.contains(BARE_CARD_PROSE_LEADING)).toBe(false);
    expect(document.body.classList.contains(BARE_CARD_PROSE_LEADING)).toBe(
      false,
    );
  });
});

describe("the pending-deletion screen (App's DeletionGate)", () => {
  it("replaces the page with one bare card; Cancel deletion is the one filled action", async () => {
    signedInStudent({
      pendingDeletion: { scheduledHardDeleteAt: "2026-10-10T12:00:00Z" },
    });
    window.history.replaceState(null, "", "/dashboard");
    render(
      <QueryClientProvider client={client()}>
        <DeletionGate>
          <div data-testid="behind-the-gate" />
        </DeletionGate>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("behind-the-gate")).toBeNull();
    // The screen is lazy (SEO F8); the card is there at once, its content when the chunk loads.
    await screen.findByText("Your account is scheduled for deletion");
    const shell = bareShell();
    expectOneH1(shell, "Your account is scheduled for deletion");
    expectOnePrimary(shell, "Cancel deletion & restore my account");
    expect(screen.getByTestId("pending-deletion-signout").textContent).toBe(
      "Sign out",
    );
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
  });
});

describe("the error screen (App's ErrorBoundary)", () => {
  it("one bare card following the device theme, Reload Page the one filled action", async () => {
    function Boom(): never {
      throw new Error("ui-59 boom");
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });
    spy.mockRestore();
    const shell = bareShell();
    expectOneH1(shell, "Something went wrong");
    expectOnePrimary(shell, "Reload Page");
    expectNoOwnFrame(shell);
    expectStudentTokensOnly(shell);
    await waitFor(() =>
      expect(shell.textContent ?? "").not.toContain("ui-59 boom"),
    );
  });
});
