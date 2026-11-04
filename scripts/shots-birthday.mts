/**
 * Shoots the birthday-input screenshots: desktop and 375px (iPhone Safari), each state.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04)] | @implemented [2026-11-04]
 *
 * plain English: serves `dist/shots-birthday` from a Map read at startup — no request-derived
 * value ever reaches the filesystem (CodeQL js/path-injection) — then photographs the page at
 * both widths. The 375px pass emulates iPhone Safari by name, so Playwright supplies the real
 * device scale factor rather than one I guess at, and it MEASURES the page width, failing if the
 * input pushed the page wider than the viewport.
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { chromium, devices } from "@playwright/test";

const DIST = "dist/shots-birthday";
const outDir = process.argv[2] ?? "/tmp/shots-birthday";
mkdirSync(outDir, { recursive: true });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Every built file, read ONCE into memory and keyed by its served path. */
const files = new Map<string, { body: Buffer; type: string }>();
(function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    const key = "/" + relative(DIST, full).split("\\").join("/");
    files.set(key, {
      body: readFileSync(full),
      // The resolved KEY decides the type, never the request (a "/" would give "" and
      // download as octet-stream — this bit me twice in earlier harnesses).
      type: TYPES[extname(key)] ?? "application/octet-stream",
    });
  }
})(DIST);

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0]!;
  const hit = files.get(path === "/" ? "/index.html" : path);
  if (!hit) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": hit.type }).end(hit.body);
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/`;

// The repo's pinned @playwright/test does not match the browser this environment installs, so
// the binary is named rather than resolved (same note as scripts/shots-billing.mts).
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--headless"],
});

async function shoot(name: string, ctxOptions: object, mobile: boolean) {
  const ctx = await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  // The fonts, so text is not measured mid-swap.
  await page.evaluate(() => document.fonts.ready);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });

  const m = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    confirmations: document.querySelectorAll(
      '[data-testid="text-birthday-confirmation"]',
    ).length,
    errors: document.querySelectorAll('[data-testid^="error-birth-"]').length,
    nativeDateInputs: document.querySelectorAll('input[type="date"]').length,
  }));
  console.log(
    `${name}: page ${m.page}px / viewport ${m.viewport}px` +
      `${m.page > m.viewport ? "  *** PAGE SCROLLS HORIZONTALLY ***" : " — no page scroll"}` +
      `; ${m.confirmations} confirmation line(s), ${m.errors} field error(s), ` +
      `${m.nativeDateInputs} native date input(s)`,
  );
  if (mobile && m.page > m.viewport) {
    throw new Error(`${name}: the page gained horizontal scroll at 375px`);
  }
  if (m.nativeDateInputs !== 0) {
    throw new Error(`${name}: a native date input is still on the page`);
  }
  if (m.confirmations === 0) throw new Error(`${name}: no confirmation line`);
  if (m.errors === 0) throw new Error(`${name}: no error state`);
  await ctx.close();
  return file;
}

const made: string[] = [];
made.push(await shoot("desktop-1280", { viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 }, false));
// By name, so Playwright supplies iPhone Safari own UA, scale factor and touch support.
// iPhone 13 Mini is 375px wide — the width the brief names — at iOS Safari deviceScaleFactor 3.
made.push(await shoot("mobile-375-iphone-safari", { ...devices["iPhone 13 Mini"] }, true));

await browser.close();
server.close();
console.log("\nwrote:\n" + made.map((f) => "  " + f).join("\n"));
