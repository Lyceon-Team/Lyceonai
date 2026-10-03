/**
 * The STUDENT mastery page in a real browser — screenshots for the owner's review (R11: the
 * guardian Dashboard and this page render one `DomainGrid`, meter included).
 *
 * @spec [owner review 2026-10-01, final round ("refresh the review page's screenshots for the
 *       Dashboard, the Calendar and the student mastery page at both widths"); R12 (16px)]
 *   | @implemented [2026-10-01]
 *
 * plain English: serves `/mastery` to a signed-in student with the guardian harness's mastery
 * payload (`masteryDomains()`, through the shared schema: four served rows, so four cards
 * read "Not enough answers yet" with empty meters) and screenshots it at 1440 and 390. No 16px
 * check here: the student page keeps the student type scale, and the floor is a
 * guardian-surface rule (R12).
 *
 * run: as `guardian-surfaces.spec.ts` (Vite up, E2E_BASE_URL, E2E_SHOT_DIR).
 */
import { expect, test, type Route } from "@playwright/test";
import { pinClock } from "./guardian-harness/clock";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}

// One "today" for the whole job (./guardian-harness/clock.ts): the fixtures are built for it and
// the page's clock is frozen on it, in UTC, so no check depends on the day CI runs.
test.use({ timezoneId: "UTC" });
test.beforeEach(async ({ page }) => {
  await pinClock(page);
});

const F = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "tsx", "tests/e2e/guardian-harness/fixtures.ts"],
    {
      encoding: "utf8",
    },
  ),
) as { masteryDomains: unknown };

const STUDENT = "student-1";
const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/student-mastery");
fs.mkdirSync(SHOTS, { recursive: true });

for (const vp of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  test(`student mastery @${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route(
      (url: URL) => url.pathname.startsWith("/api/"),
      async (route: Route) => {
        const p = new URL(route.request().url()).pathname;
        const json = (body: unknown, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        if (p === "/api/csrf-token") return json({ csrfToken: "t" });
        if (p === "/api/profile") {
          return json({
            authenticated: true,
            user: {
              id: STUDENT,
              role: "student",
              profileCompletedAt: "2026-09-01T00:00:00.000Z",
              requiredProfileComplete: true,
              guardianConsentRequired: false,
            },
          });
        }
        if (p === `/api/students/${STUDENT}/mastery/domains`) {
          return json(F.masteryDomains);
        }
        return json({ error: "Not found", requestId: "r" }, 404);
      },
    );
    await page.goto("/mastery");
    await page.getByTestId("domain-grid").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SHOTS, `student-mastery-${vp.name}.png`),
      fullPage: true,
    });
    // Presence: all eight cards, each with its meter.
    expect(await page.getByTestId("mastery-meter").count()).toBe(8);
  });
}
