// @vitest-environment jsdom
/**
 * Every public call to action opens the auth page in the mode (and role) it promises.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1, 2, 4, 6] |
 * @implemented [2026-10-10]
 *
 * plain English: a round trip on the real components. The hrefs are read off the REAL rendered
 * homepage and public header (not restated here), then each one is loaded as the auth page's URL
 * and the REAL login page and form are rendered on it. For every CTA: the right tab is selected,
 * the title is that mode's, the guardian line shows only for the parent button, and the tabs and
 * "Continue with Google" are there in every mode. Then the form's own promises: guardian intent
 * reaches both sign-up calls until "I'm a student" is pressed; an unknown or malicious query
 * opens plain Sign In; "No account yet? Create one" appears only after a failed email sign-in and
 * switches to Sign Up with the typed email kept, while the error copy stays the generic one.
 * Network and auth are stubbed (the server half is tests/ci/signup-role-intent.pg.ci.test.ts).
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));

// A subscribable stand-in, so a submit can raise and lower `authLoading` the way the real
// context does (every signIn / signUp / Google call sets it while its request runs).
vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSupabaseAuth: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          auth.listeners.add(listener);
          return () => auth.listeners.delete(listener);
        },
        () => auth.value,
      ),
  };
});

function patchAuth(patch: Record<string, unknown>): void {
  auth.value = { ...auth.value, ...patch };
  for (const listener of auth.listeners) listener();
}
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
  toast: () => undefined,
}));
// The real Link renders an anchor with its href; this double does the same (home.pricing.test).
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => [window.location.pathname, vi.fn()],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));

const { default: HomePage } = await import("./home");
const { default: Login } = await import("./login");
const { default: PublicNavBar } =
  await import("@/components/layout/PublicNavBar");
const { authError, resolveAuthErrorMessage } =
  await import("@/lib/auth-error-messages");

const noop = async (): Promise<void> => undefined;
const signUp = vi.fn(noop);
const signInWithGoogle = vi.fn(noop);
// As the real context: authLoading is raised for the request and lowered before the rejection.
const signIn = vi.fn(async () => {
  patchAuth({ authLoading: true, isLoading: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  patchAuth({ authLoading: false, isLoading: false });
  throw authError("signin_failed");
});

function signedOut(): void {
  auth.value = {
    user: null,
    isAuthenticated: false,
    authLoading: false,
    isLoading: false,
    isGuardian: false,
    signIn,
    signUp,
    signInWithGoogle,
    resetPassword: vi.fn(noop),
    signOut: vi.fn(noop),
  };
}

function withClient(node: React.ReactNode): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}

function hrefsNamed(name: string): string[] {
  return screen
    .getAllByRole("link", { name })
    .map((a) => a.getAttribute("href") ?? "");
}

function renderLoginAt(url: string): void {
  window.history.replaceState({}, "", url);
  withClient(<Login />);
}

function selectedTab(): string {
  const signinSelected =
    screen.getByTestId("tab-signin").getAttribute("aria-selected") === "true";
  const signupSelected =
    screen.getByTestId("tab-signup").getAttribute("aria-selected") === "true";
  expect(signinSelected).not.toBe(signupSelected);
  return signinSelected ? "signin" : "signup";
}

type Expectation = { tab: "signin" | "signup"; guardian: boolean };

/** What each CTA, by its visible label, promises (rule 1). */
const HOMEPAGE_CTAS: ReadonlyArray<readonly [string, Expectation]> = [
  ["Sign in", { tab: "signin", guardian: false }],
  ["Get started", { tab: "signup", guardian: false }],
  ["Get started free", { tab: "signup", guardian: false }],
  ["Start the free diagnostic", { tab: "signup", guardian: false }],
  // F-98 (owner brief 2026-10-21, Part F): the hero's one primary button.
  ["Start free diagnostic", { tab: "signup", guardian: false }],
  ["I'm a parent or guardian", { tab: "signup", guardian: true }],
  ["Start practicing free →", { tab: "signup", guardian: false }],
];

beforeEach(() => {
  vi.clearAllMocks();
  signedOut();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function assertLanding(href: string, want: Expectation): void {
  renderLoginAt(href);
  expect(selectedTab()).toBe(want.tab);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    want.tab === "signup" ? "Create your Lyceon account" : "Welcome back",
  );
  expect(screen.queryByTestId("signup-role-guardian") !== null).toBe(
    want.guardian,
  );
  // Rule 1: the tabs and Google stay available in every mode.
  expect(screen.getByTestId("tab-signin")).toBeInTheDocument();
  expect(screen.getByTestId("tab-signup")).toBeInTheDocument();
  expect(screen.getByTestId("button-google-signin")).toBeInTheDocument();
  cleanup();
}

describe("each homepage CTA lands on its tab and role", () => {
  it.each(HOMEPAGE_CTAS)("%s", (label, want) => {
    withClient(<HomePage />);
    const hrefs = hrefsNamed(label);
    expect(hrefs.length).toBeGreaterThan(0); // presence before the per-link checks
    cleanup();
    for (const href of hrefs) assertLanding(href, want);
  });

  it("no homepage link points at the bare auth page any more", () => {
    withClient(<HomePage />);
    const all = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(all.some((h) => h.startsWith("/login?"))).toBe(true);
    expect(all.filter((h) => h === "/login" || h === "/signup")).toEqual([]);
  });

  it("the diagnostic CTA returns to the diagnostic; the practice CTA keeps /dashboard", () => {
    withClient(<HomePage />);
    for (const href of hrefsNamed("Start the free diagnostic")) {
      expect(new URL(href, "https://x.test").searchParams.get("next")).toBe(
        "/practice/diagnostic",
      );
    }
    for (const href of hrefsNamed("Start practicing free →")) {
      expect(new URL(href, "https://x.test").searchParams.get("next")).toBe(
        "/dashboard",
      );
    }
    for (const href of hrefsNamed("I'm a parent or guardian")) {
      expect(new URL(href, "https://x.test").searchParams.get("next")).toBe(
        "/guardian",
      );
    }
  });
});

describe("the public header on the other marketing pages", () => {
  it.each([
    ["Sign In", { tab: "signin", guardian: false }],
    ["Get Started", { tab: "signup", guardian: false }],
  ] as const)("%s", (label, want) => {
    withClient(<PublicNavBar />);
    const [href] = hrefsNamed(label);
    expect(href).toBeDefined();
    cleanup();
    assertLanding(href ?? "", want);
  });
});

describe("unknown or malicious parameters fall back to plain Sign In", () => {
  it.each([
    ["/login"],
    ["/login?mode=reset"],
    ["/login?mode=SIGNUP&role=Guardian"],
    ["/login?mode=signup%3Cscript%3Ealert(1)%3C%2Fscript%3E"],
    ["/login?role=admin"],
    ["/login?mode=javascript%3Aalert(1)&next=https%3A%2F%2Fevil.example"],
  ])("%s", (url) => {
    renderLoginAt(url);
    expect(selectedTab()).toBe("signin");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Welcome back",
    );
    expect(screen.queryByTestId("signup-role-guardian")).toBeNull();
  });

  it("an unknown role on Sign Up opens Sign Up with no role intent", async () => {
    renderLoginAt("/login?mode=signup&role=admin");
    expect(selectedTab()).toBe("signup");
    expect(screen.queryByTestId("signup-role-guardian")).toBeNull();
    fireEvent.click(screen.getByTestId("button-google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle.mock.calls[0]?.[1]).toBeNull();
  });
});

describe("guardian intent reaches both ways of creating the account", () => {
  const GUARDIAN = "/login?mode=signup&role=guardian&next=%2Fguardian";

  it("the email sign-up sends role guardian", async () => {
    renderLoginAt(GUARDIAN);
    fireEvent.change(screen.getByTestId("input-signup-name"), {
      target: { value: "Pat" },
    });
    fireEvent.change(screen.getByTestId("input-signup-email"), {
      target: { value: "pat@example.test" },
    });
    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "correct-horse-9" },
    });
    fireEvent.click(screen.getByTestId("button-signup"));
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp.mock.calls[0]).toEqual([
      "pat@example.test",
      "correct-horse-9",
      { consentSource: "email_signup_form" },
      "Pat",
      "guardian",
    ]);
  });

  it("Continue with Google sends role guardian on Sign Up, and none from Sign In where the line is not shown", async () => {
    renderLoginAt(GUARDIAN);
    fireEvent.click(screen.getByTestId("button-google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle.mock.calls[0]?.[1]).toBe("guardian");

    fireEvent.mouseDown(screen.getByTestId("tab-signin"));
    expect(selectedTab()).toBe("signin");
    // The line belongs to Sign Up, and so does the intent: nothing is sent that is not shown.
    expect(screen.queryByTestId("signup-role-guardian")).toBeNull();
    fireEvent.click(screen.getByTestId("button-google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(2));
    expect(signInWithGoogle.mock.calls[1]?.[1]).toBeNull();

    // Back on Sign Up the line and the intent return together.
    fireEvent.mouseDown(screen.getByTestId("tab-signup"));
    expect(screen.getByTestId("signup-role-guardian")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(3));
    expect(signInWithGoogle.mock.calls[2]?.[1]).toBe("guardian");
  });

  it('"I\'m a student" drops the guardian intent for both calls', async () => {
    renderLoginAt(GUARDIAN);
    expect(screen.getByTestId("signup-role-guardian").textContent).toContain(
      "Signing up as a parent or guardian",
    );
    fireEvent.click(screen.getByTestId("button-signup-as-student"));
    expect(screen.queryByTestId("signup-role-guardian")).toBeNull();
    fireEvent.click(screen.getByTestId("button-google-signin"));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle.mock.calls[0]?.[1]).toBe("student");
  });
});

describe('"No account yet? Create one"', () => {
  it("is absent until an email sign-in fails", () => {
    renderLoginAt("/login?mode=signin");
    expect(screen.queryByTestId("signin-create-account")).toBeNull();
  });

  it("switches to Sign Up and keeps the typed email; the error stays generic", async () => {
    renderLoginAt("/login?mode=signin");
    fireEvent.change(screen.getByTestId("input-signin-email"), {
      target: { value: "typed@example.test" },
    });
    fireEvent.change(screen.getByTestId("input-signin-password"), {
      target: { value: "whatever1" },
    });
    fireEvent.click(screen.getByTestId("button-signin"));
    const alert = await screen.findByTestId("alert-error");
    // Non-enumerating: the same copy as before this change, naming no account state.
    expect(alert.textContent).toContain(
      resolveAuthErrorMessage(authError("signin_failed")),
    );
    expect(alert.textContent).not.toMatch(/no account|not found|exist/i);

    fireEvent.click(screen.getByTestId("button-create-account"));
    expect(selectedTab()).toBe("signup");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Create your Lyceon account",
    );
    expect(
      (screen.getByTestId("input-signup-email") as HTMLInputElement).value,
    ).toBe("typed@example.test");
    expect(screen.queryByTestId("alert-error")).toBeNull();
  });
});

describe("a new entry URL on the open auth page", () => {
  it("starts the form in the new mode and role", () => {
    window.history.replaceState({}, "", "/login?mode=signin");
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <Login />
      </QueryClientProvider>,
    );
    expect(selectedTab()).toBe("signin");
    window.history.replaceState(
      {},
      "",
      "/login?mode=signup&role=guardian&next=%2Fguardian",
    );
    view.rerender(
      <QueryClientProvider client={client}>
        <Login />
      </QueryClientProvider>,
    );
    expect(selectedTab()).toBe("signup");
    expect(screen.getByTestId("signup-role-guardian")).toBeInTheDocument();
  });
});

/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: "Sign-up/sign-in page:
 *       Lyceon logo linking to /; password placeholder 'Password'"] | @implemented [2026-10-13]
 */
describe("first-run P1: the sign-in / sign-up card", () => {
  it("has the Lyceon logo, a link to the homepage, on both tabs", () => {
    for (const url of ["/login", "/login?mode=signup"]) {
      renderLoginAt(url);
      const logo = screen.getByRole("link", { name: "Lyceon home" });
      expect(logo.getAttribute("href")).toBe("/");
      expect(logo.textContent).toBe("Lyceon");
      expect(logo.querySelector("svg")).not.toBeNull();
      cleanup();
    }
  });

  it('the password field says "Password", on Sign In and on Sign Up', () => {
    renderLoginAt("/login");
    expect(
      screen.getByTestId("input-signin-password").getAttribute("placeholder"),
    ).toBe("Password");
    cleanup();
    renderLoginAt("/login?mode=signup");
    expect(
      screen.getByTestId("input-signup-password").getAttribute("placeholder"),
    ).toBe("Password");
  });
});

// F-98 (owner brief "student cleanups", Karl, 2026-10-21, Part F): ONE primary button in the hero,
// "Start free diagnostic"; "Sign in" and "I'm a parent or guardian" are secondary text links whose
// targets keep their mode / role / next parameters; no parent-facing label above the hero.
// Owner rulings on #1277 (Karl, 2026-10-21), ruling 4: Variant B of the hero experiment keeps
// running and conforms to the same rule, so every case runs for BOTH variants: A (no consent,
// what every visitor without analytics consent sees) and B (consent accepted and B stored, as
// posthog-client.ts stores it).
const { HERO_COPY, HERO_VARIANT_STORAGE_KEY } =
  await import("@/lib/analytics/hero-experiment");
const { COOKIE_BANNER_VERSION } =
  await import("@lyceon/shared/analytics-consent-schema");

type HeroCase = "control" | "test";

function showVariant(variant: HeroCase): void {
  document.cookie = "lyceon_consent=; Max-Age=0; Path=/";
  window.localStorage.removeItem(HERO_VARIANT_STORAGE_KEY);
  if (variant === "test") {
    const now = Math.floor(Date.now() / 1000);
    document.cookie = `lyceon_consent=${COOKIE_BANNER_VERSION}.00000000-0000-4000-8000-000000000098.a.${now}; Path=/`;
    window.localStorage.setItem(HERO_VARIANT_STORAGE_KEY, "test");
  }
}

describe.each(["control", "test"] as const)(
  "F-98: the homepage hero, variant %s",
  (variant) => {
    function hero(): HTMLElement {
      const section = document.getElementById("top");
      if (section === null) throw new Error("no hero section");
      return section;
    }

    beforeEach(() => showVariant(variant));
    afterEach(() => showVariant("control"));

    it("shows this variant's copy (presence: the variant under test is the one drawn)", () => {
      withClient(<HomePage />);
      expect(hero().querySelector("h1")?.textContent).toBe(
        HERO_COPY[variant].title,
      );
      expect(hero().textContent).toContain(HERO_COPY[variant].sub);
    });

    it("has exactly one button-styled link, 'Start free diagnostic', to sign up then the diagnostic", () => {
      withClient(<HomePage />);
      const links = Array.from(hero().querySelectorAll("a"));
      // Presence first: the hero draws its three paths.
      expect(links.map((a) => a.textContent)).toEqual([
        "Start free diagnostic",
        "Sign in",
        "I'm a parent or guardian",
      ]);
      const buttons = links.filter((a) =>
        a.className.split(" ").includes("rounded-xl"),
      );
      expect(buttons.map((a) => a.textContent)).toEqual([
        "Start free diagnostic",
      ]);
      const primary = new URL(
        buttons[0]?.getAttribute("href") ?? "",
        "https://x.test",
      );
      expect(primary.searchParams.get("mode")).toBe("signup");
      expect(primary.searchParams.get("next")).toBe("/practice/diagnostic");
    });

    it("the secondary links are text links that keep their parameters", () => {
      withClient(<HomePage />);
      const signIn = hero().querySelector('[data-testid="hero-link-sign-in"]');
      const guardian = hero().querySelector(
        '[data-testid="button-guardian-signup"]',
      );
      expect(signIn?.className).toContain("underline");
      expect(guardian?.className).toContain("underline");
      const s = new URL(signIn?.getAttribute("href") ?? "", "https://x.test");
      expect(s.searchParams.get("mode")).toBe("signin");
      const g = new URL(guardian?.getAttribute("href") ?? "", "https://x.test");
      expect(g.searchParams.get("mode")).toBe("signup");
      expect(g.searchParams.get("role")).toBe("guardian");
      expect(g.searchParams.get("next")).toBe("/guardian");
    });

    it("draws no label above the hero's title: the h1 is the hero's first element", () => {
      withClient(<HomePage />);
      const h1 = hero().querySelector("h1");
      expect(h1).not.toBeNull();
      expect(h1?.parentElement?.firstElementChild).toBe(h1);
      expect(hero().textContent).not.toContain("SAT prep for families");
    });
  },
);
