/**
 * Smart landing in a real browser: an app open lands in the real session page and reaches
 * question 1, for `set_math_5` and for "5 more?" after today's question.
 *
 * @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26) item 4:
 *        "an end-to-end test that opens the set_math_5 session and the 5 more session in the real
 *        session page and reaches question 1, plus a planted defect that breaks it. That's the gap
 *        that let today's bug through"] | @implemented [2026-10-26]
 *
 * plain English: drives the REAL client (a production build under `vite preview`) against the
 * student harness (tests/e2e/student-harness: the real routers, `/api/landing` included, over a
 * throwaway database built from the migrations) started with the `smart-landing` seed: the kill
 * switch on, today's question scheduled, and this window's arm pinned per persona (`managed` →
 * `set_math_5`, `paid` → `qotd_then_more`; db.ts `seedSmartLanding`).
 *   L1 `managed` opens the app at Home. The landing sends the browser to a landing-opened runner
 *      (`/practice/session/<id>?from=landing`), and the page reaches "Question 1 of 5" with its
 *      choices on screen, never "Unknown Section" or another error card.
 *   L2 `paid` opens the app at Home and lands on `/qotd`. Answering today's question shows
 *      "5 more?"; "Start 5 more" opens the runner, which reaches "Question 1 of 5" the same way.
 * Today's bug lived between two halves that each passed their own tests: the server built a
 * two-section set, and the session page refuses a practice session without one section. Only the
 * real page, opened on the real session, sees both; so this spec asserts on the page, not on the
 * API.
 *
 * run: bash tests/e2e/run-student-harness-e2e.sh smart-landing tests/e2e/smart-landing.spec.ts
 * (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers where Chromium is pre-installed). Not part of
 * `pnpm test` (vitest). CI runs it in ci-full's `smart-landing-browser` job; the planted defect
 * is scripts/ci/smart-landing-e2e.mutations.sh.
 */
import { expect, test, type Page } from "@playwright/test";
import { answerCookieBanner } from "./exam-harness/consent";
import {
  PERSONA_HEADER,
  type StudentPersona,
} from "./student-harness/personas";
import { SEED_CLIENT_INSTANCE } from "./student-harness/seed";

if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
// Not serial: each case is a different student, and the planted defect must break each one on its
// own (serial mode would skip L2 after L1 failed, hiding whether L2 catches it).
test.setTimeout(120_000);

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5184";
const LANDING_RUNNER = /\/practice\/session\/[0-9a-f-]{36}\?from=landing$/;

async function asPersona(page: Page, persona: StudentPersona): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [PERSONA_HEADER]: persona });
  await answerCookieBanner(page.context(), BASE);
  await page.addInitScript((instance: string) => {
    window.localStorage.setItem("lyceon_client_instance_id", instance);
    window.localStorage.setItem("lyceon-theme", "light");
  }, SEED_CLIENT_INSTANCE);
  await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * The runner reached question 1: the position reads it and the question is answerable. Submit is
 * the check, not a choice: Math draws grid-ins as well as multiple choice, and a grid-in has an
 * answer box instead of choices.
 */
async function expectQuestionOne(page: Page): Promise<void> {
  await expect(page).toHaveURL(LANDING_RUNNER);
  const position = page.locator('[data-testid="runner-position"]');
  await expect(position).toHaveText("Question 1 of 5", { timeout: 30_000 });
  await expect(page.locator('[data-testid="runner-submit"]')).toBeVisible();
  await expect(page.getByText("Unknown Section")).toHaveCount(0);
  await expect(page.getByText("Session Error")).toHaveCount(0);
  // A landing-opened runner's back link reads "Home" (FocusShell).
  await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();
}

test("L1 set_math_5: an app open lands on a 5-question Math set at question 1", async ({
  page,
}) => {
  await asPersona(page, "managed");
  const open = page.waitForResponse(
    (r) => r.url().endsWith("/api/landing/open") && r.status() === 200,
  );
  await page.goto(`${BASE}/dashboard`);
  // Presence first: the landing answered with the pinned arm and a runner path.
  const body = (await (await open).json()) as {
    data?: { arm?: unknown; path?: unknown };
  };
  expect(body.data?.arm).toBe("set_math_5");
  expect(String(body.data?.path)).toMatch(LANDING_RUNNER);
  await expectQuestionOne(page);
});

test("L2 qotd_then_more: an app open lands on today's question; 5 more reaches question 1", async ({
  page,
}) => {
  await asPersona(page, "paid");
  await page.goto(`${BASE}/dashboard`);
  await expect(page).toHaveURL(/\/qotd\?from=landing$/, { timeout: 30_000 });
  const card = page.locator('[data-testid="home-qotd"]');
  await expect(card).toHaveAttribute("data-state", "unanswered", {
    timeout: 30_000,
  });
  await card.locator('[data-testid="runner-choice"]').first().click();
  await page.locator('[data-testid="home-qotd-submit"]').click();
  const start = page.locator('[data-testid="qotd-more-start"]');
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expectQuestionOne(page);
});
