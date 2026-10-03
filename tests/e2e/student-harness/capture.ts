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
import { PAGE_GROUPS } from "./groups";
import type {
  PageGroup,
  PrototypePairing,
  Shot,
  Theme,
  Viewport,
} from "./groups/types";
import { PERSONA_HEADER, type StudentPersona } from "./personas";
import type { SeedManifest } from "./seed";

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
const SETTLE_MS = 700;

type BuiltResult = {
  file: string;
  finalPath: string;
  htmlTheme: string | null;
  themeLock: string | null;
  /** CSS px the page is wider than the viewport (0 when nothing overflows horizontally). */
  overflowX: number;
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

async function startStack(runDir: string): Promise<Stack> {
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

function fillRoute(route: string, manifest: SeedManifest): string {
  return route.replace(
    /\{(free|paid)\.(\w+)\}/g,
    (_m, persona: StudentPersona, key: string) => {
      const value = (manifest[persona] as Record<string, unknown>)[key];
      if (typeof value !== "string")
        throw new Error(
          `route placeholder {${persona}.${key}} has no seeded value`,
        );
      return value;
    },
  );
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
  viewport: Viewport,
  theme: Theme,
  outDir: string,
  fontCss: string,
): Promise<BuiltResult> {
  const file = `${shot.id}--${viewport}--${theme}--built.png`;
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    reducedMotion: "reduce",
    extraHTTPHeaders:
      shot.persona === "signed-out" ? {} : { [PERSONA_HEADER]: shot.persona },
  });
  try {
    await localOnly(context, fontCss);
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
    await page.goto(
      `${stack.baseUrl}${fillRoute(shot.route, stack.manifest)}`,
      { waitUntil: "domcontentloaded" },
    );
    await settle(page);
    if (shot.waitFor)
      await page
        .locator(shot.waitFor[viewport])
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
    for (const step of shot.steps ?? []) {
      const selector = step.click[viewport];
      if (selector === null) continue;
      await page.locator(selector).first().click();
      await settle(page);
    }
    if (shot.expectPath !== undefined) {
      const expected = new RegExp(shot.expectPath);
      await page.waitForURL((url) => expected.test(url.pathname), {
        timeout: 20_000,
      });
      await settle(page);
    }
    await page.screenshot({
      path: path.join(outDir, file),
      fullPage: shot.fullPage === true,
    });
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
    return { file, finalPath: new URL(page.url()).pathname, ...dom };
  } finally {
    await context.close();
  }
}

type ProtoResult = { file: string } | { none: string };

function protoKey(
  p: Extract<PrototypePairing, { kind: "screen" }>,
  theme: Theme,
): string {
  const steps = (p.steps ?? []).length > 0 ? "--clicked" : "";
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
    viewport: Viewport;
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
    "- Viewport screenshots (not full page) unless the shot says full page: desktop 1440x900, phone 390x844.",
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
    for (const step of shot.steps ?? [])
      lines.push(`Step: click \`${JSON.stringify(step.click)}\`.`);
    if (shot.fullPage === true)
      lines.push("Full page: the whole document, not just the viewport.");
    if (shot.expectPath !== undefined)
      lines.push(
        `Click path: must land on a path matching \`${shot.expectPath}\` (the capture fails otherwise); the path it landed on is under each built shot.`,
      );
    if (shot.prototype.kind === "none")
      lines.push(`Prototype: none. ${shot.prototype.reason}`);
    else
      lines.push(
        `Prototype: \`${shot.prototype.file}\`${shot.prototype.note ? ` (${shot.prototype.note})` : ""}.`,
      );
    lines.push(
      "",
      "| Viewport | Theme (as rendered) | Built | Prototype |",
      "|---|---|---|---|",
    );
    for (const row of rows.filter((r) => r.shot.id === shot.id)) {
      const built = row.built.skipped
        ? `skipped: ${row.built.skipped}`
        : `![${shot.id} ${row.viewport} ${row.theme}](${row.built.file})<br>\`${row.built.finalPath}\`, ${sizeOf(outDir, row.built.file)}, horizontal overflow ${row.built.overflowX}px`;
      let proto: string;
      if ("none" in row.proto) proto = row.proto.none;
      else {
        const caveat =
          row.viewport === "mobile"
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
  const outDir = path.join(OUT_ROOT, group.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const runDir = path.join(ROOT, "test-results", "student-harness");
  fs.mkdirSync(runDir, { recursive: true });

  const stack = await startStack(runDir);
  const browser = await launch();
  const fontCss = fontFaceCss();
  const rows: Array<{
    shot: Shot;
    viewport: Viewport;
    theme: Theme;
    built: BuiltResult;
    proto: ProtoResult;
  }> = [];
  try {
    for (const shot of group.shots) {
      for (const viewport of ["desktop", "mobile"] as const) {
        for (const theme of THEMES) {
          const built = await shootBuilt(
            browser,
            stack,
            shot,
            viewport,
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
            `capture: ${shot.id} ${viewport} ${theme} -> ${built.file} (${built.finalPath}, html data-theme=${String(built.htmlTheme)}, lock=${String(built.themeLock)}, overflow-x=${built.overflowX}px)` +
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
