/**
 * G4-07 / Part D — every guardian surface in a real browser: the 16px font floor, and the
 * screenshots the owner reviews against the mockup.
 *
 * @spec [Guardian_Closure_Plan G4-07 (R12: "no computed font below 16px"; one token set);
 *       Part D (screenshots at 1440 and 390: the active student's Dashboard, the Calendar tab,
 *       the switcher open, the Add-student modal, the lapsed student, the no-student state,
 *       the exam list and detail, Linked students & billing)] | @implemented [2026-09-30]
 *
 * plain English: drives the REAL client (Vite) with the API answered by `page.route` from the
 * shared guardian scenario (`tests/e2e/guardian-harness/fixtures.ts` — the same builders the
 * RTL tests use, each payload through its schema or the real projection). On each route it
 * reads `getComputedStyle` for every element that draws its own text and fails on any font
 * size under 16px, naming the element. jsdom cannot compute styles, which is why this is a
 * browser test.
 *
 * run: start Vite (`VITE_SUPABASE_URL=http://localhost:9 VITE_SUPABASE_ANON_KEY=x pnpm exec
 *   vite --port 5173`), then
 *   E2E_BASE_URL=http://localhost:5173 E2E_SHOT_DIR=<dir> \
 *     pnpm exec playwright test tests/e2e/guardian-surfaces.spec.ts
 * Not part of `pnpm test` (vitest): it needs a browser and a dev server. CI runs it, with
 * `student-calendar.spec.ts` and `student-mastery.spec.ts`, in the `guardian-e2e` job
 * (guardian closeout, Part B step 3).
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { offCentre, type Check } from "./guardian-harness/centring";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}

type Fixtures = {
  ADA: string;
  BO: string;
  CY: string;
  rosterWithRevoked: { students: unknown[] };
  EXAM_SESSION: string;
  roster: { students: unknown[] };
  calendarWeek: unknown;
  masteryDomains: unknown;
  examList: unknown;
  examReport: unknown;
  board: {
    calendarWeek: unknown;
    masteryDomains: unknown;
    examList: unknown;
    examReport: unknown;
  };
  billingStatus: unknown;
  billingPlans: unknown;
};

const F: Fixtures = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "tsx", "tests/e2e/guardian-harness/fixtures.ts"],
    {
      encoding: "utf8",
    },
  ),
) as Fixtures;

const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/guardian-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

async function serve(
  page: Page,
  opts: { students?: "two" | "none" | "with-revoked"; board?: boolean } = {},
): Promise<void> {
  // G5-06: the board scenario answers Ada's four Dashboard reads with the boards' values.
  const ada4 = opts.board === true ? F.board : F;
  const roster =
    opts.students === "none"
      ? { students: [] }
      : opts.students === "with-revoked"
        ? F.rosterWithRevoked
        : F.roster;
  // Only the API: Vite serves modules under paths like `/src/features/exam/api/…` too.
  const isApi = (url: URL): boolean => url.pathname.startsWith("/api/");
  await page.route(isApi, async (route: Route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/api/csrf-token") return json({ csrfToken: "t" });
    if (p === "/api/profile") {
      // The same answer the RTL harness gives: the role and the onboarding flags, and no
      // profile columns (schema-truth gate Rule B — rows come from Postgres, never literals).
      return json({
        authenticated: true,
        user: {
          id: "guardian-1",
          role: "guardian",
          profileCompletedAt: "2026-09-01T00:00:00.000Z",
          requiredProfileComplete: true,
          guardianConsentRequired: false,
        },
      });
    }
    if (p === "/api/guardian/students") return json(roster);
    if (p === "/api/billing/status") return json(F.billingStatus);
    if (p === "/api/billing/plans") return json(F.billingPlans);
    if (p === "/api/notifications/unread-count") {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    if (p === "/api/notifications") {
      return json({ data: { items: [], nextCursor: null }, requestId: "r" });
    }
    const ada = `/api/students/${F.ADA}`;
    if (p === `${ada}/calendar`) return json(ada4.calendarWeek);
    if (p === `${ada}/mastery/domains`) return json(ada4.masteryDomains);
    if (p === `${ada}/tests`) return json(ada4.examList);
    if (p === `${ada}/tests/${F.EXAM_SESSION}/report`)
      return json(ada4.examReport);
    if (p.startsWith(`/api/students/${F.CY}/`)) {
      return json({ error: "Not found", requestId: "r" }, 404);
    }
    if (p.startsWith(`/api/students/${F.BO}/`)) {
      return json(
        {
          error: "Subscription required",
          code: "PAYMENT_REQUIRED",
          requestId: "r",
        },
        402,
      );
    }
    return json({ error: "Not found", requestId: "r" }, 404);
  });
}

type Small = { tag: string; testid: string | null; text: string; px: number };

/** Every element that draws its own text at a computed size under 16px. */
async function smallText(page: Page): Promise<Small[]> {
  return page.evaluate(() => {
    const out: {
      tag: string;
      testid: string | null;
      text: string;
      px: number;
    }[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .join(" ")
        .trim();
      if (own.length === 0) continue;
      const style = getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width === 0 ||
        rect.height === 0 ||
        // Screen-reader-only text is not drawn.
        (style.position === "absolute" && rect.width <= 1 && rect.height <= 1)
      ) {
        continue;
      }
      const px = parseFloat(style.fontSize);
      if (px < 16) {
        out.push({
          tag: el.tagName.toLowerCase(),
          testid:
            el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
          text: own.slice(0, 60),
          px,
        });
      }
    }
    return out;
  });
}

type Surface = {
  name: string;
  path: (f: Fixtures) => string;
  students?: "two" | "none";
  board?: boolean;
  ready: string;
  /** Presence first: each of these must be visible before the floor scan can pass. */
  present?: readonly string[];
  act?: (page: Page) => Promise<void>;
};

/** G5-06: the Dashboard's design blocks (R13); the floor scan must see every one of them. */
const DASHBOARD_BLOCKS = [
  "score-tile-projected",
  "score-tile-target",
  "score-tile-test-date",
  "score-tile-streak",
  "week-plan",
  "mastery-card",
  "mastery-pill",
  "latest-test-card",
  "latest-test-total",
  "latest-test-section-RW",
  "latest-test-disclosure",
] as const;

const SURFACES: readonly Surface[] = [
  {
    name: "dashboard-active",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    present: [...DASHBOARD_BLOCKS, "latest-test-first"],
  },
  {
    // G5-06: the boards' own values — these screenshots sit beside the boards for review.
    name: "dashboard-board",
    path: (f) => `/guardian/${f.ADA}`,
    board: true,
    ready: "latest-test-meta",
    present: [...DASHBOARD_BLOCKS, "latest-test-change", "mastery-legend"],
  },
  {
    name: "calendar-tab",
    path: (f) => `/guardian/${f.ADA}/calendar`,
    ready: "guardian-tab-calendar",
  },
  {
    name: "switcher-open",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    act: async (page) => {
      await page.getByTestId("student-switcher").click();
      await page.getByTestId(`student-switcher-item-${F.BO}`).waitFor();
    },
  },
  {
    name: "add-student-modal",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    act: async (page) => {
      await page.getByTestId("add-student-open").click();
      await page.getByTestId("add-student-dialog").waitFor();
    },
  },
  {
    // Portaled content (Radix renders it under <body>, outside the shell) is floored too.
    name: "profile-menu-open",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    act: async (page) => {
      await page.getByTestId("button-user-menu").click();
      await page.getByTestId("menu-linked-students").waitFor();
    },
  },
  {
    name: "notifications-open",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    act: async (page) => {
      await page.getByRole("button", { name: "Notifications" }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "dashboard-lapsed",
    path: (f) => `/guardian/${f.BO}`,
    ready: "guardian-state-lapsed",
  },
  {
    name: "no-students",
    path: () => "/guardian",
    students: "none",
    ready: "guardian-no-students",
  },
  {
    name: "exam-list",
    path: (f) => `/guardian/${f.ADA}/exams`,
    ready: "guardian-exam-list",
  },
  {
    name: "exam-detail",
    path: (f) => `/guardian/${f.ADA}/exams/${f.EXAM_SESSION}`,
    ready: "exam-total-score",
  },
  {
    name: "students-billing",
    path: () => "/guardian/students",
    ready: "billing-manage",
  },
  {
    // G4-08: a guardian's /profile is a guardian page.
    name: "profile",
    path: () => "/profile",
    ready: "page-title",
  },
];

for (const vp of VIEWPORTS) {
  for (const s of SURFACES) {
    test(`${s.name} @${vp.name}: no text under 16px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await serve(page, {
        ...(s.students ? { students: s.students } : {}),
        ...(s.board ? { board: true } : {}),
      });
      await page.goto(s.path(F));
      await page.getByTestId(s.ready).first().waitFor({ timeout: 15_000 });
      await s.act?.(page);
      for (const id of s.present ?? []) {
        // The legend is the desktop board's only; the phone board draws none.
        if (id === "mastery-legend" && vp.name === "390") continue;
        await expect(
          page.locator(`[data-testid="${id}"]:visible`).first(),
          `${id} is drawn`,
        ).toBeVisible();
      }
      // Fonts and layout settle before measuring.
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SHOTS, `${s.name}-${vp.name}.png`),
        fullPage: true,
      });
      const small = await smallText(page);
      expect(small, JSON.stringify(small, null, 2)).toEqual([]);
    });
  }
}

/**
 * Owner decisions 2026-10-01 on PR 1003, items 7 and 9 — the shell header, in a real browser.
 *   7. At 390 the header shows "Lyceon" and drops "Guardian" (not the other way round).
 *   9. No background square behind the logo mark: the pixels at the mark's corners are the
 *      header's own background, not the asset's cream.
 */
test.describe("the guardian shell header", () => {
  for (const vp of VIEWPORTS) {
    test(`@${vp.name}: the wordmark, and no square behind the mark`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await serve(page);
      await page.goto(`/guardian/${F.ADA}`);
      await page
        .getByTestId("latest-test-meta")
        .first()
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(300);
      const link = page.getByTestId("logo-link");
      await expect(link.getByText("Lyceon", { exact: true })).toBeVisible();
      if (vp.name === "390") {
        await expect(link.getByText("Guardian", { exact: true })).toBeHidden();
      }
      // The mark's box, and the header around it, in device pixels.
      const mark = page.getByTestId("lyceon-logo");
      const box = await mark.boundingBox();
      expect(box).not.toBeNull();
      const shot = await page.screenshot({
        clip: {
          x: box!.x - 4,
          y: box!.y,
          width: box!.width + 8,
          height: box!.height,
        },
      });
      const pixels = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const at = (x: number, y: number) =>
          Array.from(g.getImageData(x, y, 1, 1).data);
        // Each corner of the mark against the header pixel beside it ON THE SAME ROW, 4px
        // outside the mark: the header's translucent, blurred background is not uniform top
        // to bottom, so a single reference pixel would compare unlike rows.
        const top = 1;
        const bottom = img.height - 2;
        return [
          { corner: at(5, top), beside: at(1, top) },
          { corner: at(img.width - 6, top), beside: at(img.width - 2, top) },
          { corner: at(5, bottom), beside: at(1, bottom) },
          {
            corner: at(img.width - 6, bottom),
            beside: at(img.width - 2, bottom),
          },
        ];
      }, shot.toString("base64"));
      // Within 2 of 255 per channel: a filtered layer composites with ±1 rounding, which is
      // invisible; the asset's cream square differed from the header by 5–7 per channel.
      for (const { corner, beside } of pixels) {
        const worst = Math.max(
          ...corner.map((v, i) => Math.abs(v - beside[i]!)),
        );
        expect(
          worst,
          `corner ${corner.join(",")} beside ${beside.join(",")}`,
        ).toBeLessThanOrEqual(2);
      }
    });
  }
});

/**
 * Owner decision 2026-10-01 on PR 1003, item 10 — on a phone (below 640px) the guardian pages
 * centre their headings, summary lines, control rows, the calendar's day heading and week-strip
 * labels, empty-state messages and the calendar facts footer. Multi-line paragraphs and the
 * content of block and domain cards stay left-aligned. Measured at 390 by `offCentre`
 * (`guardian-harness/centring.ts`): text lines, boxes or control rows, each within 2px.
 */
const PHONE_CENTRING: readonly {
  name: string;
  path: (f: Fixtures) => string;
  students?: "two" | "none" | "with-revoked";
  ready: string;
  act?: (page: Page) => Promise<void>;
  checks: readonly Check[];
}[] = [
  {
    name: "Dashboard",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "latest-test-meta",
    checks: [
      {
        what: "section heading",
        selector:
          "[data-testid=mastery-card] h2, [data-testid=latest-test-card] h2",
        mode: "text",
      },
      {
        what: "section name",
        selector: "[data-testid=mastery-section-label]",
        mode: "text",
      },
      {
        // Each tile in its own box: the three compact tiles share a visual line, so the
        // strip as a whole is not the unit that is centred.
        what: "score strip tile",
        selector: "[data-testid=score-strip-phone] [data-testid^=score-tile-]",
        mode: "text",
      },
      {
        what: "this week's plan",
        selector: "[data-testid=week-plan]",
        mode: "text",
      },
      // G5-06: the latest-test card, centred line by line on a phone (the boards).
      {
        what: "latest test name and date",
        selector: "[data-testid=latest-test-meta]",
        mode: "text",
        within: "parent",
      },
      {
        what: "latest test total",
        selector: "[data-testid=latest-test-total]",
        mode: "box",
      },
      {
        what: "latest test change",
        selector:
          "[data-testid=latest-test-change], [data-testid=latest-test-first]",
        mode: "box",
      },
      {
        what: "latest test section tile",
        selector: "[data-testid^=latest-test-section-]",
        mode: "text",
      },
      {
        what: "latest test disclosure",
        selector: "[data-testid=latest-test-disclosure]",
        mode: "text",
      },
      {
        what: "latest test report link",
        selector: "[data-testid=latest-test-card] a",
        mode: "box",
      },
    ],
  },
  {
    name: "Calendar",
    path: (f) => `/guardian/${f.ADA}/calendar`,
    ready: "guardian-tab-calendar",
    checks: [
      {
        what: "control row",
        selector: ".lyceon-calendar .top .slot[data-slot=C1]",
        mode: "lines",
        within: "parent",
      },
      {
        what: "streak line",
        selector: ".lyceon-calendar .top .slot[data-slot=C2]",
        mode: "text",
        within: "parent",
      },
      {
        what: "target line",
        selector: ".lyceon-calendar .top .slot[data-slot=R1]",
        mode: "text",
        within: "parent",
      },
      {
        what: "projected line",
        selector: ".lyceon-calendar .top .slot[data-slot=R2]",
        mode: "text",
        within: "parent",
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
      // Owner review 2026-10-01, final round item 1: on a phone everything inside a block
      // card centres too — title, "~N min" line, scope chips and progress bar.
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
    ],
  },
  {
    name: "Calendar, an empty day",
    path: (f) => `/guardian/${f.ADA}/calendar`,
    ready: "guardian-tab-calendar",
    act: async (page) => {
      // Sunday is the week's rest day: its column says "No study planned".
      await page.locator(".lyceon-calendar .daychip").last().click();
      await page.locator(".lyceon-calendar .col .empty").first().waitFor();
    },
    checks: [
      {
        what: "empty-day message",
        selector: ".lyceon-calendar .col .empty",
        mode: "text",
      },
    ],
  },
  {
    name: "Linked students & billing",
    path: () => "/guardian/students",
    ready: "billing-manage",
    checks: [
      {
        what: "page heading",
        selector: "[data-testid=guardian-students-page] h1",
        mode: "text",
      },
      {
        what: "section heading",
        selector: "[data-testid=guardian-students-page] h2",
        mode: "text",
      },
    ],
  },
  {
    name: "no students",
    path: () => "/guardian",
    students: "none",
    ready: "guardian-no-students",
    checks: [
      {
        what: "heading",
        selector: "[data-testid=guardian-no-students] > h1",
        mode: "text",
      },
      {
        what: "message",
        selector: "[data-testid=guardian-no-students] > p",
        mode: "text",
      },
      {
        what: "action",
        selector: "[data-testid=guardian-no-students-add]",
        mode: "box",
      },
    ],
  },
  {
    name: "lapsed",
    path: (f) => `/guardian/${f.BO}`,
    ready: "guardian-state-lapsed",
    checks: [
      {
        what: "heading",
        selector: "[data-testid=guardian-state-lapsed] > h2",
        mode: "text",
      },
      {
        what: "message",
        selector: "[data-testid=guardian-state-lapsed] > p",
        mode: "text",
      },
      {
        what: "action",
        selector: "[data-testid=guardian-state-lapsed-cta]",
        mode: "box",
      },
    ],
  },
  {
    name: "revoked",
    path: (f) => `/guardian/${f.CY}`,
    students: "with-revoked",
    ready: "guardian-state-revoked",
    checks: [
      {
        what: "heading",
        selector: "[data-testid=guardian-state-revoked] > h2",
        mode: "text",
      },
      {
        what: "message",
        selector: "[data-testid=guardian-state-revoked] > p",
        mode: "text",
      },
      {
        what: "action",
        selector: "[data-testid=guardian-state-revoked] > a",
        mode: "box",
      },
    ],
  },
];

test.describe("phone centring at 390 (item 10)", () => {
  for (const s of PHONE_CENTRING) {
    test(`${s.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await serve(page, s.students ? { students: s.students } : {});
      await page.goto(s.path(F));
      await page.getByTestId(s.ready).first().waitFor({ timeout: 15_000 });
      await s.act?.(page);
      await page.waitForTimeout(300);
      expect(await offCentre(page, s.checks)).toEqual([]);
    });
  }
});

/**
 * G5-03 (R13, Karl 2026-10-02): the guardian mastery card's meter is the design board's — a
 * 150px column between the domain name and the pill at 1440, and the row's full width beneath
 * the name and pill at 390. Measured per meter against its row, within 1px. Presence first: the
 * Dashboard draws 8 meters. (The student mastery page's own meter rule is
 * `student-mastery.spec.ts`'s; R13 leaves it unchanged.)
 */
test.describe("the guardian mastery meter follows the design", () => {
  for (const vp of VIEWPORTS) {
    test(`@${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await serve(page);
      await page.goto(`/guardian/${F.ADA}`);
      await page
        .getByTestId("mastery-card")
        .first()
        .waitFor({ timeout: 15_000 });
      const boxes = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-testid=mastery-row-meter]",
          ),
        ).map((meter) => {
          const row = meter.closest<HTMLElement>("[data-testid=mastery-row]");
          const m = meter.getBoundingClientRect();
          const r = row?.getBoundingClientRect();
          return {
            width: m.width,
            rowLeft: r === undefined ? 999 : Math.abs(m.left - r.left),
            rowRight: r === undefined ? 999 : Math.abs(r.right - m.right),
          };
        }),
      );
      expect(boxes).toHaveLength(8);
      for (const b of boxes) {
        if (vp.width >= 640) {
          expect(Math.abs(b.width - 150)).toBeLessThanOrEqual(1);
        } else {
          expect(b.rowLeft).toBeLessThanOrEqual(1);
          expect(b.rowRight).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});
