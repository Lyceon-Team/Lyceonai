/**
 * The homepage's "See how it works" product screenshots, captured from the real built app.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner ruling 2026-10-05: real product
 *       screenshots from fixtures until the walkthrough video exists] | @implemented [2026-10-05]
 *
 * plain English: drives the REAL production bundle (served with vercel.json's headers by
 * `scripts/ops/page-csp-static-server.mjs`) in Chromium, light theme, and answers every
 * same-origin `/api/` request in the browser with TEST FIXTURES — never the question bank,
 * never production data. It writes three 1280x720 (16:9) JPEGs, each surface whole and
 * unscrolled (see VIEWPORT):
 *   - product-practice.jpg — a practice session showing one question, pre-submit;
 *   - product-review.jpg   — the same question after submit: the correct answer and its
 *                            worked explanation (a fixture item, so revealing it leaks nothing);
 *   - product-parent.jpg   — the guardian Dashboard's read-only progress view: this
 *                            week's plan and mastery by domain (eight five-segment meters).
 *                            Score figures (the score strip and the latest-test card) are
 *                            hidden pending Karl's approval (Doctrine rule 5).
 *
 * Fixtures, one source of truth each:
 *   - practice / review: the practice engine's own response schemas
 *     (`packages/shared/src/practice-response-schema.ts`) parse every payload before it is
 *     served, so a wrong shape fails here, loudly, instead of rendering an error state. The
 *     pre-submit item is held to `correct_answer: null, explanation: null` by that schema
 *     (anti-leak). The question is an original, generic SAT-style linear-equations item
 *     written for this script; it is not taken from any seed or bank item. The handler shapes
 *     mirror `tests/e2e/page-csp-flows.spec.ts` (practice-desmos flow).
 *   - parent: the guardian harness's scenario (`client/src/features/guardian/test-harness.tsx`
 *     `boardScenario`, `roster`, `ADA`) and the pinned e2e "today"
 *     (`tests/e2e/guardian-harness/today.ts`), the same builders the RTL tests and
 *     `tests/e2e/guardian-surfaces.spec.ts` serve. Only the roster's display name differs
 *     ("Alex"), built through the same `roster()` contract parse.
 *
 * Edge cases / trade-offs: an `/api/` request no fixture answers gets a 404 and is printed as
 * `UNMOCKED <shot> <method> <path>`; the run fails if any shot saw one, so a new read on a
 * surface cannot silently put an error state into a marketing image. A refused-analytics
 * consent cookie is set before load so no consent UI can appear. The student's only personal
 * data is the fixture first name "Alex" (email `alex@example.test`, never drawn on these
 * surfaces). Deterministic: fixed fixtures, fixed browser clock, fixed viewport.
 *
 * usage (from the repo root):
 *   VITE_SUPABASE_URL=http://localhost:9 VITE_SUPABASE_ANON_KEY=ci pnpm run build
 *   node scripts/ops/page-csp-static-server.mjs 5176 &      # must be running; not started here
 *   pnpm exec tsx scripts/marketing/capture-product-shots.mjs
 * env: E2E_BASE_URL (default http://127.0.0.1:5176), E2E_CHROMIUM (Chromium executable; default
 *   Playwright's own). tsx is required: the fixtures import TypeScript and the path aliases.
 */
/* global window, document, HTMLElement -- page.evaluate callbacks run in the browser */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  engineAnswerResponseSchema,
  engineNextItemResponseSchema,
  practiceSessionStateResponseSchema,
} from "../../packages/shared/src/practice-response-schema";
import {
  ADA,
  boardScenario,
  billingStatus,
  roster,
} from "../../client/src/features/guardian/test-harness";
import { E2E_TODAY } from "../../tests/e2e/guardian-harness/today";
import { COOKIE_BANNER_VERSION } from "../../packages/shared/src/analytics-consent-schema";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT_DIR = path.join(ROOT, "client/public/images/home");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5176";
const APP_ORIGIN = new URL(BASE_URL).origin;
// A 1600x900 CSS viewport rendered at 0.8 device pixels per CSS pixel: a 1280x720 (16:9) image
// that holds each surface whole without scrolling. Scrolled, the app's frosted sticky header
// draws blurred page content behind it (the review's choice A, the Dashboard's top tiles).
const VIEWPORT = { width: 1600, height: 900 };
const DEVICE_SCALE = 0.8;
const JPEG_QUALITY = 80;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_NAME = "Alex";
const PRACTICE_SESSION = "22222222-2222-4222-8222-222222222222";
const PRACTICE_ITEM = "22222222-2222-4222-8222-2222222222a1";

// An original, generic item (not from any seed or bank): one linear equation in context.
// Currency is written `\\$` and math `$…$`, the MathRenderer's delimiters, as bank items are.
const STEM =
  "A bike rental shop charges a flat fee of \\$6 plus \\$1.50 for each hour a bike is rented. " +
  "If a customer paid \\$18 in total, for how many hours was the bike rented?";
/** Plain text the rendered stem contains (the waits match on it). */
const STEM_TEXT = "for how many hours was the bike rented?";
const OPTIONS = [
  { id: "opt-a", text: "6" },
  { id: "opt-b", text: "8" },
  { id: "opt-c", text: "10" },
  { id: "opt-d", text: "12" },
];
const CORRECT_OPTION = "opt-b";
const EXPLANATION =
  "Let $h$ be the number of hours. The total cost is $6 + 1.5h$, so $6 + 1.5h = 18$. " +
  "Subtract 6 from both sides: $1.5h = 12$. Divide both sides by 1.5: $h = 8$. " +
  "Check: $6 + 1.5(8) = 6 + 12 = 18$.";
/** Plain text the rendered explanation contains. */
const EXPLANATION_TEXT = "Subtract 6 from both sides";

const STUDENT_PROFILE = {
  id: STUDENT_ID,
  email: "alex@example.test",
  display_name: STUDENT_NAME,
  role: "student",
  is_under_13: false,
  profileCompletedAt: "2026-09-01T00:00:00.000Z",
  requiredProfileComplete: true,
  guardianConsentRequired: false,
};

const GUARDIAN_PROFILE = {
  id: "guardian-1",
  role: "guardian",
  profileCompletedAt: "2026-09-01T00:00:00.000Z",
  requiredProfileComplete: true,
  guardianConsentRequired: false,
};

const stats = (correct, streak) => ({
  correct,
  incorrect: 1,
  skipped: 0,
  total: correct + 1,
  streak,
});

/** Question 5 of 10, pre-submit: the schema pins correct_answer / explanation to null. */
const nextItem = engineNextItemResponseSchema.parse({
  sessionId: PRACTICE_SESSION,
  sessionItemId: PRACTICE_ITEM,
  ordinal: 5,
  state: "active",
  calculatorState: null,
  question: {
    sessionItemId: PRACTICE_ITEM,
    stem: STEM,
    passage: null,
    assets: null,
    section: "M",
    questionType: "multiple_choice",
    itemType: "mcq",
    inputMode: "choice",
    options: OPTIONS,
    difficulty: "medium",
    correct_answer: null,
    explanation: null,
  },
  stats: stats(3, 2),
  totalQuestions: 10,
});

const sessionState = practiceSessionStateResponseSchema.parse({
  shortened: false,
  sessionId: PRACTICE_SESSION,
  section: "M",
  mode: "balanced",
  criteria: { sections: ["M"], domains: [], skills: [], difficulties: [] },
  state: "active",
  currentOrdinal: 5,
  answeredCount: 4,
  skippedCount: 0,
  completedCount: 4,
  targetQuestionCount: 10,
  calculatorState: null,
  lastServedUnansweredItem: null,
  clientInstanceId: null,
  readOnly: false,
});

/** Post-submit: correctness and the worked explanation (practice reveals after submit). */
const answer = engineAnswerResponseSchema.parse({
  sessionId: PRACTICE_SESSION,
  sessionItemId: PRACTICE_ITEM,
  isCorrect: true,
  mode: "multiple_choice",
  correctOptionId: CORRECT_OPTION,
  explanation: EXPLANATION,
  feedback: "Correct",
  stats: stats(4, 3),
  state: "active",
});

// The guardian harness's board scenario on the pinned e2e day; the roster through its contract.
const board = boardScenario(E2E_TODAY);
const guardianRoster = roster([{ id: ADA, name: STUDENT_NAME }]);
const guardianBilling = billingStatus();

// ── Harness ──────────────────────────────────────────────────────────────────

/** Shell reads every signed-in page makes. */
function shell(profile) {
  return ({ path: p }) => {
    if (p === "/api/csrf-token") return { body: { csrfToken: "t" } };
    if (p === "/api/profile")
      return { body: { authenticated: true, user: profile } };
    if (p === "/api/notifications/unread-count")
      return { body: { data: { unread: 0 }, requestId: "r" } };
    if (p === "/api/notifications")
      return {
        body: { data: { items: [], nextCursor: null }, requestId: "r" },
      };
    return undefined;
  };
}

const practiceReads = ({ method, path: p }) => {
  const base = `/api/practice/sessions/${PRACTICE_SESSION}`;
  if (p === `${base}/state`) return { body: sessionState };
  if (p === `${base}/next`) return { body: nextItem };
  if (method === "POST" && p === `${base}/calculator-state`)
    return { body: { ok: true } };
  if (method === "POST" && p === "/api/practice/answer")
    return { body: answer };
  return undefined;
};

const guardianReads = ({ path: p }) => {
  if (p === "/api/guardian/students") return { body: guardianRoster };
  if (p === "/api/billing/status") return { body: guardianBilling };
  const ada = `/api/students/${ADA}`;
  if (p === `${ada}/calendar`) return { body: board.calendarWeek };
  if (p === `${ada}/mastery/domains`) return { body: board.masteryDomains };
  if (p === `${ada}/tests`) return { body: board.examList };
  const report = /^\/api\/students\/[^/]+\/tests\/([^/]+)\/report$/.exec(p);
  if (p.startsWith(`${ada}/`) && report !== null) {
    const body = board.examReports[report[1]];
    if (body !== undefined) return { body };
  }
  return undefined;
};

async function newPage(browser, shot, handlers, unmocked) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  // Analytics consent already refused, so no consent UI is ever drawn.
  await context.addCookies([
    {
      name: "lyceon_consent",
      // Dated at the pinned browser clock: a choice dated after "now" does not count
      // (consentIsCurrent), and the banner would be drawn into the picture.
      value: `${COOKIE_BANNER_VERSION}.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.r.${Math.floor(Date.parse(`${E2E_TODAY}T12:00:00Z`) / 1000)}`,
      url: APP_ORIGIN,
    },
  ]);
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lyceon-theme", "light");
    } catch (err) {
      // Storage blocked: the app falls back to the colour scheme, which is light here too.
      console.warn(
        "theme pin skipped",
        err instanceof Error ? err.message : "storage",
      );
    }
  });
  // The guardian fixtures' week is cut on E2E_TODAY; the page's "today" must be the same day.
  await page.clock.setFixedTime(new Date(`${E2E_TODAY}T12:00:00Z`));
  await page.route(
    (url) => url.origin === APP_ORIGIN && url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const req = { method: request.method(), path: url.pathname };
      for (const handle of handlers) {
        const reply = handle(req);
        if (reply !== undefined) {
          return route.fulfill({
            status: reply.status ?? 200,
            contentType: "application/json",
            body: JSON.stringify(reply.body),
          });
        }
      }
      const line = `UNMOCKED ${shot} ${req.method} ${req.path}`;
      unmocked.push(line);
      process.stdout.write(`${line}\n`);
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Not found", requestId: "r" }),
      });
    },
  );
  return { context, page };
}

async function save(page, name) {
  // Fonts and layout settle; the caret and focus rings are not part of the picture.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await page.waitForTimeout(400);
  const file = path.join(OUT_DIR, `product-${name}.jpg`);
  await page.screenshot({
    path: file,
    type: "jpeg",
    quality: JPEG_QUALITY,
    caret: "hide",
  });
  process.stdout.write(
    `WROTE ${path.relative(ROOT, file)} ${fs.statSync(file).size} bytes\n`,
  );
}

// ── Shots ────────────────────────────────────────────────────────────────────

async function practiceAndReview(browser, unmocked) {
  const { context, page } = await newPage(
    browser,
    "practice",
    [shell(STUDENT_PROFILE), practiceReads],
    unmocked,
  );
  await page.goto(`${BASE_URL}/practice/session/${PRACTICE_SESSION}`);
  await page.getByText(STEM_TEXT).waitFor({ timeout: 20_000 });
  // The student has picked B and not yet checked it: still pre-submit.
  await page.getByText(OPTIONS[1].text, { exact: true }).first().click();
  await save(page, "practice");

  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByText(EXPLANATION_TEXT).first().waitFor({ timeout: 20_000 });
  await save(page, "review");
  await context.close();
}

async function parent(browser, unmocked) {
  const { context, page } = await newPage(
    browser,
    "parent",
    [shell(GUARDIAN_PROFILE), guardianReads],
    unmocked,
  );
  await page.goto(`${BASE_URL}/guardian/${ADA}`);
  await page
    .getByTestId("latest-test-meta")
    .first()
    .waitFor({ timeout: 20_000 });
  await page.getByTestId("mastery-card").first().waitFor({ timeout: 20_000 });
  // Score figures are left out of the public image: the score strip (projected score band,
  // target) and the latest full-length test card (a score and its change). A score shown on the
  // homepage would read as a Lyceon-specific performance claim (Public Disclosure Doctrine rule
  // 5) and needs Karl's written approval first. The rest of the dashboard is drawn as the app
  // draws it: this week's plan and mastery by domain.
  await page.addStyleTag({
    content:
      '[data-testid="score-strip"],[data-testid="score-strip-phone"],[data-testid="latest-test-card"]{display:none!important}',
  });
  await save(page, "parent");
  await context.close();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.E2E_CHROMIUM
      ? { executablePath: process.env.E2E_CHROMIUM }
      : {}),
    args: ["--no-proxy-server"],
  });
  const unmocked = [];
  try {
    await practiceAndReview(browser, unmocked);
    await parent(browser, unmocked);
  } finally {
    await browser.close();
  }
  if (unmocked.length > 0) {
    throw new Error(
      `unmocked API reads (fixture missing):\n${unmocked.join("\n")}`,
    );
  }
}

await main();
