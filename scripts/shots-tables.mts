/**
 * Screenshots of how a table question renders in each renderer, LF and CRLF.
 *   pnpm exec vite build --config vite.shots-tables.config.ts
 *   pnpm exec tsx scripts/shots-tables.mts <outDir>
 * The build is read once into a map and served from it, so no request-derived value reaches
 * the filesystem (CodeQL js/path-injection).
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "../dist/shots-tables");
const OUT = process.argv[2] ?? "/tmp/shots-tables";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
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
for (const eol of ["lf", "crlf"] as const) {
  const page = await browser.newPage({
    viewport: { width: 980, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:4604/?eol=${eol}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${eol}.png`), fullPage: true });
  await page.close();
  process.stdout.write(`shot ${eol}\n`);
}
await browser.close();
server.close();
