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
 * week strip, the block card) and measure the new header's two rows in place of the retired
 * slots. The desktop byte comparison applies from this redesign on.
 *
 * SCL-211 (2026-10-05, OQ-56): the student calendar draws no facts strip, so the "facts footer"
 * check is gone with it (the guardian spec keeps its own); the page is asserted to have none.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
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
) as { studentCalendar: unknown; studentCalendarStarted: unknown };

const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/student-calendar");
fs.mkdirSync(SHOTS, { recursive: true });

/** The signed-in student and a real week (`F.studentCalendar` by default); every other API call 404s. */
async function serveStudentCalendar(
  page: Page,
  week: unknown = F.studentCalendar,
): Promise<void> {
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
      if (p === "/api/calendar") return json(week);
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
}

for (const vp of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  test(`student calendar @${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await serveStudentCalendar(page);
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
    // SCL-211: no facts strip and no streak line on the student calendar.
    expect(await page.locator('[data-testid="calendar-facts"]').count()).toBe(
      0,
    );
    expect(await page.locator('[data-item="streak"]').count()).toBe(0);
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

/**
 * Production QA 2026-10-07, item 11 — the layout the walkthrough found broken, measured in the
 * browser at every width class: phone (390), the old wrap point (700), tablet with seven
 * columns (768, 820), desktop with the 340px panel (1024, 1280) and the signed-off 1440.
 *
 * @spec [production QA 2026-10-07 items 11(c), 11(d), 11(g); DESIGN.md §4 Calendar]
 *       | @implemented [2026-10-07]
 *
 * (c) Nothing inside a block card or a month chip runs past the card's edge — the title, the
 *     "🔒 started" tag (the fixture's past days hold a partly done block) and the scope chips.
 * (d) The header's two control groups never break inside themselves, and the header takes one
 *     row from 920px of calendar column, two from 700px, three below — never the broken
 *     three-column row it drew at 1024–1279.
 * (g) The goal card's projected range is on one line and inside its half of the card.
 * The page never scrolls sideways.
 */
const QA_WIDTHS = [
  { width: 390, headerRows: 3 },
  { width: 700, headerRows: 2 },
  { width: 768, headerRows: 2 },
  { width: 820, headerRows: 2 },
  { width: 1024, headerRows: 3 },
  { width: 1280, headerRows: 2 },
  { width: 1440, headerRows: 1 },
] as const;

/**
 * Everything inside a card that pokes out of it by more than half a pixel: every element's box,
 * and every line of TEXT — measured as laid out (`Range.getClientRects`), against the card and
 * against the element holding it (a chip whose words spill past the chip's own background is
 * as broken as one past the card). Text inside an element that clips (`overflow: hidden`, the
 * truncated "started" tag and the month chip's label) is cut on purpose and is judged by that
 * element's box instead.
 */
async function overflowingCardContent(
  page: Page,
  cardSelector: string,
): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = [];
    const outside = (r: DOMRect, box: DOMRect): boolean =>
      r.right > box.right + 0.5 || r.left < box.left - 0.5;
    for (const card of Array.from(document.querySelectorAll(selector))) {
      const box = card.getBoundingClientRect();
      if (box.width === 0) continue;
      for (const el of Array.from(card.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && outside(r, box)) {
          out.push(
            `box "${(el.textContent ?? "").trim().slice(0, 24)}" (${Math.round(r.right - box.right)}px)`,
          );
        }
      }
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        const holder = node.parentElement;
        if (holder === null || (node.textContent ?? "").trim() === "") continue;
        if (getComputedStyle(holder).overflowX !== "visible") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const held = holder.getBoundingClientRect();
        for (const line of Array.from(range.getClientRects())) {
          if (line.width > 0 && (outside(line, box) || outside(line, held))) {
            out.push(
              `text "${(node.textContent ?? "").trim().slice(0, 24)}" (${Math.round(line.right - held.right)}px)`,
            );
            break;
          }
        }
      }
    }
    return out;
  }, cardSelector);
}

for (const vp of QA_WIDTHS) {
  test(`QA 2026-10-07 item 11 layout @${vp.width}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: 900 });
    // The week with a started block (Wednesday's Geometry, partly done), for the tag.
    await serveStudentCalendar(page, F.studentCalendarStarted);
    await pinBrowserToday(page);
    await page.goto("/calendar");
    await page
      .locator('[data-testid="calendar-week-grid"]')
      .first()
      .waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);

    // (c) Presence first: cards, chips and (with seven columns) a started tag are drawn.
    const blocks = page.locator(".lyceon-calendar .block");
    expect(await blocks.count()).toBeGreaterThan(0);
    expect(
      await page.locator(".lyceon-calendar .block .dom span").count(),
    ).toBeGreaterThan(0);
    if (vp.width >= 768) {
      expect(
        await page.locator(".lyceon-calendar .block .lock").count(),
      ).toBeGreaterThan(0);
    }
    expect(
      await overflowingCardContent(page, ".lyceon-calendar .block"),
    ).toEqual([]);

    // (d) The header: each control group on one line, and the expected number of rows.
    const header = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="calendar-header"]');
      if (h === null) return null;
      const box = h.getBoundingClientRect();
      /** Rows of boxes: a new row wherever a centre sits more than 12px below the last row's. */
      const rowCount = (els: Element[]): number => {
        const centres = els
          .map((c) => {
            const r = c.getBoundingClientRect();
            return r.top + r.height / 2;
          })
          .sort((a, b) => a - b);
        let rows = 0;
        let last = Number.NEGATIVE_INFINITY;
        for (const y of centres) {
          if (y - last > 12) {
            rows += 1;
            last = y;
          }
        }
        return rows;
      };
      const kids = Array.from(h.children).filter(
        (c) => c.getBoundingClientRect().height > 0,
      );
      const rows = rowCount(kids);
      const groups = ["calendar-header-nav"]
        .map((id) => document.querySelector(`[data-testid="${id}"]`))
        .concat(
          Array.from(
            h.querySelectorAll('[data-testid="topbar-edit-schedule"]'),
          ).map((b) => b.parentElement),
        )
        .filter((g): g is Element => g !== null)
        .map((g) => {
          const r = g.getBoundingClientRect();
          return {
            lines: rowCount(Array.from(g.children)),
            inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
          };
        });
      return { rows, groups };
    });
    expect(header).not.toBeNull();
    expect(header?.groups).toHaveLength(2);
    expect(header?.groups).toEqual([
      { lines: 1, inside: true },
      { lines: 1, inside: true },
    ]);
    expect(header?.rows).toBe(vp.headerRows);

    // (g) The projected range: one line, inside its half of the goal card.
    const figure = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-projection"]');
      if (el === null || el.parentElement === null) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set(
        Array.from(range.getClientRects()).map((r) => Math.round(r.top)),
      ).size;
      // The TEXT, as laid out: the figure is a stretched flex item, so its own box is always
      // the cell's width whatever its text does.
      const r = range.getBoundingClientRect();
      const cell = el.parentElement.getBoundingClientRect();
      return {
        text: el.textContent,
        lines,
        inside: r.left >= cell.left - 0.5 && r.right <= cell.right + 0.5,
      };
    });
    expect(figure?.text).toMatch(/^\d{3,4}–\d{3,4}$/);
    expect(figure?.lines).toBe(1);
    expect(figure?.inside).toBe(true);

    // (c) The month chips too.
    await page.locator('[data-testid="calendar-view-month"]').click();
    await page
      .locator('[data-testid="calendar-month-grid"]')
      .waitFor({ timeout: 15_000 });
    expect(
      await page.locator(".lyceon-calendar .mchip").count(),
    ).toBeGreaterThan(0);
    expect(
      await overflowingCardContent(page, ".lyceon-calendar .mchip"),
    ).toEqual([]);

    // No sideways scroll on the page.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
