/**
 * The page Content-Security-Policy, exercised by every student flow in a real browser.
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02] | @implemented [2026-10-02]
 *
 * plain English: drives the real client through each student flow — sign-in (email and the
 * Google hand-off), practice with the Desmos calculator, review, LISA, the calendar, billing
 * (out to Stripe's portal and back), the full-length exam report, the dashboard and mastery —
 * and records every CSP violation the page raises, enforced or report-only. Expected outcome:
 * against a Vercel preview (real CDN headers, real built bundle) every flow ends with ZERO
 * violation reports, which is the evidence that the page CSP in `vercel.json` can be enforced.
 * Against local Vite (no CSP header) the list is trivially empty; the local run proves that each
 * flow actually renders its key element, so an empty list on the preview means "no violations",
 * not "the page never loaded" (CLAUDE.md: presence before absence).
 *
 * How the evidence is gathered:
 *  - an init script (runs in every frame, before any page script, and is not itself subject to
 *    the page CSP) listens for `securitypolicyviolation` on `document`, pushes each report onto
 *    `window.__cspReports`, and forwards it through an exposed binding so reports survive the
 *    navigations a flow makes (sign-in → dashboard, billing → Stripe → back);
 *  - console messages mentioning "Content Security Policy" or "Report Only" are kept too (Chrome
 *    prints the report-only notices there);
 *  - per flow the list is printed (`CSP_REPORTS <flow> <json>`), written to
 *    `<E2E_SHOT_DIR | test-results/page-csp>/csp-reports-<flow>.json` with a screenshot beside
 *    it, and asserted empty.
 *
 * The API is mocked in the browser (`page.route`) for same-origin `/api/` paths only — NOT every
 * `/api/` path: Desmos serves its script from `www.desmos.com/api/v1.11/calculator.js`, which a
 * bare pathname match would swallow. Payloads go through the shared Zod schemas (practice/review
 * loop, review pool, billing, LISA lifecycle, exam report envelope) or reuse the existing
 * fixtures (`report-fixtures.ts`; the guardian harness's mastery and student-calendar payloads).
 * An `/api/` request no mock answers gets a 404 and is printed as `UNMOCKED <flow> <method>
 * <path>`; it does not fail the test.
 *
 * Third-party navigations are stubbed, never followed: Supabase's `/auth/v1/authorize` (the
 * Google OAuth hand-off) and `billing.stripe.com` answer a tiny local page, and the test asserts
 * the request was made.
 *
 * env: E2E_BASE_URL (default http://localhost:5173, Vite's port — this spec sets its own
 * baseURL rather than the config's :3000), E2E_SHOT_DIR, E2E_CHROMIUM, VERCEL_SHARE (a preview
 * share token; visited once per test as `/?_vercel_share=<token>` to set the bypass cookie —
 * never printed).
 *
 * run (local):  Vite up with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_DESMOS_API_KEY,
 *   E2E_BASE_URL=http://localhost:5173 pnpm exec playwright test tests/e2e/page-csp-flows.spec.ts
 * run (preview): E2E_BASE_URL=<preview url> VERCEL_SHARE=<token> pnpm exec playwright test \
 *   tests/e2e/page-csp-flows.spec.ts
 * run (built bundle, vercel.json headers): build with the same three VITE_ variables, then
 *   `node scripts/ops/page-csp-static-server.mjs 5175` and E2E_BASE_URL=http://127.0.0.1:5175.
 *   This serves dist/public with the header values vercel.json gives every page, so the CSP is
 *   the real one; it is how the 2026-10-02 evidence was taken when the session's network path
 *   to the preview failed Chromium's asset requests (ERR_TOO_MANY_RETRIES, not a CSP block).
 * Not part of `pnpm test` (vitest) and not run in CI.
 */
import {
  expect,
  test,
  type ConsoleMessage,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  engineAnswerResponseSchema,
  engineNextItemResponseSchema,
  engineSessionStateResponseSchema,
} from "../../packages/shared/src/practice-response-schema";
import {
  reviewOpenSessionsResponseSchema,
  reviewPoolSummaryResponseSchema,
} from "../../packages/shared/src/review-schema";
import {
  billingPortalOutcomeSchema,
  billingStatusResponseSchema,
} from "../../packages/shared/src/billing-schema";
import {
  conversationDetailSchema,
  listConversationsResponseSchema,
  type ConversationDetailMessage,
} from "../../packages/shared/src/tutor-lifecycle-schema";
import { examReportMetaSchema } from "../../packages/shared/src/exam-report-schema";
import { streakSummarySchema } from "../../packages/shared/src/calendar/api";
import { masterySkillsResponseSchema } from "../../packages/shared/src/mastery-levels";
import type { EstimateResponse } from "../../client/src/lib/projectionApi";
import {
  FIXTURE_SESSION_ID,
  studentScoredReport,
} from "../../client/src/features/exam/test-fixtures/report-fixtures";

if (process.env.E2E_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM } });
}
test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.use({ baseURL: BASE_URL });
const APP_ORIGIN = new URL(BASE_URL).origin;

const OUT = process.env.E2E_SHOT_DIR ?? path.resolve("test-results/page-csp");
fs.mkdirSync(OUT, { recursive: true });

// The guardian harness's scenario (one scenario, shared): the student's own calendar week and
// the mastery payload, both through their shared schemas. tsx resolves the harness's aliases.
const HARNESS = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "tsx", "tests/e2e/guardian-harness/fixtures.ts"],
    {
      encoding: "utf8",
    },
  ),
) as { studentCalendar: unknown; masteryDomains: unknown };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const PRACTICE_SESSION = "22222222-2222-4222-8222-222222222222";
const PRACTICE_ITEM = "22222222-2222-4222-8222-2222222222a1";
const REVIEW_SESSION = "33333333-3333-4333-8333-333333333333";
const REVIEW_ITEM = "33333333-3333-4333-8333-3333333333a1";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-02T12:00:00.000Z";
const STRIPE_PORTAL_URL = "https://billing.stripe.com/p/session/test_page_csp";
const TUTOR_REPLY = "Start by isolating x: subtract 3 from both sides.";
const DESMOS_SCRIPT =
  /^https:\/\/www\.desmos\.com\/api\/v1\.11[^/]*\/calculator\.js/;
const STEM = "If 2x + 3 = 11, what is the value of x?";

const profileUser = {
  id: STUDENT_ID,
  email: "student@example.test",
  display_name: "Csp Student",
  role: "student",
  is_under_13: false,
  profileCompletedAt: "2026-09-01T00:00:00.000Z",
  requiredProfileComplete: true,
  guardianConsentRequired: false,
};

/** One math MCQ, pre-submit: the schema pins correct_answer / explanation to null. */
function nextItem(sessionId: string, sessionItemId: string): unknown {
  return engineNextItemResponseSchema.parse({
    sessionId,
    sessionItemId,
    ordinal: 1,
    state: "active",
    calculatorState: null,
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

function sessionState(sessionId: string, mode: string): unknown {
  return engineSessionStateResponseSchema.parse({
    sessionId,
    section: "M",
    mode,
    state: "active",
    currentOrdinal: 1,
    answeredCount: 0,
    skippedCount: 0,
    completedCount: 0,
    targetQuestionCount: 10,
    calculatorState: null,
    lastServedUnansweredItem: null,
    clientInstanceId: null,
    readOnly: false,
  });
}

function answer(sessionId: string, sessionItemId: string): unknown {
  return engineAnswerResponseSchema.parse({
    sessionId,
    sessionItemId,
    isCorrect: true,
    mode: "multiple_choice",
    correctOptionId: "opt-b",
    explanation: "2x = 8, so x = 4.",
    feedback: "Correct",
    stats: { correct: 1, incorrect: 0, skipped: 0, total: 1, streak: 1 },
    state: "active",
  });
}

const reviewPool = reviewPoolSummaryResponseSchema.parse({
  total: 3,
  timezone: "UTC",
  timezoneFallback: false,
  bySection: [{ key: "M", count: 3 }],
  byDomain: [{ key: "Algebra", count: 3 }],
  bySkill: [],
  sessions: [],
  sessions_next_cursor: null,
});

const reviewOpen = reviewOpenSessionsResponseSchema.parse({
  sessions: [],
  maxConcurrentSessions: 3,
});

const billingStatus = billingStatusResponseSchema.parse({
  plan: "premium",
  stripeStatus: "active",
  currentPeriodEnd: "2026-11-01T00:00:00.000Z",
  stripeSubscriptionId: "sub_page_csp",
  effectiveAccess: true,
  needsPaymentUpdate: false,
  lapsed: false,
  hasBillingAccount: true,
  isPaid: true,
  managedBy: "self",
  requestId: "r",
});

const scope = {
  source_session_id: null,
  source_session_item_id: null,
  source_question_row_id: null,
  source_question_canonical_id: null,
};

function conversationDetail(messages: ConversationDetailMessage[]): unknown {
  return conversationDetailSchema.parse({
    conversation: {
      conversation_id: CONVERSATION,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      status: "active",
      title: messages.length > 0 ? "Solving linear equations" : null,
      crisis_paused_at: null,
      resolved_scope: scope,
      created_at: NOW,
      updated_at: NOW,
      closed_at: null,
    },
    messages,
    pagination: { has_more: false, next_cursor: null },
  });
}

const conversationList = listConversationsResponseSchema.parse({
  conversations: [
    {
      conversation_id: CONVERSATION,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      status: "active",
      title: null,
      crisis_flagged: false,
      crisis_paused_at: null,
      resolved_scope: scope,
      last_message_preview: null,
      message_count: 0,
      created_at: NOW,
      updated_at: NOW,
    },
  ],
  pagination: { has_more: false, next_cursor: null },
});

const streak = streakSummarySchema.parse({
  current: 3,
  longest: 5,
  history_complete: true,
});

const masterySkills = masterySkillsResponseSchema.parse({
  ok: true,
  catalogEmpty: false,
  skills: [
    {
      section: "M",
      domain: "Algebra",
      skill: "Linear equations in one variable",
      levelKey: "L3",
      level: 3,
      displayName: "Proficient",
    },
    {
      section: "RW",
      domain: "Craft and Structure",
      skill: "Words in Context",
      levelKey: "L2",
      level: 2,
      displayName: "Developing",
    },
  ],
  requestId: "r",
});

// No shared schema exists for these two reads (the client types them locally); the projection
// is held to the client's exported union, the KPI payload to the fields the dashboard reads.
const projection = {
  estimateStatus: "no_baseline",
  estimate: null,
  baseline: null,
  totalQuestionsAttempted: 12,
  lastUpdated: NOW,
  entitlement: {
    hasPaidAccess: true,
    plan: "paid",
    status: "active",
    reason: "active_subscription",
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
  },
} satisfies EstimateResponse;

const kpis = {
  timezone: "UTC",
  week: { questionsSolved: 12 },
  recency: { window: 50, totalAttempts: 12 },
  metrics: [],
};

const examReportEnvelope = {
  data: studentScoredReport,
  meta: examReportMetaSchema.parse({ request_id: "r", served_at: NOW }),
};

// ── Harness ──────────────────────────────────────────────────────────────────

type CspReport = Record<string, unknown>;

type ApiRequest = {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
};

/** A mock's answer: a JSON body (status 200 unless given), or undefined for "not mine". */
type ApiReply = { status?: number; body: unknown } | undefined;
type ApiHandler = (req: ApiRequest) => ApiReply;

type Flow = {
  name: string;
  page: Page;
  reports: CspReport[];
  unmocked: string[];
};

declare global {
  interface Window {
    __cspReports?: CspReport[];
    __cspReport?: (report: CspReport) => void;
  }
}

/** Runs in every frame before any page script; the page CSP does not apply to it. */
function recordViolations(): void {
  document.addEventListener("securitypolicyviolation", (e) => {
    const report = {
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
      lineNumber: e.lineNumber,
      disposition: e.disposition,
      sample: e.sample,
      documentURI: e.documentURI,
    };
    (window.__cspReports ??= []).push(report);
    window.__cspReport?.(report);
  });
}

/** Answers every page: the CSRF handshake, the signed-in profile, and the shell's reads. */
function shellHandler(signedIn: () => boolean): ApiHandler {
  return ({ path: p }) => {
    if (p === "/api/csrf-token") return { body: { csrfToken: "t" } };
    if (p === "/api/profile") {
      return signedIn()
        ? { body: { authenticated: true, user: profileUser } }
        : { status: 401, body: { error: "Unauthorized", requestId: "r" } };
    }
    if (p === "/api/notifications/unread-count")
      return { body: { data: { unread: 0 }, requestId: "r" } };
    if (p === "/api/notifications")
      return {
        body: { data: { items: [], nextCursor: null }, requestId: "r" },
      };
    if (p === "/api/billing/status") return { body: billingStatus };
    return undefined;
  };
}

/** One evidence line on the run's output (the reporter prints a test's stdout). */
function evidence(line: string): void {
  process.stdout.write(`${line}\n`);
}

function parseBody(req: Request): unknown {
  const raw = req.postData();
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // A non-JSON body is passed through as text; mocks here only read JSON bodies.
    return {
      unparsed: raw,
      reason: err instanceof Error ? err.message : "parse",
    };
  }
}

async function startFlow(
  page: Page,
  name: string,
  handlers: ApiHandler[],
): Promise<Flow> {
  const flow: Flow = { name, page, reports: [], unmocked: [] };

  await page.exposeBinding("__cspReport", (source, report: CspReport) => {
    flow.reports.push({ ...report, frameURL: source.frame.url() });
  });
  await page.addInitScript(recordViolations);
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (
      text.includes("Content Security Policy") ||
      text.includes("Report Only")
    ) {
      flow.reports.push({
        console: text,
        type: msg.type(),
        location: msg.location(),
      });
    }
  });

  await page.route(
    (url: URL) => url.origin === APP_ORIGIN && url.pathname.startsWith("/api/"),
    async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const req: ApiRequest = {
        method: request.method(),
        path: url.pathname,
        search: url.searchParams,
        body: parseBody(request),
      };
      for (const handle of handlers) {
        const reply = handle(req);
        if (reply !== undefined) {
          return route.fulfill({
            status: reply.status ?? 200,
            contentType: "application/json",
            body: JSON.stringify(reply.body),
          });
        }
      }
      const line = `UNMOCKED ${name} ${req.method} ${req.path}`;
      flow.unmocked.push(line);
      evidence(line);
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Not found", requestId: "r" }),
      });
    },
  );

  // Preview protection: one visit with the share token sets the bypass cookie.
  const share = process.env.VERCEL_SHARE;
  if (share) {
    await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
    flow.reports.length = 0;
  }
  return flow;
}

/** A third-party page the browser is sent to; answered locally so the run never leaves. */
async function stubExternal(
  page: Page,
  pattern: string,
  title: string,
): Promise<void> {
  await page.route(pattern, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${title}</title><p>${title}</p>`,
    }),
  );
}

async function finishFlow(flow: Flow): Promise<void> {
  const { page, name } = flow;
  // Let late loads (lazy chunks, fonts, Desmos assets) raise whatever they will raise.
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: path.join(OUT, `csp-${name}.png`),
    fullPage: true,
  });

  // The binding saw every document; the current document's own array is folded in as well, in
  // case a report raced the binding. Identical reports are kept once.
  const local = await page.evaluate(() => window.__cspReports ?? []);
  const seen = new Set(flow.reports.map((r) => JSON.stringify(stripFrame(r))));
  for (const r of local) {
    if (!seen.has(JSON.stringify(r))) flow.reports.push(r);
  }

  const reports = flow.reports;
  evidence(`CSP_REPORTS ${name} ${JSON.stringify(reports)}`);
  fs.writeFileSync(
    path.join(OUT, `csp-reports-${name}.json`),
    JSON.stringify(
      { flow: name, baseURL: BASE_URL, reports, unmocked: flow.unmocked },
      null,
      2,
    ),
  );
  expect(reports, JSON.stringify(reports, null, 2)).toEqual([]);
}

function stripFrame(r: CspReport): CspReport {
  const { frameURL: _frameURL, ...rest } = r;
  return rest;
}

const signedInShell = shellHandler(() => true);

/**
 * The signed-in student's own reads: the dashboard's (also the post-sign-in landing and the
 * billing portal's return URL), the calendar's and the mastery page's.
 */
const studentReads: ApiHandler = ({ path: p }) => {
  if (p === "/api/progress/kpis") return { body: kpis };
  if (p === "/api/progress/projection") return { body: projection };
  if (p === "/api/calendar") return { body: HARNESS.studentCalendar };
  if (p === "/api/me/streak") return { body: streak };
  if (p === `/api/students/${STUDENT_ID}/mastery/domains`)
    return { body: HARNESS.masteryDomains };
  if (p === `/api/students/${STUDENT_ID}/mastery/skills`)
    return { body: masterySkills };
  return undefined;
};

async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByTestId("page-title")).toBeVisible({ timeout: 15_000 });
}

// ── The recorder itself ──────────────────────────────────────────────────────

// Presence before absence for the instrument: on local Vite there is no CSP, so an empty list
// could equally mean "the listener never ran". This page carries a report-only policy that its
// own <img> violates; the recorder must see it, through the binding, from the right frame.
test("recorder sees a report-only violation", async ({ page }) => {
  const flow = await startFlow(page, "recorder-canary", []);
  await page.route(`${APP_ORIGIN}/__csp-canary`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "Content-Security-Policy-Report-Only": "img-src 'none'" },
      body: '<!doctype html><title>canary</title><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
    }),
  );
  await page.goto("/__csp-canary");
  await expect
    .poll(
      () =>
        flow.reports.filter((r) => r.effectiveDirective === "img-src").length,
    )
    .toBeGreaterThan(0);
  const seen = flow.reports.find((r) => r.effectiveDirective === "img-src");
  expect(seen?.disposition).toBe("report");
  expect(String(seen?.frameURL)).toContain("/__csp-canary");
});

// ── Flows ────────────────────────────────────────────────────────────────────

test("login", async ({ page }) => {
  let signedIn = false;
  const flow = await startFlow(page, "login", [
    shellHandler(() => signedIn),
    ({ method, path: p }) => {
      if (method === "POST" && p === "/api/auth/signin") {
        signedIn = true;
        return { body: { ok: true } };
      }
      return undefined;
    },
    studentReads,
  ]);

  // Google: the Supabase browser client sends the window to <supabase>/auth/v1/authorize.
  await stubExternal(page, "**/auth/v1/authorize**", "authorize stub");
  await page.goto("/login");
  await expect(page.getByTestId("button-google-signin")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("checkbox-google-legal").click();
  const authorize = page.waitForRequest(/\/auth\/v1\/authorize/);
  await page.getByTestId("button-google-signin").click();
  const authorizeUrl = new URL((await authorize).url());
  expect(authorizeUrl.searchParams.get("provider")).toBe("google");
  await expect(page.getByText("authorize stub")).toBeVisible();

  // Email + password, signed out → signed in → the student's landing.
  await page.goto("/login");
  await expect(page.getByTestId("tab-signin")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("input-signin-email").fill("student@example.test");
  await page.getByTestId("input-signin-password").fill("correct horse battery");
  await page.getByTestId("button-signin").click();
  await expectDashboard(page);

  await finishFlow(flow);
});

test("practice-desmos", async ({ page }) => {
  let calculatorSaves = 0;
  const flow = await startFlow(page, "practice-desmos", [
    signedInShell,
    ({ method, path: p }) => {
      const base = `/api/practice/sessions/${PRACTICE_SESSION}`;
      if (p === `${base}/state`)
        return { body: sessionState(PRACTICE_SESSION, "balanced") };
      if (p === `${base}/next`)
        return { body: nextItem(PRACTICE_SESSION, PRACTICE_ITEM) };
      if (method === "POST" && p === `${base}/calculator-state`) {
        calculatorSaves += 1;
        return { body: { ok: true } };
      }
      if (method === "POST" && p === "/api/practice/answer")
        return { body: answer(PRACTICE_SESSION, PRACTICE_ITEM) };
      return undefined;
    },
  ]);

  // A Desmos request that fails at the network is named in the failure, so "desmos.com was
  // unreachable from this runner" is never mistaken for a CSP block or an app defect.
  const desmosFailures: string[] = [];
  page.on("requestfailed", (r) => {
    const host = new URL(r.url()).hostname;
    if (host === "desmos.com" || host.endsWith(".desmos.com")) {
      desmosFailures.push(`${r.url()} ${r.failure()?.errorText ?? ""}`);
    }
  });
  // The pinned URL (`/api/v1.11/calculator.js`) 302s to the current patch release on the same
  // host; the script that runs is the final 200.
  const desmosScript = page.waitForResponse(
    (r) => DESMOS_SCRIPT.test(r.url()) && r.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto(`/practice/session/${PRACTICE_SESSION}`);
  await expect(page.getByText(STEM)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("practice-calculator-toggle").click();
  await Promise.race([
    desmosScript,
    page.getByTestId("desmos-calculator-error").waitFor({ timeout: 30_000 }),
  ]);
  expect(desmosFailures, "Desmos requests failed at the network").toEqual([]);
  const calculator = page.getByTestId("desmos-calculator").first();
  await expect(calculator.locator(".dcg-container").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("desmos-calculator-error")).toHaveCount(0);
  await calculator.locator(".dcg-mq-editable-field").first().click();
  await page.keyboard.type("y=x^2");
  await page.waitForTimeout(1_500);
  evidence(`PRACTICE_CALCULATOR_SAVES ${calculatorSaves}`);

  await finishFlow(flow);
});

test("review", async ({ page }) => {
  const flow = await startFlow(page, "review", [
    signedInShell,
    ({ path: p }) => {
      if (p === "/api/review/pool") return { body: reviewPool };
      if (p === "/api/review/sessions/open") return { body: reviewOpen };
      if (p === "/api/practice/topics") return { body: { sections: [] } };
      // The review item's LISA panel looks up an existing scoped thread (GET, never a create).
      if (p === "/api/tutor/conversations")
        return {
          body: {
            data: listConversationsResponseSchema.parse({
              conversations: [],
              pagination: { has_more: false, next_cursor: null },
            }),
          },
        };
      const base = `/api/review/sessions/${REVIEW_SESSION}`;
      if (p === `${base}/state`)
        return { body: sessionState(REVIEW_SESSION, "queue") };
      if (p === `${base}/next`)
        return { body: nextItem(REVIEW_SESSION, REVIEW_ITEM) };
      return undefined;
    },
  ]);

  await page.goto("/review");
  await expect(page.getByTestId("review-queue-total")).toBeVisible({
    timeout: 15_000,
  });
  await page.goto(`/review/session/${REVIEW_SESSION}`);
  await expect(page.getByText(STEM)).toBeVisible({ timeout: 15_000 });

  await finishFlow(flow);
});

test("lisa", async ({ page }) => {
  const messages: ConversationDetailMessage[] = [];
  const flow = await startFlow(page, "lisa", [
    signedInShell,
    ({ method, path: p, body }) => {
      if (p === "/api/tutor/conversations")
        return { body: { data: conversationList } };
      if (p === `/api/tutor/conversations/${CONVERSATION}`)
        return { body: { data: conversationDetail(messages) } };
      if (method === "POST" && p === "/api/tutor/messages") {
        const sent = body as { message: string; client_turn_id: string };
        messages.push(
          {
            message_id: "55555555-5555-4555-8555-555555555551",
            role: "student",
            content_kind: "text",
            message: sent.message,
            created_at: NOW,
            client_turn_id: sent.client_turn_id,
          },
          {
            message_id: "55555555-5555-4555-8555-555555555552",
            role: "tutor",
            content_kind: "text",
            message: TUTOR_REPLY,
            created_at: NOW,
            client_turn_id: sent.client_turn_id,
          },
        );
        return {
          body: {
            data: {
              conversation_id: CONVERSATION,
              message_id: "55555555-5555-4555-8555-555555555552",
              client_turn_id: sent.client_turn_id,
              response: {
                content: TUTOR_REPLY,
                content_kind: "text",
                suggested_action: { type: "none", label: null },
                ui_hints: {
                  show_accept_decline: false,
                  allow_freeform_reply: true,
                  suggested_chip: null,
                },
              },
              conversation_updated_at: NOW,
            },
          },
        };
      }
      return undefined;
    },
  ]);

  await page.goto(`/chat?conversationId=${CONVERSATION}`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("How do I solve 2x + 3 = 11?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByTestId("tutor-bubble").filter({ hasText: TUTOR_REPLY }),
  ).toBeVisible({
    timeout: 15_000,
  });

  await finishFlow(flow);
});

test("calendar", async ({ page }) => {
  const flow = await startFlow(page, "calendar", [signedInShell, studentReads]);

  await page.goto("/calendar");
  await expect(page.locator(".lyceon-calendar .main").first()).toBeVisible({
    timeout: 15_000,
  });

  await finishFlow(flow);
});

test("billing", async ({ page }) => {
  let portalOpened = false;
  const flow = await startFlow(page, "billing", [
    signedInShell,
    ({ method, path: p }) => {
      if (method === "POST" && p === "/api/billing/portal") {
        portalOpened = true;
        return {
          body: billingPortalOutcomeSchema.parse({ url: STRIPE_PORTAL_URL }),
        };
      }
      return undefined;
    },
    studentReads,
  ]);
  await stubExternal(
    page,
    "https://billing.stripe.com/**",
    "stripe portal stub",
  );

  await page.goto("/profile?tab=billing");
  const manage = page.getByTestId("button-manage-subscription");
  await expect(manage).toBeVisible({ timeout: 15_000 });
  const portal = page.waitForRequest((r) => r.url() === STRIPE_PORTAL_URL);
  await manage.click();
  await portal;
  expect(portalOpened).toBe(true);
  await expect(page).toHaveURL(STRIPE_PORTAL_URL);

  // The portal's return_url for a student (server/routes/billing-routes.ts): /dashboard.
  await page.goto("/dashboard");
  await expectDashboard(page);

  await finishFlow(flow);
});

test("exam-report", async ({ page }) => {
  const flow = await startFlow(page, "exam-report", [
    signedInShell,
    ({ path: p }) => {
      if (p === `/api/tests/sessions/${FIXTURE_SESSION_ID}/report`)
        return { body: examReportEnvelope };
      return undefined;
    },
  ]);

  await page.goto(`/tests/${FIXTURE_SESSION_ID}/report`);
  await expect(page.getByTestId("exam-report")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("exam-total-score")).toBeVisible();

  await finishFlow(flow);
});

test("dashboard", async ({ page }) => {
  const flow = await startFlow(page, "dashboard", [
    signedInShell,
    studentReads,
  ]);

  await page.goto("/dashboard");
  await expectDashboard(page);

  await finishFlow(flow);
});

test("mastery", async ({ page }) => {
  const flow = await startFlow(page, "mastery", [signedInShell, studentReads]);

  await page.goto("/mastery");
  await expect(page.getByTestId("domain-grid")).toBeVisible({
    timeout: 15_000,
  });
  expect(await page.getByTestId("mastery-meter").count()).toBe(8);

  await finishFlow(flow);
});
