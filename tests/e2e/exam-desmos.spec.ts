/**
 * E10 — Desmos and the reference sheet inside the exam's Math module, in a browser.
 *
 * @spec [Doc-02B_v4 §28 (Desmos + formula sheet on every runtime surface's Math questions);
 *        Doc-04A_V2.2 §15.1 (resume); G-EX-08] | @implemented [2026-09-26]
 *
 * plain English: the real client against the E7b harness (real /api/tests, real SQL). The
 * spec makes its own lenient sitting through the API, walks it to Math Module 1, then in the
 * browser: opens the calculator from the header tools row, reloads mid-module (the page must
 * come back on the same question, the calculator closed and re-openable), and opens the
 * reference sheet. Screenshots of each go to E2E_SHOT_DIR.
 *
 * G-EX-08 needs desmos.com. Where it is reachable (E2E_DESMOS_REACHABLE=1, and a real
 * VITE_DESMOS_API_KEY in the Vite build), the spec types y=x^2 and requires a rendered
 * graph — no failed desmos.com request, no error state. Where it is not (this repo's
 * cloud containers refuse desmos.com at the proxy), the refusal is logged and the spec
 * asserts only the wiring: that is NOT G-EX-08, and the PR says so.
 *
 * run: start the harness + Vite (tests/e2e/exam-harness/server.ts), then
 *   E2E_BASE_URL=http://localhost:5173 E2E_SHOT_DIR=<dir> \
 *     pnpm exec playwright test tests/e2e/exam-desmos.spec.ts
 * Not part of `pnpm test` (vitest) and not run in CI: it needs the local stack.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
test.use({ viewport: { width: 1280, height: 832 } });
test.setTimeout(3 * 60_000);

const SHOTS =
  process.env.E2E_SHOT_DIR ?? path.resolve("test-results/exam-desmos-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const FORM = "e7b00000-0000-4000-8000-0000000000f1";
const REACHABLE = process.env.E2E_DESMOS_REACHABLE === "1";

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test("Math module: calculator from the tools row, resume with it open, reference sheet", async ({
  page,
  request,
}) => {
  const desmosFailures: string[] = [];
  page.on("requestfailed", (req) => {
    if (req.url().includes("desmos.com"))
      desmosFailures.push(
        `${new URL(req.url()).host} ${req.failure()?.errorText ?? ""}`,
      );
  });

  // A lenient sitting walked to Math Module 1 through the real API.
  const created = await request.post("/api/tests/sessions", {
    data: { test_form_id: FORM, mode: "lenient" },
  });
  expect([200, 201]).toContain(created.status());
  const sid = ((await created.json()) as { session_id: string }).session_id;
  // Walk only what is not done yet: a live sitting from an earlier run is resumed (200), and
  // the exam allows one live sitting per student.
  type SectionRow = { section: "RW" | "M"; state: string };
  const state = await request.get(`/api/tests/sessions/${sid}/state`);
  expect(state.status()).toBe(200);
  const sections = ((await state.json()) as { sections: SectionRow[] })
    .sections;
  const rw = sections.find((x) => x.section === "RW")?.state ?? "";
  const m = sections.find((x) => x.section === "M")?.state ?? "";
  const steps: Array<readonly ["RW" | "M", 1 | 2, boolean]> = [];
  if (rw === "not_started") steps.push(["RW", 1, true], ["RW", 2, true]);
  else if (rw === "module1_active")
    steps.push(["RW", 1, true], ["RW", 2, true]);
  else if (rw === "module2_active") steps.push(["RW", 2, true]);
  if (m === "not_started") steps.push(["M", 1, false]);
  for (const [section, module, submit] of steps) {
    const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
    if (!(section === "RW" && module === 1 && rw === "module1_active"))
      expect((await request.post(`${base}/start`)).status()).toBe(200);
    if (submit)
      expect((await request.post(`${base}/submit`)).status()).toBe(200);
  }
  expect(
    (
      (await (
        await request.get(`/api/tests/sessions/${sid}/state`)
      ).json()) as {
        active_section: string;
      }
    ).active_section,
  ).toBe("M");

  const m1 = `/tests/${sid}/M/1`;
  await page.goto(m1);
  await expect(page.getByTestId("exam-module")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Next" }).click();

  // ── The calculator, from the header tools row beside Reference ────────────
  const toggle = page.getByRole("button", { name: "Calculator", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const panel = page.locator("#exam-calculator-panel");
  await expect(panel).toBeVisible();
  if (REACHABLE) {
    await expect(panel.locator(".dcg-container").first()).toBeVisible({
      timeout: 20_000,
    });
    await panel.locator(".dcg-mq-editable-field").first().click();
    await page.keyboard.type("y=x^2");
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("desmos-calculator-error")).toHaveCount(0);
    expect(desmosFailures).toEqual([]);
  } else {
    await page.waitForTimeout(2_000);
  }
  await shot(page, "01-math-calculator-open");

  // ── Resume: reload mid-module with the calculator open ────────────────────
  const counter = page.getByRole("button", { name: /^Question \d+ of \d+/ });
  const onScreen = (await counter.textContent()) ?? "";
  expect(onScreen).toMatch(/^Question \d+ of \d+/);
  await page.reload();
  await expect(page.getByTestId("exam-module")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(new RegExp(`${m1}$`));
  // Module state is the server's: the same question comes back (sections[].current_ordinal).
  await expect(counter).toHaveText(onScreen);
  // The calculator re-mounts closed (its own state is not persisted — E10 decision log)
  // and opens again from the same button.
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(REACHABLE ? 2_000 : 1_000);
  await shot(page, "02-after-reload-calculator-reopened");
  await page.getByRole("button", { name: "Close calculator" }).click();

  // ── The reference sheet ───────────────────────────────────────────────────
  await page.getByRole("button", { name: "Reference" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Math Reference Sheet")).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "03-math-reference-sheet");

  // eslint-disable-next-line no-console -- evidence line
  console.log(
    "E10 EVIDENCE " +
      JSON.stringify({
        session: sid,
        desmos_reachable: REACHABLE,
        desmos_request_failures: desmosFailures,
      }),
  );
});
