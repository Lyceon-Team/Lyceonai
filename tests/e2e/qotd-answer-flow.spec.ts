/**
 * The Question of the Day answer flow, in a real browser, against the built bundle.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16, R17, Q2/Q3 acceptance ("Preview: today's
 *       HTML has no answer; an archive page has its own meta and JSON-LD and is in the sitemap;
 *       a full Playwright answer flow"); SCL-202 item 2] | @implemented [2026-10-05]
 *
 * plain English: loads the homepage and the hub as a visitor with no account, checks the HTML the
 * server sent holds no answer, then answers today's question end to end: the real Cloudflare
 * Turnstile widget (Cloudflare's published always-pass TEST site key, owner decision 8) issues a
 * token, the choice and token are POSTed, and the reveal (correctness, correct choice,
 * explanation) renders. It also records every CSP report the page raises, enforced or
 * report-only, so the Turnstile hosts added to vercel.json are proven sufficient, and checks
 * that the question area carries `ph-no-capture` and that nothing is written to browser storage.
 *
 * Two API modes:
 *  - LIVE (E2E_QOTD_LIVE_API=1): the deployment's own /api/public/qotd — the preview run. Needs
 *    the QOTD migrations applied to that deployment's database and PUBLIC_RATE_LIMIT_HMAC_SECRET
 *    set (Karl). Also checks an archive page's meta, JSON-LD and sitemap entry when one exists.
 *  - MOCKED (default): /api/public/qotd/* answered in the browser with payloads produced by the
 *    SERVER's own projections over the shared fixture (tests/lib/qotd-fixture.ts, real SQL
 *    output). The POST handler refuses a request without a Turnstile token, so a passing run
 *    proves the browser sent one.
 *
 * env: E2E_CHROMIUM (a Chromium binary, as in page-csp-flows.spec.ts), E2E_PROXY, E2E_BASE_URL (default http://127.0.0.1:5175 — `node scripts/ops/page-csp-static-server.mjs`
 *   after `pnpm run build`, which serves dist/public with vercel.json's real headers),
 *   VERCEL_SHARE (preview bypass token, never printed), E2E_SHOT_DIR, E2E_QOTD_LIVE_API.
 * E2E_TURNSTILE_STUB=1 answers Cloudflare's api.js with a minimal stand-in implementing the same
 *   explicit-render API (render -> iframe + callback(token), remove), for environments whose
 *   browser cannot reach challenges.cloudflare.com. The real widget and the CSP report check are
 *   only meaningful without it (the preview run).
 * Not part of `pnpm test` (vitest) and not run in CI.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  gradeQotd,
  toArchiveIndexResponse,
  toTodayResponse,
} from "../../server/services/qotd/qotd-service";
import {
  qotdStat,
  qotdSubmitRequestSchema,
  qotdSubmitResponseSchema,
} from "../../packages/shared/src/qotd-schema";
import { QOTD_ARCHIVE_ROWS, qotdTodayRow } from "../lib/qotd-fixture";

// Mocked mode builds payloads with the server's token code, which keys off this secret.
process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET ??= "e2e-mock-secret-not-real";
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";
const LIVE = process.env.E2E_QOTD_LIVE_API === "1";
const STUB_TURNSTILE = process.env.E2E_TURNSTILE_STUB === "1";
const TURNSTILE_STUB_JS = `window.turnstile = {
  render: function (el, opts) {
    var f = document.createElement("iframe");
    f.setAttribute("src", "https://challenges.cloudflare.com/stub");
    f.setAttribute("title", "turnstile stub");
    el.appendChild(f);
    setTimeout(function () { opts.callback("XXXX.DUMMY.TOKEN.XXXX-stub"); }, 50);
    return "stub-widget";
  },
  remove: function () {}
};`;
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? "test-results/qotd";
test.use({ baseURL: BASE });
// E2E_PROXY: an outbound proxy for Chromium (Turnstile loads from challenges.cloudflare.com);
// local addresses bypass it so the static server is reached directly.
test.use({
  launchOptions: {
    ...(process.env.E2E_CHROMIUM
      ? { executablePath: process.env.E2E_CHROMIUM }
      : {}),
    ...(process.env.E2E_PROXY
      ? {
          proxy: {
            server: process.env.E2E_PROXY,
            bypass: "127.0.0.1,localhost",
          },
        }
      : {}),
  },
});
test.setTimeout(90_000);

type CspReport = { directive: string; blocked: string; disposition: string };

async function recordCsp(page: Page): Promise<CspReport[]> {
  const reports: CspReport[] = [];
  await page.exposeBinding("__qotdCsp", (_source, r: CspReport) => {
    reports.push(r);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as {
        __qotdCsp: (r: {
          directive: string;
          blocked: string;
          disposition: string;
        }) => void;
      };
      w.__qotdCsp({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
      });
    });
  });
  return reports;
}

async function bypass(page: Page): Promise<void> {
  const share = process.env.VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
}

function mockApi(page: Page, posted: unknown[]): Promise<void> {
  const row = qotdTodayRow();
  return page.route(
    (url) =>
      url.origin === new URL(BASE).origin &&
      url.pathname.startsWith("/api/public/qotd/"),
    async (route: Route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      if (req.method() === "GET" && p.endsWith("/today")) {
        return route.fulfill({ json: { data: toTodayResponse(row) } });
      }
      if (req.method() === "GET" && p.endsWith("/archive")) {
        return route.fulfill({
          json: { data: toArchiveIndexResponse(QOTD_ARCHIVE_ROWS) },
        });
      }
      if (req.method() === "POST" && p.endsWith("/today/answer")) {
        const body = qotdSubmitRequestSchema.safeParse(req.postDataJSON());
        posted.push(req.postDataJSON());
        if (!body.success || body.data.turnstile_token.length < 10) {
          return route.fulfill({
            status: 403,
            json: { error: { code: "turnstile_failed", message: "no token" } },
          });
        }
        const graded = gradeQotd(row, body.data.answer);
        if (!graded.ok)
          return route.fulfill({
            status: 400,
            json: { error: { code: "invalid_input" } },
          });
        return route.fulfill({
          json: {
            data: qotdSubmitResponseSchema.parse({
              qotd_date: row.qotd_date,
              is_correct: graded.isCorrect,
              correct_option_id: graded.correctOptionId,
              correct_answer: null,
              explanation: row.explanation ?? "",
              stats: qotdStat(6, 4),
            }),
          },
        });
      }
      return route.fulfill({
        status: 404,
        json: { error: { code: "not_found" } },
      });
    },
  );
}

test.describe("Question of the Day", () => {
  test("today's HTML has no answer, and a visitor answers end to end", async ({
    page,
  }) => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const csp = await recordCsp(page);
    const posted: unknown[] = [];
    await bypass(page);
    if (!LIVE) await mockApi(page, posted);
    if (STUB_TURNSTILE) {
      await page.route(/challenges\.cloudflare\.com\/turnstile\//, (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: TURNSTILE_STUB_JS,
        }),
      );
      await page.route(/challenges\.cloudflare\.com\/stub/, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><p>stub</p>",
        }),
      );
    }

    // 1. The HTML as served carries no question and no answer for today.
    for (const p of ["/", "/sat-question-of-the-day"]) {
      const res = await page.goto(p);
      const html = (await res?.text()) ?? "";
      expect(html, p).toContain('data-testid="qotd-loading"');
      expect(html, p).not.toContain('data-testid="qotd-question-area"');
      if (!LIVE) {
        expect(html, p).not.toContain(qotdTodayRow().explanation ?? "\u0000");
        expect(html, p).not.toContain(qotdTodayRow().stem);
      }
    }

    // 2. The widget renders today's question inside ph-no-capture. Turnstile is requested only
    //    on interaction (owner ruling 2026-10-05), so count its requests from page load.
    const turnstileRequests: string[] = [];
    page.on("request", (r) => {
      // Host compared exactly (CodeQL js/incomplete-url-substring-sanitization).
      if (new URL(r.url()).hostname === "challenges.cloudflare.com")
        turnstileRequests.push(r.url());
    });
    // The homepage widget is lazy (owner request 2026-10-05): its chunk and KaTeX load only when
    // the slot nears the viewport, so record those requests and scroll to the slot first.
    const lazyChunks: string[] = [];
    page.on("request", (r) => {
      if (/\/assets\/(QotdWidget|MathRenderer)-/.test(r.url()))
        lazyChunks.push(r.url());
    });
    await page.goto("/");
    const entryHtml = (await (await page.request.get("/")).text()) ?? "";
    expect(entryHtml).not.toMatch(
      /modulepreload[^>]*(QotdWidget|MathRenderer)/,
    );
    await page.getByTestId("qotd-lazy-slot").scrollIntoViewIfNeeded();
    const area = page.getByTestId("qotd-question-area");
    await expect(area).toBeVisible({ timeout: 20_000 });
    await expect(area).toHaveClass(/ph-no-capture/);
    // No reveal before submit (the renderer's explanation panel, UI-53).
    await expect(area.getByTestId("runner-explanation")).toHaveCount(0);

    // 3. No Turnstile before a pick; picking loads it, it issues a token (test key) and submit
    //    becomes possible. The options are shuffled server-side; the first on-screen one is "A".
    expect(turnstileRequests).toEqual([]);
    await expect(
      page.locator('iframe[src*="challenges.cloudflare.com"]'),
    ).toHaveCount(0);
    // Choices are radios in a radiogroup since the renderer moved to the student tokens (UI-53).
    await area.getByRole("radio").first().click();
    await expect(
      page.locator('iframe[src*="challenges.cloudflare.com"]'),
    ).toHaveCount(1, {
      timeout: 20_000,
    });
    const submit = page.getByTestId("qotd-submit");
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await page.screenshot({
      path: path.join(SHOT_DIR, "qotd-before-submit.png"),
      fullPage: false,
    });
    await submit.click();

    // 4. The reveal.
    await expect(page.getByText(/^(Correct|Not quite)$/)).toBeVisible({
      timeout: 20_000,
    });
    // The explanation panel (the renderer's `runner-explanation` since UI-53; it has no
    // "Explanation" label any more), holding the explanation's own text.
    await expect(area.getByTestId("runner-explanation")).toBeVisible();
    await expect(area.getByTestId("runner-explanation")).not.toHaveText("");
    // One answer per visit: the widget is locked — no submit control, every choice disabled.
    await expect(page.getByTestId("qotd-locked")).toBeVisible();
    await expect(page.getByTestId("qotd-submit")).toHaveCount(0);
    const choices = area.getByRole("radio");
    for (let i = 0; i < (await choices.count()); i += 1) {
      await expect(choices.nth(i)).toBeDisabled();
    }
    await page.screenshot({
      path: path.join(SHOT_DIR, "qotd-after-submit.png"),
      fullPage: false,
    });
    if (!LIVE) {
      expect(posted).toHaveLength(1);
      const sent = posted[0] as { answer: string; turnstile_token: string };
      // The first on-screen choice is sent as its opaque token, never a letter.
      expect(sent.answer).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(sent.turnstile_token.length).toBeGreaterThan(10);
      await expect(page.getByTestId("qotd-stat")).toHaveText(
        "67% of students got this right.",
      );
    }

    // 5. Nothing in browser storage; no CSP report from the flow.
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /qotd|question/i.test(k)),
    );
    expect(stored).toEqual([]);
    process.stdout.write(`QOTD_CSP_REPORTS ${JSON.stringify(csp)}\n`);
    fs.writeFileSync(
      path.join(SHOT_DIR, "csp-reports.json"),
      JSON.stringify(csp, null, 2),
    );
    expect(csp).toEqual([]);
  });

  test("homepage at mobile size: the widget chunk and KaTeX load only once the slot nears the viewport", async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 412, height: 823 },
    });
    const posted: unknown[] = [];
    await bypass(page);
    if (!LIVE) await mockApi(page, posted);
    const lazyChunks: string[] = [];
    page.on("request", (r) => {
      if (/\/assets\/(QotdWidget|MathRenderer)-/.test(r.url()))
        lazyChunks.push(r.url());
    });
    await page.goto("/", { waitUntil: "networkidle" });
    // Presence first: the slot is on the page, below the fold.
    await expect(page.getByTestId("qotd-lazy-slot")).toHaveCount(1);
    expect(lazyChunks).toEqual([]);
    await page.getByTestId("qotd-lazy-slot").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("qotd-question-area")).toBeVisible({
      timeout: 20_000,
    });
    expect(lazyChunks.some((u) => u.includes("/QotdWidget-"))).toBe(true);
    expect(lazyChunks.some((u) => u.includes("/MathRenderer-"))).toBe(true);
    await page.close();
  });

  test("the hub's widget (not lazy) answers end to end too", async ({
    page,
  }) => {
    const posted: unknown[] = [];
    await bypass(page);
    if (!LIVE) await mockApi(page, posted);
    if (STUB_TURNSTILE) {
      await page.route(/challenges\.cloudflare\.com\/turnstile\//, (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: TURNSTILE_STUB_JS,
        }),
      );
      await page.route(/challenges\.cloudflare\.com\/stub/, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><p>stub</p>",
        }),
      );
    }
    await page.goto("/sat-question-of-the-day");
    const area = page.getByTestId("qotd-question-area");
    await expect(area).toBeVisible({ timeout: 20_000 });
    await area.getByRole("button").first().click();
    const submit = page.getByTestId("qotd-submit");
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await submit.click();
    await expect(page.getByText(/^(Correct|Incorrect)$/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("qotd-locked")).toBeVisible();
    if (!LIVE) expect(posted).toHaveLength(1);
  });

  test("an archive page has its own head, Quiz JSON-LD and a sitemap entry (live only)", async ({
    page,
    request,
  }) => {
    test.skip(!LIVE, "archive pages are built from the deployment's database");
    await bypass(page);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const loc =
      /<loc>(https:\/\/lyceon\.ai\/sat-question-of-the-day\/\d{4}-\d{2}-\d{2})<\/loc>/.exec(
        sitemap,
      )?.[1];
    test.skip(!loc, "no archive day has ended on this deployment yet");
    const pathOnly = new URL(String(loc)).pathname;
    const res = await page.goto(pathOnly);
    const html = (await res?.text()) ?? "";
    expect(html).toContain(`<link rel="canonical" href="${loc}" />`);
    expect(html).toContain('"@type":"Quiz"');
    expect(html).toContain('"@type":"BreadcrumbList"');
  });
});
