/**
 * Proves a generated worked-example composition in a browser: everything inside TikTok's safe
 * area, and the paper blank.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "TikTok safe area
 *       (x 71..912, y 154..1555)", "fully blank paper (no lines or margin)", acceptance "30-60 s
 *       and the safe area", "blank-paper template"] | @implemented [2026-10-27]
 *
 * plain English: `pnpm exec tsx scripts/worked-examples/layout-check.ts <composition folder>`
 * opens index.html at 1080×1920, waits for the fit script to register the timeline, and measures
 * every element that draws something (hook, question card, recaps, notepad lines, circle, end
 * card; there are no captions since SCL-267, Karl's ruling 2026-11-02; the drawn figure's strokes
 * and labels since Karl's rulings 2026-11-11, which must also cross no text of the scenes the
 * figure stays through). Without the Hyperframes
 * runtime every scene is laid out at once, so every element of every scene is measured. Then it hides everything on the page and screenshots it:
 * every pixel must be the kit's paper colour, so no ruled line, margin or texture can creep into
 * the template. Exits 1 with each problem.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { safeArea } from "./composition";
import { loadKit, type Track } from "./kit";

export const DRAWN_SELECTORS = [
  ".hook",
  ".question",
  ".recap",
  ".hand",
  ".circle",
  ".logo",
  ".follow",
  ".brand-name",
  ".credit",
  ".fig-stroke",
  ".fig-label",
] as const;

/** The figure's elements, and the scenes it stays on screen through (open to answer). */
export const FIGURE_SELECTORS = [
  "#figure .fig-stroke",
  "#figure .fig-label",
] as const;
export const FIGURE_SCENE_TEXT = [
  "#open .hook",
  "#open .question",
  "#work .recap",
  "#work .hand",
  "#trap .hand",
  "#answer .recap",
  "#answer .hand",
  "#answer .circle",
] as const;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

/**
 * The drawn figure (Karl, 2026-11-11) stays on screen from the opening to the answer, so nothing
 * those scenes write may cross it: every figure box against every text box of those scenes.
 */
export function figureOverlapProblems(
  figure: readonly Box[],
  text: readonly Box[],
): string[] {
  const out: string[] = [];
  for (const f of figure)
    for (const t of text)
      if (overlaps(f, t))
        out.push(
          `${f.what} at y ${Math.round(f.y)}..${Math.round(f.bottom)} overlaps ${t.what} at y ${Math.round(t.y)}..${Math.round(t.bottom)}`,
        );
  return out;
}

export type Box = {
  what: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
};

/** Every box outside the safe area (1 px tolerance for subpixel layout). */
export function boxProblems(
  boxes: readonly Box[],
  safe: { left: number; right: number; top: number; bottom: number },
): string[] {
  const out: string[] = [];
  if (boxes.length === 0) out.push("nothing was measured");
  for (const b of boxes) {
    if (
      b.x < safe.left - 1 ||
      b.right > safe.right + 1 ||
      b.y < safe.top - 1 ||
      b.bottom > safe.bottom + 1
    )
      out.push(
        `${b.what} at x ${Math.round(b.x)}..${Math.round(b.right)}, y ${Math.round(b.y)}..${Math.round(b.bottom)} leaves the safe area x ${safe.left}..${safe.right}, y ${safe.top}..${safe.bottom}`,
      );
  }
  return out;
}

/** The end card's credit and outro text as the page lays them out. */
export type EndCardMeasure = {
  credits: { text: string; fontPx: number; right: number }[];
  /** The outro text sizes (.follow, .brand-name), in px. */
  outroPx: number[];
};

/**
 * The end card's music credit against the track's licence (Karl's ruling 2026-11-04): exactly
 * one credit with the track's on-screen text when the licence requires attribution, none when it
 * does not; at most a quarter of the smallest outro size; right-aligned to the safe area's right
 * edge (the box check above keeps it inside the safe area).
 */
export function creditProblems(
  m: EndCardMeasure,
  track: Track,
  safe: { right: number },
): string[] {
  const out: string[] = [];
  if (track.on_screen_credit === null) {
    if (m.credits.length > 0)
      out.push(
        "the end card shows a music credit, but the track needs no attribution",
      );
    return out;
  }
  if (m.credits.length !== 1) {
    out.push(
      `the end card must show the music credit once (the track's ${track.licence} licence requires it), found ${m.credits.length}`,
    );
    return out;
  }
  const [c] = m.credits;
  if (!c) return out;
  if (c.text !== track.on_screen_credit)
    out.push(
      `the end card's credit reads "${c.text}", not "${track.on_screen_credit}"`,
    );
  if (m.outroPx.length === 0)
    out.push("the end card's outro text was not measured");
  const limit = Math.min(...m.outroPx) / 4;
  if (c.fontPx > limit)
    out.push(
      `the credit is ${c.fontPx} px, over a quarter of the outro text (${limit} px)`,
    );
  if (Math.abs(c.right - safe.right) > 2)
    out.push(
      `the credit's right edge is at x ${Math.round(c.right)}, not at the safe area's right edge (${safe.right})`,
    );
  return out;
}

/** The share of pixels that are not the paper colour (RGBA buffer), as a count. */
export function nonPaperPixels(rgba: Uint8Array, paperHex: string): number {
  const r = parseInt(paperHex.slice(1, 3), 16);
  const g = parseInt(paperHex.slice(3, 5), 16);
  const b = parseInt(paperHex.slice(5, 7), 16);
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4)
    if (
      Math.abs((rgba[i] ?? 0) - r) > 1 ||
      Math.abs((rgba[i + 1] ?? 0) - g) > 1 ||
      Math.abs((rgba[i + 2] ?? 0) - b) > 1
    )
      n++;
  return n;
}

export async function layoutCheck(folder: string): Promise<string[]> {
  const kit = loadKit();
  const executablePath = process.env.WE_CHROMIUM;
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });
    await page.addInitScript(() => {
      (
        window as unknown as { __timelines: Record<string, unknown> }
      ).__timelines = {};
    });
    await page.goto(pathToFileURL(join(folder, "index.html")).href);
    await page.waitForFunction(
      () =>
        "main" in
        (window as unknown as { __timelines: Record<string, unknown> })
          .__timelines,
      null,
      { timeout: 30_000 },
    );
    // Measure the end state: every write done, the circle at its final scale.
    await page.evaluate(() => {
      const tl = (
        window as unknown as {
          __timelines: Record<string, { progress: (p: number) => void }>;
        }
      ).__timelines["main"];
      tl?.progress(1);
    });
    const boxes = await page.evaluate((selectors: readonly string[]) => {
      const out: {
        what: string;
        x: number;
        y: number;
        right: number;
        bottom: number;
      }[] = [];
      for (const sel of selectors)
        document.querySelectorAll(sel).forEach((el, k) => {
          const r = el.getBoundingClientRect();
          out.push({
            what: `${sel}[${k}] "${(el.textContent ?? "").trim().slice(0, 30)}"`,
            x: r.left,
            y: r.top,
            right: r.right,
            bottom: r.bottom,
          });
        });
      return out;
    }, DRAWN_SELECTORS);
    const problems = boxProblems(boxes, safeArea());
    const measure = (selectors: readonly string[]): Promise<Box[]> =>
      page.evaluate(
        (sels: readonly string[]) =>
          sels.flatMap((sel) =>
            [...document.querySelectorAll(sel)].map((el, k) => {
              const r = el.getBoundingClientRect();
              return {
                what: `${sel}[${k}] "${(el.textContent ?? "").trim().slice(0, 30)}"`,
                x: r.left,
                y: r.top,
                right: r.right,
                bottom: r.bottom,
              };
            }),
          ),
        selectors,
      );
    problems.push(
      ...figureOverlapProblems(
        await measure(FIGURE_SELECTORS),
        await measure(FIGURE_SCENE_TEXT),
      ),
    );
    // No named helper inside the callback: tsx (esbuild keepNames) wraps a named function in
    // __name(), which does not exist in the page, and evaluate fails with "__name is not defined".
    const endCard: EndCardMeasure = await page.evaluate(() => ({
      credits: [...document.querySelectorAll("#endcard .credit")].map((el) => ({
        text: (el.textContent ?? "").trim(),
        fontPx: parseFloat(getComputedStyle(el).fontSize),
        right: el.getBoundingClientRect().right,
      })),
      outroPx: [
        ...document.querySelectorAll("#endcard .follow, #endcard .brand-name"),
      ].map((el) => parseFloat(getComputedStyle(el).fontSize)),
    }));
    problems.push(...creditProblems(endCard, kit.track, safeArea()));
    await page.addStyleTag({
      content: "#root > * { visibility: hidden !important; }",
    });
    const shot = (await page.screenshot({ fullPage: false })).toString(
      "base64",
    );
    // Decoded and counted in the page (no PNG library in the repo), with the same function.
    const stray: unknown = await page.evaluate(
      `(async () => {
        const img = new Image();
        img.src = "data:image/png;base64,${shot}";
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        return (${nonPaperPixels.toString()})(data, ${JSON.stringify(kit.brand.colours.paper)});
      })()`,
    );
    if (typeof stray !== "number")
      throw new Error("the paper check returned no count");
    if (stray > 0)
      problems.push(
        `the paper is not blank: ${stray} pixels differ from ${kit.brand.colours.paper}`,
      );
    return problems;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (!folder) throw new Error("usage: layout-check.ts <composition folder>");
  const problems = await layoutCheck(resolve(folder));
  const meta: unknown = JSON.parse(
    readFileSync(join(resolve(folder), "meta.json"), "utf8"),
  );
  if (problems.length > 0) {
    process.stderr.write(
      `layout-check: ${problems.length} problem(s)\n  ${problems.join("\n  ")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `layout-check: safe area and blank paper OK (${JSON.stringify((meta as { duration?: unknown }).duration)} s)\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `layout-check: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
