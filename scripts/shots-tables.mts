/**
 * Before/after screenshots of every table question and the non-table controls.
 *
 *   pnpm exec vite build --config vite.shots-tables.config.ts
 *   pnpm exec tsx scripts/shots-tables.mts <outDir>
 *
 * The build is read once into a map and served from it, so no request-derived value reaches the
 * filesystem (CodeQL js/path-injection).
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "../dist/shots-tables");
const OUT = process.argv[2] ?? "/tmp/shots-tables";
const CORPUS = JSON.parse(
  await readFile(
    path.resolve(import.meta.dirname, "../client/shots-tables/questions.json"),
    "utf8",
  ),
) as { tables: Array<{ id: string }>; plain: Array<{ id: string }> };

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

async function loadBuild(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (sub: string): Promise<void> => {
    for (const e of await readdir(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, e.name);
      if (e.isDirectory()) await walk(rel);
      else files.set(`/${rel}`, await readFile(path.join(dir, rel)));
    }
  };
  await walk("");
  return files;
}

const BUILD = await loadBuild(DIR).catch(() => new Map<string, Buffer>());
if (!BUILD.has("/index.html")) {
  throw new Error(
    `No build at ${DIR}. Run: pnpm exec vite build --config vite.shots-tables.config.ts`,
  );
}

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const key = url === "/" ? "/index.html" : url;
  const body = BUILD.get(key);
  if (body === undefined) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(key)] ?? "application/octet-stream",
  });
  res.end(body);
});
await new Promise<void>((r) => server.listen(4604, () => r()));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--headless"],
});

/**
 * Phone width, for the two the owner named: SATM2K9CGMN and the widest of the 23.
 *
 * It MEASURES as well as photographs. "A wide table scrolls inside its own box at 375px instead
 * of widening the page" is a claim about `document.documentElement.scrollWidth`, and a
 * screenshot of a page that happens to fit cannot tell you whether a page that did not fit
 * would have. This throws if the page gained horizontal scroll, so the claim cannot pass by
 * looking right.
 */
const MOBILE: ReadonlyArray<{ set: "tables"; id: string; label: string }> = [
  { set: "tables", id: "SATM2K9CGMN", label: "the reported question" },
  { set: "tables", id: "SATRW2OWOU0Y", label: "the widest of the 23" },
];

for (const target of MOBILE) {
  const i = CORPUS[target.set].findIndex((q) => q.id === target.id);
  if (i < 0) throw new Error(`no such fixture: ${target.id}`);
  const page = await browser.newPage({
    viewport: { width: 375, height: 760 },
    deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:4604/?set=${target.set}&i=${i}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(400);

  const measured = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll(".question-table-wrap")];
    return {
      pageScrollWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      wraps: wraps.map((w) => ({
        clientWidth: w.clientWidth,
        scrollWidth: w.scrollWidth,
        overflowX: getComputedStyle(w).overflowX,
        maxWidth: getComputedStyle(w).maxWidth,
      })),
    };
  });

  if (measured.pageScrollWidth > measured.viewport) {
    throw new Error(
      `${target.id}: the PAGE scrolls horizontally at 375px ` +
        `(scrollWidth ${measured.pageScrollWidth} > viewport ${measured.viewport}) — ` +
        `the table widened the page instead of scrolling in its own box`,
    );
  }
  if (measured.wraps.length === 0) {
    throw new Error(`${target.id}: no .question-table-wrap rendered`);
  }
  for (const w of measured.wraps) {
    if (w.overflowX !== "auto") {
      throw new Error(`${target.id}: wrapper overflow-x is "${w.overflowX}", not "auto"`);
    }
  }
  const scrolling = measured.wraps.filter((w) => w.scrollWidth > w.clientWidth).length;
  process.stdout.write(
    `mobile-${target.id}: page ${measured.pageScrollWidth}px / viewport ` +
      `${measured.viewport}px — no page scroll; ` +
      `${scrolling} of ${measured.wraps.length} wrappers scroll internally (${target.label})\n`,
  );

  await page.screenshot({
    path: path.join(OUT, `mobile-375-${target.id}.png`),
    fullPage: true,
  });
  await page.close();
}

for (const set of ["tables", "plain"] as const) {
  const list = CORPUS[set];
  for (let i = 0; i < list.length; i += 1) {
    const page = await browser.newPage({
      viewport: { width: 940, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(`http://127.0.0.1:4604/?set=${set}&i=${i}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(350);
    const name = `${set}-${String(i + 1).padStart(2, "0")}-${list[i]!.id}.png`;
    await page.screenshot({ path: path.join(OUT, name), fullPage: true });
    await page.close();
    process.stdout.write(`${name}\n`);
  }
}
await browser.close();
server.close();
