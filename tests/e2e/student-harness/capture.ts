/**
 * Side-by-side screenshots for one Wave 5 page group: the built page next to its signed-off
 * prototype, light and dark, desktop (1440x900) and phone (390x844).
 *
 * @spec [student-UI register §6 Wave 5 ("Proof for every row: side-by-side screenshot with the
 *        signed-off prototype in the PR"); OQ-4 (390px screenshot of each app-shell page, light
 *        and dark); design/DESIGN.md §2] | @implemented [2026-10-03]
 *
 * plain English: one command per page group.
 *   1. Starts the student harness server (real routers over a throwaway local Postgres, personas
 *      free and paid seeded through the real practice routes) and Vite (the real client), unless
 *      STUDENT_HARNESS_BASE_URL points at ones already running.
 *   2. For every shot x viewport x theme, opens the built route as the shot's persona and saves a
 *      viewport screenshot. Dark is asked for the way a device asks: the app's own per-device
 *      setting (`localStorage["lyceon-theme"]`, read by client/index.html's boot script and
 *      client/src/lib/theme.ts) plus the colour-scheme media feature. What the page then did is
 *      recorded from the DOM (`html[data-theme]`, and `data-theme-lock` on the shell), so a page
 *      still pinned light (OQ-49) is labelled, not passed off as dark.
 *   3. Opens the paired prototype from disk (file://) with the canvas props `plan` and `theme`
 *      set, rendered by prototype-runtime.js (the canvas runtime is not in the repo), at the
 *      canvas's own fixed 1440x900. The prototypes have no phone layout, so phone rows show the
 *      desktop prototype and say so.
 *   4. Writes PNGs and an index.md table (built | prototype) under
 *      docs/plans/student-ui/evidence/wave5/<group>/.
 * Nothing leaves the machine: every request that is not localhost, file: or data: is aborted
 * and listed in the index. The prototypes' Google Fonts stylesheet is answered locally with the
 * app's own self-hosted Source Sans 3 / Source Serif 4 files.
 *
 * run: pnpm exec tsx tests/e2e/student-harness/capture.ts UI-41   (see README.md)
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";
import { pgConnConfig } from "../../helpers/pg-supabase";
import { STUDENT_HARNESS_DB } from "./db";
import {
  CONSENT_COOKIE_NAME,
  COOKIE_BANNER_VERSION,
  formatConsentCookieValue,
} from "../../../packages/shared/src/analytics-consent-schema";
import { PAGE_GROUPS } from "./groups";
import type {
  ExtraViewport,
  FreshSession,
  PageGroup,
  PickStep,
  PrototypePairing,
  Shot,
  Theme,
  Viewport,
} from "./groups/types";
import {
  isStudentPersona,
  PERSONA_HEADER,
  PERSONAS,
  type StudentPersona,
} from "./personas";
import { SEED_CLIENT_INSTANCE, type SeedManifest } from "./seed";
import {
  CONSENT_COOKIE_NAME,
  COOKIE_BANNER_VERSION,
  formatConsentCookieValue,
} from "../../../packages/shared/src/analytics-consent-schema";

/**
 * The site-wide cookie banner (SEO Wave 1C, `CookieConsentRoot`) shows until a visitor answers it,
 * fixed over the bottom of every page, where it covers the phone tab bar and a bottom sheet's
 * actions. The student pages under review are shot as a student who has already answered it
 * ("Reject analytics", the strictly necessary consent cookie only, in the app's own format), so
 * the banner is not drawn over them. The banner itself is the SEO vertical's surface, not shot here.
 */
function answeredConsentCookie(baseUrl: string): {
  name: string;
  value: string;
  url: string;
} {
  return {
    name: CONSENT_COOKIE_NAME,
    value: encodeURIComponent(
      formatConsentCookieValue({
        consentId: "5e55c000-0000-4000-8000-000000000063",
        analytics: false,
        bannerVersion: COOKIE_BANNER_VERSION,
        decidedAtSeconds: Math.floor(Date.now() / 1000),
      }),
    ),
    url: baseUrl,
  };
}

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const PROTOTYPE_DIR = path.join(ROOT, "docs/plans/student-ui/design/prototype");
const RUNTIME = path.join(
  ROOT,
  "tests/e2e/student-harness/prototype-runtime.js",
);
const FONTS_DIR = path.join(ROOT, "client/public/fonts");
const OUT_ROOT = path.join(ROOT, "docs/plans/student-ui/evidence/wave5");

const VIEWPORTS: Readonly<Record<Viewport, { width: number; height: number }>> =
  {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  };
const THEMES: readonly Theme[] = ["light", "dark"];

/** A size a shot is captured at: desktop, phone, or a shot's extra size (F-69: tablet). */
type Size = ExtraViewport;

function standardSize(viewport: Viewport): Size {
  return { name: viewport, ...VIEWPORTS[viewport], selectors: viewport };
}

/** F-69: what `expectFitsViewport` measured after the steps (groups/types.ts). */
type Fit = {
  scrollHeight: number;
  innerHeight: number;
  scrollY: number;
  barTop: number;
  barBottom: number;
  /** The `unscrolled` container's scrollHeight and clientHeight, when the shot names one. */
  unscrolled: { scrollHeight: number; clientHeight: number } | null;
};
const SETTLE_MS = 700;

type BuiltResult = {
  file: string;
  finalPath: string;
  htmlTheme: string | null;
  themeLock: string | null;
  /** CSS px the page is wider than the viewport (0 when nothing overflows horizontally). */
  overflowX: number;
  /** F-69: the document and top-bar measurement, for shots with `expectFitsViewport`. */
  fit: Fit | null;
  skipped?: string;
};

function log(line: string): void {
  // eslint-disable-next-line no-console -- the capture run log
  console.log(line);
}

// ---------------------------------------------------------------------------------------------
// The local stack
// ---------------------------------------------------------------------------------------------

const children: ChildProcess[] = [];

function stopChildren(): void {
  for (const child of children) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (err: unknown) {
        log(
          `capture: could not stop process group ${child.pid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

function startChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logFile: string,
): ChildProcess {
  const out = fs.openSync(logFile, "w");
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", out],
  });
  children.push(child);
  child.stdout?.on("data", (chunk: Buffer) =>
    fs.appendFileSync(logFile, chunk),
  );
  return child;
}

function waitForLine(
  child: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
  what: string,
): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(`${what}: no "${pattern.source}" within ${timeoutMs} ms`),
        ),
      timeoutMs,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const m = pattern.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolve(m);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${what} exited with code ${String(code)} before it was ready`,
        ),
      );
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err: unknown) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} not up within ${timeoutMs} ms (${last})`);
}

type Stack = {
  baseUrl: string;
  manifest: SeedManifest;
  serverLog: string | null;
};

async function startStack(
  runDir: string,
  seed: PageGroup["seed"],
): Promise<Stack> {
  const reuse = process.env.STUDENT_HARNESS_BASE_URL;
  const manifestEnv = process.env.STUDENT_HARNESS_MANIFEST;
  if (reuse) {
    if (!manifestEnv)
      throw new Error(
        "STUDENT_HARNESS_BASE_URL needs STUDENT_HARNESS_MANIFEST (the server's ready-line JSON)",
      );
    return {
      baseUrl: reuse,
      manifest: JSON.parse(manifestEnv) as SeedManifest,
      serverLog: null,
    };
  }
  const harnessPort = process.env.HARNESS_PORT ?? "5056";
  const vitePort = process.env.STUDENT_HARNESS_VITE_PORT ?? "5174";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_PORT: harnessPort,
    NODE_ENV: "development",
    // The group's extra seed (groups/types.ts `seed`); server.ts reads it.
    STUDENT_HARNESS_SEED: seed ?? "",
  };
  const serverLog = path.join(runDir, "server.log");
  const server = startChild(
    "pnpm",
    [
      "exec",
      "tsx",
      "--import",
      "./tests/e2e/student-harness/register.mjs",
      "tests/e2e/student-harness/server.ts",
    ],
    env,
    serverLog,
  );
  log(
    `capture: starting the student harness server on :${harnessPort} (migrations + seed)`,
  );
  const ready = await waitForLine(
    server,
    /student harness ready (\{.*\})\n/,
    240_000,
    "student harness server",
  );
  const manifest = JSON.parse(ready[1] ?? "{}") as SeedManifest;
  log(`capture: server ready; seeded ${JSON.stringify(manifest)}`);

  // Vite proxies /api to localhost:$PORT (vite.config.ts; `vite preview` inherits server.proxy).
  // The Supabase URL is a closed local port: the client's direct auth calls fail locally and
  // never reach a real project.
  //
  // The client is a PRODUCTION build served by `vite preview` by default, because the dev
  // server runs React.StrictMode's double effects (client/src/main.tsx): the runner then asks
  // /next twice at once and one of the pair fails, an error banner production never shows.
  // STUDENT_HARNESS_CLIENT=dev uses the dev server instead (faster to iterate on).
  const viteEnv: NodeJS.ProcessEnv = {
    ...env,
    PORT: harnessPort,
    VITE_SUPABASE_URL: "http://localhost:9",
    VITE_SUPABASE_ANON_KEY: "student-harness",
  };
  if (process.env.STUDENT_HARNESS_CLIENT === "dev") {
    startChild(
      "pnpm",
      ["exec", "vite", "--port", vitePort, "--strictPort"],
      viteEnv,
      path.join(runDir, "vite.log"),
    );
  } else {
    const webDir = path.join(runDir, "web");
    log("capture: building the client (vite build) for vite preview");
    const build = startChild(
      "pnpm",
      ["exec", "vite", "build", "--outDir", webDir, "--emptyOutDir"],
      { ...viteEnv, NODE_ENV: "production" },
      path.join(runDir, "vite-build.log"),
    );
    const code = await new Promise<number | null>((resolve) =>
      build.on("exit", resolve),
    );
    if (code !== 0)
      throw new Error(
        `vite build failed (exit ${String(code)}); see ${path.join(runDir, "vite-build.log")}`,
      );
    startChild(
      "pnpm",
      [
        "exec",
        "vite",
        "preview",
        "--outDir",
        webDir,
        "--port",
        vitePort,
        "--strictPort",
      ],
      viteEnv,
      path.join(runDir, "vite.log"),
    );
  }
  const baseUrl = `http://localhost:${vitePort}`;
  await waitForHttp(`${baseUrl}/`, 120_000);
  log(`capture: Vite up at ${baseUrl}`);
  return { baseUrl, manifest, serverLog };
}

// ---------------------------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------------------------

async function launch(): Promise<Browser> {
  const pinned = process.env.E2E_CHROMIUM;
  if (pinned) return chromium.launch({ executablePath: pinned });
  try {
    return await chromium.launch();
  } catch (err: unknown) {
    const fallback = "/opt/pw-browsers/chromium";
    if (!fs.existsSync(fallback)) throw err;
    log(
      `capture: the pinned Chromium did not launch (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); using ${fallback}`,
    );
    return chromium.launch({ executablePath: fallback });
  }
}

const blockedHosts = new Set<string>();

function fontFaceCss(): string {
  const face = (family: string, file: string): string =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:200 900;font-display:block;` +
    `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(FONTS_DIR, file)).toString("base64")}) format('woff2')}`;
  return [
    face("Source Sans 3", "source-sans-3-latin-variable.woff2"),
    face("Source Serif 4", "source-serif-4-latin-variable.woff2"),
  ].join("\n");
}

/** Local-only network: localhost, file: and data: pass; Google Fonts CSS is answered locally; the rest is aborted. */
async function localOnly(
  context: BrowserContext,
  fontCss: string,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol === "file:" ||
      url.protocol === "data:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    ) {
      return route.continue();
    }
    if (
      url.hostname === "fonts.googleapis.com" &&
      url.searchParams.get("family")?.includes("Source")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "text/css",
        body: fontCss,
      });
    }
    blockedHosts.add(url.hostname);
    return route.abort();
  });
}

function fillRoute(
  route: string,
  manifest: SeedManifest,
  sessionId: string | null = null,
): string {
  if (route.includes("{session}")) {
    if (sessionId === null)
      throw new Error(
        `route ${route} names {session} but the shot has no freshSession`,
      );
    route = route.replace("{session}", sessionId);
  }
  return route.replace(
    /\{(free|paid)\.(\w+)\}/g,
    (_m, persona: "free" | "paid", key: string) => {
      const value = (manifest[persona] as Record<string, unknown>)[key];
      if (typeof value !== "string")
        throw new Error(
          `route placeholder {${persona}.${key}} has no seeded value`,
        );
      return value;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// UI-53: fresh runner sessions and choices picked by what they are
// ---------------------------------------------------------------------------------------------

let freshCounter = 0;

async function harnessDb(): Promise<pg.Client> {
  const client = new pg.Client(pgConnConfig(STUDENT_HARNESS_DB));
  await client.connect();
  return client;
}

/**
 * SCL-211 / OQ-56 (b) (groups/types.ts `freshCalendarProfile`): removes the persona's study
 * profile, so the next page load is a first visit again. Nothing references the row.
 */
async function clearCalendarProfile(persona: StudentPersona): Promise<void> {
  const db = await harnessDb();
  try {
    await db.query(
      "DELETE FROM public.student_study_profile WHERE student_id = $1",
      [PERSONAS[persona].id],
    );
  } finally {
    await db.end();
  }
}

/**
 * SEO Wave 2 (groups/types.ts `freshReviewPrompt`): removes the persona's review-prompt state and
 * review, so the next page load is a never-prompted account again.
 */
async function clearReviewPrompt(persona: StudentPersona): Promise<void> {
  const db = await harnessDb();
  try {
    await db.query(
      "DELETE FROM public.product_review_prompt_state WHERE profile_id = $1",
      [PERSONAS[persona].id],
    );
    await db.query("DELETE FROM public.product_reviews WHERE profile_id = $1", [
      PERSONAS[persona].id,
    ]);
  } finally {
    await db.end();
  }
}

async function apiCall(
  stack: Stack,
  persona: StudentPersona,
  method: "POST",
  apiPath: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${stack.baseUrl}${apiPath}`, {
    method,
    headers: { "content-type": "application/json", [PERSONA_HEADER]: persona },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json();
  if (res.status >= 400 || json === null || typeof json !== "object")
    throw new Error(
      `${persona} ${method} ${apiPath} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`,
    );
  return json as Record<string, unknown>;
}

function itemsTable(engine: FreshSession["engine"]): string {
  return engine === "review"
    ? "review_session_items"
    : "practice_session_items";
}

/** Starts a session through the real create route; retries when its first item is a grid-in. */
async function startFreshSession(
  stack: Stack,
  persona: StudentPersona,
  fresh: FreshSession,
): Promise<string> {
  const db = await harnessDb();
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      freshCounter += 1;
      const created = await apiCall(
        stack,
        persona,
        "POST",
        `/api/${fresh.engine}/sessions`,
        {
          ...fresh.body,
          client_instance_id: SEED_CLIENT_INSTANCE,
          idempotency_key: `student-harness-fresh-${process.pid}-${freshCounter}`,
        },
      );
      const id = created.sessionId;
      if (typeof id !== "string")
        throw new Error("fresh session: no sessionId");
      if (fresh.mcqFirst !== true) return id;
      const first = await db.query<{ question_item_type: string }>(
        `SELECT question_item_type FROM public.${itemsTable(fresh.engine)}
          WHERE session_id = $1 ORDER BY ordinal LIMIT 1`,
        [id],
      );
      if (first.rows[0]?.question_item_type !== "grid_in") return id;
      await endFreshSession(stack, persona, fresh, id);
    }
    throw new Error("fresh session: six starts in a row opened on a grid-in");
  } finally {
    await db.end();
  }
}

async function endFreshSession(
  stack: Stack,
  persona: StudentPersona,
  fresh: FreshSession,
  sessionId: string,
): Promise<void> {
  await apiCall(
    stack,
    persona,
    "POST",
    `/api/${fresh.engine}/sessions/${sessionId}/terminate`,
    { client_instance_id: SEED_CLIENT_INSTANCE },
  );
}

/**
 * The on-screen index of the choice a pick names, from the served item's stored display order
 * (`option_order`, canonical keys in the order shown) and its correct key. Harness only: the
 * page under test is never told.
 */
async function pickIndex(
  fresh: FreshSession,
  sessionId: string,
  pick: PickStep["pick"],
): Promise<number> {
  if (pick === "first") return 0;
  const db = await harnessDb();
  try {
    const r = await db.query<{
      option_order: string[] | null;
      question_correct_answer: string | null;
    }>(
      `SELECT option_order, question_correct_answer FROM public.${itemsTable(fresh.engine)}
        WHERE session_id = $1 AND status = 'served' ORDER BY ordinal DESC LIMIT 1`,
      [sessionId],
    );
    const row = r.rows[0];
    const order = row?.option_order ?? null;
    const correct = row?.question_correct_answer ?? null;
    if (!order || !correct)
      throw new Error("pick: the served item has no option order");
    const at = order.indexOf(correct);
    if (at === -1)
      throw new Error("pick: the correct key is not in the option order");
    return pick === "correct" ? at : at === 0 ? 1 : 0;
  } finally {
    await db.end();
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(SETTLE_MS);
}

async function shootBuilt(
  browser: Browser,
  stack: Stack,
  shot: Shot,
  size: Size,
  theme: Theme,
  outDir: string,
  fontCss: string,
): Promise<BuiltResult> {
  const viewport = size.selectors;
  const file = `${shot.id}--${size.name}--${theme}--built.png`;
  // A fresh runner session needs one of the seeded students (UI-59's bare-page personas have none).
  const persona = isStudentPersona(shot.persona) ? shot.persona : null;
  const fresh = shot.freshSession ?? null;
  if (fresh && persona === null)
    throw new Error(`${shot.id}: a fresh session needs a signed-in persona`);
  const sessionId =
    fresh && persona ? await startFreshSession(stack, persona, fresh) : null;
  if (shot.freshCalendarProfile === true) {
    if (persona === null)
      throw new Error(
        `${shot.id}: a fresh calendar profile needs a seeded student`,
      );
    await clearCalendarProfile(persona);
  }
  if (shot.freshReviewPrompt === true) {
    if (persona === null)
      throw new Error(`${shot.id}: a fresh review prompt needs a seeded student`);
    await clearReviewPrompt(persona);
  }
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    colorScheme: theme,
    reducedMotion: "reduce",
    extraHTTPHeaders:
      shot.persona === "signed-out" ? {} : { [PERSONA_HEADER]: shot.persona },
  });
  try {
    if (shot.cookieChoiceMade === true) {
      await context.addCookies([
        {
          name: CONSENT_COOKIE_NAME,
          value: encodeURIComponent(
            formatConsentCookieValue({
              bannerVersion: COOKIE_BANNER_VERSION,
              consentId: "00000000-0000-4000-8000-00000000c0c0",
              analytics: false,
              decidedAtSeconds: Math.floor(Date.now() / 1000),
            }),
          ),
          url: stack.baseUrl,
        },
      ]);
    }
    await localOnly(context, fontCss);
    await context.addCookies([answeredConsentCookie(stack.baseUrl)]);
    await context.addInitScript(
      (arg: {
        theme: string;
        local: Record<string, string>;
        session: Record<string, string>;
      }) => {
        try {
          window.localStorage.setItem("lyceon-theme", arg.theme);
          for (const [k, v] of Object.entries(arg.local))
            window.localStorage.setItem(k, v);
          for (const [k, v] of Object.entries(arg.session))
            window.sessionStorage.setItem(k, v);
        } catch (err: unknown) {
          // A page with no storage still gets the colour-scheme media feature. (Runs in the page.)
          // eslint-disable-next-line no-console -- browser-side; surfaces in the page console only
          console.warn("student harness: storage not written", err);
        }
      },
      {
        theme,
        local: { ...(shot.localStorage ?? {}) },
        session: { ...(shot.sessionStorage ?? {}) },
      },
    );
    const page = await context.newPage();
    // UI-56: a held request (groups/types.ts `holdRequest`) is answered by nobody until the
    // screenshot is taken, then aborted. A page route outranks the context's local-only route.
    const held: Array<() => Promise<void>> = [];
    const hold = shot.holdRequest;
    if (hold) {
      await page.route(
        (url) => url.pathname === hold.path,
        async (route) => {
          if (route.request().method() !== hold.method) {
            await route.fallback();
            return;
          }
          held.push(() => route.abort());
        },
      );
    }
    // UI-58: a request answered by the browser itself (groups/types.ts `fulfillRequest`).
    const fulfil = shot.fulfillRequest;
    if (fulfil) {
      await page.route(
        (url) => url.pathname === fulfil.path,
        async (route) => {
          if (route.request().method() !== fulfil.method) {
            await route.fallback();
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fulfil.body),
          });
        },
      );
    }
    // UI-59: requests the browser fails itself (groups/types.ts `failRequest`).
    const fail = shot.failRequest;
    let failed = 0;
    if (fail) {
      const pattern = new RegExp(fail.pathPattern);
      await page.route(
        (url) => pattern.test(url.pathname),
        async (route) => {
          failed += 1;
          await route.abort("failed");
        },
      );
    }
    const settleAfterStep = async (): Promise<void> => {
      if (hold) await page.waitForTimeout(SETTLE_MS);
      else await settle(page);
    };
    await page.goto(
      `${stack.baseUrl}${fillRoute(shot.route, stack.manifest, sessionId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await settle(page);
    if (shot.waitFor)
      await page
        .locator(shot.waitFor[viewport])
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
    for (const step of shot.steps ?? []) {
      if ("pick" in step) {
        if (!fresh || sessionId === null)
          throw new Error(`${shot.id}: a pick step needs a fresh session`);
        const at = await pickIndex(fresh, sessionId, step.pick);
        await page.locator('[data-testid="runner-choice"]').nth(at).click();
        await settleAfterStep();
        continue;
      }
      if ("fill" in step) {
        const field = step.fill[viewport];
        if (field === null) continue;
        await page.locator(field).first().fill(step.value);
        continue;
      }
      if ("focus" in step) {
        const field = step.focus[viewport];
        if (field === null) continue;
        await page.locator(field).first().focus();
        await page.waitForTimeout(SETTLE_MS);
        continue;
      }
      const selector = step.click[viewport];
      if (selector === null) continue;
      if (step.ariaDisabledOk === true) {
        // groups/types.ts ClickStep: an aria-disabled element that still answers a click.
        const target = page.locator(selector).first();
        await target.waitFor({ state: "visible", timeout: 20_000 });
        await target.click({ force: true });
      } else {
        await page.locator(selector).first().click();
      }
      await settleAfterStep();
    }
    if (shot.expectVisible !== undefined)
      await page
        .locator(shot.expectVisible)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
    if (shot.expectGone !== undefined)
      await page
        .locator(shot.expectGone)
        .first()
        .waitFor({ state: "detached", timeout: 20_000 });
    if (shot.expectText !== undefined)
      await page
        .getByText(shot.expectText, { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
    if (shot.expectPath !== undefined) {
      const expected = new RegExp(shot.expectPath);
      await page.waitForURL((url) => expected.test(url.pathname), {
        timeout: 20_000,
      });
      await settle(page);
    }
    // F-69: measured before the screenshot, which is taken either way so a failure can be seen.
    const fits = shot.expectFitsViewport;
    const fit: Fit | null = fits
      ? await page.evaluate(
          (arg: { topBar: string; unscrolled: string | null }): Fit => {
            const bar = document
              .querySelector(arg.topBar)
              ?.getBoundingClientRect();
            const box =
              arg.unscrolled === null
                ? null
                : document.querySelector(arg.unscrolled);
            return {
              scrollHeight: document.documentElement.scrollHeight,
              innerHeight: window.innerHeight,
              scrollY: window.scrollY,
              barTop: bar ? bar.top : Number.NaN,
              barBottom: bar ? bar.bottom : Number.NaN,
              unscrolled:
                arg.unscrolled === null
                  ? null
                  : box
                    ? {
                        scrollHeight: box.scrollHeight,
                        clientHeight: box.clientHeight,
                      }
                    : { scrollHeight: Number.NaN, clientHeight: Number.NaN },
            };
          },
          { topBar: fits.topBar, unscrolled: fits.unscrolled ?? null },
        )
      : null;
    await page.screenshot({
      path: path.join(outDir, file),
      fullPage: shot.fullPage === true,
    });
    if (
      fit &&
      !(
        fit.scrollHeight <= fit.innerHeight &&
        fit.scrollY === 0 &&
        fit.barTop >= 0 &&
        fit.barBottom <= fit.innerHeight &&
        (fit.unscrolled === null ||
          fit.unscrolled.scrollHeight <= fit.unscrolled.clientHeight)
      )
    )
      throw new Error(
        `${shot.id} ${size.name} ${theme}: the page does not fit the viewport (F-69): ` +
          `scrollHeight ${fit.scrollHeight} vs innerHeight ${fit.innerHeight}, scrollY ${fit.scrollY}, ` +
          `top bar ${fit.barTop}..${fit.barBottom}` +
          (fit.unscrolled
            ? `, ${fits?.unscrolled ?? ""} scrollHeight ${fit.unscrolled.scrollHeight} vs clientHeight ${fit.unscrolled.clientHeight}`
            : ""),
      );
    if (fail && failed === 0)
      throw new Error(
        `${shot.id}: no request matched failRequest ${fail.pathPattern}`,
      );
    if (hold && held.length === 0)
      throw new Error(
        `${shot.id}: ${hold.method} ${hold.path} was to be held but was never requested`,
      );
    for (const abort of held) await abort();
    const dom = await page.evaluate(() => ({
      htmlTheme: document.documentElement.getAttribute("data-theme"),
      overflowX: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      themeLock:
        document
          .querySelector("[data-theme-lock]")
          ?.getAttribute("data-theme-lock") ?? null,
    }));
    return { file, finalPath: new URL(page.url()).pathname, ...dom, fit };
  } finally {
    await context.close();
    if (fresh && persona && sessionId !== null)
      await endFreshSession(stack, persona, fresh, sessionId);
  }
}

type ProtoResult = { file: string } | { none: string };

function protoKey(
  p: Extract<PrototypePairing, { kind: "screen" }>,
  theme: Theme,
): string {
  const steps =
    p.state !== undefined
      ? `--${p.state}`
      : (p.steps ?? []).length > 0
        ? "--clicked"
        : "";
  return `proto--${p.file.replace(/\.dc\.html$/, "")}--${p.plan ?? "noplan"}--${theme}${steps}.png`;
}

async function shootPrototype(
  browser: Browser,
  pairing: Extract<PrototypePairing, { kind: "screen" }>,
  theme: Theme,
  outDir: string,
  fontCss: string,
): Promise<string> {
  const file = protoKey(pairing, theme);
  if (fs.existsSync(path.join(outDir, file))) return file;
  const source = path.join(PROTOTYPE_DIR, pairing.file);
  if (!fs.existsSync(source)) throw new Error(`no prototype ${source}`);
  const context = await browser.newContext({
    viewport: VIEWPORTS.desktop,
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  try {
    await localOnly(context, fontCss);
    const props: Record<string, string> = { theme };
    if (pairing.plan) props.plan = pairing.plan;
    await context.addInitScript((p: Record<string, string>) => {
      (
        window as unknown as { __DC_PROPS__: Record<string, string> }
      ).__DC_PROPS__ = p;
    }, props);
    await context.addInitScript({ path: RUNTIME });
    const page = await context.newPage();
    await page.goto(pathToFileURL(source).href, { waitUntil: "load" });
    const state = await page.waitForFunction(
      () =>
        document.documentElement.dataset.dcReady ??
        document.documentElement.dataset.dcError ??
        null,
      undefined,
      { timeout: 15_000 },
    );
    const err = await page.evaluate(
      () => document.documentElement.dataset.dcError ?? null,
    );
    if (err)
      throw new Error(`prototype ${pairing.file} did not render: ${err}`);
    await state.dispose();
    for (const selector of pairing.steps ?? []) {
      await page.locator(selector).first().click();
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, file), fullPage: false });
    return file;
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------------------------

function themeLabel(requested: Theme, built: BuiltResult): string {
  if (requested === "light") return "light";
  if (built.htmlTheme === "dark" && built.themeLock === "light")
    return "dark requested; page pinned light (`data-theme-lock=light`, OQ-49)";
  if (built.htmlTheme === "dark") return "dark";
  return `dark requested; rendered \`data-theme=${String(built.htmlTheme)}\``;
}

function sizeOf(outDir: string, file: string): string {
  return `${Math.round(fs.statSync(path.join(outDir, file)).size / 1024)} KB`;
}

function writeIndex(
  group: PageGroup,
  outDir: string,
  rows: Array<{
    shot: Shot;
    viewport: string;
    theme: Theme;
    built: BuiltResult;
    proto: ProtoResult;
  }>,
  stack: Stack,
  notServed: readonly string[],
): void {
  const lines: string[] = [];
  lines.push(`# ${group.title}`, "");
  lines.push(
    `Generated ${new Date().toISOString()} by \`pnpm exec tsx tests/e2e/student-harness/capture.ts ${group.id}\` ` +
      "(see `tests/e2e/student-harness/README.md`). Built = a production build of the real client (`vite preview`, or the dev server with STUDENT_HARNESS_CLIENT=dev) against the student harness " +
      "(real routers over a local Postgres built from this repo's migrations; personas seeded through the real practice " +
      "routes). Prototype = the signed-off `docs/plans/student-ui/design/prototype/*.dc.html`, rendered locally.",
    "",
    "Conditions, read before comparing:",
    "- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844, and any extra size a shot names.",
    "- The prototypes are a fixed 1440x900 canvas with no phone layout; phone rows show the desktop prototype.",
    "- Dark is requested through the app's own per-device setting; the theme column records what the page rendered.",
    "- No external requests: the built app's Google Fonts (Inter, Poppins) are blocked, so legacy page bodies fall back to system faces; " +
      "Source Sans 3 / Source Serif 4 are self-hosted and load for both sides.",
    "- Prototype data is illustrative; built data is the seeded personas' real payloads.",
    "",
  );
  for (const shot of group.shots) {
    lines.push(`## ${shot.title}`, "");
    lines.push(`Persona: \`${shot.persona}\`. Route: \`${shot.route}\`.`);
    if (shot.sessionStorage)
      lines.push(
        `Preset sessionStorage: \`${JSON.stringify(shot.sessionStorage)}\`.`,
      );
    if (shot.localStorage)
      lines.push(
        `Preset localStorage: \`${JSON.stringify(shot.localStorage)}\`.`,
      );
    if (shot.freshSession)
      lines.push(
        `Fresh session per capture (real create route, ended after the shot): \`${shot.freshSession.engine} ${JSON.stringify(shot.freshSession.body)}\`.`,
      );
    if (shot.cookieChoiceMade === true)
      lines.push(
        "Cookie banner already answered (the real `lyceon_consent` cookie, analytics rejected, current banner version).",
      );
    if (shot.freshReviewPrompt === true)
      lines.push(
        "No review-prompt state before each capture (the persona's `product_review_prompt_state` and `product_reviews` rows are deleted from the harness database), so the real cadence shows the prompt in every viewport and theme.",
      );
    if (shot.freshCalendarProfile === true)
      lines.push(
        "No study profile before each capture (the persona's `student_study_profile` row is deleted from the harness database), so the save is a first save in every viewport and theme.",
      );
    for (const step of shot.steps ?? [])
      lines.push(
        "pick" in step
          ? `Step: pick the ${step.pick} choice (resolved from the served item's stored order in the harness database).`
          : "fill" in step
            ? `Step: type \`${step.value}\` into \`${JSON.stringify(step.fill)}\`.`
            : "focus" in step
              ? `Step: focus \`${JSON.stringify(step.focus)}\` (no typing).`
              : `Step: click \`${JSON.stringify(step.click)}\`${step.ariaDisabledOk === true ? " (aria-disabled but clickable: forced once visible)" : ""}.`,
      );
    if (shot.expectText !== undefined)
      lines.push(
        `Must then show the text \`${shot.expectText}\` (the capture fails otherwise).`,
      );
    if (shot.holdRequest !== undefined)
      lines.push(
        `Held: the browser's \`${shot.holdRequest.method} ${shot.holdRequest.path}\` is left unanswered through the screenshot, then aborted (it never reaches the server).`,
      );
    if (shot.fulfillRequest !== undefined)
      lines.push(
        `Stubbed in the browser: \`${shot.fulfillRequest.method} ${shot.fulfillRequest.path}\` is answered by the browser itself and never reaches the server. ${shot.fulfillRequest.reason}`,
      );
    if (shot.expectVisible !== undefined)
      lines.push(
        `Must then show \`${shot.expectVisible}\` (the capture fails otherwise).`,
      );
    if (shot.expectGone !== undefined)
      lines.push(
        `Must then show no \`${shot.expectGone}\` (the capture fails otherwise).`,
      );
    if (shot.fullPage === true)
      lines.push("Full page: the whole document, not just the viewport.");
    if (shot.expectFitsViewport !== undefined)
      lines.push(
        `Must fit the viewport (F-69): document no taller than the viewport, window unscrolled, \`${shot.expectFitsViewport.topBar}\` wholly in view${
          shot.expectFitsViewport.unscrolled !== undefined
            ? `, nothing to scroll in \`${shot.expectFitsViewport.unscrolled}\``
            : ""
        } (the capture fails otherwise); the measurement is under each built shot.`,
      );
    for (const extra of shot.extraViewports ?? [])
      lines.push(
        `Also shot at ${extra.name} ${extra.width}x${extra.height} (the ${extra.selectors} steps and selectors).`,
      );
    if (shot.failRequest !== undefined)
      lines.push(
        `Failed in the browser: requests whose path matches \`${shot.failRequest.pathPattern}\` get a network error and never reach the server. ${shot.failRequest.reason}`,
      );
    if (shot.expectPath !== undefined)
      lines.push(
        `Click path: must land on a path matching \`${shot.expectPath}\` (the capture fails otherwise); the path it landed on is under each built shot.`,
      );
    if (shot.prototype.kind === "none")
      lines.push(`Prototype: none. ${shot.prototype.reason}`);
    else
      lines.push(
        `Prototype: \`${shot.prototype.file}\`${shot.prototype.note ? ` (${shot.prototype.note})` : ""}${
          (shot.prototype.steps ?? []).length > 0
            ? `; clicked: ${(shot.prototype.steps ?? []).map((x) => `\`${x}\``).join(", ")}`
            : ""
        }.`,
      );
    lines.push(
      "",
      "| Viewport | Theme (as rendered) | Built | Prototype |",
      "|---|---|---|---|",
    );
    for (const row of rows.filter((r) => r.shot.id === shot.id)) {
      const built = row.built.skipped
        ? `skipped: ${row.built.skipped}`
        : `![${shot.id} ${row.viewport} ${row.theme}](${row.built.file})<br>\`${row.built.finalPath}\`, ${sizeOf(outDir, row.built.file)}, horizontal overflow ${row.built.overflowX}px${
            row.built.fit
              ? `, document ${row.built.fit.scrollHeight}px in a ${row.built.fit.innerHeight}px viewport, scrollY ${row.built.fit.scrollY}, top bar ${Math.round(row.built.fit.barTop)}..${Math.round(row.built.fit.barBottom)}px${
                  row.built.fit.unscrolled
                    ? `, \`${row.shot.expectFitsViewport?.unscrolled ?? ""}\` ${row.built.fit.unscrolled.scrollHeight}px of content in ${row.built.fit.unscrolled.clientHeight}px`
                    : ""
                }`
              : ""
          }`;
      let proto: string;
      if ("none" in row.proto) proto = row.proto.none;
      else {
        const caveat =
          row.viewport !== "desktop"
            ? "<br>desktop prototype (no phone layout)"
            : "";
        proto = `![prototype ${row.theme}](${row.proto.file})${caveat}, ${sizeOf(outDir, row.proto.file)}`;
      }
      lines.push(
        `| ${row.viewport} | ${themeLabel(row.theme, row.built)} | ${built} | ${proto} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Run facts", "");
  lines.push(`- Seeded ids: \`${JSON.stringify(stack.manifest)}\``);
  lines.push(
    `- Endpoints the pages asked for that the harness does not serve (answered 404): ${
      notServed.length === 0
        ? "none"
        : notServed.map((e) => `\`${e}\``).join(", ")
    }`,
  );
  lines.push(
    `- External hosts blocked: ${
      blockedHosts.size === 0
        ? "none"
        : [...blockedHosts]
            .sort()
            .map((h) => `\`${h}\``)
            .join(", ")
    }`,
  );
  lines.push("");
  fs.writeFileSync(path.join(outDir, "index.md"), lines.join("\n"));
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const groupId = process.argv[2];
  const group = groupId ? PAGE_GROUPS[groupId] : undefined;
  if (!group) {
    throw new Error(
      `usage: pnpm exec tsx tests/e2e/student-harness/capture.ts <group>; groups: ${Object.keys(PAGE_GROUPS).join(", ")}`,
    );
  }
  const outDir = path.join(
    group.outRoot === undefined ? OUT_ROOT : path.join(ROOT, group.outRoot),
    group.id,
  );
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const runDir = path.join(ROOT, "test-results", "student-harness");
  fs.mkdirSync(runDir, { recursive: true });

  const stack = await startStack(runDir, group.seed);
  const browser = await launch();
  const fontCss = fontFaceCss();
  const rows: Array<{
    shot: Shot;
    viewport: string;
    theme: Theme;
    built: BuiltResult;
    proto: ProtoResult;
  }> = [];
  try {
    for (const shot of group.shots) {
      // F-69: a shot may name sizes beyond desktop and phone (the exam module at tablet width).
      const sizes: Size[] = [
        standardSize("desktop"),
        standardSize("mobile"),
        ...(shot.extraViewports ?? []),
      ];
      for (const size of sizes) {
        const viewport = size.name;
        // UI-54: a shot may name its themes (the timed exam module is light only).
        for (const theme of shot.themes ?? THEMES) {
          const built = await shootBuilt(
            browser,
            stack,
            shot,
            size,
            theme,
            outDir,
            fontCss,
          );
          const proto: ProtoResult =
            shot.prototype.kind === "none"
              ? { none: "none" }
              : {
                  file: await shootPrototype(
                    browser,
                    shot.prototype,
                    theme,
                    outDir,
                    fontCss,
                  ),
                };
          rows.push({ shot, viewport, theme, built, proto });
          log(
            `capture: ${shot.id} ${viewport} ${theme} -> ${built.file} (${built.finalPath}, html data-theme=${String(built.htmlTheme)}, lock=${String(built.themeLock)}, overflow-x=${built.overflowX}px${built.fit ? `, document ${built.fit.scrollHeight}/${built.fit.innerHeight}px, scrollY ${built.fit.scrollY}, top bar ${Math.round(built.fit.barTop)}..${Math.round(built.fit.barBottom)}${built.fit.unscrolled ? `, unscrolled ${built.fit.unscrolled.scrollHeight}/${built.fit.unscrolled.clientHeight}` : ""}` : ""})` +
              ("file" in proto ? ` | ${proto.file}` : " | no prototype"),
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  const notServed = stack.serverLog
    ? [
        ...new Set(
          fs
            .readFileSync(stack.serverLog, "utf8")
            .match(/not served [A-Z]+ \S+/g) ?? [],
        ),
      ].map((s) => s.slice("not served ".length))
    : [];
  writeIndex(group, outDir, rows, stack, notServed);
  log(
    `capture: wrote ${rows.length} rows to ${path.relative(ROOT, path.join(outDir, "index.md"))}`,
  );
}

main().then(
  () => {
    stopChildren();
    process.exit(0);
  },
  (err: unknown) => {
    // eslint-disable-next-line no-console -- the capture failed; say why and stop the stack
    console.error(err);
    stopChildren();
    process.exit(1);
  },
);
