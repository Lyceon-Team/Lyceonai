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
 * Not part of `pnpm test` (vitest) and not in CI's browser job: it needs the local stack.
 * The harness keeps production's global limiter (1000 requests per 15 minutes): many runs in a row
 * against one server start answering 429, which the app reads as signed out (the login page). Wait
 * out the window or restart the server.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
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
        // Bottom-right.
        const b = await box(bubble);
        expect(b.x + b.width).toBeGreaterThan(width - 40);
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
  test(`${width}px review runner: the dock replaces the panel, clears Submit and every choice, collapsed and open`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 900 });
    await asPersona(page, "paid");
    const sessionId = await freshReviewSession(request);
    try {
      await openRunner(page, sessionId);
      // The panel and its bar toggle are gone from 768px up.
      await expect(
        page.locator('[data-testid="scoped-tutor-panel"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid="practice-tutor-toggle"]'),
      ).toHaveCount(0);
      const bubble = page.locator(BUBBLE);
      await expect(bubble).toBeVisible();
      await expectRunnerClear(page, bubble);

      await bubble.click();
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("role", "dialog");
      await expect(panel).toHaveAttribute("aria-modal", "false");
      // The panel grows up from the bubble and stays above Submit / Next.
      const footer = page.locator('[data-testid="runner-footer"]');
      expect(overlaps(await box(panel), await box(footer))).toBe(false);
      // Non-modal: a choice still takes a real click (actionability checks on) with it open.
      // (5s: a choice under the panel fails here, by name, not at the test's own timeout.)
      await page
        .locator('[data-testid="runner-choice"]')
        .first()
        .click({ timeout: 5_000 });
      await expect(page.locator('[data-testid="runner-submit"]')).toBeEnabled();
      await expect(panel).toBeVisible();
      // Esc minimizes.
      await panel.focus();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(bubble).toBeVisible();
      await expect(bubble).toBeFocused();
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
    await page.locator(BUBBLE).click();
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
  test(`${width}px Math review runner with the calculator open: the bubble clears the calculator, Submit and the footer`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 800 });
    await asPersona(page, "paid");
    const sessionId = await freshSession(request, "review", ["M"]);
    try {
      await openAnyRunner(page, "review", sessionId);
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
