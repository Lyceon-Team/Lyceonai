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
