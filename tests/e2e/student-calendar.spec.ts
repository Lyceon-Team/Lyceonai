/**
 * The STUDENT calendar in a real browser — the R11 guard for changes made for the guardian.
 *
 * @spec [Guardian_Closure_Plan R11 (the guardian view is the student's view — a change to the
 *       shared calendar reaches both); owner decisions 2026-10-01 on PR 1003 (items 6 and 10:
 *       "Student snapshots must stay identical"; "the student desktop snapshots must stay
 *       identical")] | @implemented [2026-10-01]
 *
 * plain English: serves `/calendar` to a signed-in student with the real week
 * (`calendar-week.fixture.ts`, through the same read model the server uses) and screenshots
 * it at 1440 and 390. Run once before a change to the shared calendar and once after, into
 * two directories, then compare the PNGs byte for byte (`cmp`): desktop must be identical;
 * phone differs only where a change meant it to. At 390 it also measures the phone centring
 * (owner decision 2026-10-01, item 10) with the guardian spec's `offCentre`.
 *
 * run: as `guardian-surfaces.spec.ts` (Vite up, E2E_BASE_URL, E2E_SHOT_DIR).
 *
 * UI-55 (2026-10-03): the student calendar moved onto the App shell (student-UI register UI-55,
 * DESIGN.md §4): its own rail and the three-zone `.top` header (slots C1/C2/R1/R2) are the
 * guardian's alone now, and the student page draws a Canvas-style header (`calendar-header`)
 * with the goal card in the shell's right panel. So this spec waits for the student grid instead
 * of `.main`, and its phone-centring checks keep every SHARED element (the day heading, the
 * week strip, the facts footer, the block card) and measure the new header's two rows in place
 * of the retired slots. The desktop byte comparison applies from this redesign on.
 */
import { expect, test, type Route } from "@playwright/test";
import { offCentre } from "./guardian-harness/centring";
import { pinBrowserToday } from "./guardian-harness/today";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}

const F = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "tsx", "tests/e2e/guardian-harness/fixtures.ts"],
    {
      encoding: "utf8",
    },
  ),
) as { studentCalendar: unknown };

const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/student-calendar");
fs.mkdirSync(SHOTS, { recursive: true });

for (const vp of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  test(`student calendar @${vp.name}`, async ({ page }) => {
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
              id: "student-1",
              role: "student",
              profileCompletedAt: "2026-09-01T00:00:00.000Z",
              requiredProfileComplete: true,
              guardianConsentRequired: false,
            },
          });
        }
        if (p === "/api/calendar") return json(F.studentCalendar);
        if (p === "/api/notifications/unread-count")
          return json({ data: { unread: 0 }, requestId: "r" });
        if (p === "/api/notifications")
          return json({
            data: { items: [], nextCursor: null },
            requestId: "r",
          });
        return json({ error: "Not found", requestId: "r" }, 404);
      },
    );
    // The fixture week is cut on E2E_TODAY; the app's "today" must be the same day.
    await pinBrowserToday(page);
    await page.goto("/calendar");
    // The week grid (one day plus the strip on a phone) is in both layouts.
    await page
      .locator('[data-testid="calendar-week-grid"]')
      .first()
      .waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SHOTS, `student-calendar-${vp.name}.png`),
      fullPage: true,
    });
    // One grid root and one overlay root (the sheets), both scoped by the student class.
    expect(await page.locator(".lyceon-calendar.lyc-cal").count()).toBe(2);
    expect(await page.locator(".lyceon-calendar .rail").count()).toBe(0);
    // R11: the shared calendar centres on a student's phone exactly as on a guardian's
    // (owner decision 2026-10-01, item 10). Desktop is the byte comparison above.
    if (vp.name === "390") {
      expect(
        await offCentre(page, [
          {
            what: "header range title",
            selector: '[data-testid="calendar-range-title"]',
            mode: "text",
            within: "parent",
          },
          {
            what: "header control row",
            selector: '[data-testid="calendar-header-nav"]',
            mode: "lines",
          },
          {
            what: "selected-day heading",
            selector: ".lyceon-calendar .col .dayhead",
            mode: "text",
          },
          {
            what: "week-strip label",
            selector: ".lyceon-calendar .daychip",
            mode: "text",
          },
          {
            what: "facts footer",
            selector: ".lyceon-calendar .facts",
            mode: "lines",
          },
          // Final round item 1: the block card's own content centres on a phone (R11).
          {
            what: "block-card title",
            selector: ".lyceon-calendar .col .block .ttl",
            mode: "text",
          },
          {
            what: "block-card meta line",
            selector: ".lyceon-calendar .col .block .sub",
            mode: "text",
          },
          {
            what: "block-card scope chips",
            selector: ".lyceon-calendar .col .block .dom",
            mode: "lines",
          },
          {
            what: "block-card progress bar",
            selector: ".lyceon-calendar .col .block .progress",
            mode: "box",
          },
        ]),
      ).toEqual([]);
    }
  });
}
