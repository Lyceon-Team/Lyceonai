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

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const file = url === "/" ? "/index.html" : url;
  try {
    const body = await readFile(path.join(DIR, file));
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
