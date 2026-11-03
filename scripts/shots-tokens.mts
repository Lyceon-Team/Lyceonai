/**
 * Screenshots of the `--primary` token gallery, light and dark.
 *
 *   pnpm exec vite build --config vite.shots-tokens.config.ts
 *   pnpm exec tsx scripts/shots-tokens.mts <outDir>
 *
 * The built directory is read once into a map and served from it, so no request-derived value
 * ever reaches the filesystem (CodeQL js/path-injection, alerts 107/108 on the sibling harness).
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "../dist/shots-tokens");
const OUT = process.argv[2] ?? "/tmp/shots-tokens";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

async function loadBuild(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (sub: string): Promise<void> => {
    for (const entry of await readdir(path.join(dir, sub), {
      withFileTypes: true,
    })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) await walk(rel);
      else files.set(`/${rel}`, await readFile(path.join(dir, rel)));
    }
  };
  await walk("");
  return files;
}

const BUILD = await loadBuild(DIR).catch(() => new Map<string, Buffer>());
if (!BUILD.has("/index.html")) {
  throw new Error(
    `No gallery build at ${DIR}. Run: pnpm exec vite build --config vite.shots-tokens.config.ts`,
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
await new Promise<void>((r) => server.listen(4603, () => r()));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--headless"],
});
for (const theme of ["light", "dark"] as const) {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
    deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:4603/?theme=${theme}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, `${theme}.png`),
    fullPage: true,
  });
  await page.close();
  process.stdout.write(`shot ${theme}\n`);
}
await browser.close();
server.close();
