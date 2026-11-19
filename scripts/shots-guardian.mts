/**
 * Screenshots of the parent-seat, teen-invite and book-a-call screens, for the DESIGN.md §5
 * checklist in the PR. NOT shipped.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §3; DESIGN.md §5] | @implemented [2026-11-19]
 *
 * plain English: serves the harness build from memory (the request path is a map key, never a
 * filesystem path — see scripts/shots-billing.mts for why) and photographs each scene, clicking
 * through where a state only exists after an action (the checkout dialog, the account menu, a
 * refused claim).
 *
 *   pnpm exec vite build --config vite.shots-guardian.config.ts
 *   pnpm exec tsx scripts/shots-guardian.mts [outDir]
 */
import { chromium, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "dist/shots-guardian");
const FONTS = path.join(ROOT, "client/public/fonts");
const OUT = process.argv[2] ?? "/tmp/shots-guardian";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

async function loadDir(
  dir: string,
  prefix: string,
  into: Map<string, Buffer>,
): Promise<void> {
  const walk = async (sub: string): Promise<void> => {
    for (const entry of await readdir(path.join(dir, sub), {
      withFileTypes: true,
    })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) await walk(rel);
      else into.set(`${prefix}/${rel}`, await readFile(path.join(dir, rel)));
    }
  };
  await walk("");
}

const BUILD = new Map<string, Buffer>();
await loadDir(DIR, "", BUILD).catch(() => undefined);
await loadDir(FONTS, "/fonts", BUILD).catch(() => undefined);
if (!BUILD.has("/index.html")) {
  throw new Error(
    `No harness build at ${DIR}. Run: pnpm exec vite build --config vite.shots-guardian.config.ts`,
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
await new Promise<void>((r) => server.listen(4602, () => r()));
await mkdir(OUT, { recursive: true });

type Shot = {
  name: string;
  scene: string;
  width: number;
  height?: number;
  act?: (page: Page) => Promise<void>;
};
const SHOTS: Shot[] = [
  { name: "01-home-no-students", scene: "home-buy", width: 1440, height: 900 },
  {
    name: "02-home-no-students-mobile",
    scene: "home-buy",
    width: 390,
    height: 1100,
  },
  {
    name: "03-seat-checkout-dialog",
    scene: "home-buy",
    width: 1440,
    height: 900,
    act: async (p) => {
      await p.getByTestId("guardian-no-students-buy-seat").click();
      await p.getByRole("dialog").waitFor();
    },
  },
  {
    name: "04-seat-checkout-dialog-mobile",
    scene: "home-buy",
    width: 390,
    height: 844,
    act: async (p) => {
      await p.getByTestId("guardian-no-students-buy-seat").click();
      await p.getByRole("dialog").waitFor();
    },
  },
  {
    name: "05-account-menu-talk-to-us",
    scene: "home-buy",
    width: 1440,
    height: 700,
    act: async (p) => {
      await p.getByTestId("button-user-menu").click();
      await p.getByTestId("menu-talk-to-us").waitFor();
    },
  },
  {
    name: "06-home-seat-waiting",
    scene: "home-seat-waiting",
    width: 1440,
    height: 900,
  },
  {
    name: "07-seat-card-no-invite",
    scene: "seat-no-invite",
    width: 1440,
    height: 520,
  },
  {
    name: "08-seat-card-invited",
    scene: "seat-invited",
    width: 1440,
    height: 520,
  },
  {
    name: "09-seat-card-invited-mobile",
    scene: "seat-invited",
    width: 390,
    height: 700,
  },
  {
    name: "10-seat-card-already-pro",
    scene: "seat-already-pro",
    width: 1440,
    height: 560,
  },
  {
    name: "11-seat-card-loading",
    scene: "seat-loading",
    width: 1440,
    height: 300,
  },
  { name: "12-seat-card-error", scene: "seat-error", width: 1440, height: 300 },
  { name: "13-join-loading", scene: "join-loading", width: 1440, height: 420 },
  { name: "14-join-error", scene: "join-error", width: 1440, height: 420 },
  { name: "15-join-invalid", scene: "join-invalid", width: 1440, height: 420 },
  {
    name: "16-join-signed-out",
    scene: "join-signed-out",
    width: 1440,
    height: 520,
  },
  {
    name: "17-join-signed-out-mobile",
    scene: "join-signed-out",
    width: 390,
    height: 700,
  },
  { name: "18-join-ready", scene: "join-ready", width: 1440, height: 480 },
  {
    name: "19-join-already-pro",
    scene: "join-already-pro",
    width: 1440,
    height: 420,
    act: async (p) => {
      await p.getByTestId("join-claim").click();
      await p.getByTestId("join-already-pro").waitFor();
    },
  },
  {
    name: "20-join-not-student",
    scene: "join-not-student",
    width: 1440,
    height: 420,
  },
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--headless"],
});
const errors: string[] = [];
for (const shot of SHOTS) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height ?? 800 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => errors.push(`${shot.name}: ${e.message}`));
  await page.goto(`http://127.0.0.1:4602/?scene=${shot.scene}`, {
    waitUntil: "networkidle",
  });
  if (shot.act) await shot.act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  await page.close();
  process.stdout.write(`shot ${shot.name}\n`);
}
await browser.close();
server.close();
if (errors.length > 0) {
  process.stderr.write(`page errors:\n${errors.join("\n")}\n`);
  process.exit(1);
}
