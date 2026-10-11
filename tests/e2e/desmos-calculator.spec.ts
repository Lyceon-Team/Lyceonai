/**
 * The Desmos calculator in a browser: Scientific + DEG by default, a keypad that stays, and no
 * re-creation on a tab switch.
 *
 * @spec [Doc-02B_v4 §28 (Desmos on every runtime surface's Math questions); owner brief
 *        2026-10-11 ("default to Scientific + DEG, and fix the keypad"; "no re-creation on
 *        switch"; desktop 1440 and phone 390)] | @implemented [2026-10-11]
 *
 * plain English: drives the REAL `DesmosCalculator` in the calculator harness
 * (tests/e2e/desmos-harness), whose parent keeps the emitted state and feeds it back as
 * `initialState` exactly as the exam and practice pages do, against the REAL Desmos runtime.
 * A spy wraps both Desmos constructors before the page's own code runs, so every calculator the
 * component creates is counted.
 *   - desktop 1440, the exam's floating-panel box (`fillHeight`); phone 390, practice's stacked
 *     calculator.
 *   1. it opens on Scientific, in degrees: sin(30) evaluates to 0.5;
 *   2. the keypad stays on screen through 20 rapid presses, and still after the state has been
 *      saved (past the 600 ms debounce) — on Scientific and on Graphing;
 *   3. switching tabs back and forth creates no calculator after the first of each kind.
 * Screenshots (default view, and the Graphing tab) go to E2E_SHOT_DIR.
 *
 * Desmos source: E2E_DESMOS_SCRIPT_FILE (a copy of www.desmos.com's calculator.js, served to the
 * page by route — used where the browser cannot reach desmos.com directly, e.g. behind an
 * intercepting proxy whose CA the browser does not trust), otherwise desmos.com itself.
 *
 * run: start the harness —
 *   VITE_DESMOS_API_KEY=<key> pnpm exec vite --config tests/e2e/desmos-harness/vite.config.ts
 * then
 *   DESMOS_HARNESS_URL=http://localhost:5174 [E2E_DESMOS_SCRIPT_FILE=…] E2E_SHOT_DIR=<dir> \
 *     pnpm exec playwright test tests/e2e/desmos-calculator.spec.ts
 * Not part of `pnpm test` (vitest): it needs the harness and the Desmos runtime.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
test.setTimeout(2 * 60_000);

const HARNESS = process.env.DESMOS_HARNESS_URL ?? "http://localhost:5174";
const SCRIPT_FILE = process.env.E2E_DESMOS_SCRIPT_FILE;
const SHOTS =
  process.env.E2E_SHOT_DIR ??
  path.resolve("test-results/desmos-calculator-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const DESMOS_SCRIPT =
  /^https:\/\/www\.desmos\.com\/api\/v1\.11[^/]*\/calculator\.js/;

/** Wraps both constructors the moment Desmos defines `window.Desmos`, and counts every call. */
const CONSTRUCTOR_SPY = `(() => {
  const counts = { graphing: 0, scientific: 0 };
  window.__desmosConstructed = counts;
  // Desmos assigns an empty object to window.Desmos and fills it afterwards, so the
  // constructors are wrapped when they are READ, through a Proxy over the real object.
  const wrappers = new Map();
  const wrap = (real, key) => {
    if (typeof real !== "function") return real;
    if (!wrappers.has(real)) {
      wrappers.set(real, function (el, o) {
        counts[key] += 1;
        return new real(el, o);
      });
    }
    return wrappers.get(real);
  };
  let proxied;
  Object.defineProperty(window, "Desmos", {
    configurable: true,
    get() { return proxied; },
    set(real) {
      proxied = new Proxy(real, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === "GraphingCalculator") return wrap(value, "graphing");
          if (prop === "ScientificCalculator") return wrap(value, "scientific");
          return value;
        },
      });
    },
  });
})();`;

type Viewport = {
  name: string;
  width: number;
  height: number;
  layout: "panel" | "stacked";
};
const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900, layout: "panel" },
  { name: "phone", width: 390, height: 844, layout: "stacked" },
];

async function open(page: Page, vp: Viewport): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript(CONSTRUCTOR_SPY);
  if (SCRIPT_FILE) {
    await page.route(DESMOS_SCRIPT, (route) =>
      route.fulfill({
        path: SCRIPT_FILE,
        contentType: "application/javascript",
      }),
    );
  }
  await page.goto(`${HARNESS}/?layout=${vp.layout}`);
  await expect(page.locator(".dcg-container").first()).toBeVisible({
    timeout: 30_000,
  });
  // Desmos's trial-key toast (demo key only) sits over the keypad; dismiss it if present.
  await page.waitForTimeout(500);
}

async function constructed(
  page: Page,
): Promise<{ graphing: number; scientific: number }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __desmosConstructed: { graphing: number; scientific: number };
        }
      ).__desmosConstructed,
  );
}

/** The calculator on screen (the other tab's, if kept, is hidden). */
const visible = (page: Page, selector: string) =>
  page
    .locator(`[data-testid="desmos-calculator-shell"] ${selector}`)
    .locator("visible=true");

async function keypadKey(page: Page, label: string) {
  return visible(page, `.dcg-keypad-btn[aria-label="${label}"]`).first();
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}`, () => {
    test("opens on Scientific, in degrees: sin(30) = 0.5", async ({ page }) => {
      await open(page, vp);
      await expect(page.getByTestId("desmos-mode-scientific")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByTestId("desmos-mode-graphing")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.screenshot({
        path: path.join(SHOTS, `${vp.name}-01-default.png`),
      });
      await visible(page, ".dcg-mq-editable-field").first().click();
      await page.keyboard.type("sin(30)", { delay: 40 });
      await expect(
        visible(page, ".dcg-exp-output-container").first(),
      ).toContainText("=0.5");
    });

    test("the Scientific keypad stays through 20 rapid presses and after the save", async ({
      page,
    }) => {
      await open(page, vp);
      await expect(page.getByTestId("desmos-mode-scientific")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await visible(page, ".dcg-mq-editable-field").first().click();
      for (let i = 0; i < 20; i += 1) {
        await (
          await keypadKey(page, String((i % 9) + 1))
        ).click({ timeout: 2_000 });
        await expect(await keypadKey(page, "Sine")).toBeVisible();
      }
      // past the component's 600 ms state debounce: the save must not reset the calculator
      await page.waitForTimeout(1_500);
      await expect(await keypadKey(page, "Sine")).toBeVisible();
      await (await keypadKey(page, "Plus")).click({ timeout: 2_000 });
      await (await keypadKey(page, "1")).click({ timeout: 2_000 });
      await expect(
        visible(page, ".dcg-mq-editable-field").first(),
      ).toContainText("12345678912345678912+1");
    });

    test("the Graphing keypad stays through 20 rapid presses and after the save", async ({
      page,
    }) => {
      await open(page, vp);
      await page.getByTestId("desmos-mode-graphing").click();
      const expression = visible(page, ".dcg-mq-editable-field").first();
      await expression.click();
      // the graphing keypad is Desmos's own; open it from its toggle if it did not open on focus
      if (
        !(await (await keypadKey(page, "Sine")).isVisible().catch(() => false))
      ) {
        const toggle = visible(
          page,
          '[aria-label="Show Keypad"], .dcg-show-keypad',
        ).first();
        if (await toggle.isVisible().catch(() => false)) await toggle.click();
        await expression.click();
      }
      await expect(await keypadKey(page, "7")).toBeVisible({ timeout: 5_000 });
      for (let i = 0; i < 20; i += 1) {
        await (
          await keypadKey(page, String((i % 9) + 1))
        ).click({ timeout: 2_000 });
      }
      await page.waitForTimeout(1_500);
      await expect(await keypadKey(page, "7")).toBeVisible();
      await (await keypadKey(page, "Plus")).click({ timeout: 2_000 });
      await (await keypadKey(page, "1")).click({ timeout: 2_000 });
      await expect(expression).toContainText("12345678912345678912+1");
      await page.screenshot({
        path: path.join(SHOTS, `${vp.name}-02-graphing-keypad.png`),
      });
    });

    test("switching tabs never re-creates a calculator", async ({ page }) => {
      await open(page, vp);
      await page.getByTestId("desmos-mode-graphing").click();
      await expect(
        visible(page, ".dcg-graph-outer, .dcg-grapher").first(),
      ).toBeVisible();
      await page.getByTestId("desmos-mode-scientific").click();
      await expect(await keypadKey(page, "Sine")).toBeVisible();
      const afterFirstOfEach = await constructed(page);
      for (let i = 0; i < 3; i += 1) {
        await page.getByTestId("desmos-mode-graphing").click();
        await page.waitForTimeout(150);
        await page.getByTestId("desmos-mode-scientific").click();
        await page.waitForTimeout(150);
      }
      const after = await constructed(page);
      expect(afterFirstOfEach).toEqual({ graphing: 1, scientific: 1 });
      expect(after).toEqual(afterFirstOfEach);
    });

    test("each tab keeps its own work across switches", async ({ page }) => {
      await open(page, vp);
      await visible(page, ".dcg-mq-editable-field").first().click();
      await page.keyboard.type("2+3", { delay: 40 });
      await page.getByTestId("desmos-mode-graphing").click();
      await visible(page, ".dcg-mq-editable-field").first().click();
      await page.keyboard.type("y=x", { delay: 40 });
      await page.getByTestId("desmos-mode-scientific").click();
      await expect(
        visible(page, ".dcg-mq-editable-field").first(),
      ).toContainText("2+3");
      await page.getByTestId("desmos-mode-graphing").click();
      await expect(
        visible(page, ".dcg-mq-editable-field").first(),
      ).toContainText("y=x");
      await page.screenshot({
        path: path.join(SHOTS, `${vp.name}-03-graphing.png`),
      });
    });
  });
}
