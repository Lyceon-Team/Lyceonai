/**
 * G2 — the score disclosure is the summary alone, for a student and a guardian.
 *
 * @spec [Doc-04C_V1.0 §15.1 as amended by SCL-182 (no "Learn more"; the summary stands
 *        alone; a scaled score never renders without its summary beside it)]
 * @implemented [2026-09-27]
 *
 * plain English: the real client against the E7b harness (real /api/tests and, since G2,
 * the real /api/students router behind the real subject resolver). The spec walks one
 * lenient sitting through the API to a scored report, then opens it twice: as the
 * student at /tests/:sessionId/report, and as the linked guardian at
 * /students/:studentId/tests/:sessionId (the harness makes a request as the guardian when
 * it carries `x-harness-as: guardian`). On both screens: a scaled score is on the page, the
 * disclosure note beside it is exactly the payload's summary, and there is no link — no
 * "Learn more", no anchor inside the note, and the payload's full_text_url nowhere in the
 * page. Screenshots go to E2E_SHOT_DIR.
 *
 * run: start the harness + Vite (tests/e2e/exam-harness/server.ts), then
 *   E2E_BASE_URL=http://localhost:5173 E2E_SHOT_DIR=<dir> \
 *     pnpm exec playwright test tests/e2e/exam-disclosure.spec.ts
 * Not part of `pnpm test` (vitest) and not run in CI: it needs the local stack.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(3 * 60_000);

const SHOTS =
  process.env.E2E_SHOT_DIR ??
  path.resolve("test-results/exam-disclosure-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const FORM = "e7b00000-0000-4000-8000-0000000000f2";
const STUDENT = "00000000-0000-4000-8000-0000000e7b01";

type Disclosure = { summary: string; full_text_url: string };

/** One lenient sitting walked to a scored report through the real API. */
async function scoredSession(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/tests/sessions", {
    data: { test_form_id: FORM, mode: "lenient" },
  });
  expect([200, 201]).toContain(created.status());
  const sid = ((await created.json()) as { session_id: string }).session_id;
  for (const section of ["RW", "M"] as const) {
    for (const module of [1, 2] as const) {
      const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
      expect((await request.post(`${base}/start`)).status()).toBe(200);
      expect((await request.post(`${base}/submit`)).status()).toBe(200);
    }
  }
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`/api/tests/sessions/${sid}/report`)
          ).json()) as { data: { report_state: string } }
        ).data.report_state,
      { timeout: 30_000 },
    )
    .toBe("scored");
  return sid;
}

/** The ruling, asserted on a rendered page. */
async function expectSummaryAloneBesideScore(
  page: Page,
  disclosure: Disclosure,
): Promise<void> {
  await expect(page.getByTestId("exam-total-score")).toBeVisible();
  const note = page.getByTestId("exam-disclosure");
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText(disclosure.summary);
  await expect(note.locator("a")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /learn more/i })).toHaveCount(0);
  expect(await page.content()).not.toContain(disclosure.full_text_url);
}

test("the score screen carries the summary and no link, for the student and the guardian", async ({
  page,
  request,
  browser,
}) => {
  const sid = await scoredSession(request);
  const disclosure = (
    (await (await request.get(`/api/tests/sessions/${sid}/report`)).json()) as {
      data: { disclosure: Disclosure };
    }
  ).data.disclosure;
  // The payload still carries the field (the data model is unchanged, SCL-182).
  expect(disclosure.full_text_url.length).toBeGreaterThan(0);

  // ── The student ─────────────────────────────────────────────────────────────
  await page.goto(`/tests/${sid}/report`);
  await expect(page.getByTestId("exam-report")).toHaveAttribute(
    "data-report-state",
    "scored",
    { timeout: 30_000 },
  );
  await expectSummaryAloneBesideScore(page, disclosure);
  await page.screenshot({
    path: path.join(SHOTS, "01-student-score-screen.png"),
    fullPage: true,
  });

  // ── The guardian ────────────────────────────────────────────────────────────
  const guardianContext = await browser.newContext({
    extraHTTPHeaders: { "x-harness-as": "guardian" },
    viewport: { width: 1280, height: 900 },
  });
  const guardian = await guardianContext.newPage();
  await guardian.goto(`/students/${STUDENT}/tests/${sid}`);
  await expect(guardian.getByTestId("guardian-exam")).toBeVisible({
    timeout: 30_000,
  });
  await expect(guardian.locator("[data-report-state]").first()).toHaveAttribute(
    "data-report-state",
    "scored",
    { timeout: 30_000 },
  );
  await expectSummaryAloneBesideScore(guardian, disclosure);
  await guardian.screenshot({
    path: path.join(SHOTS, "02-guardian-score-screen.png"),
    fullPage: true,
  });
  await guardianContext.close();

  // eslint-disable-next-line no-console -- evidence line
  console.log(
    "G2 EVIDENCE " +
      JSON.stringify({
        session: sid,
        summary: disclosure.summary,
        full_text_url_in_payload: disclosure.full_text_url,
        student: "summary only, no link",
        guardian: "summary only, no link",
      }),
  );
});
