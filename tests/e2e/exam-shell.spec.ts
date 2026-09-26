/**
 * E7b — a full exam in a browser, both timing modes, both Module 2 paths.
 *
 * @spec [Doc-04A_V2.2 §7.3-§12, §15.1; Doc-04C_V1.0 §8-§11, §15.1; SCL-132..SCL-147]
 *       [E7b evidence: start -> M1 -> navigator -> review page -> submit -> break ->
 *        M2 -> submit -> score, screenshots of each screen, the resume case shown]
 * @implemented [2026-09-25]
 *
 * plain English: drives the REAL client (Vite) against the REAL exam routers and SQL
 * (tests/e2e/exam-harness). The walk reads each served option's canonical letter
 * from the database ONLY to decide which option to click, so one sitting routes
 * Reading and Writing to the harder Module 2 and Math to the easier one, and the
 * other sitting the reverse. Every /api/tests response is scanned for answer
 * fields during the walk.
 *
 * run: start the harness + Vite (see tests/e2e/exam-harness/server.ts), then
 *   E2E_BASE_URL=http://localhost:5173 E2E_SHOT_DIR=<dir> PGPORT=54331 \
 *     pnpm exec playwright test tests/e2e/exam-shell.spec.ts
 * Not part of `pnpm test` (vitest) and not run in CI: it needs the local stack.
 */
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import fs from "fs";
import path from "path";

test.describe.configure({ mode: "serial" });
// A container whose Playwright browser build differs from the pinned one names its own.
if (process.env.E2E_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
test.setTimeout(15 * 60_000);

const SHOTS = process.env.E2E_SHOT_DIR ?? path.resolve("test-results/exam-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pg: Client;
test.beforeAll(async () => {
  pg = new Client({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? "54331"),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database: "exam_e2e_harness",
  });
  await pg.connect();
});
test.afterAll(async () => {
  await pg.end();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

/** Anti-leak watch: any non-null answer field in any /api/tests response. */
function watchForLeaks(page: Page): string[] {
  const leaks: string[] = [];
  const scan = (value: unknown, where: string): void => {
    if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${where}[${i}]`));
    else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (["correct_answer", "explanation", "correct_variants", "module2_path", "difficulty"].includes(k) && v !== null) {
          leaks.push(`${where}.${k}`);
        }
        scan(v, `${where}.${k}`);
      }
    }
  };
  page.on("response", async (res) => {
    if (!res.url().includes("/api/tests/")) return;
    const type = res.headers()["content-type"] ?? "";
    if (!type.includes("json")) return;
    try {
      scan(await res.json(), new URL(res.url()).pathname);
    } catch {
      // A body that is not JSON carries no fields to leak.
    }
  });
  return leaks;
}

function sessionIdOf(page: Page): string {
  const m = /\/tests\/([0-9a-f-]{36})/.exec(page.url());
  if (!m) throw new Error(`no session id in ${page.url()}`);
  return m[1]!;
}

async function position(page: Page): Promise<{ number: number; total: number }> {
  const text = (await page.getByTestId("exam-navigator-open").textContent()) ?? "";
  const m = /Question (\d+) of (\d+)/.exec(text);
  if (!m) throw new Error(`not on a question: ${text}`);
  return { number: Number(m[1]), total: Number(m[2]) };
}

async function tokenFor(sid: string, section: string, module: string, ordinal: number, letter: string): Promise<string> {
  const r = await pg.query(
    `SELECT option_token_map FROM public.test_session_items
      WHERE test_session_id = $1 AND section = $2 AND ordinal = $3
        AND (module = $4 OR ($4 = '2' AND module IN ('2A', '2B')))`,
    [sid, section, ordinal, module],
  );
  const map = r.rows[0]?.option_token_map as Record<string, string> | undefined;
  const hit = map && Object.entries(map).find(([, key]) => key === letter);
  if (!hit) throw new Error(`no token for ${letter} at ${section}/${module}/${ordinal}`);
  return hit[0];
}

/** Answers the question on screen: correct (A / '1') or wrong (B / '2'). */
async function answerCurrent(page: Page, correct: boolean): Promise<void> {
  const sid = sessionIdOf(page);
  const [, , , section, module] = new URL(page.url()).pathname.split("/");
  const { number } = await position(page);
  const choices = page.getByTestId("exam-choice");
  if ((await choices.count()) === 0) {
    await page.getByLabel("Enter your answer").fill(correct ? "1" : "2");
    await page.getByLabel("Enter your answer").blur();
    return;
  }
  const token = await tokenFor(sid, section!, module!, number - 1, correct ? "A" : "B");
  await page.locator(`[data-choice-token="${token}"]`).click();
  await expect(page.locator(`[data-choice-token="${token}"]`)).toHaveAttribute("aria-pressed", "true");
}

async function answerModule(page: Page, correct: boolean, skip: ReadonlySet<number> = new Set()): Promise<void> {
  for (;;) {
    const { number, total } = await position(page);
    if (!skip.has(number)) await answerCurrent(page, correct);
    if (number === total) break;
    await page.getByTestId("exam-next").click();
    await expect(page.getByTestId("exam-navigator-open")).toContainText(`Question ${number + 1} of`);
  }
}

async function goToReviewAndSubmit(page: Page, shotName?: string): Promise<void> {
  await page.getByTestId("exam-next").click(); // Next on the last question -> review page
  await expect(page.getByTestId("exam-review-page")).toBeVisible();
  await page.getByTestId("exam-review-submit").click();
  await expect(page.getByTestId("exam-submit-counts")).toBeVisible();
  if (shotName) {
    await page.waitForTimeout(400);
    await shot(page, shotName);
  }
  await expect(page.getByText("You cannot return to this module.")).toBeVisible();
  await expect(page.getByRole("alertdialog")).not.toContainText(/difficult|harder|easier/i);
  await page.getByTestId("exam-submit-confirm").click();
}

async function highlightFirstWords(page: Page, chars: number): Promise<void> {
  await page.evaluate((n) => {
    const seg = document.querySelector('[data-testid="exam-passage"] [data-seg-kind="text"]');
    const node = seg?.firstChild;
    if (!node) throw new Error("no passage text");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, n);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, chars);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
}

test("test-day timing: RW routes up, Math routes down; resume, URL re-entry, anti-leak", async ({ page }) => {
  const leaks = watchForLeaks(page);
  const desmosFailures: string[] = [];
  page.on("requestfailed", (req) => {
    if (req.url().includes("desmos.com")) desmosFailures.push(`${new URL(req.url()).host} ${req.failure()?.errorText ?? ""}`);
  });
  await page.setViewportSize({ width: 1280, height: 832 });

  // ── Start ───────────────────────────────────────────────────────────────
  await page.goto("/tests");
  const card = page.getByRole("article", { name: "Practice Test 1" });
  await expect(card.getByTestId("exam-form-state")).toHaveText("Not started");
  await card.getByRole("button", { name: "Start test" }).click();
  await expect(page.getByTestId("exam-start-panel")).toBeVisible();
  await expect(page.getByLabel(/Test-day timing/)).toBeChecked();
  await shot(page, "01-start");
  await page.getByTestId("exam-begin").click();

  // ── Reading and Writing, Module 1 ─────────────────────────────────────
  await expect(page).toHaveURL(/\/RW\/1$/);
  await expect(page.getByTestId("exam-module-label")).toHaveText("Module 1 of 2");
  await expect(page.getByTestId("exam-choice").first()).toBeVisible();
  // No letters anywhere on an option.
  for (const text of await page.getByTestId("exam-choice").allTextContents()) {
    expect(text.trim()).not.toMatch(/^\(?[A-D][).:]\s/);
  }
  // Question 1: select, cross out a DIFFERENT option, mark, highlight.
  await answerCurrent(page, true);
  const selectedToken = await page.locator('[data-choice-token][aria-pressed="true"]').getAttribute("data-choice-token");
  const crossTarget = (await page.locator('[data-choice-token][aria-pressed="false"]').first().getAttribute("data-choice-token"))!;
  const crossIndex = await page.locator("[data-choice-token]").evaluateAll(
    (els, t) => els.findIndex((e) => e.getAttribute("data-choice-token") === t),
    crossTarget,
  );
  await page.getByRole("button", { name: `Cross out choice ${crossIndex + 1}` }).click();
  await page.getByTestId("exam-mark-review").click();
  await highlightFirstWords(page, 43);
  await expect(page.locator('[data-testid="exam-passage"] mark')).toHaveCount(1);
  await shot(page, "02-rw-module1-question");

  // Question 2 carries a formula: a selection ending inside it takes the whole formula.
  await page.getByTestId("exam-next").click();
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="exam-passage"]')!;
    const text = root.querySelector('[data-seg-kind="text"]')!.firstChild!;
    const math = root.querySelector('[data-seg-kind="math"]')!;
    const inner = document.createTreeWalker(math, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(text, 60);
    range.setEnd(inner, 1);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator('[data-testid="exam-passage"] [data-seg-kind="math"]')).toHaveClass(/exam-highlight|bg-/);
  await shot(page, "02b-rw-highlight-whole-formula");

  // Answer through question 9, leaving 10 and 14 unanswered (like the design).
  await page.getByTestId("exam-navigator-open").click();
  await page.getByRole("button", { name: /^Question 2,/ }).click();
  const skip = new Set([10, 14]);
  for (;;) {
    const { number } = await position(page);
    if (!skip.has(number)) await answerCurrent(page, true);
    if (number === 9) break;
    await page.getByTestId("exam-next").click();
  }

  // ── RESUME: reload mid-module ─────────────────────────────────────────
  // Let the 5 s heartbeat (or the on-navigation beat) carry position 9.
  await expect
    .poll(async () => (await pg.query(`SELECT current_ordinal FROM public.test_session_sections WHERE test_session_id = $1 AND section = 'RW'`, [sessionIdOf(page)])).rows[0]?.current_ordinal)
    .toBe(8);
  const timerBefore = await page.getByTestId("exam-timer").textContent();
  await page.reload();
  await expect(page.getByTestId("exam-navigator-open")).toContainText("Question 9 of 27");
  await shot(page, "03-resume-after-reload");
  const timerAfter = await page.getByTestId("exam-timer").textContent();
  // The server's remaining time: the reload costs seconds, not the module.
  const secs = (t: string | null) => { const [m, s] = (t ?? "0:0").split(":").map(Number); return m! * 60 + s!; };
  expect(secs(timerBefore) - secs(timerAfter)).toBeLessThan(15);
  expect(secs(timerBefore) - secs(timerAfter)).toBeGreaterThanOrEqual(0);
  // Question 1 after the reload: same selection, same crossed-out option, flag, highlight.
  await page.getByTestId("exam-navigator-open").click();
  await page.getByRole("button", { name: /^Question 1,/ }).click();
  await expect(page.locator(`[data-choice-token="${selectedToken}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Cross out choice ${crossIndex + 1}` })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("[data-choice-token]").nth(crossIndex).getAttribute("data-choice-token")).toBe(crossTarget);
  await expect(page.getByTestId("exam-mark-review")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="exam-passage"] mark')).toHaveCount(1);
  // ...and it is what the server stored: the token on screen maps to the stored letter.
  const stored = await pg.query(
    `SELECT a.answer, i.option_token_map ->> $2 AS letter
       FROM public.test_session_answers a
       JOIN public.test_session_items i USING (test_session_id, section, module, ordinal)
      WHERE a.test_session_id = $1 AND a.section = 'RW' AND a.module = '1' AND a.ordinal = 0`,
    [sessionIdOf(page), selectedToken],
  );
  expect(stored.rows[0]).toEqual({ answer: "A", letter: "A" });
  await shot(page, "03b-resume-question1-restored");

  // Finish Module 1 from question 11 on.
  await page.getByTestId("exam-navigator-open").click();
  await page.getByRole("button", { name: /^Question 11,/ }).click();
  await answerModule(page, true, skip);

  // ── Navigator and review page ─────────────────────────────────────────
  await page.getByTestId("exam-navigator-open").click();
  await expect(page.getByTestId("exam-navigator-grid")).toBeVisible();
  await page.waitForTimeout(400); // let the dialog's open animation finish
  await shot(page, "04-navigator");
  const cells = page.getByTestId("exam-navigator-grid").getByTestId("exam-question-cell");
  const navAnswered = await cells.evaluateAll((els) => els.filter((e) => e.getAttribute("data-answered") === "true").length);
  const navMarked = await cells.evaluateAll((els) => els.filter((e) => e.getAttribute("data-marked") === "true").length);
  await page.getByRole("button", { name: "Go to review page" }).click();
  await expect(page.getByTestId("exam-review-page")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const counts = page.getByTestId("exam-review-counts");
  await expect(counts.locator('[data-count="Answered"]')).toHaveText(String(navAnswered));
  await expect(counts.locator('[data-count="Marked for review"]')).toHaveText(String(navMarked));
  expect(navAnswered).toBe(25);
  await shot(page, "05-review-page");
  await page.getByTestId("exam-review-submit").click();
  await expect(page.getByTestId("exam-submit-counts")).toContainText("25 of 27");
  await page.waitForTimeout(400);
  await shot(page, "06-submit-dialog");
  await page.getByTestId("exam-submit-confirm").click();

  // ── RW Module 2 ────────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/RW\/2$/);
  await expect(page.getByTestId("exam-module-label")).toHaveText("Module 2 of 2");
  const sid = sessionIdOf(page);
  // PLANT: the submitted Module 1 cannot be re-entered by URL.
  await page.goto(`/tests/${sid}/RW/1`);
  await expect(page).toHaveURL(new RegExp(`/tests/${sid}/RW/2$`));
  // CONTRAST: under test-day timing a hidden tab pauses nothing.
  const strictRemaining = async () =>
    Number((await pg.query(`SELECT public.exam_remaining_ms($1, 'RW', clock_timestamp()) AS ms`, [sid])).rows[0].ms);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const strictBefore = await strictRemaining();
  await page.waitForTimeout(20_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1_500);
  const strictAfter = await strictRemaining();
  // eslint-disable-next-line no-console -- evidence line
  console.log("TEST-DAY NO PAUSE: remaining before hide", strictBefore, "after 20s hidden", strictAfter);
  expect(strictBefore - strictAfter).toBeGreaterThanOrEqual(20_000);

  // PLANT: the timer does not advance when the system clock moves forward.
  const read = async () => {
    const [m, s2] = ((await page.getByTestId("exam-timer").textContent()) ?? "0:0").split(":").map(Number);
    return m! * 60 + s2!;
  };
  const t0 = await read();
  // Shift the page's wall clock (Date) three hours ahead and leave the monotonic clock
  // alone — what a system clock change does. (page.clock would fake performance.now
  // too, which is not the case being tested.)
  await page.evaluate(() => {
    const RealDate = Date;
    const offset = 3 * 3600_000;
    class ShiftedDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor> | []) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...(args as ConstructorParameters<DateConstructor>));
      }
      static now(): number {
        return RealDate.now() + offset;
      }
    }
    (window as unknown as { Date: DateConstructor }).Date = ShiftedDate as unknown as DateConstructor;
  });
  expect(await page.evaluate(() => Date.now())).toBeGreaterThan(Date.now() + 3 * 3600_000 - 60_000);
  await page.waitForTimeout(3_000);
  const t1 = await read();
  // eslint-disable-next-line no-console -- evidence line
  console.log("CLOCK PLANT: timer", t0, "s -> wall clock +3h, 3s later ->", t1, "s");
  expect(t0 - t1).toBeGreaterThanOrEqual(2);
  expect(t0 - t1).toBeLessThanOrEqual(5);
  await answerModule(page, true);
  await goToReviewAndSubmit(page);

  // ── Break ──────────────────────────────────────────────────────────────
  await expect(page.getByTestId("exam-break")).toBeVisible();
  await expect(page.getByTestId("exam-break")).toContainText("the break ends on its own");
  await shot(page, "07-break");
  await page.getByTestId("exam-resume-now").click();

  // ── Math Module 1 (answered wrong: routes to the easier Module 2) ──────
  await expect(page).toHaveURL(/\/M\/1$/);
  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.locator("#exam-calculator-panel")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "08-math-calculator");
  // G-EX-08. E7b ran where desmos.com is refused at the proxy (CONNECT 403), so it could only
  // record the refusal. E10: where desmos.com is reachable (E2E_DESMOS_REACHABLE=1), the real
  // embed must load — no failed request, no error state, a Desmos container in the panel. A
  // refused fetch proves nothing about the exam, so it is logged, never passed as G-EX-08.
  // eslint-disable-next-line no-console -- evidence line
  console.log("DESMOS REQUEST FAILURES", JSON.stringify(desmosFailures));
  if (process.env.E2E_DESMOS_REACHABLE === "1") {
    await expect(page.locator("#exam-calculator-panel .dcg-container").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("desmos-calculator-error")).toHaveCount(0);
    expect(desmosFailures).toEqual([]);
  } else {
    expect(desmosFailures.length).toBeGreaterThan(0);
  }
  await page.getByRole("button", { name: "Close calculator" }).click();
  await page.getByRole("button", { name: "Reference" }).click();
  await page.waitForTimeout(500);
  await shot(page, "08b-math-reference");
  await page.keyboard.press("Escape");
  // A grid-in question on screen (the fixture puts grid-ins first in Math).
  await answerCurrent(page, false);
  await shot(page, "08c-math-grid-in");
  await page.getByTestId("exam-next").click();
  await answerModule(page, false);
  await goToReviewAndSubmit(page);
  await expect(page).toHaveURL(/\/M\/2$/);
  await expect(page.getByTestId("exam-module-label")).toHaveText("Module 2 of 2");
  await shot(page, "09-math-module2");
  await answerModule(page, true);
  await goToReviewAndSubmit(page, "10-math-module2-submit");

  // ── Completion ────────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByTestId("exam-report")).toHaveAttribute("data-report-state", /scored|scoring_pending/);
  await expect(page.getByTestId("exam-report")).toHaveAttribute("data-report-state", "scored", { timeout: 30_000 });
  await expect(page.getByTestId("exam-disclosure").first()).toBeVisible();
  await shot(page, "11-score");

  const paths = await pg.query(
    `SELECT section, module2_path FROM public.test_session_sections WHERE test_session_id = $1 ORDER BY section DESC`,
    [sid],
  );
  // eslint-disable-next-line no-console -- evidence line
  console.log("TEST-DAY PATHS", JSON.stringify(paths.rows));
  expect(leaks).toEqual([]);
});

test("practice timing: RW routes down, Math routes up; a hidden tab pauses the clock", async ({ page }) => {
  const leaks = watchForLeaks(page);
  await page.setViewportSize({ width: 1280, height: 832 });
  await page.goto("/tests");
  const card = page.getByRole("article", { name: "Practice Test 2" });
  await card.getByRole("button", { name: "Start test" }).click();
  await page.getByLabel(/Practice timing/).check();
  await page.getByTestId("exam-begin").click();

  await expect(page).toHaveURL(/\/RW\/1$/);
  await answerModule(page, false);
  await goToReviewAndSubmit(page);
  await expect(page).toHaveURL(/\/RW\/2$/);
  await answerModule(page, true);
  await goToReviewAndSubmit(page);

  await expect(page.getByTestId("exam-break")).toBeVisible();
  await expect(page.getByTestId("exam-break")).toContainText("when you're ready");
  await shot(page, "12-break-practice-timing");
  await page.getByTestId("exam-resume-now").click();
  await expect(page).toHaveURL(/\/M\/1$/);

  // MECHANISM: hide the tab for 20 s. No heartbeats go out, the server sees the gap,
  // and under practice timing gives the time back.
  const sid = sessionIdOf(page);
  const remaining = async () =>
    Number((await pg.query(`SELECT public.exam_remaining_ms($1, 'M', clock_timestamp()) AS ms`, [sid])).rows[0].ms);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await remaining();
  await page.waitForTimeout(20_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1_500);
  const after = await remaining();
  // eslint-disable-next-line no-console -- evidence line
  console.log("PRACTICE PAUSE: remaining before hide", before, "after 20s hidden", after);
  expect(before - after).toBeLessThan(8_000); // 20 s away cost at most the pre-threshold slice

  await answerModule(page, true);
  await goToReviewAndSubmit(page);
  await expect(page).toHaveURL(/\/M\/2$/);
  await answerModule(page, true);
  await goToReviewAndSubmit(page);

  await expect(page.getByTestId("exam-report")).toHaveAttribute("data-report-state", "scored", { timeout: 30_000 });
  await expect(page.getByText("Practice", { exact: true })).toBeVisible();
  await shot(page, "13-score-practice-timing");
  const paths = await pg.query(
    `SELECT section, module2_path FROM public.test_session_sections WHERE test_session_id = $1 ORDER BY section DESC`,
    [sid],
  );
  // eslint-disable-next-line no-console -- evidence line
  console.log("PRACTICE PATHS", JSON.stringify(paths.rows));

  await page.goto("/tests");
  await expect(page.getByRole("article", { name: "Practice Test 1" }).getByTestId("exam-form-state")).toHaveText("Scored");
  await expect(page.getByRole("article", { name: "Practice Test 2" }).getByTestId("exam-form-state")).toHaveText("Scored");
  await expect(page.getByTestId("exam-forms")).not.toContainText(/\b1[0-9]{3}\b/); // no score on a card
  await shot(page, "14-tests-home-after");
  expect(leaks).toEqual([]);
});

/** Presses Tab until `target` has focus — proof it is in the keyboard order. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("not reachable by Tab");
}

async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const cs = getComputedStyle(el);
    return (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || cs.boxShadow !== "none";
  });
}

test("keyboard only: start, answer, cross out, mark, navigator, review page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 832 });
  await page.goto("/tests");
  const card = page.getByRole("article", { name: "Practice Test 1" });
  await tabTo(page, card.getByRole("button", { name: "Take again" }));
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByLabel(/Test-day timing/));
  await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel(/Practice timing/)).toBeChecked();
  await tabTo(page, page.getByTestId("exam-begin"));
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/RW\/1$/);
  const first = page.locator("[data-choice-token]").first();
  await tabTo(page, first);
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  const cross = page.getByRole("button", { name: "Cross out choice 2" });
  await tabTo(page, cross);
  await page.keyboard.press("Space");
  await expect(cross).toHaveAttribute("aria-pressed", "true");
  await tabTo(page, page.getByTestId("exam-mark-review"));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-mark-review")).toHaveAttribute("aria-pressed", "true");

  // Navigator: open, reach a cell, jump; Escape returns focus to the trigger.
  const opener = page.getByTestId("exam-navigator-open");
  await tabTo(page, opener);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-navigator-grid")).toBeVisible();
  const cell3 = page.getByRole("button", { name: /^Question 3, unanswered/ });
  await tabTo(page, cell3);
  expect(await focusIsVisible(page)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, "15-keyboard-navigator-focus");
  await page.keyboard.press("Enter");
  await expect(opener).toContainText("Question 3 of 27");
  await tabTo(page, opener);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-navigator-grid")).toBeVisible();
  // Radix attaches its Escape handler after the dialog mounts; a key in the same
  // frame as the open is a harness artefact, not something a person can do.
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("exam-navigator-grid")).toHaveCount(0);
  await expect.poll(() => opener.evaluate((el) => el === document.activeElement)).toBe(true);

  // Review page by keyboard, then back to question 1 from its grid.
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Go to review page" }));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-review-page")).toBeVisible();
  // The submit dialog by keyboard: Escape keeps working and focus comes back.
  const submit = page.getByTestId("exam-review-submit");
  await tabTo(page, submit);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-submit-counts")).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("exam-submit-counts")).toHaveCount(0);
  await expect.poll(() => submit.evaluate((el) => el === document.activeElement)).toBe(true);
  const q1 = page.getByTestId("exam-review-page").getByRole("button", { name: /^Question 1, answered, marked for review/ });
  await tabTo(page, q1);
  await page.keyboard.press("Enter");
  await expect(opener).toContainText("Question 1 of 27");

  // Hide/Show by keyboard changes the display only.
  const hide = page.getByRole("button", { name: "Hide" });
  await tabTo(page, hide);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-timer")).toHaveAttribute("aria-label", "Timer hidden");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exam-timer")).toHaveAttribute("aria-label", /Time remaining/);
});
