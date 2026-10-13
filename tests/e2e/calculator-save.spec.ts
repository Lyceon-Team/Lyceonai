/**
 * Calculator state saves only when needed: a browser proof against the real practice runner.
 *
 * @spec [Doc-02B_v4 §14 (resumable sessions), §28 (Desmos on Math items); register G-NEW-14
 *        (production logs: `calculator-state` posts about once a second); owner brief
 *        2026-10-12 ("Calculator state saves: only when needed")] | @implemented [2026-10-12]
 *
 * plain English: the real client runs a practice session against a mocked, STATEFUL API (the
 * calculator-state POST stores the body; `/next` serves it back, exactly as the server's
 * session metadata does), with the real Desmos runtime. Every calculator-state POST is counted.
 *   1. 60 s of calculator work (short bursts with the pauses a student makes) → at most 1 save.
 *   2. Leaving the question (Submit, then Next) → exactly 1 save, and it lands before `/next`.
 *   3. The page going hidden → exactly 1 save; hidden again with nothing new → no second save.
 *   4. Typing, leaving the question, then a refresh → the expression is restored.
 * Each test prints `CALC_SAVES <test> <n>`.
 *
 * Desmos source: E2E_DESMOS_SCRIPT_FILE (a saved copy of www.desmos.com's calculator.js, served
 * by route where the browser cannot reach desmos.com), otherwise desmos.com itself.
 *
 * run: Vite up with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_DESMOS_API_KEY, then
 *   E2E_BASE_URL=http://localhost:5173 [E2E_DESMOS_SCRIPT_FILE=…] \
 *     pnpm exec playwright test tests/e2e/calculator-save.spec.ts
 * Not part of `pnpm test` (vitest): it needs the app and the Desmos runtime.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { randomUUID } from "crypto";
import {
  engineAnswerResponseSchema,
  engineNextItemResponseSchema,
  engineSessionStateResponseSchema,
  practiceSessionStateResponseSchema,
} from "../../packages/shared/src/practice-response-schema";
import {
  CONSENT_COOKIE_NAME,
  COOKIE_BANNER_VERSION,
} from "../../packages/shared/src/analytics-consent-schema";
import { serveRealDesmosFromFile } from "./desmos-stub";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(3 * 60_000);

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.use({ baseURL: BASE_URL });
const APP_ORIGIN = new URL(BASE_URL).origin;

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const BASE = `/api/practice/sessions/${SESSION}`;
const STEM = "If 2x + 3 = 11, what is the value of x?";

const profileUser = {
  id: STUDENT_ID,
  email: "student@example.test",
  display_name: "Calc Student",
  role: "student",
  is_under_13: false,
  profileCompletedAt: "2026-09-01T00:00:00.000Z",
  requiredProfileComplete: true,
  guardianConsentRequired: false,
};

/** The mocked server: what it holds, and every request in order. */
type Server = {
  calculatorState: unknown;
  ordinal: number;
  log: string[];
  saves: unknown[];
};

function itemId(ordinal: number): string {
  return `22222222-2222-4222-8222-${String(ordinal).padStart(12, "0")}`;
}

function nextItem(server: Server): unknown {
  const sessionItemId = itemId(server.ordinal);
  return engineNextItemResponseSchema.parse({
    sessionId: SESSION,
    sessionItemId,
    ordinal: server.ordinal,
    state: "active",
    calculatorState: server.calculatorState,
    question: {
      sessionItemId,
      stem: STEM,
      passage: null,
      assets: null,
      section: "M",
      questionType: "multiple_choice",
      itemType: "mcq",
      inputMode: "choice",
      options: [
        { id: "opt-a", text: "3" },
        { id: "opt-b", text: "4" },
        { id: "opt-c", text: "5" },
        { id: "opt-d", text: "7" },
      ],
      difficulty: "medium",
      correct_answer: null,
      explanation: null,
    },
    stats: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
    totalQuestions: 10,
  });
}

function sessionState(server: Server): unknown {
  return practiceSessionStateResponseSchema.parse({
    ...(engineSessionStateResponseSchema.parse({
      sessionId: SESSION,
      section: "M",
      mode: "balanced",
      state: "active",
      currentOrdinal: server.ordinal,
      answeredCount: server.ordinal - 1,
      skippedCount: 0,
      completedCount: server.ordinal - 1,
      targetQuestionCount: 10,
      calculatorState: server.calculatorState,
      lastServedUnansweredItem: null,
      clientInstanceId: null,
      readOnly: false,
      criteria: { sections: ["M"], domains: [], skills: [], difficulties: [] },
    }) as Record<string, unknown>),
    shortened: false,
  });
}

function answer(server: Server): unknown {
  return engineAnswerResponseSchema.parse({
    sessionId: SESSION,
    sessionItemId: itemId(server.ordinal),
    isCorrect: true,
    mode: "multiple_choice",
    correctOptionId: "opt-b",
    explanation: "2x = 8, so x = 4.",
    feedback: "Correct",
    stats: { correct: 1, incorrect: 0, skipped: 0, total: 1, streak: 1 },
    state: "active",
  });
}

async function startServer(page: Page): Promise<Server> {
  const server: Server = {
    calculatorState: null,
    ordinal: 1,
    log: [],
    saves: [],
  };
  await page.context().addCookies([
    {
      name: CONSENT_COOKIE_NAME,
      value: `${COOKIE_BANNER_VERSION}.${randomUUID()}.r.${Math.floor(Date.now() / 1000)}`,
      url: BASE_URL,
    },
  ]);
  await serveRealDesmosFromFile(page.context());
  await page.route(
    (url: URL) => url.origin === APP_ORIGIN && url.pathname.startsWith("/api/"),
    async (route: Route) => {
      const request = route.request();
      const p = new URL(request.url()).pathname;
      const method = request.method();
      server.log.push(`${method} ${p}`);
      const reply = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (p === "/api/csrf-token") return reply({ csrfToken: "t" });
      if (p === "/api/profile")
        return reply({ authenticated: true, user: profileUser });
      if (p === "/api/notifications/unread-count")
        return reply({ data: { unread: 0 }, requestId: "r" });
      if (p === `${BASE}/state`) return reply(sessionState(server));
      if (p === `${BASE}/next`) return reply(nextItem(server));
      if (method === "POST" && p === `${BASE}/calculator-state`) {
        const body = JSON.parse(request.postData() ?? "{}") as {
          calculator_state?: unknown;
        };
        server.saves.push(body.calculator_state ?? null);
        server.calculatorState = body.calculator_state ?? null;
        return reply({
          sessionId: SESSION,
          calculatorState: server.calculatorState,
        });
      }
      if (method === "POST" && p === "/api/practice/answer") {
        const body = answer(server);
        server.ordinal += 1;
        return reply(body);
      }
      return reply({ error: "Not found", requestId: "r" }, 404);
    },
  );
  return server;
}

async function openCalculator(page: Page): Promise<void> {
  await page.goto(`/practice/session/${SESSION}`);
  await expect(page.getByText(STEM)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("practice-calculator-toggle").click();
  await expect(
    page.locator('[data-testid="desmos-calculator"] .dcg-container').first(),
  ).toBeVisible({ timeout: 30_000 });
}

const field = (page: Page) =>
  page
    .locator('[data-testid="desmos-calculator"] .dcg-mq-editable-field')
    .locator("visible=true")
    .first();

async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function leaveQuestion(page: Page): Promise<void> {
  await page.getByRole("radio").nth(1).click();
  await page.getByTestId("runner-submit").click();
  await page.getByTestId("runner-next").click();
  await expect(page.getByTestId("runner-submit")).toBeVisible();
}

function report(name: string, server: Server): void {
  process.stdout.write(`CALC_SAVES ${name} ${server.saves.length}\n`);
}

test("60 s of calculator work makes at most 1 save", async ({ page }) => {
  const server = await startServer(page);
  await openCalculator(page);
  await field(page).click();
  const started = Date.now();
  let presses = 0;
  // A student working: a short burst, then a pause to read or think, for a full minute.
  while (Date.now() - started < 60_000) {
    await page.keyboard.type(`${(presses % 9) + 1}+`, { delay: 40 });
    presses += 1;
    await page.waitForTimeout(700);
  }
  report(`60s-typing(${presses}-bursts)`, server);
  expect(server.saves.length).toBeLessThanOrEqual(1);
});

test("leaving the question saves once, before the next item is read", async ({
  page,
}) => {
  const server = await startServer(page);
  await openCalculator(page);
  await field(page).click();
  await page.keyboard.type("12+30", { delay: 40 });
  await page.waitForTimeout(2_000);
  expect(server.saves.length, "no save while working").toBe(0);
  const mark = server.log.length;
  await leaveQuestion(page);
  report("leave-question", server);
  expect(server.saves.length).toBe(1);
  const after = server.log.slice(mark);
  const saveAt = after.indexOf(`POST ${BASE}/calculator-state`);
  const nextAt = after.indexOf(`GET ${BASE}/next`);
  expect(saveAt).toBeGreaterThanOrEqual(0);
  expect(saveAt).toBeLessThan(nextAt);
});

test("the page going hidden saves once, and only once", async ({ page }) => {
  const server = await startServer(page);
  await openCalculator(page);
  await field(page).click();
  await page.keyboard.type("6+7", { delay: 40 });
  await page.waitForTimeout(2_000);
  expect(server.saves.length, "no save while working").toBe(0);
  await hidePage(page);
  await expect.poll(() => server.saves.length).toBe(1);
  await hidePage(page);
  await page.waitForTimeout(1_000);
  report("page-hidden", server);
  expect(server.saves.length).toBe(1);
});

test("typing, leaving the question, then a refresh restores the expression", async ({
  page,
}) => {
  const server = await startServer(page);
  await openCalculator(page);
  await field(page).click();
  await page.keyboard.type("77+5", { delay: 40 });
  await leaveQuestion(page);
  await page.reload();
  await expect(page.getByText(STEM)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("practice-calculator-toggle").click();
  await expect(field(page)).toContainText("77+5", { timeout: 30_000 });
  report("refresh-restore", server);
});
