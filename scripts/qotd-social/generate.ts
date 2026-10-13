/**
 * Build the Question of the Day social assets: two images, the caption and the alt text.
 *
 * @spec [Doc 10A §7, §11; owner decisions 2026-10-07 on the QOTD social assets (GitHub run
 *       downloads with the caption and alt text on the run page; portrait 1080x1350 + story
 *       1080x1920; choice order fixed per day; existing tooling only: the repo's KaTeX, Vite and
 *       Playwright, no new dependency; no question content to any third party)]
 *       | @implemented [2026-10-07]
 *
 * Usage:
 *   pnpm exec tsx scripts/qotd-social/generate.ts [--date YYYY-MM-DD|latest] [--out DIR] [--base-url URL]
 *
 * plain English:
 *   * Without --date it builds TODAY from GET /api/public/qotd/today, the website's own
 *     pre-submit payload: the answer and explanation are the literal null there, and the
 *     database decides which day "today" is, so no future day can be fetched.
 *   * --date builds a PAST day (strictly before today in America/Chicago, else exit 2) from the
 *     public archive. Its answer is dropped by socialInputFromArchive before anything is built,
 *     and the output is then checked against it with socialAssetLeaks. `--date latest` picks the
 *     newest archive day whose input passes socialInputProblems (pull request runs use it to
 *     prove the workflow end to end, the Slack dry run included).
 *   * The card (client/src/components/qotd/QotdSocialCard.tsx) is loaded through Vite's SSR
 *     loader, so the same aliases and the same StaticMath the site uses apply, rendered to static
 *     HTML with the site's fonts, and screenshotted by Playwright at each size. Text is set to
 *     the largest size at which nothing overflows; a format that cannot fit at 24px is not
 *     written and the run fails rather than cropping the question.
 *   * Every day: socialCopyProblems over the caption and alt text, revealWording over the card's
 *     visible text. Any problem: nothing is written, exit 1.
 *
 * Writes to DIR (default qotd-social-out/): qotd-<date>-portrait.png, qotd-<date>-story.png,
 * caption.txt, alt-text.txt and summary.md (the run-page summary, caption and alt text in code
 * blocks so GitHub shows a copy button), and post.json, the publish manifest the Slack poster
 * requires (written only when every check passed and every format was produced; see
 * publishDecision). Logs carry status only, never question text.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { z } from "zod";
import {
  qotdArchiveIndexResponseSchema,
  qotdArchiveResponseSchema,
  qotdDateSchema,
  qotdTodayResponseSchema,
  qotdSocialPostManifestSchema,
  type QotdArchiveResponse,
  type QotdSocialCopy,
  type QotdSocialInput,
  type QotdSocialPostManifest,
} from "../../packages/shared/src/qotd-schema";
import {
  QOTD_SECTION_NAME,
  QOTD_SOCIAL_FORMATS,
  buildSocialCopy,
  revealWording,
  socialAssetLeaks,
  socialCopyProblems,
  socialInputProblems,
  socialInputFromArchive,
  socialInputFromToday,
  type QotdSocialFormat,
} from "../../shared/qotd/social";
import { localTodayIn } from "../../server/services/calendar/adapters/local-day";

/** Status lines only (the logger is the server's; this is a CLI). */
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

const ROOT = resolve(import.meta.dirname, "../..");
/** The QOTD day boundary (plan R18); the same zone as public.qotd_today(). */
const QOTD_TIME_ZONE = "America/Chicago";
const MIN_FONT_PX = 24;
const MAX_FONT_PX: Record<QotdSocialFormat, number> = {
  portrait: 52,
  story: 58,
};
/** Short choices sit two by two on the portrait card. */
const SHORT_OPTION_CHARS = 24;

type Args = { date: string | null; out: string; baseUrl: string };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    date: null,
    out: join(ROOT, "qotd-social-out"),
    baseUrl: "https://lyceon.ai",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--date") args.date = value;
    else if (flag === "--out") args.out = resolve(value);
    else if (flag === "--base-url") args.baseUrl = value.replace(/\/$/, "");
    else throw new Error(`unknown argument ${flag}`);
    i += 1;
  }
  return args;
}

/**
 * A requested date is buildable only once it has passed. Exported for the test: future days
 * and today itself are refused (today is built from /today, without a date).
 */
export function pastDateProblem(
  date: string,
  now: Date = new Date(),
): string | null {
  if (!qotdDateSchema.safeParse(date).success)
    return `${date} is not a YYYY-MM-DD date`;
  const today = localTodayIn(QOTD_TIME_ZONE, now);
  return date < today
    ? null
    : `${date} has not passed yet (today is ${today} in ${QOTD_TIME_ZONE})`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${new URL(url).pathname} -> ${res.status}`);
  return res.json();
}

export type Source =
  | { kind: "today"; input: QotdSocialInput }
  | { kind: "past"; input: QotdSocialInput; revealed: QotdArchiveResponse };

/**
 * Whether a built day may be published, and if so its manifest (post.json).
 *
 * @spec [Doc 10A §7; owner brief 2026-10-10 (QOTD social assets to Slack: "never post a day
 *       with a leak-check failure"; the existing socialAssetLeaks check gates the post)]
 *       | @implemented [2026-10-10]
 *
 * plain English: every check the generator has always run (the input, the caption and alt text,
 * reveal wording on each card), plus socialAssetLeaks against the day's revealed answer when
 * the source is a past day. Any problem: no manifest, and the poster posts nothing. Today's
 * source has no answer to check against (the public pre-submit payload's answer and explanation
 * are the literal null), which the manifest records as "no-answer-in-source", never as a pass.
 * Pure: the caller writes the files.
 */
export function publishDecision(
  source: Source,
  copy: QotdSocialCopy,
  rendered: readonly { format: QotdSocialFormat; cardText: string }[],
  today: string,
):
  | { ok: true; manifest: QotdSocialPostManifest }
  | { ok: false; problems: string[] } {
  const { input } = source;
  const problems = [
    ...socialInputProblems(input),
    ...socialCopyProblems(copy, input),
  ];
  for (const r of rendered) {
    const reveal = revealWording(r.cardText, input);
    if (reveal) problems.push(`${r.format} card: ${reveal}`);
    if (source.kind === "past") {
      problems.push(
        ...socialAssetLeaks(
          {
            caption: copy.caption,
            alt_text: copy.alt_text,
            card_text: r.cardText,
          },
          source.revealed,
        ).map((leak) => `${r.format}: ${leak}`),
      );
    }
  }
  // "no-answer-in-source" is true only of today's own payload. A today source dated any other
  // day (a stale cache at the day boundary) is a day whose answer is already public: refused,
  // never posted without its leak check. Build it with --date instead.
  if (source.kind === "today" && input.qotd_date !== today) {
    problems.push(
      `source: the today payload is dated ${input.qotd_date}, not today (${today})`,
    );
  }
  if (rendered.length === 0) problems.push("no image was produced");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    manifest: qotdSocialPostManifestSchema.parse({
      qotd_date: input.qotd_date,
      section: QOTD_SECTION_NAME[input.section_code],
      source: source.kind,
      caption: copy.caption,
      alt_text: copy.alt_text,
      images: rendered.map((r) => ({
        format: r.format,
        file: `qotd-${input.qotd_date}-${r.format}.png`,
      })),
      checks: {
        input: "passed",
        copy: "passed",
        reveal_wording: "passed",
        leaks: source.kind === "past" ? "passed" : "no-answer-in-source",
      },
    }),
  };
}

/**
 * Write post.json for a complete, passing day, and make sure no post.json exists otherwise: the
 * Slack poster posts nothing without it (owner brief 2026-10-10). Returns whether it was written.
 */
export function writePublishManifest(
  outDir: string,
  decision: ReturnType<typeof publishDecision>,
  unfit: readonly string[],
): boolean {
  const path = join(outDir, "post.json");
  rmSync(path, { force: true });
  if (!decision.ok || unfit.length > 0) return false;
  writeFileSync(path, `${JSON.stringify(decision.manifest, null, 2)}\n`);
  return true;
}

/** How far back `--date latest` looks for a day whose input passes. */
const LATEST_LOOKBACK_DAYS = 14;

async function loadSource(args: Args): Promise<Source> {
  if (args.date === null) {
    const body = z
      .object({ data: qotdTodayResponseSchema })
      .parse(await getJson(`${args.baseUrl}/api/public/qotd/today`));
    return { kind: "today", input: socialInputFromToday(body.data) };
  }
  const body = z
    .object({ data: qotdArchiveResponseSchema })
    .parse(await getJson(`${args.baseUrl}/api/public/qotd/${args.date}`));
  return {
    kind: "past",
    input: socialInputFromArchive(body.data),
    revealed: body.data,
  };
}

type CardModule =
  typeof import("../../client/src/components/qotd/QotdSocialCard");

async function loadCardModule(): Promise<{
  card: CardModule;
  close: () => Promise<void>;
}> {
  const vite = await createServer({
    configFile: join(ROOT, "vite.config.ts"),
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const card = (await vite.ssrLoadModule(
    "/src/components/qotd/QotdSocialCard.tsx",
  )) as CardModule;
  return { card, close: () => vite.close() };
}

function fileUrl(path: string): string {
  return pathToFileURL(join(ROOT, path)).href;
}

function pageHtml(
  card: CardModule,
  input: QotdSocialInput,
  format: QotdSocialFormat,
): string {
  const { width, height } = QOTD_SOCIAL_FORMATS[format];
  const fonts = [
    ["Poppins", 500, "client/public/fonts/poppins-latin-500-normal.woff2"],
    ["Poppins", 600, "client/public/fonts/poppins-latin-600-normal.woff2"],
    ["Poppins", 700, "client/public/fonts/poppins-latin-700-normal.woff2"],
    [
      "Inter",
      "400 700",
      "client/public/fonts/inter-latin-400-700-normal.woff2",
    ],
  ]
    .map(
      ([family, weight, path]) =>
        `@font-face{font-family:${family};font-weight:${weight};src:url(${fileUrl(String(path))}) format("woff2")}`,
    )
    .join("\n");
  const body = renderToStaticMarkup(
    createElement(card.QotdSocialCard, {
      input,
      format,
      logoSrc: fileUrl("client/public/lyceon-logo.png"),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl("node_modules/katex/dist/katex.min.css")}">
<style>${fonts}
html,body{width:${width}px;height:${height}px}
${card.QOTD_SOCIAL_CARD_CSS}</style></head><body>${body}</body></html>`;
}

type Rendered = {
  format: QotdSocialFormat;
  file: string;
  fontPx: number;
  cardText: string;
};

async function renderFormats(
  card: CardModule,
  input: QotdSocialInput,
  workDir: string,
): Promise<{ rendered: Rendered[]; unfit: QotdSocialFormat[] }> {
  const executablePath = process.env.QOTD_SOCIAL_CHROMIUM;
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  const rendered: Rendered[] = [];
  const unfit: QotdSocialFormat[] = [];
  try {
    for (const format of Object.keys(
      QOTD_SOCIAL_FORMATS,
    ) as QotdSocialFormat[]) {
      const { width, height } = QOTD_SOCIAL_FORMATS[format];
      const htmlPath = join(workDir, `card-${format}.html`);
      writeFileSync(htmlPath, pageHtml(card, input, format));
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const twoColumns =
        format === "portrait" &&
        input.options.length > 0 &&
        input.options.every((o) => o.text.length <= SHORT_OPTION_CHARS);
      const fontPx = await page.evaluate(
        ({ max, min, twoColumns }) => {
          const body = document.getElementById("qs-body");
          if (!body) return -1;
          if (twoColumns) body.style.setProperty("--cols", "1fr 1fr");
          for (let size = max; size >= min; size -= 1) {
            body.style.setProperty("--fs", `${size}px`);
            if (
              body.scrollHeight <= body.clientHeight &&
              body.scrollWidth <= body.clientWidth
            ) {
              return size;
            }
          }
          return -1;
        },
        { max: MAX_FONT_PX[format], min: MIN_FONT_PX, twoColumns },
      );
      if (fontPx < 0) {
        unfit.push(format);
      } else {
        const file = join(workDir, `${format}.png`);
        await page.screenshot({ path: file, type: "png" });
        const cardText = await page
          .locator("[data-qotd-social-card]")
          .innerText();
        rendered.push({ format, file, fontPx, cardText });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { rendered, unfit };
}

function fenced(text: string): string {
  return ["~~~text", text, "~~~"].join("\n");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.date === "latest") {
    // The newest archive day: what a pull request run builds to prove the workflow end to end.
    const index = z
      .object({ data: qotdArchiveIndexResponseSchema })
      .parse(await getJson(`${args.baseUrl}/api/public/qotd/archive`));
    // The newest one whose input passes, so the run proves the full path (images, manifest,
    // Slack dry run) rather than an older input refusal, which the unit tests already cover.
    // Checked through loadSource, the same past-day read the build makes.
    let picked: string | null = null;
    for (const day of index.data.days.slice(0, LATEST_LOOKBACK_DAYS)) {
      const candidate = await loadSource({ ...args, date: day.qotd_date });
      if (socialInputProblems(candidate.input).length === 0) {
        picked = day.qotd_date;
        break;
      }
      out(`qotd-social: latest: skipping ${day.qotd_date} (input refused)`);
    }
    if (!picked) {
      err(
        `qotd-social: refused: no publishable day among the newest ${LATEST_LOOKBACK_DAYS} archive days`,
      );
      return 2;
    }
    args.date = picked;
  }
  if (args.date !== null) {
    const problem = pastDateProblem(args.date);
    if (problem) {
      err(`qotd-social: refused: ${problem}`);
      return 2;
    }
  }

  const source = await loadSource(args);
  const { input } = source;
  // Belt and braces: the endpoint decides "today", but a day that has not begun here is refused
  // whatever the server said.
  const today = localTodayIn(QOTD_TIME_ZONE);
  if (input.qotd_date > today) {
    err(
      `qotd-social: refused: ${input.qotd_date} has not begun (today is ${today})`,
    );
    return 2;
  }
  const copy = buildSocialCopy(input);

  rmSync(args.out, { recursive: true, force: true });
  const workDir = join(args.out, ".render");
  mkdirSync(workDir, { recursive: true });

  const { card, close } = await loadCardModule();
  let result: Awaited<ReturnType<typeof renderFormats>>;
  try {
    result = await renderFormats(card, input, workDir);
  } finally {
    await close();
  }

  const decision = publishDecision(source, copy, result.rendered, today);
  if (!decision.ok) {
    const { problems } = decision;
    rmSync(args.out, { recursive: true, force: true });
    mkdirSync(args.out, { recursive: true });
    writeFileSync(
      join(args.out, "summary.md"),
      [
        `## SAT Question of the Day: ${input.qotd_date}`,
        "",
        "**Not publishable; no images or caption were produced.**",
        "",
        ...problems.map((p) => `- ${p}`),
        "",
      ].join("\n"),
    );
    err(`qotd-social: ${input.qotd_date}: NOT PUBLISHABLE, nothing written`);
    for (const p of problems) err(`  - ${p}`);
    return 1;
  }

  const date = input.qotd_date;
  for (const r of result.rendered) {
    renameSync(r.file, join(args.out, `qotd-${date}-${r.format}.png`));
  }
  rmSync(workDir, { recursive: true, force: true });
  writeFileSync(join(args.out, "caption.txt"), `${copy.caption}\n`);
  writeFileSync(join(args.out, "alt-text.txt"), `${copy.alt_text}\n`);

  const summary = [
    `## SAT Question of the Day: ${date}`,
    "",
    `Images: ${result.rendered.map((r) => `${r.format} (text ${r.fontPx}px)`).join(", ") || "none"}. Download them from this run's **Artifacts**.`,
    ...(result.unfit.length > 0
      ? [
          "",
          `**Not produced:** ${result.unfit.join(", ")}: the question does not fit at ${MIN_FONT_PX}px.`,
        ]
      : []),
    "",
    "### Caption",
    fenced(copy.caption),
    "",
    "### Alt text",
    fenced(copy.alt_text),
    "",
  ].join("\n");
  writeFileSync(join(args.out, "summary.md"), summary);
  writePublishManifest(args.out, decision, result.unfit);

  out(
    `qotd-social: ${date} (${source.kind}): ${result.rendered
      .map((r) => `${r.format} ${r.fontPx}px`)
      .join(", ")}; checks passed`,
  );
  if (result.unfit.length > 0) {
    err(`qotd-social: ${date}: does not fit: ${result.unfit.join(", ")}`);
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      err(`qotd-social: failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
