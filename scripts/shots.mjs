import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIR = "/home/user/Lyceonai/dist/shots";
const OUT = "/tmp/claude-0/-home-user-Lyceonai/500be707-3efa-5f3f-94af-9b09100f6f60/scratchpad/shots";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const file = url === "/" ? "/index.html" : url;
  try {
    const body = await readFile(path.join(DIR, file));
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4599, r));

const SCENES = [
  ["week", 1440, 900, null],
  ["month", 1440, 900, null],
  ["week", 1440, 900, "sheet"],
  ["setup", 1440, 900, null],
  ["guardian", 1440, 900, null],
  ["loading", 1440, 900, null],
  ["premium", 1440, 900, null],
  ["error", 1440, 900, null],
  ["guardian-not-set-up", 1440, 900, null],
  ["week", 430, 900, "mobile"],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const [scene, w, h, variant] of SCENES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:4599/?scene=${scene}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if (scene === "month") {
    // The view toggle is component state, not a URL parameter — the scene only widens the
    // data range, so the Month view has to actually be pressed.
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.waitForTimeout(600);
  }
  if (variant === "sheet") {
    const card = page.locator('[data-testid^="calendar-block-"]').nth(1);
    await card.click();
    await page.waitForTimeout(500);
  }
  const name = variant ? `${scene}-${variant}` : scene;
  await page.screenshot({ path: path.join(OUT, `calendar-${name}.png`) });
  console.log("shot:", name);
  await page.close();
}
await browser.close();
server.close();
