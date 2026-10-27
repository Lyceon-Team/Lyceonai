/**
 * The LISA chat dock in a real browser: where it appears, what it never covers, the lock, the
 * non-modal panel, Esc, and the question scope.
 *
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22): "The bubble appears on Home and Review
 *        only, at desktop/tablet widths, and never on the live test, guardian pages, signed-out
 *        pages or phones"; "No layout collision with the cookie banner or Submit/Next at 768px,
 *        1024px and 1440px"; "Free → lock + upgrade modal; paid → dock opens"; "Non-modal: answer
 *        choices stay clickable with the dock open; Esc minimizes"; "The dock replaces the runner
 *        panel and opens scoped to the current question"] | @implemented [2026-10-22]
 *
 * plain English: drives the REAL client (a production build under `vite preview`) against the
 * student harness (tests/e2e/student-harness: the real routers over a throwaway database, real
 * entitlements for the free and paid personas), started with the `lisa-dock` seed. Each runner
 * test starts its own review session through the real create route and ends it afterwards. A
 * choice is clicked with Playwright's actionability checks on, so a bubble or panel over its click
 * point fails the click. No tutor turn runs (the harness refuses `POST /api/tutor/messages`).
 * Guardian pages are covered by ChatDock.surfaces.guard.test.ts (the harness has no guardian
 * persona); the signed-out homepage, the LISA page, the practice runner and the live timed module
 * are visited here.
 *
 * run (the stack the student harness README describes, reused):
 *   HARNESS_PORT=5066 STUDENT_HARNESS_SEED=lisa-dock pnpm exec tsx \
 *     --import ./tests/e2e/student-harness/register.mjs tests/e2e/student-harness/server.ts
 *   (vite build, then vite preview on :5184 with PORT=5066)
 *   E2E_BASE_URL=http://localhost:5184 STUDENT_HARNESS_MANIFEST_FILE=<file holding the ready-line
 *     JSON> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     pnpm exec playwright test tests/e2e/lisa-dock.spec.ts
 * Not part of `pnpm test` (vitest). CI runs it in ci-full's `lisa-dock-browser` job
 * (tests/e2e/run-lisa-dock-e2e.sh starts the same stack).
 *
 * @updated 2026-10-23 (owner brief "LISA launcher redesign + placement", Karl, option D): the
 * round bubble is now the "Ask LISA" speech-bubble launcher (same `chat-dock-bubble` test id),
 * anchored in the column the student works in: on Home and Review inside the middle column, never
 * over the rail or the right panel; in a runner above Submit/Next and clear of the calculator.
 * After a wrong answer, "Still confused? Ask LISA" under the explanation opens it scoped to that
 * question; each surface has its opening line.
 * @updated 2026-10-26 (owner brief "restore the pre-#1300 runner layout", Karl): in the practice
 * and review runners the OPEN dock is the runner's docked right column (review: open on entry),
 * the calculator opens between the question and LISA with one shared edge, and Minimize returns
 * it to the launcher; the runner tests above that drove the floating panel are re-pointed to the
 * column and to the launcher (each names the guarantee it keeps). Home and Review are unchanged.
 * The harness mounts production's global limiter with a higher ceiling for the test server only
 * (tests/e2e/student-harness/rate-limit.ts, owner ruling 2026-10-24; production stays at 1000 per
 * 15 minutes). Past it the server answers 429, which the app reads as signed out (the login page):
 * restart the server, or raise the harness's override for the run (rate-limit.ts names it).
 * @updated 2026-10-27 (owner brief "Video player: near-fullscreen", Karl): the video player's
 * tests are the last block (sizes at desktop, tablet and phone, the one-line header, shrink and
 * expand, focus returning on close), on the LISA page and in the review runner.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import { answerCookieBanner } from "./exam-harness/consent";
import {
  PERSONA_HEADER,
  type StudentPersona,
} from "./student-harness/personas";
import {
  SEED_CLIENT_INSTANCE,
  type SeedManifest,
} from "./student-harness/seed";

if (process.env.E2E_CHROMIUM)
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5184";
/** The harness's ready-line JSON, inline or from a file (`STUDENT_HARNESS_MANIFEST_FILE`). */
const MANIFEST = JSON.parse(
  process.env.STUDENT_HARNESS_MANIFEST ??
    (process.env.STUDENT_HARNESS_MANIFEST_FILE
      ? fs.readFileSync(process.env.STUDENT_HARNESS_MANIFEST_FILE, "utf8")
      : "{}"),
) as Partial<SeedManifest>;

const BUBBLE = '[data-testid="chat-dock-bubble"]';
const PANEL = '[data-testid="chat-dock-panel"]';
const WIDTHS = [768, 1024, 1440] as const;
const HEIGHT_FOR: Record<number, number> = {
  768: 1024,
  1024: 768,
  1062: 800,
  1440: 900,
};

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("element not on screen");
  return b;
}

async function asPersona(
  page: Page,
  persona: StudentPersona | "signed-out",
  opts: { bannerAnswered?: boolean } = {},
): Promise<void> {
  if (persona !== "signed-out")
    await page.context().setExtraHTTPHeaders({ [PERSONA_HEADER]: persona });
  if (opts.bannerAnswered !== false)
    await answerCookieBanner(page.context(), BASE);
  await page.addInitScript((instance: string) => {
    window.localStorage.setItem("lyceon_client_instance_id", instance);
    window.localStorage.setItem("lyceon-theme", "light");
  }, SEED_CLIENT_INSTANCE);
}

let freshCounter = 0;
async function freshReviewSession(api: APIRequestContext): Promise<string> {
  freshCounter += 1;
  const res = await api.post(`${BASE}/api/review/sessions`, {
    headers: { [PERSONA_HEADER]: "paid", "content-type": "application/json" },
    data: {
      mode: "filter",
      filters: { sections: ["RW"] },
      target_count: 10,
      client_instance_id: SEED_CLIENT_INSTANCE,
      idempotency_key: `lisa-dock-spec-${process.pid}-${freshCounter}`,
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(400);
  const json = (await res.json()) as { sessionId?: unknown };
  if (typeof json.sessionId !== "string") throw new Error("no sessionId");
  return json.sessionId;
}

async function endReviewSession(
  api: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await api.post(`${BASE}/api/review/sessions/${sessionId}/terminate`, {
    headers: { [PERSONA_HEADER]: "paid", "content-type": "application/json" },
    data: { client_instance_id: SEED_CLIENT_INSTANCE },
  });
}

/** The served item's id, read from the runner's own /next answer. */
async function openRunner(page: Page, sessionId: string): Promise<string> {
  const next = page.waitForResponse(
    (r) => /\/api\/review\/sessions\/[^/]+\/next/.test(r.url()) && r.ok(),
  );
  await page.goto(`${BASE}/review/session/${sessionId}`);
  const body = (await (await next).json()) as {
    sessionItemId?: string;
    question?: { sessionItemId?: string } | null;
  };
  await page.locator('[data-testid="runner-choice"]').first().waitFor();
  const id = body.question?.sessionItemId ?? body.sessionItemId;
  if (typeof id !== "string") throw new Error("no served item");
  return id;
}

/**
 * A fresh session of `engine` in `sections`, through the real create route, bound to the seed's
 * client instance (#1300 follow-ups, 2026-10-23: practice and Math sessions too).
 */
async function freshSession(
  api: APIRequestContext,
  engine: "practice" | "review",
  sections: readonly ("M" | "RW")[],
): Promise<string> {
  freshCounter += 1;
  const data =
    engine === "review"
      ? {
          mode: "filter",
          filters: { sections },
          target_count: 10,
          client_instance_id: SEED_CLIENT_INSTANCE,
          idempotency_key: `lisa-dock-spec-${process.pid}-${freshCounter}`,
        }
      : {
          section: sections[0],
          mode: "balanced",
          target_question_count: 5,
          client_instance_id: SEED_CLIENT_INSTANCE,
        };
  const res = await api.post(`${BASE}/api/${engine}/sessions`, {
    headers: { [PERSONA_HEADER]: "paid", "content-type": "application/json" },
    data,
  });
  expect(res.status(), await res.text()).toBeLessThan(400);
  const json = (await res.json()) as { sessionId?: unknown };
  if (typeof json.sessionId !== "string") throw new Error("no sessionId");
  return json.sessionId;
}

async function endSession(
  api: APIRequestContext,
  engine: "practice" | "review",
  sessionId: string,
): Promise<void> {
  await api.post(`${BASE}/api/${engine}/sessions/${sessionId}/terminate`, {
    headers: { [PERSONA_HEADER]: "paid", "content-type": "application/json" },
    data: { client_instance_id: SEED_CLIENT_INSTANCE },
  });
}

/** Opens `engine`'s runner on `sessionId` and returns the served item's id (from /next). */
async function openAnyRunner(
  page: Page,
  engine: "practice" | "review",
  sessionId: string,
): Promise<string> {
  const next = page.waitForResponse(
    (r) =>
      new RegExp(`/api/${engine}/sessions/[^/]+/next`).test(r.url()) && r.ok(),
  );
  await page.goto(`${BASE}/${engine}/session/${sessionId}`);
  const body = (await (await next).json()) as {
    sessionItemId?: string;
    question?: { sessionItemId?: string } | null;
  };
  await page.locator('[data-testid="runner-submit"]').waitFor();
  const id = body.question?.sessionItemId ?? body.sessionItemId;
  if (typeof id !== "string") throw new Error("no served item");
  return id;
}

/** Every choice (scrolled to), Submit and the footer stay clear of `cover`. */
async function expectRunnerClear(page: Page, cover: Locator): Promise<void> {
  const footer = page.locator('[data-testid="runner-footer"]');
  const submit = page.locator('[data-testid="runner-submit"]');
  expect(overlaps(await box(cover), await box(footer))).toBe(false);
  expect(overlaps(await box(cover), await box(submit))).toBe(false);
  const choices = page.locator('[data-testid="runner-choice"]');
  const n = await choices.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i += 1) {
    const choice = choices.nth(i);
    await choice.scrollIntoViewIfNeeded();
    expect(
      overlaps(await box(cover), await box(choice)),
      `choice ${i + 1} under the dock`,
    ).toBe(false);
  }
}

/** 2026-10-26: the review runner opens with LISA docked; this minimizes it to the launcher. */
async function minimizeDockedLisa(page: Page): Promise<void> {
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Minimize LISA" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator(BUBBLE)).toBeVisible();
}

// ── Where it appears ───────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  test(`${width}px: the bubble on Home and Review (paid and free), named "Ask LISA"`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 900 });
    for (const persona of ["paid", "free"] as const) {
      await asPersona(page, persona);
      for (const route of ["/dashboard", "/review"]) {
        await page.goto(`${BASE}${route}`);
        const bubble = page.locator(BUBBLE);
        await expect(bubble).toBeVisible();
        await expect(bubble).toHaveAttribute(
          "aria-label",
          persona === "paid"
            ? "Ask LISA"
            : "Ask LISA, included with a paid plan",
        );
        // Collapsed on every load: it never opens by itself.
        await expect(page.locator(PANEL)).toHaveCount(0);
        // Bottom-right of the middle column (owner brief 2026-10-23), not of the screen.
        const b = await box(bubble);
        const column = await box(page.locator("main#main"));
        expect(b.x + b.width).toBeGreaterThan(column.x + column.width - 40);
        expect(b.x + b.width).toBeLessThanOrEqual(column.x + column.width);
      }
    }
  });
}

test("390px (phone): no bubble on Home or Review; the LISA tab is still there", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asPersona(page, "paid");
  // Presence before absence: the PAGE (not just the shell, which draws first) must be on screen,
  // and settled, before "no bubble" means anything. Waiting on the tab bar alone passed with the
  // dock planted onto phones (the bubble mounts with the page, a beat after the shell).
  const pageContent: Record<string, string> = {
    "/dashboard": "main#main h1",
    "/review": '[data-testid="review"]',
  };
  for (const route of ["/dashboard", "/review"]) {
    await page.goto(`${BASE}${route}`);
    await expect(page.locator('[data-testid="tab-lisa"]')).toBeVisible();
    await expect(
      page.locator(pageContent[route] ?? "main").first(),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(BUBBLE)).toHaveCount(0);
  }
});

test("never: the live timed module, the LISA page, the practice runner, the signed-out homepage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  const live = MANIFEST.paid?.inProgressExamSessionId;
  expect(live, "the lisa-dock seed's live module").toBeTruthy();
  await page.goto(`${BASE}/tests/${String(live)}/RW/2`);
  await expect(
    page
      .locator('[data-testid="exam-module"] [data-testid="exam-choice"]')
      .first(),
  ).toBeVisible();
  await expect(page.locator(BUBBLE)).toHaveCount(0);

  await page.goto(`${BASE}/chat`);
  await expect(page.locator('[data-testid="lisa-page"]')).toBeVisible();
  await expect(page.locator(BUBBLE)).toHaveCount(0);

  const practice = MANIFEST.paid?.openPracticeSessionId;
  expect(practice).toBeTruthy();
  await page.goto(`${BASE}/practice/session/${String(practice)}`);
  await page.locator('[data-testid="runner-choice"]').first().waitFor();
  await expect(page.locator(BUBBLE)).toHaveCount(0);

  const anon = await page.context().browser()?.newContext();
  if (anon === undefined) throw new Error("no browser");
  const visitor = await anon.newPage();
  await answerCookieBanner(anon, BASE);
  await visitor.setViewportSize({ width: 1440, height: 900 });
  await visitor.goto(`${BASE}/`);
  await expect(visitor.locator("h1").first()).toBeVisible();
  await expect(visitor.locator(BUBBLE)).toHaveCount(0);
  await anon.close();
});

// ── The review runner ──────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  // 2026-10-26 (owner brief "restore the pre-#1300 runner layout"): LISA is the runner's docked
  // right column, open on entry in review; minimized, it is the launcher. Re-pointed from the
  // floating panel's "collapsed and open": the same guarantees (clear of Submit, the footer and
  // every choice; non-modal; Esc minimizes) on the docked column and on the launcher.
  test(`${width}px review runner: LISA docked open on entry as the right column, clear of Submit and every choice; Esc minimizes it to the launcher, which clears them too`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 900 });
    await asPersona(page, "paid");
    const sessionId = await freshReviewSession(request);
    try {
      await openRunner(page, sessionId);
      // The old side panel and its bar toggle are gone from 768px up.
      await expect(
        page.locator('[data-testid="scoped-tutor-panel"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid="practice-tutor-toggle"]'),
      ).toHaveCount(0);
      const bubble = page.locator(BUBBLE);
      const panel = page.locator(PANEL);
      const column = page.locator('[data-testid="runner-lisa-column"]');
      // Open on entry, docked: drawn inside the runner's right column, no launcher.
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-placement", "docked");
      expect(
        await column.evaluate(
          (el, p) => el.contains(document.querySelector(p)),
          PANEL,
        ),
      ).toBe(true);
      await expect(bubble).toHaveCount(0);
      await expect(panel).toHaveAttribute("role", "dialog");
      await expect(panel).toHaveAttribute("aria-modal", "false");
      // The right column: its right edge 12px in from the screen's, its top 12px below the bar.
      const p = await box(panel);
      expect(Math.round(width - (p.x + p.width))).toBe(12);
      await expectRunnerClear(page, panel);
      // Non-modal: a choice still takes a real click (actionability checks on) with it open.
      // (5s: a choice under the panel fails here, by name, not at the test's own timeout.)
      await page
        .locator('[data-testid="runner-choice"]')
        .first()
        .click({ timeout: 5_000 });
      await expect(page.locator('[data-testid="runner-submit"]')).toBeEnabled();
      await expect(panel).toBeVisible();
      // Esc minimizes: the column goes, the launcher comes, and it clears Submit and the choices.
      await panel.focus();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(column).toBeHidden();
      await expect(bubble).toBeVisible();
      await expect(bubble).toBeFocused();
      await expectRunnerClear(page, bubble);
    } finally {
      await endReviewSession(request, sessionId);
    }
  });
}

test("the dock opens scoped to the current question: the chip names it, and the first message creates the served item's conversation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  const sessionId = await freshReviewSession(request);
  try {
    const itemId = await openRunner(page, sessionId);
    // 2026-10-26: docked open on entry; no click needed.
    const panel = page.locator(PANEL);
    await expect(
      panel.locator('[data-testid="tutor-question-chip"]'),
    ).toHaveText(/^Question 1 of \d+$/);
    await expect(panel.locator('[data-testid="tutor-opener"]')).toBeVisible();
    const create = page.waitForRequest(
      (r) =>
        r.method() === "POST" && r.url().endsWith("/api/tutor/conversations"),
    );
    await panel
      .locator('textarea[aria-label="Message"]')
      .fill("Where do I start?");
    await panel.locator('button[aria-label="Send"]').click();
    const body = (await create).postDataJSON() as Record<string, unknown>;
    expect(body.entry_mode).toBe("scoped_question");
    expect(body.source_surface).toBe("review");
    expect(body.source_session_item_id).toBe(itemId);
  } finally {
    await endReviewSession(request, sessionId);
  }
});

// ── The lock and the cookie banner ─────────────────────────────────────────────────────────

test("free: the bubble's lock opens the upgrade modal, and no tutor request is made", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await asPersona(page, "free");
  const tutorCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/tutor"))
      tutorCalls.push(r.url());
  });
  await page.goto(`${BASE}/dashboard`);
  const bubble = page.locator(BUBBLE);
  await expect(bubble.locator('[data-testid="chat-dock-lock"]')).toBeVisible();
  await bubble.click();
  await expect(page.locator('[data-testid="upgrade-modal"]')).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(tutorCalls).toEqual([]);
});

for (const width of WIDTHS) {
  test(`${width}px with the cookie banner up: the bubble sits above it on Home, and above it and the footer in the runner`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 900 });
    await asPersona(page, "paid", { bannerAnswered: false });
    await page.goto(`${BASE}/dashboard`);
    const banner = page.locator('[data-testid="cookie-banner"]');
    const bubble = page.locator(BUBBLE);
    await expect(banner).toBeVisible();
    await expect(bubble).toBeVisible();
    expect(overlaps(await box(bubble), await box(banner))).toBe(false);
    if (width < 1024) {
      // Tablet: the tab bar is drawn too; the bubble clears it.
      const tabBar = page.locator('[data-testid="app-tab-bar"]');
      await expect(tabBar).toBeVisible();
      expect(overlaps(await box(bubble), await box(tabBar))).toBe(false);
    }

    const sessionId = await freshReviewSession(request);
    try {
      await openRunner(page, sessionId);
      // 2026-10-26: LISA is docked open on entry; minimized, it is the launcher checked here.
      await minimizeDockedLisa(page);
      await expect(banner).toBeVisible();
      expect(overlaps(await box(bubble), await box(banner))).toBe(false);
      expect(
        overlaps(
          await box(bubble),
          await box(page.locator('[data-testid="runner-footer"]')),
        ),
      ).toBe(false);
    } finally {
      await endReviewSession(request, sessionId);
    }
  });
}

// ── #1300 follow-ups (owner rulings, Karl, 2026-10-23) ──────────────────────────────────────

// Ruling 2: practice gets the dock POST-SUBMIT only.
test("practice runner (1440): no bubble before submit; after submit the bubble, clear of Next, opening scoped to the answered item", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  const sessionId = await freshSession(request, "practice", ["RW"]);
  try {
    const itemId = await openAnyRunner(page, "practice", sessionId);
    // Presence before absence: the question is served and settled, unanswered.
    await expect(
      page.locator('[data-testid="runner-choice"]').first(),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(BUBBLE)).toHaveCount(0);

    await page.locator('[data-testid="runner-choice"]').first().click();
    await page.locator('[data-testid="runner-submit"]').click();
    const nextButton = page.locator('[data-testid="runner-next"]');
    await expect(nextButton).toBeVisible();
    const bubble = page.locator(BUBBLE);
    await expect(bubble).toBeVisible();
    expect(overlaps(await box(bubble), await box(nextButton))).toBe(false);
    expect(
      overlaps(
        await box(bubble),
        await box(page.locator('[data-testid="runner-footer"]')),
      ),
    ).toBe(false);

    await bubble.click();
    const panel = page.locator(PANEL);
    // 2026-10-26: opened in a runner, it docks as the right column.
    await expect(panel).toHaveAttribute("data-placement", "docked");
    await expect(
      page.locator('[data-testid="runner-lisa-column"]'),
    ).toHaveAttribute("data-open", "true");
    await expect(
      panel.locator('[data-testid="tutor-question-chip"]'),
    ).toHaveText(/^Question 1 of \d+$/);
    // Ruling 4: Send is the outline paper-plane icon button named "Send".
    await expect(panel.getByRole("button", { name: "Send" })).toBeVisible();
    const create = page.waitForRequest(
      (r) =>
        r.method() === "POST" && r.url().endsWith("/api/tutor/conversations"),
    );
    await panel
      .locator('textarea[aria-label="Message"]')
      .fill("Why is this one right?");
    await panel.getByRole("button", { name: "Send" }).click();
    const body = (await create).postDataJSON() as Record<string, unknown>;
    expect(body.entry_mode).toBe("scoped_question");
    expect(body.source_surface).toBe("practice");
    expect(body.source_session_item_id).toBe(itemId);
  } finally {
    await endSession(request, "practice", sessionId);
  }
});

// Ruling 5: the bubble never covers the calculator, at the stacked width (1024), the split
// breakpoint (1062) and desktop (1440).
for (const width of [1024, 1062, 1440] as const) {
  test(`${width}px Math review runner with the calculator open and LISA minimized: the launcher clears the calculator, Submit and the footer`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 800 });
    await asPersona(page, "paid");
    const sessionId = await freshSession(request, "review", ["M"]);
    try {
      await openAnyRunner(page, "review", sessionId);
      // 2026-10-26: LISA starts docked; ruling 5 is about the launcher, so minimize it first
      // (the docked column beside the calculator is the test below this one).
      await minimizeDockedLisa(page);
      await page.locator('[data-testid="practice-calculator-toggle"]').click();
      // The calculator itself (the Desmos shell, modes bar included), inside whichever layout
      // holds it: beside the question from the split breakpoint, stacked under it below.
      const holder =
        width >= 1062
          ? page.locator('[data-testid="side-panel-calculator"]')
          : page.locator('[data-testid="stacked-calculator-container"]');
      await expect(holder).toBeVisible();
      const calculator = holder.locator(
        '[data-testid="desmos-calculator-shell"]',
      );
      // Presence first: the calculator is open, the bubble drawn.
      await expect(calculator).toBeVisible();
      const bubble = page.locator(BUBBLE);
      await expect(bubble).toBeVisible();
      await calculator.scrollIntoViewIfNeeded();
      // Let the side panel take the bubble's footprint (measured after the bubble reports).
      await page.waitForTimeout(300);
      expect(
        overlaps(await box(bubble), await box(calculator)),
        `bubble ${JSON.stringify(await box(bubble))} over calculator ${JSON.stringify(await box(calculator))}`,
      ).toBe(false);
      expect(
        overlaps(
          await box(bubble),
          await box(page.locator('[data-testid="runner-submit"]')),
        ),
      ).toBe(false);
      expect(
        overlaps(
          await box(bubble),
          await box(page.locator('[data-testid="runner-footer"]')),
        ),
      ).toBe(false);
    } finally {
      await endSession(request, "review", sessionId);
    }
  });
}

// ── The launcher (owner brief "LISA launcher redesign + placement", Karl, 2026-10-23) ──────────

/** `inner` lies wholly inside `outer`. */
function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The launcher in the middle column, clear of the rail and the right panel, in view. */
async function expectInMiddleColumn(
  page: Page,
  what: Locator,
  label: string,
): Promise<void> {
  const b = await box(what);
  const column = await box(page.locator("main#main"));
  const rail = await box(page.locator('[data-testid="app-shell-header"]'));
  const panel = await box(page.locator('[data-testid="app-shell-panel"]'));
  expect(
    within(b, column),
    `${label} ${JSON.stringify(b)} inside the column ${JSON.stringify(column)}`,
  ).toBe(true);
  expect(overlaps(b, rail), `${label} over the rail`).toBe(false);
  expect(
    overlaps(b, panel),
    `${label} ${JSON.stringify(b)} over the right panel ${JSON.stringify(panel)}`,
  ).toBe(false);
  // In view: from lg the column IS the viewport's height, so "inside the column" above already
  // says it (a separate in-view check could never fail on its own here, so there is none).
}

for (const width of [1024, 1440] as const) {
  for (const route of ["/dashboard", "/review"] as const) {
    test(`${width}px ${route}: the launcher and its open panel stay in the middle column, clear of the rail and the right panel, while the column scrolls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 900 });
      await asPersona(page, "paid");
      await page.goto(`${BASE}${route}`);
      const launcher = page.locator(BUBBLE);
      // Presence first: the shell's three columns and the launcher are drawn.
      await expect(launcher).toBeVisible();
      await expect(
        page.locator('[data-testid="app-shell-panel"]'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="app-rail"]')).toBeVisible();
      await expectInMiddleColumn(page, launcher, "launcher");
      // The column scrolls; the launcher stays in it and in view.
      await page
        .locator("main#main")
        .evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await page.waitForTimeout(100);
      await expectInMiddleColumn(page, launcher, "launcher after scrolling");
      await launcher.click();
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible();
      await expectInMiddleColumn(page, panel, "open panel");
      const column = await box(page.locator("main#main"));
      // min(380px, column width - 24px).
      expect(Math.round((await box(panel)).width)).toBe(
        Math.round(Math.min(380, column.width - 24)),
      );
    });
  }
}

test("the launcher's shape: a 40px speech bubble (14px corners, the bottom-right 4px), the sparkle, 'Ask LISA', the accent fill; the free variant the same with the lock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const persona of ["paid", "free"] as const) {
    await asPersona(page, persona);
    await page.goto(`${BASE}/dashboard`);
    const launcher = page.locator(BUBBLE);
    await expect(launcher).toBeVisible();
    const style = await launcher.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        tl: cs.borderTopLeftRadius,
        tr: cs.borderTopRightRadius,
        bl: cs.borderBottomLeftRadius,
        br: cs.borderBottomRightRadius,
        height: el.getBoundingClientRect().height,
        bg: cs.backgroundColor,
        color: cs.color,
      };
    });
    expect(style).toMatchObject({
      tl: "14px",
      tr: "14px",
      bl: "14px",
      br: "4px",
      height: 40,
    });
    // The accent and its on-accent ink, from the tokens.
    const tokens = await page
      .locator(".lyc")
      .first()
      .evaluate((el) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--primary-bg)";
        probe.style.color = "var(--primary-ink)";
        el.appendChild(probe);
        const cs = getComputedStyle(probe);
        const out = { bg: cs.backgroundColor, color: cs.color };
        probe.remove();
        return out;
      });
    expect(style.bg).toBe(tokens.bg);
    expect(style.color).toBe(tokens.color);
    await expect(launcher).toHaveText("Ask LISA");
    if (persona === "paid") {
      await expect(launcher).toHaveAccessibleName("Ask LISA");
      await expect(
        launcher.locator('[data-testid="lisa-sparkle"]'),
      ).toBeVisible();
      await expect(
        launcher.locator('[data-testid="chat-dock-lock"]'),
      ).toHaveCount(0);
    } else {
      await expect(launcher).toHaveAccessibleName(
        "Ask LISA, included with a paid plan",
      );
      await expect(
        launcher.locator('[data-testid="chat-dock-lock"]'),
      ).toBeVisible();
      await expect(
        launcher.locator('[data-testid="lisa-sparkle"]'),
      ).toHaveCount(0);
    }
    // A visible focus ring.
    await launcher.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(launcher).toBeFocused();
    // The student focus ring (DESIGN.md §1): 3px solid --focus.
    const ring = await launcher.evaluate((el) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("div");
      probe.style.color = "var(--focus)";
      el.parentElement?.appendChild(probe);
      const focus = getComputedStyle(probe).color;
      probe.remove();
      return {
        style: cs.outlineStyle,
        width: cs.outlineWidth,
        color: cs.outlineColor,
        focus,
      };
    });
    expect(ring).toEqual({
      style: "solid",
      width: "3px",
      color: ring.focus,
      focus: ring.focus,
    });
  }
});

/** Ends every active LISA-page conversation of the paid student; returns how many it ended. */
async function endActiveStandalone(api: APIRequestContext): Promise<number> {
  const headers = {
    [PERSONA_HEADER]: "paid",
    "content-type": "application/json",
  };
  const res = await api.get(
    `${BASE}/api/tutor/conversations?surface=standalone&status=active&limit=100`,
    { headers },
  );
  expect(res.status(), await res.text()).toBe(200);
  const json = (await res.json()) as {
    data?: { conversations?: Array<{ conversation_id?: unknown }> };
  };
  const ids = (json.data?.conversations ?? [])
    .map((c) => c.conversation_id)
    .filter((id): id is string => typeof id === "string");
  for (const id of ids) {
    const end = await api.post(`${BASE}/api/tutor/conversations/${id}/end`, {
      headers,
      data: {},
    });
    expect(end.status(), await end.text()).toBeLessThan(400);
  }
  return ids.length;
}

test("opening lines: Home 'What do you want to work on?', Review 'Want help with your past mistakes?', the review runner before submit unchanged", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  // The seed's paid student has active LISA-page conversations (the history), and general mode
  // opens the latest; the opening line shows on a fresh one. End them first, through the real
  // route (presence first: there were some to end).
  expect(await endActiveStandalone(request)).toBeGreaterThan(0);
  const lines: Record<string, string> = {
    "/dashboard": "What do you want to work on?",
    "/review": "Want help with your past mistakes?",
  };
  for (const [route, line] of Object.entries(lines)) {
    await page.goto(`${BASE}${route}`);
    await page.locator(BUBBLE).click();
    await expect(
      page.locator(`${PANEL} [data-testid="tutor-opener"]`),
    ).toContainText(line);
  }
  const sessionId = await freshReviewSession(request);
  try {
    await openRunner(page, sessionId);
    // 2026-10-26: docked open on entry.
    const opener = page.locator(`${PANEL} [data-testid="tutor-opener"]`);
    await expect(opener).toContainText("Need help with this question?");
    await expect(opener).toContainText(
      "I can walk you through it. I won't give you the answer before you submit.",
    );
    // Before submit: no "Still confused?" link either.
    await expect(page.locator('[data-testid="runner-ask-lisa"]')).toHaveCount(
      0,
    );
  } finally {
    await endReviewSession(request, sessionId);
  }
});

/**
 * Answers the current item with its first choice and returns whether the server marked it
 * correct (its own answer response; nothing inferred).
 */
async function answerFirstChoice(
  page: Page,
  engine: "practice" | "review",
): Promise<boolean> {
  const answer = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/api/${engine}/answer`),
  );
  await page.locator('[data-testid="runner-choice"]').first().click();
  await page.locator('[data-testid="runner-submit"]').click();
  const body = (await (await answer).json()) as { isCorrect?: unknown };
  await expect(page.locator('[data-testid="runner-feedback"]')).toBeVisible();
  return body.isCorrect === true;
}

for (const engine of ["practice", "review"] as const) {
  test(`${engine} runner (1440): 'Still confused? Ask LISA' only after a wrong answer; it opens the panel scoped to that item, with the after-submit line`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await asPersona(page, "paid");
    const sessionId = await freshSession(request, engine, ["RW"]);
    const link = page.locator('[data-testid="runner-ask-lisa"]');
    try {
      let itemId = await openAnyRunner(page, engine, sessionId);
      // 2026-10-26: review starts with LISA docked; minimized, the link must RESTORE the column.
      if (engine === "review") await minimizeDockedLisa(page);
      // Before submit: the question is served, and there is no link.
      await expect(page.locator('[data-testid="runner-submit"]')).toBeVisible();
      await expect(link).toHaveCount(0);
      for (let i = 0; i < 5; i += 1) {
        const correct = await answerFirstChoice(page, engine);
        if (!correct) break;
        // After a correct answer: the result is on screen, and there is no link.
        await expect(page.locator('[data-testid="runner-next"]')).toBeVisible();
        await expect(link).toHaveCount(0);
        const next = page.waitForResponse(
          (r) =>
            new RegExp(`/api/${engine}/sessions/[^/]+/next`).test(r.url()) &&
            r.ok(),
        );
        await page.locator('[data-testid="runner-next"]').click();
        const body = (await (await next).json()) as {
          sessionItemId?: string;
          question?: { sessionItemId?: string } | null;
        };
        const id = body.question?.sessionItemId ?? body.sessionItemId;
        if (typeof id !== "string") throw new Error("no served item");
        itemId = id;
        await expect(
          page.locator('[data-testid="runner-submit"]'),
        ).toBeVisible();
      }
      // A wrong answer: the link, under the explanation, muted.
      await expect(link).toBeVisible();
      await expect(link).toHaveText("Still confused? Ask LISA");
      const explanation = await box(
        page.locator('[data-testid="runner-explanation"]'),
      );
      expect((await box(link)).y).toBeGreaterThan(
        explanation.y + explanation.height - 1,
      );
      await link.click();
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible();
      // 2026-10-26: the link opens (review: restores) LISA's docked column.
      await expect(panel).toHaveAttribute("data-placement", "docked");
      await expect(panel.locator('[data-testid="tutor-opener"]')).toContainText(
        "Want to walk through this one? Ask me about any step.",
      );
      await expect(
        panel.locator('[data-testid="tutor-opener"]'),
      ).not.toContainText("I won't give you the answer before you submit.");
      const create = page.waitForRequest(
        (r) =>
          r.method() === "POST" && r.url().endsWith("/api/tutor/conversations"),
      );
      await panel
        .locator('textarea[aria-label="Message"]')
        .fill("Why not my answer?");
      await panel.getByRole("button", { name: "Send" }).click();
      const sent = (await create).postDataJSON() as Record<string, unknown>;
      expect(sent.entry_mode).toBe("scoped_question");
      expect(sent.source_surface).toBe(engine);
      expect(sent.source_session_item_id).toBe(itemId);
    } finally {
      await endSession(request, engine, sessionId);
    }
  });
}

// ── The docked runner (owner brief "restore the pre-#1300 runner layout", Karl, 2026-10-26) ───

// Owner ruling on #1322 (Karl, 2026-10-26): from 1338px LISA's panel is 360px; from W3
// (1278px) to 1337px it is 300px, the three columns still side by side (1280x650 here).
for (const [width, height] of [
  [1280, 650],
  [1366, 650],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`${width}x${height} Math review runner, calculator and LISA both open: the calculator sits between the question and LISA, its right edge LISA's left edge, nothing overlapping`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await asPersona(page, "paid");
    const sessionId = await freshSession(request, "review", ["M"]);
    try {
      await openAnyRunner(page, "review", sessionId);
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible();
      await page.locator('[data-testid="practice-calculator-toggle"]').click();
      const calculator = page.locator(
        '[data-testid="side-panel-calculator"] [data-testid="desmos-calculator-shell"]',
      );
      // Presence first: the calculator is open beside the question, LISA docked.
      await expect(calculator).toBeVisible();
      await expect(panel).toBeVisible();
      await page.waitForTimeout(200);
      const calc = await box(calculator);
      const lisa = await box(panel);
      const question = await box(page.locator('[data-testid="runner-body"]'));
      // LISA's width for the tier: 300px below 1338, 360px from it.
      expect(Math.round(lisa.width), "LISA's width").toBe(
        width < 1338 ? 300 : 360,
      );
      // The question's panel meets the calculator at the resize handle (1px): one gutter.
      const questionPanel = await box(
        page.locator('[data-testid="practice-question-panel"]'),
      );
      expect(
        Math.abs(questionPanel.x + questionPanel.width - calc.x),
        `question panel ${JSON.stringify(questionPanel)} | calculator ${JSON.stringify(calc)}`,
      ).toBeLessThanOrEqual(2);
      // One shared boundary: the calculator's right edge is LISA's left edge (±1px).
      expect(
        Math.abs(calc.x + calc.width - lisa.x),
        `calculator ${JSON.stringify(calc)} | LISA ${JSON.stringify(lisa)}`,
      ).toBeLessThanOrEqual(1);
      // Nothing behind or over anything else (1px of the shared edge allowed).
      const shrink = (b: Box): Box => ({
        x: b.x + 1,
        y: b.y + 1,
        width: b.width - 2,
        height: b.height - 2,
      });
      expect(overlaps(shrink(calc), shrink(lisa)), "calculator over LISA").toBe(
        false,
      );
      expect(
        overlaps(shrink(question), shrink(calc)),
        `question ${JSON.stringify(question)} over the calculator`,
      ).toBe(false);
      expect(
        overlaps(shrink(question), shrink(lisa)),
        "question over LISA",
      ).toBe(false);
      // Submit is on screen, clear of LISA. (The choices sit inside the question's box, so the
      // two checks above already cover them; the Chromebook sizes are a report, not a gate.)
      const submit = page.locator('[data-testid="runner-submit"]');
      await expect(submit).toBeVisible();
      expect(overlaps(await box(submit), lisa), "Submit under LISA").toBe(
        false,
      );
    } finally {
      await endSession(request, "review", sessionId);
    }
  });
}

test("review runner (1440): LISA docked open on entry; minimized, it stays minimized across questions; reopened, it stays open", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  const sessionId = await freshReviewSession(request);
  const column = page.locator('[data-testid="runner-lisa-column"]');
  const panel = page.locator(PANEL);
  const nextItem = async (): Promise<void> => {
    await page.locator('[data-testid="runner-choice"]').first().click();
    await page.locator('[data-testid="runner-submit"]').click();
    await page.locator('[data-testid="runner-next"]').click();
    await expect(page.locator('[data-testid="runner-submit"]')).toBeVisible();
  };
  try {
    await openRunner(page, sessionId);
    await expect(column).toHaveAttribute("data-open", "true");
    await expect(panel).toBeVisible();
    await minimizeDockedLisa(page);
    await expect(column).toHaveAttribute("data-open", "false");
    await nextItem();
    // Question 2: still minimized.
    await expect(panel).toBeHidden();
    await expect(column).toHaveAttribute("data-open", "false");
    await expect(page.locator(BUBBLE)).toBeVisible();
    await page.locator(BUBBLE).click();
    await expect(column).toHaveAttribute("data-open", "true");
    await nextItem();
    // Question 3: still open, on the new question.
    await expect(column).toHaveAttribute("data-open", "true");
    await expect(
      panel.locator('[data-testid="tutor-question-chip"]'),
    ).toHaveText(/^Question 3 of \d+$/);
  } finally {
    await endReviewSession(request, sessionId);
  }
});

test("review runner (1440): Enter in LISA's input sends exactly once and never submits the answer; Shift+Enter adds a new line", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asPersona(page, "paid");
  const sessionId = await freshReviewSession(request);
  const sends: string[] = [];
  const answers: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const path = new URL(r.url()).pathname;
    if (path === "/api/tutor/messages") sends.push(path);
    if (path === "/api/review/answer") answers.push(path);
  });
  try {
    await openRunner(page, sessionId);
    // An answer picked, so Submit is live: an Enter that leaked would submit it.
    await page.locator('[data-testid="runner-choice"]').first().click();
    const submit = page.locator('[data-testid="runner-submit"]');
    await expect(submit).toBeEnabled();
    const input = page.locator(`${PANEL} textarea[aria-label="Message"]`);
    // Shift+Enter: a new line, nothing sent.
    await input.click();
    await input.pressSequentially("first");
    await page.keyboard.press("Shift+Enter");
    await input.pressSequentially("second");
    await expect(input).toHaveValue("first\nsecond");
    expect(sends).toEqual([]);
    // Enter: sent once.
    const sent = page.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        new URL(r.url()).pathname === "/api/tutor/messages",
    );
    await page.keyboard.press("Enter");
    await sent;
    await page.waitForTimeout(500);
    expect(sends).toEqual(["/api/tutor/messages"]);
    // ...and the answer was never submitted: no answer request, the item still unanswered.
    expect(answers).toEqual([]);
    await expect(submit).toBeVisible();
    await expect(page.locator('[data-testid="runner-feedback"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="runner-next"]')).toHaveCount(0);
  } finally {
    await endReviewSession(request, sessionId);
  }
});

// Owner ruling on #1322 (Karl, 2026-10-26): below W3 (1278px) the calculator and the docked LISA
// column take turns: opening the calculator minimizes LISA to the launcher, reopening LISA closes
// the calculator, the last one opened winning. No overlap at any step.
for (const [width, height] of [
  [1277, 650],
  [1024, 768],
] as const) {
  test(`${width}x${height} (below W3) Math review runner: the calculator and LISA take turns, twice, never overlapping`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await asPersona(page, "paid");
    const sessionId = await freshSession(request, "review", ["M"]);
    const panel = page.locator(PANEL);
    const launcher = page.locator(BUBBLE);
    const toggle = page.locator('[data-testid="practice-calculator-toggle"]');
    const shell = page.locator(
      '[data-testid="desmos-calculator-shell"]:visible',
    );
    const submit = page.locator('[data-testid="runner-submit"]');
    try {
      await openAnyRunner(page, "review", sessionId);
      // Presence first: LISA docked open, the calculator closed.
      await expect(panel).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      for (let round = 1; round <= 2; round += 1) {
        // The calculator opened: LISA yields to its launcher.
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(panel, `round ${round}: LISA yields`).toBeHidden();
        await expect(launcher).toBeVisible();
        await expect(shell.first()).toBeVisible();
        await shell.first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        expect(
          overlaps(await box(launcher), await box(shell.first())),
          `round ${round}: the launcher over the calculator`,
        ).toBe(false);
        expect(overlaps(await box(launcher), await box(submit))).toBe(false);
        // LISA reopened from its launcher: the calculator closes.
        await launcher.click();
        await expect(panel, `round ${round}: LISA back`).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(shell).toHaveCount(0);
        expect(overlaps(await box(panel), await box(submit))).toBe(false);
      }
    } finally {
      await endSession(request, "review", sessionId);
    }
  });
}

// Owner ruling on #1322 (Karl, 2026-10-26): LISA's header chip never truncates. The 300px column
// reads the compact "N of M"; the 360px column and the phone panel keep "Question N of M".
for (const [width, height, expected] of [
  [1280, 650, /^1 of \d+$/],
  [1338, 800, /^Question 1 of \d+$/],
  [1440, 900, /^Question 1 of \d+$/],
  [390, 844, /^Question 1 of \d+$/],
] as const) {
  test(`${width}x${height}: LISA's question chip reads ${String(expected)} and is not truncated`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await asPersona(page, "paid");
    const sessionId = await freshReviewSession(request);
    try {
      await openRunner(page, sessionId);
      // The phone keeps its stacked panel, opened from the bar's LISA toggle.
      if (width < 768)
        await page.locator('[data-testid="practice-tutor-toggle"]').click();
      const chip = page.locator('[data-testid="tutor-question-chip"]:visible');
      await expect(chip).toBeVisible();
      await expect(chip).toHaveText(expected);
      const fit = await chip.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(
        fit.scroll,
        `the chip's text overflows its box (${fit.scroll} > ${fit.client})`,
      ).toBeLessThanOrEqual(fit.client);
    } finally {
      await endReviewSession(request, sessionId);
    }
  });
}

// ── The video player (owner brief "Video player: near-fullscreen", Karl 2026-10-27) ──────────
//
// @spec [owner brief "Video player: near-fullscreen" (Karl, 2026-10-27): "the modal takes most of
//        the viewport, about 90–95% of the width and height on desktop, holding the 16:9 frame.
//        On phones it goes full screen"; "Header: one line"; shrink and expand; "Escape closes,
//        focus moves into the dialog and returns to the button that opened it"; tests: "the size
//        and one-line header at desktop, tablet and phone widths in the existing Playwright
//        student harness; shrink and expand; focus returning on close"] | @implemented [2026-10-27]
//
// plain English: the real card and player, on the LISA page and in the review runner's docked
// LISA. The harness never runs a tutor turn, so the one hop the spec stands in for is the send's
// answer: its `suggested_action` is the BFF's own, built by `resolveVideoAction` from the
// reviewed library row of Desmos Lesson #10 (student-harness/video-offer.ts). The embed is
// answered by a blank page (no network to YouTube in CI) and every request for it is counted,
// so "shrink and expand never reload the lesson" is a count, not a guess.

type VideoAction = {
  type: "recommend_video";
  label: string | null;
  video: {
    video_id: string;
    title: string;
    channel_name: string;
    duration_seconds: number;
    start_seconds: number | null;
  };
};
const VIDEO_ACTION = JSON.parse(
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--import",
      "./tests/e2e/student-harness/register.mjs",
      "tests/e2e/student-harness/video-offer.ts",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .pop() ?? "{}",
) as VideoAction;

const PLAYER = '[data-testid="tutor-video-modal"]';
const PLAYER_SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
] as const;
const VIDEO_SHOTS = process.env.E2E_SHOT_DIR ?? "test-results/tutor-video";

/** Answers the embed with a blank page and the send with the video offer; counts embed loads. */
async function serveVideoOffer(page: Page): Promise<{ embedLoads: string[] }> {
  const embedLoads: string[] = [];
  await page.route("https://www.youtube-nocookie.com/**", async (route) => {
    embedLoads.push(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>embed</title><body style='margin:0;background:#000'>",
    });
  });
  await page.route(`${BASE}/api/tutor/messages`, async (route) => {
    const sent = route.request().postDataJSON() as {
      conversation_id: string;
      client_turn_id: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // The route's Step 19 body (server/routes/tutor-runtime.ts), envelope included: every
      // tutor route answers `{ data }`, and the client reads `payload.data`.
      body: JSON.stringify({
        data: {
          conversation_id: sent.conversation_id,
          message_id: "harness-video-turn",
          client_turn_id: sent.client_turn_id,
          response: {
            content:
              "This Desmos lesson works an Equivalent Expressions question.",
            content_kind: "message",
            suggested_action: VIDEO_ACTION,
            ui_hints: {
              show_accept_decline: false,
              allow_freeform_reply: true,
              suggested_chip: null,
            },
          },
          conversation_updated_at: new Date().toISOString(),
        },
      }),
    });
  });
  return { embedLoads };
}

/** Sends one message in `scope` and opens the offered video; returns the Watch button. */
async function watchOfferedVideo(scope: Locator): Promise<Locator> {
  await scope
    .locator('textarea[aria-label="Message"]')
    .fill("is there a Desmos video for this?");
  await scope.getByRole("button", { name: "Send" }).click();
  const card = scope.locator('[data-testid="tutor-video-card"]');
  await expect(card).toBeVisible();
  const watch = card.locator('[data-testid="tutor-video-watch"]');
  await watch.click();
  return watch;
}

async function focusIsInPlayer(page: Page): Promise<boolean> {
  return page.evaluate(
    (sel) =>
      document.querySelector(sel)?.contains(document.activeElement) ?? false,
    PLAYER,
  );
}

/** The expanded player's box against the viewport, for its size assertions. */
async function expectExpanded(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const player = page.locator(PLAYER);
  await expect(player).toHaveAttribute("data-size", "expanded");
  await expect(player).toHaveAttribute("aria-modal", "true");
  const b = await box(player);
  const frame = await box(page.locator('[data-testid="tutor-video-frame"]'));
  // 16:9 frame, always.
  expect(Math.abs(frame.height - (frame.width * 9) / 16)).toBeLessThanOrEqual(
    1.5,
  );
  if (width < 768) {
    // Phones: the whole screen, the frame across it.
    expect(b).toEqual({ x: 0, y: 0, width, height });
    expect(Math.abs(frame.width - width)).toBeLessThanOrEqual(1);
    return;
  }
  // 768px and up: centred; the binding side at 90–95% of the viewport, neither side above 95%.
  const shareW = b.width / width;
  const shareH = b.height / height;
  expect(Math.max(shareW, shareH)).toBeGreaterThanOrEqual(0.9);
  expect(shareW).toBeLessThanOrEqual(0.951);
  expect(shareH).toBeLessThanOrEqual(0.951);
  expect(Math.abs(b.x + b.width / 2 - width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.y + b.height / 2 - height / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.width - b.width)).toBeLessThanOrEqual(2.5);
}

/** One header line: 48px; the title on one line with an ellipsis; channel and controls in it. */
async function expectOneLineHeader(page: Page, width: number): Promise<void> {
  const header = page.locator('[data-testid="tutor-video-header"]');
  const h = await box(header);
  expect(Math.round(h.height)).toBe(48);
  const title = page.locator('[data-testid="tutor-video-modal-title"]');
  await expect(title).toHaveText(VIDEO_ACTION.video.title);
  const fit = await title.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      whiteSpace: css.whiteSpace,
      textOverflow: css.textOverflow,
      lineHeight: parseFloat(css.lineHeight),
      height: el.getBoundingClientRect().height,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    };
  });
  expect(fit.whiteSpace).toBe("nowrap");
  expect(fit.textOverflow).toBe("ellipsis");
  expect(fit.height).toBeLessThanOrEqual(fit.lineHeight + 1);
  // The proof title is long: below desktop it does not fit, and the ellipsis is what shows.
  if (width < 1024) expect(fit.scroll).toBeGreaterThan(fit.client);
  for (const id of [
    "tutor-video-modal-channel",
    "tutor-video-size",
    "tutor-video-close",
  ]) {
    const b = await box(page.locator(`[data-testid="${id}"]`));
    expect(b.y, `${id} in the header`).toBeGreaterThanOrEqual(h.y - 0.5);
    expect(b.y + b.height, `${id} in the header`).toBeLessThanOrEqual(
      h.y + h.height + 0.5,
    );
  }
  await expect(
    page.locator('[data-testid="tutor-video-modal-channel"]'),
  ).toHaveText(VIDEO_ACTION.video.channel_name);
  await expect(
    page.locator('[data-testid="tutor-video-size"]'),
  ).toHaveAccessibleName("Shrink video");
}

for (const size of PLAYER_SIZES) {
  test(`video player, ${size.name} ${size.width}x${size.height}: near-fullscreen 16:9, one-line header, focus in and back`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await asPersona(page, "paid");
    const { embedLoads } = await serveVideoOffer(page);
    await page.goto(`${BASE}/chat`);
    const lisaPage = page.locator('[data-testid="lisa-page"]');
    await expect(lisaPage).toBeVisible();
    const watch = await watchOfferedVideo(lisaPage);

    await expect(page.locator(PLAYER)).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: VIDEO_ACTION.video.title }),
    ).toBeVisible();
    await expect.poll(() => focusIsInPlayer(page)).toBe(true);
    await expectExpanded(page, size.width, size.height);
    await expectOneLineHeader(page, size.width);
    // The embed is unchanged: this video, nocookie, rel=0, no start.
    await expect(
      page.locator('[data-testid="tutor-video-embed"]'),
    ).toHaveAttribute(
      "src",
      `https://www.youtube-nocookie.com/embed/${VIDEO_ACTION.video.video_id}?rel=0`,
    );
    expect(embedLoads).toHaveLength(1);
    await page.screenshot({
      path: `${VIDEO_SHOTS}/expanded-${size.width}x${size.height}.png`,
    });

    if (size.width >= 768) {
      // Hover shows the whole title.
      await page.locator('[data-testid="tutor-video-modal-title"]').hover();
      await expect(
        page.locator('[data-testid="tutor-video-full-title"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="tutor-video-full-title"]'),
      ).toHaveText(VIDEO_ACTION.video.title);
    }

    // Escape closes; focus is back on Watch.
    await page.keyboard.press("Escape");
    await expect(page.locator(PLAYER)).toHaveCount(0);
    await expect(watch).toBeFocused();
  });
}

test("video player, phone: a long-press on the title shows it whole", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asPersona(page, "paid");
  await serveVideoOffer(page);
  await page.goto(`${BASE}/chat`);
  await watchOfferedVideo(page.locator('[data-testid="lisa-page"]'));
  const title = page.locator('[data-testid="tutor-video-modal-title"]');
  const full = page.locator('[data-testid="tutor-video-full-title"]');
  await expect(full).toBeHidden();
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    isPrimary: true,
  });
  await expect(full).toBeVisible();
  await expect(full).toHaveText(VIDEO_ACTION.video.title);
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    isPrimary: true,
  });
  await expect(full).toBeVisible();
  await page
    .locator('[data-testid="tutor-video-header"]')
    .dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await expect(full).toBeHidden();
});

test("video player, 1440: shrink and expand restyle the same frame; the page is usable while shrunk; Close returns focus", async ({
  page,
}) => {
  const width = 1440;
  const height = 900;
  await page.setViewportSize({ width, height });
  await asPersona(page, "paid");
  const { embedLoads } = await serveVideoOffer(page);
  await page.goto(`${BASE}/chat`);
  const lisaPage = page.locator('[data-testid="lisa-page"]');
  const watch = await watchOfferedVideo(lisaPage);
  const player = page.locator(PLAYER);
  await expectExpanded(page, width, height);
  // A mark on the frame element: a remount would draw a new element without it.
  await page
    .locator('[data-testid="tutor-video-embed"]')
    .evaluate((el) => el.setAttribute("data-harness-mark", "kept"));

  const toggle = page.locator('[data-testid="tutor-video-size"]');
  await toggle.click();
  await expect(player).toHaveAttribute("data-size", "shrunk");
  await expect(player).toHaveAttribute("aria-modal", "false");
  await expect(toggle).toHaveAccessibleName("Expand video");
  await expect(toggle).toBeFocused();
  const mini = await box(player);
  expect(Math.round(mini.width)).toBe(360);
  // Bottom-right, an edge in.
  expect(Math.round(width - (mini.x + mini.width))).toBe(16);
  expect(height - (mini.y + mini.height)).toBeGreaterThanOrEqual(16);
  const frame = await box(page.locator('[data-testid="tutor-video-frame"]'));
  expect(Math.abs(frame.height - (frame.width * 9) / 16)).toBeLessThanOrEqual(
    1.5,
  );
  await page.screenshot({
    path: `${VIDEO_SHOTS}/shrunk-${width}x${height}.png`,
  });

  // The page is the student's: typing to LISA works, and the player keeps playing.
  const composer = lisaPage.locator('textarea[aria-label="Message"]');
  await composer.click();
  await composer.fill("thanks");
  await expect(composer).toHaveValue("thanks");
  await page.keyboard.press("Escape");
  await expect(player).toHaveAttribute("data-size", "shrunk");

  await toggle.click();
  await expectExpanded(page, width, height);
  await expect(toggle).toHaveAccessibleName("Shrink video");
  await expect(
    page.locator('[data-testid="tutor-video-embed"]'),
  ).toHaveAttribute("data-harness-mark", "kept");
  // One load for the whole open: shrinking and expanding never reloaded the lesson.
  expect(embedLoads).toHaveLength(1);

  // Shrunk, Close is one press, and focus is back on Watch.
  await toggle.click();
  await page.locator('[data-testid="tutor-video-close"]').click();
  await expect(player).toHaveCount(0);
  await expect(watch).toBeFocused();
  // Every open starts expanded.
  await watch.click();
  await expectExpanded(page, width, height);
  await page.locator('[data-testid="tutor-video-close"]').click();
  await expect(watch).toBeFocused();
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`video player, review runner ${width}x${height}: shrunk over LISA's column, clear of the question, its choices and Submit/Next`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await asPersona(page, "paid");
    await serveVideoOffer(page);
    const sessionId = await freshReviewSession(request);
    try {
      await openRunner(page, sessionId);
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible();
      await watchOfferedVideo(panel);
      await expectExpanded(page, width, height);
      await page.locator('[data-testid="tutor-video-size"]').click();
      const player = page.locator(PLAYER);
      await expect(player).toHaveAttribute("data-size", "shrunk");
      // Inside LISA's docked column, at its width (372px from 1338px up, 312px below).
      const column = await box(panel);
      const mini = await box(player);
      expect(Math.abs(mini.x - column.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mini.width - column.width)).toBeLessThanOrEqual(1);
      expect(mini.y).toBeGreaterThanOrEqual(column.y);
      expect(mini.y + mini.height).toBeLessThanOrEqual(
        column.y + column.height + 1,
      );
      await expectRunnerClear(page, player);
      // Working the question while it plays: a choice takes the click (Playwright's hit test
      // fails if anything lies over it), and the player is still there.
      await page.locator('[data-testid="runner-choice"]').first().click();
      await expect(player).toHaveAttribute("data-size", "shrunk");
      await page.screenshot({
        path: `${VIDEO_SHOTS}/runner-shrunk-${width}x${height}.png`,
      });
    } finally {
      await endReviewSession(request, sessionId);
    }
  });
}
