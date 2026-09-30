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
 * Not part of `pnpm test` (vitest) and not run in CI: it needs a browser and a dev server, as
 * the exam e2e specs do.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}

type Fixtures = {
  ADA: string;
  BO: string;
  EXAM_SESSION: string;
  roster: { students: unknown[] };
  calendarWeek: unknown;
  masteryDomains: unknown;
  examList: unknown;
  examReport: unknown;
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
  opts: { students?: "two" | "none" } = {},
): Promise<void> {
  const roster = opts.students === "none" ? { students: [] } : F.roster;
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
    const ada = `/api/students/${F.ADA}`;
    if (p === `${ada}/calendar`) return json(F.calendarWeek);
    if (p === `${ada}/mastery/domains`) return json(F.masteryDomains);
    if (p === `${ada}/tests`) return json(F.examList);
    if (p === `${ada}/tests/${F.EXAM_SESSION}/report`)
      return json(F.examReport);
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
  ready: string;
  act?: (page: Page) => Promise<void>;
};

const SURFACES: readonly Surface[] = [
  {
    name: "dashboard-active",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "dashboard-exam",
  },
  {
    name: "calendar-tab",
    path: (f) => `/guardian/${f.ADA}/calendar`,
    ready: "guardian-tab-calendar",
  },
  {
    name: "switcher-open",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "dashboard-exam",
    act: async (page) => {
      await page.getByTestId("student-switcher").click();
      await page.getByTestId(`student-switcher-item-${F.BO}`).waitFor();
    },
  },
  {
    name: "add-student-modal",
    path: (f) => `/guardian/${f.ADA}`,
    ready: "dashboard-exam",
    act: async (page) => {
      await page.getByTestId("add-student-open").click();
      await page.getByTestId("add-student-dialog").waitFor();
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
      await serve(page, s.students ? { students: s.students } : {});
      await page.goto(s.path(F));
      await page.getByTestId(s.ready).first().waitFor({ timeout: 15_000 });
      await s.act?.(page);
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
