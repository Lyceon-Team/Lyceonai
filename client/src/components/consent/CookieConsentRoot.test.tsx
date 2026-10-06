// @vitest-environment jsdom
/**
 * @spec [Doc 10 §9.11; legal-drafts README banner requirements; SCL-201 IS 1; owner Step 0
 *       decision 1, 2026-10-05 (nothing loads or sends before Accept)] | @implemented [2026-10-05]
 *
 * plain English: the REAL banner and the REAL consent store; only the PostHog loader and the auth
 * hook are stubbed, and `fetch` is recorded. Each case asserts what the visitor sees AND whether
 * PostHog was started — the decision this component exists to make.
 */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  running: false,
}));
vi.mock("@/lib/analytics/posthog-client", () => ({
  startAnalytics: loader.start,
  stopAnalytics: loader.stop,
  analyticsRunning: () => loader.running,
}));

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; is_under_13: boolean | null },
  authLoading: false,
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => auth,
}));

const posts: { url: string; body: unknown }[] = [];

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

function setGpc(value: boolean | undefined): void {
  Object.defineProperty(window.navigator, "globalPrivacyControl", {
    value,
    configurable: true,
  });
}

async function mountFresh(): Promise<void> {
  vi.resetModules();
  const { CookieConsentRoot } = await import("./CookieConsentRoot");
  await act(async () => {
    render(<CookieConsentRoot />);
  });
}

beforeEach(() => {
  clearCookies();
  window.sessionStorage.clear();
  setGpc(undefined);
  posts.length = 0;
  loader.start.mockClear();
  loader.stop.mockClear();
  loader.running = false;
  auth.user = null;
  auth.authLoading = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cookie banner", () => {
  it("first visit: shows the banner with both choices equally styled, and starts nothing", async () => {
    await mountFresh();
    // Owner ruling 2026-10-05 (Version 2): heading, then three buttons of one size and style,
    // in this order.
    expect(
      screen.getByRole("heading", { name: "We use cookies" }),
    ).toBeTruthy();
    const banner = screen.getByTestId("cookie-banner");
    const buttons = Array.from(banner.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Reject all",
      "Accept all",
      "Cookie settings",
    ]);
    expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
    expect(banner.textContent).toContain("Cookie Policy");
    expect(loader.start).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("Reject: remembers the refusal, logs it, starts nothing, and the banner is gone", async () => {
    await mountFresh();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cookie-reject"));
    });
    expect(screen.queryByTestId("cookie-banner")).toBeNull();
    expect(loader.start).not.toHaveBeenCalled();
    expect(document.cookie).toMatch(/lyceon_consent=2\.[0-9a-f-]{36}\.r\.\d+/);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      url: "/api/public/cookie-consent",
      body: { analytics: false, banner_version: 2, source: "banner" },
    });
    // A later visit: still refused, no banner, still nothing started.
    cleanup();
    await mountFresh();
    expect(screen.queryByTestId("cookie-banner")).toBeNull();
    expect(loader.start).not.toHaveBeenCalled();
  });

  it("Accept: starts PostHog and logs the acceptance", async () => {
    await mountFresh();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cookie-accept"));
    });
    expect(loader.start).toHaveBeenCalledTimes(1);
    expect(posts[0]).toMatchObject({
      body: { analytics: true, source: "banner" },
    });
  });

  it("GPC: no banner, the GPC notice instead, nothing started, nothing logged", async () => {
    setGpc(true);
    await mountFresh();
    expect(screen.queryByTestId("cookie-banner")).toBeNull();
    expect(screen.getByTestId("gpc-notice").textContent).toMatch(
      /Your browser sent a Global Privacy Control signal, so analytics cookies are off\./,
    );
    expect(loader.start).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("a choice made on the Version 1 text no longer counts: the banner asks again", async () => {
    const now = Math.floor(Date.now() / 1000);
    document.cookie = `lyceon_consent=1.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.a.${now}; Path=/`;
    await mountFresh();
    expect(screen.getByTestId("cookie-banner")).toBeTruthy();
    expect(loader.start).not.toHaveBeenCalled();
  });

  it("the banner's Cookie settings opens the dialog: Analytics off, three choices", async () => {
    await mountFresh();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cookie-open-settings"));
    });
    expect(
      screen.getByRole("heading", { name: "Cookie settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    for (const name of ["Reject all", "Save choices", "Accept all"]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
    expect(posts).toEqual([]);
  });

  it("a choice older than 6 months no longer counts: the banner asks again", async () => {
    const old = Math.floor(Date.now() / 1000) - 183 * 24 * 60 * 60;
    document.cookie = `lyceon_consent=2.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.a.${old}; Path=/`;
    await mountFresh();
    expect(screen.getByTestId("cookie-banner")).toBeTruthy();
    expect(loader.start).not.toHaveBeenCalled();
  });
});

describe("under-13 exclusion", () => {
  const accepted = (): void => {
    const now = Math.floor(Date.now() / 1000);
    document.cookie = `lyceon_consent=2.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.a.${now}; Path=/`;
  };

  it("an adult account with consent: started (presence before absence)", async () => {
    accepted();
    auth.user = { id: "u", is_under_13: false };
    await mountFresh();
    expect(loader.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["under 13", true],
    ["age unknown", null],
  ])(
    "an account %s: never started, no banner, even with consent",
    async (_l, isUnder13) => {
      accepted();
      auth.user = { id: "u", is_under_13: isUnder13 };
      await mountFresh();
      expect(loader.start).not.toHaveBeenCalled();
      expect(screen.queryByTestId("cookie-banner")).toBeNull();
    },
  );

  it("PostHog already running when an under-13 account signs in: stopped", async () => {
    accepted();
    loader.running = true;
    auth.user = { id: "u", is_under_13: true };
    await mountFresh();
    expect(loader.stop).toHaveBeenCalledTimes(1);
  });

  it("an excluded account cannot record a choice: every settings control is disabled", async () => {
    auth.user = { id: "u", is_under_13: true };
    await mountFresh();
    const { openCookieSettings } = await import("@/lib/analytics/consent");
    await act(async () => {
      openCookieSettings();
    });
    // Presence first: the dialog is open.
    expect(screen.getByTestId("cookie-settings")).toBeTruthy();
    for (const name of ["Reject all", "Save choices", "Accept all"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(posts).toEqual([]);
  });

  it("while the session is still resolving: nothing starts", async () => {
    accepted();
    auth.authLoading = true;
    await mountFresh();
    expect(loader.start).not.toHaveBeenCalled();
  });
});

describe("theme (owner ruling 2026-10-05: never a dark banner over a light page)", () => {
  let lycRoot: HTMLElement | null = null;

  function paintPage(theme: "light" | "dark", tokenRoot: boolean): void {
    document.documentElement.setAttribute("data-theme", theme);
    if (tokenRoot && lycRoot === null) {
      lycRoot = document.createElement("div");
      lycRoot.className = "lyc";
      document.body.appendChild(lycRoot);
    }
  }

  afterEach(() => {
    lycRoot?.remove();
    lycRoot = null;
    document.documentElement.removeAttribute("data-theme");
  });

  const bannerIsDark = (): boolean =>
    screen.getByTestId("cookie-banner").classList.contains("dark");

  it("signed-in page painted dark: the banner and the dialog are dark (presence first)", async () => {
    paintPage("dark", true);
    await mountFresh();
    const { enterSignedInSurface } = await import("@/lib/signed-in-surface");
    let leave = (): void => undefined;
    await act(async () => {
      leave = enterSignedInSurface();
    });
    expect(bannerIsDark()).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("cookie-open-settings"));
    });
    expect(
      screen.getByTestId("cookie-settings").classList.contains("dark"),
    ).toBe(true);
    // Leaving the signed-in surface (back to a public page): light again.
    await act(async () => {
      leave();
    });
    expect(bannerIsDark()).toBe(false);
  });

  it("public page, dark setting: light", async () => {
    paintPage("dark", true);
    await mountFresh();
    expect(bannerIsDark()).toBe(false);
  });

  it("signed-in page whose dark setting does not reach the page (no token root): light", async () => {
    paintPage("dark", false);
    await mountFresh();
    const { enterSignedInSurface } = await import("@/lib/signed-in-surface");
    await act(async () => {
      enterSignedInSurface();
    });
    expect(bannerIsDark()).toBe(false);
  });

  it("signed-in page locked to light (timed exam): light", async () => {
    paintPage("dark", true);
    lycRoot?.setAttribute("data-theme-lock", "light");
    await mountFresh();
    const { enterSignedInSurface } = await import("@/lib/signed-in-surface");
    await act(async () => {
      enterSignedInSurface();
    });
    expect(bannerIsDark()).toBe(false);
  });

  it("signed-in page, light setting: light", async () => {
    paintPage("light", true);
    await mountFresh();
    const { enterSignedInSurface } = await import("@/lib/signed-in-surface");
    await act(async () => {
      enterSignedInSurface();
    });
    expect(bannerIsDark()).toBe(false);
  });
});

describe("F-72: above the student shell's phone tab bar (owner brief 2026-10-05)", () => {
  async function mountTabBar(height: number): Promise<() => void> {
    const { useReportBottomChrome } = await import("@/lib/bottom-chrome");
    function FakeTabBar(): JSX.Element {
      const ref = React.useRef<HTMLElement>(null);
      useReportBottomChrome(ref);
      return <nav ref={ref} data-testid="fake-tab-bar" />;
    }
    // jsdom does no layout: the bar's measured height is supplied here.
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function rect(this: HTMLElement) {
      return this.dataset.testid === "fake-tab-bar"
        ? ({ height } as DOMRect)
        : original.call(this);
    };
    const view = render(<FakeTabBar />);
    return () => {
      view.unmount();
      proto.getBoundingClientRect = original;
    };
  }

  it("public page (no tab bar): the banner sits at the bottom edge, unchanged", async () => {
    await mountFresh();
    const banner = screen.getByTestId("cookie-banner");
    expect(banner.className).toContain("bottom-0");
    expect(banner.getAttribute("style") ?? "").not.toContain("calc(");
  });

  it("with the tab bar on screen: the banner sits its height plus the safe-area inset higher, and returns when it goes", async () => {
    await mountFresh();
    let unmount = (): void => undefined;
    await act(async () => {
      unmount = await mountTabBar(65);
    });
    expect(screen.getByTestId("cookie-banner").getAttribute("style")).toMatch(
      // jsdom reorders env()'s arguments when it serialises the style; the parts are the claim.
      /bottom: calc\(65px \+ env\(.*safe-area-inset-bottom/,
    );
    await act(async () => {
      unmount();
    });
    expect(
      screen.getByTestId("cookie-banner").getAttribute("style") ?? "",
    ).not.toContain("calc(");
  });

  it("the GPC notice takes the same offset", async () => {
    setGpc(true);
    await mountFresh();
    let unmount = (): void => undefined;
    await act(async () => {
      unmount = await mountTabBar(65);
    });
    expect(screen.getByTestId("gpc-notice").getAttribute("style")).toMatch(
      // jsdom reorders env()'s arguments when it serialises the style; the parts are the claim.
      /bottom: calc\(65px \+ env\(.*safe-area-inset-bottom/,
    );
    unmount();
  });
});
