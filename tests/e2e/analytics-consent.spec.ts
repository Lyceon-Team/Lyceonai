/**
 * Cookie consent → PostHog, in a real browser against the BUILT app with vercel.json's headers.
 *
 * @spec [Doc 10 §9.11; docs/compliance/legal-drafts/README.md banner requirements ("Reject means
 *       zero analytics requests"; GPC = reject; under-13 never loads analytics); SCL-201; SCL-204;
 *       plan F10 / F11 / F15 acceptance; owner Step 0 decisions 2026-10-05] | @implemented [2026-10-05]
 *
 * plain English: every request the page makes to any *.posthog.com host is recorded (and
 * answered locally, so nothing leaves the runner). The four acceptance cases:
 *   1. Reject → ZERO PostHog requests, while the consent log POST proves the click happened;
 *   2. Accept → PostHog loads and sends events to the ingestion host;
 *   3. GPC → the GPC notice instead of the banner, and ZERO PostHog requests;
 *   4. an under-13 signed-in session with a stored "accepted" choice → ZERO PostHog requests.
 * Plus withdrawal: accept, then turn analytics off in Cookie settings → the page reloads, PostHog's
 * storage is gone and no further PostHog request is made.
 *
 * Presence before absence: every "zero" case first proves the page rendered and the consent
 * machinery ran (banner, notice, log POST, or the signed-in profile read).
 *
 * run: build with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and VITE_POSTHOG_KEY set, then
 *   node scripts/ops/page-csp-static-server.mjs 5175
 *   E2E_BASE_URL=http://127.0.0.1:5175 pnpm exec playwright test tests/e2e/analytics-consent.spec.ts
 * CI: job `analytics-consent-e2e`.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { gunzipSync } from "node:zlib";
import {
  HERO_COPY,
  HERO_FLAG_KEY,
  HERO_TITLE_ID,
  HERO_VARIANT_STORAGE_KEY,
} from "../../client/src/lib/analytics/hero-experiment";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}
test.setTimeout(60_000);
// posthog-js drops events from user agents it classifies as bots, and headless Chrome's UA says
// "HeadlessChrome". A desktop Chrome UA makes the browser look like a visitor's, so case 2 tests
// consent rather than PostHog's bot filter (which would make every "zero" case pass for the
// wrong reason too).
test.use({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";
const POSTHOG_HOST = /^https:\/\/[a-z0-9.-]*posthog\.com\//;
const STUDENT = "5c5c5c5c-1111-4222-8333-444444444444";

type CapturedEvent = { event: string; properties: Record<string, unknown> };

type Observed = {
  posthog: string[];
  events: CapturedEvent[];
  consentPosts: unknown[];
  profileReads: number;
};

/** Decodes a PostHog capture body: gzip (detected by its magic bytes) or plain JSON. */
function decodeCapture(body: Buffer | null): CapturedEvent[] {
  if (body === null || body.length === 0) return [];
  const raw =
    body[0] === 0x1f && body[1] === 0x8b
      ? gunzipSync(body).toString("utf-8")
      : body.toString("utf-8");
  const parsed: unknown = JSON.parse(raw);
  // posthog-js sends `{ api_key, batch: [...] }`; a bare event or array is accepted too.
  const batch =
    typeof parsed === "object" && parsed !== null && "batch" in parsed
      ? (parsed as { batch: unknown }).batch
      : parsed;
  const list = Array.isArray(batch) ? batch : [batch];
  return list.filter(
    (e): e is CapturedEvent =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as CapturedEvent).event === "string",
  );
}

async function instrument(
  context: BrowserContext,
  page: Page,
  opts: {
    signedIn?: "under13" | "adult";
    /** The variant PostHog's flag response assigns for `homepage-hero` (F13). */
    heroVariant?: "control" | "test";
  } = {},
): Promise<Observed> {
  const seen: Observed = {
    posthog: [],
    events: [],
    consentPosts: [],
    profileReads: 0,
  };
  // The other half of PostHog's bot check: an automated browser reports navigator.webdriver.
  await context.addInitScript(() => {
    // ...and Playwright's headless shell (what CI runs) names itself "HeadlessChrome" in
    // navigator.userAgentData's brands as well as in the UA string.
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: () => undefined,
    });
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => false,
    });
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await context.route(POSTHOG_HOST, async (route: Route) => {
    seen.posthog.push(route.request().url());
    // Answered locally with valid-shaped bodies: an empty remote config or flags response would
    // leave the SDK waiting, which would read as "no events" for the wrong reason.
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/config.js")) {
      await route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: "",
      });
    } else if (url.pathname.endsWith("/config")) {
      await route.fulfill({
        status: 200,
        // As a real project answers: autocapture on (the project setting), replay off (R12a).
        json: {
          supportedCompression: ["gzip-js"],
          hasFeatureFlags: opts.heroVariant !== undefined,
          autocapture_opt_out: false,
          sessionRecording: false,
        },
      });
    } else if (url.pathname.startsWith("/flags")) {
      await route.fulfill({
        status: 200,
        json: {
          // PostHog's /flags v2 shape; empty unless a test assigns the hero experiment.
          flags:
            opts.heroVariant === undefined
              ? {}
              : {
                  [HERO_FLAG_KEY]: {
                    key: HERO_FLAG_KEY,
                    enabled: true,
                    variant: opts.heroVariant,
                    reason: {
                      code: "condition_match",
                      condition_index: 0,
                      description: "Matched condition set 1",
                    },
                    metadata: { id: 1, version: 1, payload: null },
                  },
                },
          errorsWhileComputingFlags: false,
          autocapture_opt_out: false,
          sessionRecording: false,
        },
      });
    } else {
      if (
        url.hostname === "us.i.posthog.com" &&
        /^\/(e|i\/v0\/e|batch)\b/.test(url.pathname)
      ) {
        seen.events.push(...decodeCapture(route.request().postDataBuffer()));
      }
      await route.fulfill({ status: 200, json: { status: 1 } });
    }
  });
  await page.route(
    (url) =>
      url.origin === new URL(BASE).origin && url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/csrf-token") {
        return route.fulfill({
          json: {
            csrfToken: "t",
            sessionCookiePresent: opts.signedIn !== undefined,
          },
        });
      }
      if (path === "/api/profile") {
        seen.profileReads += 1;
        if (opts.signedIn) {
          return route.fulfill({
            json: {
              authenticated: true,
              user: {
                id: STUDENT,
                email: "student@example.test",
                display_name: "Casey Student",
                role: "student",
                is_under_13: opts.signedIn === "under13",
                profileCompletedAt: "2026-09-01T00:00:00.000Z",
                requiredProfileComplete: true,
                guardianConsentRequired: false,
              },
            },
          });
        }
        return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
      }
      if (path === "/api/public/cookie-consent") {
        seen.consentPosts.push(route.request().postDataJSON());
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ status: 404, json: { error: "not mocked" } });
    },
  );
  return seen;
}

async function setAcceptedCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "lyceon_consent",
      value: `2.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.a.${Math.floor(Date.now() / 1000)}`,
      url: BASE,
    },
  ]);
}

test.describe("cookie consent → PostHog", () => {
  test("1. Reject → zero PostHog requests", async ({ context, page }) => {
    const seen = await instrument(context, page);
    await page.goto(`${BASE}/`);
    await expect(page.getByTestId("cookie-banner")).toBeVisible();
    // Version 2 (owner ruling 2026-10-05): three equal buttons, in this order.
    const banner = page.getByTestId("cookie-banner");
    await expect(banner.getByRole("button")).toHaveText([
      "Reject all",
      "Accept all",
      "Cookie settings",
    ]);
    await banner.getByRole("button", { name: "Reject all" }).click();
    await expect(page.getByTestId("cookie-banner")).toBeHidden();
    await expect.poll(() => seen.consentPosts.length).toBe(1);
    expect(seen.consentPosts[0]).toMatchObject({
      analytics: false,
      source: "banner",
    });
    // Navigate and wait: nothing may load later either.
    await page.goto(`${BASE}/digital-sat`);
    await page.waitForTimeout(2500);
    expect(seen.posthog).toEqual([]);
  });

  test("2. Accept → events sent to PostHog", async ({ context, page }) => {
    const seen = await instrument(context, page);
    await page.goto(`${BASE}/`);
    // Before the choice: nothing at all.
    await expect(page.getByTestId("cookie-banner")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(seen.posthog).toEqual([]);
    await page
      .getByTestId("cookie-banner")
      .getByRole("button", { name: "Accept all" })
      .click();
    await expect
      .poll(
        () =>
          seen.posthog.filter((u) =>
            /us\.i\.posthog\.com\/(e|i\/v0\/e|batch)\b/.test(u),
          ).length,
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);
    expect(seen.consentPosts[0]).toMatchObject({
      analytics: true,
      source: "banner",
    });
    // vercel.json's page CSP (report-only today) names the PostHog hosts: no violation fires.
    const violations = await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    );
    expect(violations).toEqual([]);
  });

  test("3. GPC → treated as refuse: notice, zero PostHog requests", async ({
    context,
    page,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
        get: () => true,
      });
    });
    const seen = await instrument(context, page);
    await page.goto(`${BASE}/`);
    await expect(page.getByTestId("gpc-notice")).toBeVisible();
    await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect(seen.posthog).toEqual([]);
    expect(seen.consentPosts).toEqual([]);
  });

  test("4. under-13 session with consent stored → zero PostHog requests", async ({
    context,
    page,
  }) => {
    await setAcceptedCookie(context);
    const seen = await instrument(context, page, { signedIn: "under13" });
    await page.goto(`${BASE}/`);
    await expect.poll(() => seen.profileReads).toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    expect(seen.posthog).toEqual([]);
  });

  test("withdrawal in Cookie settings stops PostHog and clears its storage", async ({
    context,
    page,
  }) => {
    await setAcceptedCookie(context);
    const seen = await instrument(context, page);
    await page.goto(`${BASE}/digital-sat`);
    await expect
      .poll(() => seen.posthog.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("switch", { name: "Analytics" }).click();
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Save choices" }).click(),
    ]);
    const before = seen.posthog.length;
    await page.waitForTimeout(3000);
    expect(seen.posthog.length).toBe(before);
    const storage = await page.evaluate(() => [
      ...Object.keys(localStorage).filter((k) => /^(ph_|__ph)/.test(k)),
      ...document.cookie
        .split(";")
        .map((c) => c.trim().split("=")[0] ?? "")
        .filter((n) => /^(ph_|__ph)/.test(n)),
    ]);
    expect(storage).toEqual([]);
    expect(seen.consentPosts.at(-1)).toMatchObject({
      analytics: false,
      source: "settings",
    });
  });

  test("signed-in surface: autocapture records no element text (public pages keep it)", async ({
    context,
    page,
  }) => {
    await setAcceptedCookie(context);
    const seen = await instrument(context, page, { signedIn: "adult" });

    // Control (presence before absence): on a public page the clicked element's text is captured.
    await page.goto(`${BASE}/digital-sat`);
    await expect
      .poll(() => seen.events.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await expect
      .poll(
        () => seen.events.filter((e) => e.event === "$autocapture").length,
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);
    const publicClick = seen.events
      .filter((e) => e.event === "$autocapture")
      .at(-1);
    expect(JSON.stringify(publicClick?.properties)).toContain(
      "Cookie settings",
    );
    await page.keyboard.press("Escape");

    // Signed-in surface (RequireRole): the same kind of click carries no element text.
    const before = seen.events.length;
    await page.goto(`${BASE}/profile`);
    // /profile is the Settings page since UI-58: its section buttons are labelled controls whose
    // text a public page would capture; here it must not be.
    const section = page.getByRole("button", { name: "Account", exact: true });
    await expect(section).toBeVisible({ timeout: 15_000 });
    await section.click();
    await expect
      .poll(
        () =>
          seen.events.slice(before).filter((e) => e.event === "$autocapture")
            .length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    for (const e of seen.events
      .slice(before)
      .filter((x) => x.event === "$autocapture")) {
      expect(e.properties["$el_text"] ?? null).toBeNull();
      expect(String(e.properties["$elements_chain"] ?? "")).not.toMatch(
        /text="[^"]+"/,
      );
      expect(JSON.stringify(e.properties)).not.toContain("Casey Student");
    }
  });
});

/**
 * F13 (owner rulings 2026-10-05, Step 0 decisions 5 and 6; SCL-213 IS 7): the homepage hero
 * experiment. Variant A is prerendered and all a visitor without consent sees; consent lets
 * PostHog's flag request assign a variant, which shows from the NEXT homepage view, before first
 * paint, and is the only view that sends an exposure.
 */
test.describe("homepage-hero experiment", () => {
  const heroTitle = (page: Page) => page.locator(`#${HERO_TITLE_ID}`);
  const storedVariant = (page: Page) =>
    page.evaluate(
      (key) => window.localStorage.getItem(key),
      HERO_VARIANT_STORAGE_KEY,
    );
  const exposures = (seen: Observed) =>
    seen.events.filter((e) => e.event === "$feature_flag_called");

  test("no consent → Variant A, no flag request, nothing stored", async ({
    context,
    page,
  }) => {
    const seen = await instrument(context, page, { heroVariant: "test" });
    await page.goto(`${BASE}/`);
    await expect(page.getByTestId("cookie-banner")).toBeVisible();
    await expect(heroTitle(page)).toHaveText(HERO_COPY.control.title);
    await page.waitForTimeout(2500);
    expect(seen.posthog).toEqual([]);
    expect(await storedVariant(page)).toBeNull();
    // Rejecting changes nothing: still A, still no request.
    await page.getByRole("button", { name: "Reject all" }).click();
    await page.goto(`${BASE}/`);
    await expect(heroTitle(page)).toHaveText(HERO_COPY.control.title);
    await page.waitForTimeout(1500);
    expect(seen.posthog).toEqual([]);
  });

  test("consent → the flag assigns B; it shows from the next view, before any app script", async ({
    context,
    page,
  }) => {
    const seen = await instrument(context, page, { heroVariant: "test" });
    await page.goto(`${BASE}/`);
    await expect(heroTitle(page)).toHaveText(HERO_COPY.control.title);
    await page.getByRole("button", { name: "Accept all" }).click();

    // Assigned through PostHog's own flag request, and kept for the next view.
    await expect
      .poll(
        () =>
          seen.posthog.some((u) => new URL(u).pathname.startsWith("/flags")),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);
    await expect
      .poll(() => storedVariant(page), { timeout: 15_000 })
      .toBe("test");
    // The consent view itself does not change, and sends no exposure.
    await expect(heroTitle(page)).toHaveText(HERO_COPY.control.title);
    await page.waitForTimeout(1500);
    expect(exposures(seen)).toEqual([]);

    // Next view, with every app script blocked: only the inline script can have shown B, and it
    // runs as the page is parsed, before first paint.
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
    await page.goto(`${BASE}/`);
    await expect(heroTitle(page)).toHaveText(HERO_COPY.test.title);
    await page.unroute(/\/assets\/.*\.js$/);

    // Next view with the app: still B after React renders, and the exposure is sent once.
    await page.goto(`${BASE}/`);
    await expect(heroTitle(page)).toHaveText(HERO_COPY.test.title);
    await expect
      .poll(() => exposures(seen).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(exposures(seen)[0]?.properties).toMatchObject({
      $feature_flag: HERO_FLAG_KEY,
      $feature_flag_response: "test",
    });
    const csp = await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    );
    expect(csp).toEqual([]);
  });

  test("withdrawing consent deletes the stored variant: back to A", async ({
    context,
    page,
  }) => {
    await setAcceptedCookie(context);
    const seen = await instrument(context, page, { heroVariant: "test" });
    await page.goto(`${BASE}/`);
    await expect
      .poll(() => storedVariant(page), { timeout: 15_000 })
      .toBe("test");
    await page.goto(`${BASE}/`);
    await expect(heroTitle(page)).toHaveText(HERO_COPY.test.title);
    expect(seen.posthog.length).toBeGreaterThan(0);

    await page
      .locator("footer")
      .getByRole("button", { name: "Cookie settings" })
      .click();
    await page.getByRole("switch", { name: "Analytics" }).click();
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Save choices" }).click(),
    ]);
    expect(await storedVariant(page)).toBeNull();
    await expect(heroTitle(page)).toHaveText(HERO_COPY.control.title);
  });
});
