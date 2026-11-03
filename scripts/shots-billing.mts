/**
 * Screenshots of the real cancellation control, one per decision.
 *
 * @spec [SCL-271; SCL-272; DESIGN.md §5 UI standards] | @implemented [2026-11-03]
 *
 * plain English: builds each row with the SERVER's own `describeCancellable`, hands it to the
 * harness page, and photographs the closed control and its confirmation. Expected outcome: the
 * pictures in the PR are of the shipped component with the shipped tokens, and the dates in
 * them were computed by the same code production runs.
 *
 *   pnpm exec vite build --config vite.shots-billing.config.ts
 *   pnpm exec tsx scripts/shots-billing.mts [outDir]
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { cancellableSubscriptionSchema } from "../packages/shared/src/billing-schema";
import { describeCancellable } from "../server/lib/stripe/cancellation-subject";

const DIR = path.resolve(import.meta.dirname, "../dist/shots-billing");
const OUT = process.argv[2] ?? "/tmp/shots-billing";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

const NOW = Math.floor(Date.now() / 1000);
const PERIOD_END = NOW + 9 * 86_400;
const INVOICE_FINALIZED = NOW - 2 * 86_400;

/** Only what `describeCancellable` reads of Stripe: the open-invoice list. */
function stripeFor(finalizedAt: number | null): Stripe {
  return {
    invoices: {
      list: async () => ({
        data:
          finalizedAt === null
            ? []
            : [
                {
                  id: "in_open",
                  created: finalizedAt,
                  status_transitions: { finalized_at: finalizedAt },
                },
              ],
        has_more: false,
      }),
    },
  } as unknown as Stripe;
}

async function row(shape: {
  status: string;
  cancelAt?: number | null;
  openInvoiceFinalizedAt?: number | null;
}): Promise<string> {
  const described = await describeCancellable(
    stripeFor(shape.openInvoiceFinalizedAt ?? null),
    {
      id: "sub_shot",
      status: shape.status,
      cancel_at: shape.cancelAt ?? null,
      cancel_at_period_end: false,
      customer: "cus_shot",
      items: { data: [{ current_period_end: PERIOD_END, metadata: {} }] },
      metadata: {},
    } as unknown as Stripe.Subscription,
    NOW,
  );
  if (described === null) throw new Error(`unsupported status: ${shape.status}`);
  const parsed = cancellableSubscriptionSchema.parse(described);
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64");
}

const SCENES: ReadonlyArray<{
  name: string;
  shape: Parameters<typeof row>[0];
  confirm: boolean;
  width: number;
  forLabel?: string;
  /** "default" renders the guardian look (no `.lyc` root), as that page has. */
  surface?: "default";
}> = [
  { name: "active-button", shape: { status: "active" }, confirm: false, width: 1440 },
  { name: "active-confirm", shape: { status: "active" }, confirm: true, width: 1440 },
  {
    name: "past-due-confirm",
    shape: { status: "past_due", openInvoiceFinalizedAt: INVOICE_FINALIZED },
    confirm: true,
    width: 1440,
  },
  { name: "unpaid-confirm", shape: { status: "unpaid" }, confirm: true, width: 1440 },
  {
    name: "scheduled-undo",
    shape: { status: "active", cancelAt: NOW + 4 * 86_400 },
    confirm: false,
    width: 1440,
  },
  {
    name: "guardian-row-button",
    shape: { status: "active" },
    confirm: false,
    width: 1440,
    forLabel: "Bo",
    surface: "default",
  },
  {
    name: "guardian-row-confirm",
    shape: { status: "active" },
    confirm: true,
    width: 1440,
    forLabel: "Bo",
    surface: "default",
  },
  { name: "active-button-mobile", shape: { status: "active" }, confirm: false, width: 390 },
  { name: "active-confirm-mobile", shape: { status: "active" }, confirm: true, width: 390 },
];

/**
 * Resolve a request path inside the build directory, or refuse.
 *
 * The request path is attacker-controlled in the general case — `GET /../../etc/passwd` is a
 * real request a real client can send — so joining it straight onto `DIR` is a path traversal
 * whatever the server's intended lifetime. CodeQL flagged exactly that here (alert 107,
 * "uncontrolled data used in path expression") and it was right: this binds to a port, and
 * "it only runs for eight screenshots" is a property of today's caller, not of the code.
 *
 * Decoded first, because `%2e%2e%2f` is `../` by the time the filesystem sees it, and then
 * checked by RESOLVED PREFIX rather than by scanning for "..", which is the check that cannot
 * be spelled around.
 */
function resolveInside(requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const resolved = path.resolve(DIR, `.${path.posix.normalize(decoded)}`);
  return resolved === DIR || resolved.startsWith(`${DIR}${path.sep}`)
    ? resolved
    : null;
}

// `pnpm build`'s prebuild step rimrafs `dist/`, so this directory goes away whenever a build
// runs. Say so, rather than serving 404s and timing out on a locator 30 seconds later.
if (!existsSync(path.join(DIR, "index.html"))) {
  throw new Error(
    `No harness build at ${DIR}. Run: pnpm exec vite build --config vite.shots-billing.config.ts`,
  );
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const file = resolveInside(url === "/" ? "/index.html" : url);
  if (file === null) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise<void>((r) => server.listen(4601, () => r()));
await mkdir(OUT, { recursive: true });

// The repo's pinned @playwright/test does not match the browser this environment installs, so
// the binary is named rather than resolved. Override with PW_CHROMIUM elsewhere.
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--headless"],
});
for (const scene of SCENES) {
  const encoded = await row(scene.shape);
  const page = await browser.newPage({
    viewport: { width: scene.width, height: scene.width < 600 ? 780 : 620 },
    deviceScaleFactor: 2,
  });
  const forParam =
    scene.forLabel === undefined
      ? ""
      : `&for=${encodeURIComponent(scene.forLabel)}`;
  const surfaceParam =
    scene.surface === undefined ? "" : `&surface=${scene.surface}`;
  await page.goto(
    `http://127.0.0.1:4601/?row=${encodeURIComponent(encoded)}${forParam}${surfaceParam}`,
    { waitUntil: "networkidle" },
  );
  if (scene.confirm) {
    await page.getByTestId("button-cancel-subscription").click();
    await page.getByTestId("cancel-confirm").waitFor();
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${scene.name}.png`) });
  await page.close();
  process.stdout.write(`shot ${scene.name}\n`);
}
await browser.close();
server.close();
