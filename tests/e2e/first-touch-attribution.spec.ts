/**
 * First-touch attribution survives the forced redirect to /login (owner report 2026-10-05).
 *
 * @spec [SCL-201 IS 6 (first-touch UTM carried to the signup); Doc 07A §6.2 (`signup_source`);
 *       cookie-policy.md §1–§2 (session storage is a cookie; analytics storage needs consent);
 *       owner report 2026-10-05 ("land with UTM → forced redirect → signup → signup_source =
 *       paid_ad")] | @implemented [2026-10-05]
 *
 * plain English: the BUILT app in a real browser, served with vercel.json's headers. The visitor
 * lands on the homepage from an ad (`utm_medium=cpc`), answers the cookie banner, and then a FULL
 * document load (not an in-app link, which never lost it) opens a signed-in page that the app
 * redirects to /login — the query string is gone, which is what lost the channel in production.
 * They then sign up. The signup request is
 * answered locally and its body read:
 *   1. accepted analytics → `signupSource: "paid_ad"`, and the tab's session storage holds it;
 *   2. rejected analytics → nothing stored, so the channel is this page's own (`direct`).
 * The server side — POST /api/auth/signup writing that value to profiles.signup_source, and
 * user_signed_up carrying it — is proved over real Postgres by tests/ci/signup-analytics.pg.ci.
 *
 * run: pnpm run build, then
 *   node scripts/ops/page-csp-static-server.mjs 5175
 *   E2E_BASE_URL=http://127.0.0.1:5175 pnpm exec playwright test tests/e2e/first-touch-attribution.spec.ts
 * CI: job `analytics-consent-e2e`.
 */
import { expect, test, type Page } from "@playwright/test";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}
test.setTimeout(60_000);

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";
const PAID_LANDING = "/?utm_source=google&utm_medium=cpc&utm_campaign=sat_prep";
const STORAGE_KEY = "lyceon_first_touch";

type Seen = { signupBodies: Record<string, unknown>[] };

async function instrument(page: Page): Promise<Seen> {
  const seen: Seen = { signupBodies: [] };
  // Nothing leaves the runner: every non-local request is answered empty.
  await page.route(
    (url) => url.origin !== new URL(BASE).origin,
    (route) => route.fulfill({ status: 204, body: "" }),
  );
  await page.route(
    (url) =>
      url.origin === new URL(BASE).origin && url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/csrf-token") {
        return route.fulfill({
          json: { csrfToken: "t", sessionCookiePresent: false },
        });
      }
      if (path === "/api/profile") {
        return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
      }
      if (path === "/api/public/cookie-consent") {
        return route.fulfill({ status: 204, body: "" });
      }
      if (path === "/api/auth/signup") {
        seen.signupBodies.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        // Answered as a refusal: the body is what this test reads; nothing after it matters.
        return route.fulfill({
          status: 400,
          json: { error: "stopped by test" },
        });
      }
      return route.fulfill({ status: 404, json: { error: "not mocked" } });
    },
  );
  return seen;
}

async function landAnswerAndSignUp(
  page: Page,
  choice: "Accept all" | "Reject all",
): Promise<void> {
  await page.goto(`${BASE}${PAID_LANDING}`);
  const banner = page.getByTestId("cookie-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: choice }).click();
  await expect(banner).toBeHidden();

  // The forced redirect, as production lost it: a FULL document load (a refresh, a typed or
  // pasted address, a redirect from outside the app) of a signed-in page, which the app sends to
  // /login. In-app links are client-side and never lost the channel; a document load did,
  // because the value lived only in this page's memory. The marker proves the load happened.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });
  await page.goto(`${BASE}/dashboard`);
  await page.waitForURL(/\/login\?next=%2Fdashboard$/);
  expect(
    await page.evaluate(
      () => (window as unknown as { __sameDocument?: boolean }).__sameDocument,
    ),
  ).toBeUndefined();
  expect(new URL(page.url()).searchParams.has("utm_medium")).toBe(false);

  await page.getByTestId("tab-signup").click();
  await page.getByTestId("input-signup-name").fill("Casey Student");
  await page.getByTestId("input-signup-email").fill("casey@example.test");
  await page.getByTestId("input-signup-password").fill("Str0ngPassw0rd!");
  await page.getByTestId("button-signup").click();
}

test("accepted analytics: a paid landing is still paid_ad at signup after the full load of /login", async ({
  page,
}) => {
  const seen = await instrument(page);
  await landAnswerAndSignUp(page, "Accept all");
  await expect.poll(() => seen.signupBodies.length).toBe(1);
  expect(seen.signupBodies[0]?.signupSource).toBe("paid_ad");
  expect(
    await page.evaluate((k) => window.sessionStorage.getItem(k), STORAGE_KEY),
  ).toBe("paid_ad");
});

test("rejected analytics: nothing is stored, so the channel is the signup page's own (direct)", async ({
  page,
}) => {
  const seen = await instrument(page);
  await landAnswerAndSignUp(page, "Reject all");
  await expect.poll(() => seen.signupBodies.length).toBe(1);
  expect(seen.signupBodies[0]?.signupSource).toBe("direct");
  expect(
    await page.evaluate((k) => window.sessionStorage.getItem(k), STORAGE_KEY),
  ).toBeNull();
});
