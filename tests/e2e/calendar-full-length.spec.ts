/**
 * E9b — a full-length practice test, planned and started from the calendar, in a browser.
 *
 * @spec [Doc_05F §9.4 (G-08-02), §15.1 launch, §17.2 day editor; SCL-167 (the test and
 *        the timing are block-scope keys), SCL-168 (the next test)] | @implemented [2026-09-25]
 *
 * plain English: the real client, the real /api/calendar and /api/tests routers, real SQL
 * (tests/e2e/exam-harness). The student opens their calendar, adds a full-length block to
 * today with "+ Add block" — choosing the test and the timing in the same sheet practice uses
 * for its domains — opens it, presses Start, and lands in the exam. The database then shows
 * the calendar_block_launches row naming the real exam session. Going back and pressing the
 * block again says Resume and lands in the SAME session.
 *
 * run: start the harness + Vite (see tests/e2e/exam-harness/server.ts), then
 *   E2E_BASE_URL=http://localhost:5173 E2E_SHOT_DIR=<dir> PGPORT=54331 \
 *     pnpm exec playwright test tests/e2e/calendar-full-length.spec.ts
 * Not part of `pnpm test` (vitest) and not run in CI: it needs the local stack.
 */
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import fs from "fs";
import path from "path";

test.describe.configure({ mode: "serial" });
if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
// The harness student's calendar is in UTC; the browser agrees, so "today" is one date.
test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
test.setTimeout(5 * 60_000);

const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/calendar-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STUDENT_ID = "00000000-0000-4000-8000-0000000e7b01";
const FIRST_FORM = "e7b00000-0000-4000-8000-0000000000f1";

let pg: Client;
let today = "";
test.beforeAll(async () => {
  pg = new Client({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? "54331"),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database: "exam_e2e_harness",
  });
  await pg.connect();
  today = (await pg.query(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`))
    .rows[0].d as string;
});
test.afterAll(async () => {
  await pg.end();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage: false,
  });
}

async function todaysFullLength(): Promise<string | null> {
  const r = await pg.query(
    `SELECT b.block_id::text FROM public.calendar_current_plan cp
       JOIN public.calendar_blocks b ON b.block_id = cp.block_id
      WHERE cp.student_id = $1 AND cp.scheduled_date = $2 AND b.block_type = 'full_length'`,
    [STUDENT_ID, today],
  );
  return (r.rows[0]?.block_id as string | undefined) ?? null;
}

let blockId = "";
let sessionId = "";

test("the student adds a full-length test to today, choosing the test and the timing", async ({
  page,
}) => {
  await page.goto("/calendar");
  const day = page.getByTestId(`calendar-day-${today}`);
  await expect(day).toBeVisible({ timeout: 30_000 });
  await day.getByRole("button", { name: "+ Add block" }).click();

  await page.getByTestId("calendar-create-engine-full_length").click();
  const form = page.locator("#calendar-create-fl-form-select");
  await expect(form).toHaveValue("next");
  // Both published tests are offered by name, after "Next unused test".
  await expect(form.locator("option")).toHaveText([
    "Next unused test",
    "Practice Test 1",
    "Practice Test 2",
  ]);
  await expect(
    page.getByTestId("calendar-create-fl-mode-strict"),
  ).toHaveAttribute("aria-pressed", "true");
  await shot(page, "01-create-sheet-full-length");
  await page.getByTestId("calendar-create-confirm").click();

  await expect.poll(todaysFullLength, { timeout: 15_000 }).not.toBeNull();
  blockId = (await todaysFullLength())!;
  const scope = (
    await pg.query(
      `SELECT scope FROM public.calendar_blocks WHERE block_id = $1`,
      [blockId],
    )
  ).rows[0].scope;
  expect(scope).toEqual({ form_id: null, exam_mode: "strict" });
  await expect(page.getByTestId(`calendar-block-${blockId}`)).toBeVisible();
  await shot(page, "02-week-with-full-length");
});

test("Start launches a real exam session and records the launch", async ({
  page,
}) => {
  await page.goto("/calendar");
  await page.getByTestId(`calendar-block-${blockId}`).click();
  const sheet = page.getByTestId("calendar-block-sheet");
  await expect(sheet).toBeVisible();
  // The same two fields, on the block that exists (§17.2 edit sheet).
  await expect(page.locator("#calendar-block-fl-form-select")).toHaveValue(
    "next",
  );
  await expect(
    page.getByTestId("calendar-block-fl-mode-strict"),
  ).toHaveAttribute("aria-pressed", "true");
  await shot(page, "03-block-sheet-full-length");
  await sheet.getByRole("button", { name: "Start" }).click();

  await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  sessionId = page.url().split("/").pop()!;
  await shot(page, "04-exam-session-hub");

  const session = (
    await pg.query(
      `SELECT test_form_id::text, mode, student_id::text FROM public.test_sessions WHERE id = $1`,
      [sessionId],
    )
  ).rows;
  expect(session).toEqual([
    { test_form_id: FIRST_FORM, mode: "strict", student_id: STUDENT_ID },
  ]);
  const links = (
    await pg.query(
      `SELECT launch_sequence, engine, engine_session_id::text FROM public.calendar_block_launches WHERE block_id = $1`,
      [blockId],
    )
  ).rows;
  expect(links).toEqual([
    { launch_sequence: 1, engine: "full_length", engine_session_id: sessionId },
  ]);
  // eslint-disable-next-line no-console -- evidence for the PR
  console.log(
    "E9b UI EVIDENCE " +
      JSON.stringify({
        block_id: blockId,
        test_session: { id: sessionId, ...session[0] },
        calendar_block_launches: links,
      }),
  );
});

test("back on the calendar the block says Resume, and resumes the SAME session", async ({
  page,
}) => {
  await page.goto("/calendar");
  // A STARTED block's card carries aria-disabled="true": dnd-kit marks every card it will not
  // drag that way, although the card still opens its sheet on click (BlockCard onClick). That
  // is a pre-existing accessibility defect for every engine's started block, reported with
  // E9b and not fixed here; `force` clicks the card exactly as a pointer does.
  await page.getByTestId(`calendar-block-${blockId}`).click({ force: true });
  const sheet = page.getByTestId("calendar-block-sheet");
  await expect(sheet.getByRole("button", { name: "Resume" })).toBeVisible();
  await sheet.getByRole("button", { name: "Resume" }).click();
  await page.waitForURL(new RegExp(`/tests/${sessionId}$`), {
    timeout: 30_000,
  });
  const n = (
    await pg.query(
      `SELECT count(*)::int AS n FROM public.test_sessions WHERE student_id = $1`,
      [STUDENT_ID],
    )
  ).rows[0].n;
  expect(n).toBe(1);
});
