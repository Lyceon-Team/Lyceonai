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
 *   * --date builds a PAST day (strictly before today's QOTD day, 04:00 UTC to 04:00 UTC, else
 *     exit 2) from the
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
 *   * Yesterday's reveal (owner brief 2026-10-15, for r/satquestion): read from yesterday's
 *     PUBLIC archive page data only (GET /api/public/qotd/<the day before>; the server refuses
 *     today and later), never from today's payload. A 404 is a withheld day (a repaired
 *     question): the reveal is the notice alone. Any other failure fails the run, loudly.
 *     Today's suggested Reddit title and plain-text body are built from the social input and go
 *     through the same leak check as the caption and alt text.
 *
 *   * TikTok carousel (Karl, 2026-10-23): yesterday's question as three 1080x1920 slides
 *     (question, pause, answer; client/src/components/qotd/QotdTiktokSlide.tsx), built from the
 *     SAME yesterday archive payload as the reveal (buildTiktokCarousel refuses any other day),
 *     with the fixed CTA-first caption and the short title. tiktokCarouselLeaks checks the slides,
 *     caption and title against today: today's question text never, and today's answer when it
 *     is known. Yesterday withheld or missing (404), or a slide that does not fit at 24px: no
 *     carousel, and post.json records why (the Slack poster posts a one-line note). A 4th slide
 *     is never added. A long explanation no longer skips the day: its "Why" is cut with a
 *     pointer to the full explanation (shared/qotd/tiktok.ts tiktokWhy; Karl, 2026-10-26).
 *
 * Writes to DIR (default qotd-social-out/): qotd-<date>-portrait.png, qotd-<date>-story.png,
 * qotd-<yesterday>-tiktok-1..3.png (when built),
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
  previousQotdDate,
  qotdArchiveIndexResponseSchema,
  qotdArchiveResponseSchema,
  qotdDateSchema,
  qotdTodayResponseSchema,
  qotdSocialPostManifestSchema,
  type QotdArchiveResponse,
  type QotdRedditPost,
  type QotdReveal,
  type QotdSocialCopy,
  type QotdSocialInput,
  type QotdSocialPostManifest,
  type QotdTiktokCarousel,
  type QotdTiktokPost,
} from "../../packages/shared/src/qotd-schema";
import {
  buildReveal,
  buildRedditPost,
  withheldReveal,
} from "../../shared/qotd/reveal";
import { campaignLinks } from "../../shared/social/funnel";
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
  tiktokCarouselLeaks,
  type QotdSocialFormat,
} from "../../shared/qotd/social";
import {
  qotdTiktokCaption,
  QOTD_TIKTOK_SIZE,
  buildTiktokCarousel,
  buildTiktokTitle,
  tiktokSafePx,
} from "../../shared/qotd/tiktok";
import {
  firstBannedPhrase,
  firstUnapprovedOutcome,
} from "../../shared/seo/banned-phrases";
import { qotdTodaySwitched } from "../../server/services/qotd/qotd-day";

/** Status lines only (the logger is the server's; this is a CLI). */
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
/** Every error line this run printed; written to failure.txt when the run exits non-zero. */
const errorLines: string[] = [];
function err(line: string): void {
  errorLines.push(line);
  process.stderr.write(`${line}\n`);
}

/**
 * A failed run leaves its reasons in <out>/failure.txt, which the workflow's failure step posts
 * to Slack (post-to-slack.ts --failure; Karl's rulings 2026-10-28, SCL-258: a refused served
 * order fails loudly and visibly, never silently). Lines are this run's own refusals and the API
 * status and error code; a refused order's reason carries no letter.
 */
function writeFailure(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "failure.txt"), `${errorLines.join("\n")}\n`);
}

const ROOT = resolve(import.meta.dirname, "../..");
/**
 * The QOTD day (Karl, 2026-10-27): 04:00 UTC to 04:00 UTC, the database's public.qotd_day after
 * the switch. This script has no database, so it uses the switched rule (qotd-day.ts) and checks
 * /today against it: a run before the database has switched is refused, never posted.
 */
const QOTD_DAY_RULE = "04:00 UTC to 04:00 UTC";
const MIN_FONT_PX = 24;
const MAX_FONT_PX: Record<QotdSocialFormat, number> = {
  portrait: 52,
  story: 58,
};
/** The TikTok slides' largest text size (slides 1 and 3; slide 2 is fixed). */
const TIKTOK_MAX_FONT_PX = 52;
const TIKTOK_SLIDES = [1, 2, 3] as const;
/** Short choices sit two by two on the portrait card. */
const SHORT_OPTION_CHARS = 24;

type Args = { date: string | null; out: string; baseUrl: string };

/** Where failure.txt goes: --out when it is given, else the default (even if other args are bad). */
function failureOutDir(argv: readonly string[]): string {
  const at = argv.indexOf("--out");
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value ? resolve(value) : join(ROOT, "qotd-social-out");
}

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
 * The day a run builds as "today" (Karl, 2026-10-27): the QOTD day at the run's moment, 04:00 UTC
 * to 04:00 UTC. The 04:05 UTC run therefore posts the day that began five minutes earlier (the
 * Reddit post and images) and reveals the day that just ended (the reveal and TikTok, read from
 * the archive as yesterday). /today must already be this day or the run is refused.
 */
export function socialRunToday(now: Date = new Date()): string {
  return qotdTodaySwitched(now);
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
  const today = socialRunToday(now);
  return date < today
    ? null
    : `${date} has not passed yet (today is ${today}, QOTD day ${QOTD_DAY_RULE})`;
}

/** The `error.code` of an API error body ({ error: { code, message } }); nothing else is read. */
const API_ERROR_CODE = /"error"\s*:\s*\{\s*"code"\s*:\s*"([a-z_]{1,64})"/;

/** A non-2xx answer from the public API: its status, and the API's error code at most. */
export class ApiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // The API's error code (e.g. qotd_order_invalid: a stored order the server refused), never
    // the rest of the body.
    const code = API_ERROR_CODE.exec(await res.text())?.[1];
    throw new ApiHttpError(
      `GET ${new URL(url).pathname} -> ${res.status}${code ? ` (${code})` : ""}`,
      res.status,
    );
  }
  return res.json();
}

export type Source =
  | { kind: "today"; input: QotdSocialInput }
  | { kind: "past"; input: QotdSocialInput; revealed: QotdArchiveResponse };

/**
 * The TikTok carousel as built for a day: three rendered slides of yesterday's question, or
 * skipped with the reason the Slack note gives, or refused (a defect: the run fails).
 */
export type TiktokBuild =
  | {
      status: "built";
      carouselDay: QotdArchiveResponse;
      carousel: QotdTiktokCarousel;
      slides: readonly { slide: 1 | 2 | 3; cardText: string }[];
    }
  | {
      status: "skipped";
      qotd_date: string;
      reason: "withheld" | "does_not_fit";
    }
  | { status: "refused"; problem: string };

/**
 * The checks on the carousel: yesterday's day only, three slides, nothing of today's question
 * or (when known) today's answer, and a caption and title that pass the public-copy guards.
 * Pure. Returns the manifest entry, or the problems.
 */
export function tiktokDecision(
  source: Source,
  tiktok: TiktokBuild,
): { ok: true; post: QotdTiktokPost } | { ok: false; problems: string[] } {
  const yesterday = previousQotdDate(source.input.qotd_date);
  if (tiktok.status === "refused")
    return { ok: false, problems: [tiktok.problem] };
  if (tiktok.status === "skipped") {
    return tiktok.qotd_date === yesterday
      ? {
          ok: true,
          post: {
            status: "skipped",
            qotd_date: tiktok.qotd_date,
            reason: tiktok.reason,
          },
        }
      : {
          ok: false,
          problems: [
            `tiktok: is for ${tiktok.qotd_date}, not yesterday (${yesterday})`,
          ],
        };
  }
  const problems: string[] = [];
  const day = tiktok.carousel.question.qotd_date;
  if (day !== yesterday || tiktok.carouselDay.qotd_date !== yesterday) {
    problems.push(`tiktok: is for ${day}, not yesterday (${yesterday})`);
  }
  if (tiktok.slides.length !== 3) {
    problems.push(`tiktok: ${tiktok.slides.length} slides, not 3`);
  }
  const title = buildTiktokTitle(day, tiktok.carousel.question.section_code);
  // Posted today, so the caption's bio line is today's (Karl, 2026-10-28).
  const caption = qotdTiktokCaption(source.input.qotd_date);
  for (const [field, text] of [
    ["tiktok caption", caption],
    ["tiktok title", title],
  ] as const) {
    const banned = firstBannedPhrase(text);
    if (banned) problems.push(`${field}: banned phrase (${banned.why})`);
    const outcome = firstUnapprovedOutcome(text);
    if (outcome)
      problems.push(`${field}: unapproved outcome claim (${outcome.why})`);
  }
  problems.push(
    ...tiktokCarouselLeaks(
      { slides: tiktok.slides.map((s) => s.cardText), caption, title },
      tiktok.carouselDay,
      {
        input: source.input,
        revealed: source.kind === "past" ? source.revealed : null,
      },
    ),
  );
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    post: {
      status: "built",
      qotd_date: day,
      title,
      caption,
      slides: TIKTOK_SLIDES.map((n) => `qotd-${day}-tiktok-${n}.png`),
    },
  };
}

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
  reddit: QotdRedditPost,
  reveal: QotdReveal,
  tiktok: TiktokBuild,
):
  | { ok: true; manifest: QotdSocialPostManifest }
  | { ok: false; problems: string[] } {
  const { input } = source;
  const problems = [
    ...socialInputProblems(input),
    ...socialCopyProblems(copy, input),
  ];
  // The TikTok carousel (Karl, 2026-10-23): any problem with it stops the whole post, as a leak
  // anywhere else does.
  const tiktokChecked = tiktokDecision(source, tiktok);
  if (!tiktokChecked.ok) problems.push(...tiktokChecked.problems);
  for (const r of rendered) {
    const wording = revealWording(r.cardText, input);
    if (wording) problems.push(`${r.format} card: ${wording}`);
    if (source.kind === "past") {
      problems.push(
        ...socialAssetLeaks(
          {
            caption: copy.caption,
            alt_text: copy.alt_text,
            card_text: r.cardText,
            reddit_title: reddit.title,
            reddit_body: reddit.body,
            instagram_caption: copy.instagram_caption,
          },
          source.revealed,
        ).map((leak) => `${r.format}: ${leak}`),
      );
    }
  }
  // Today's Reddit post is one of today's messages: reveal wording is refused there on every
  // day, as on the card (the leak check above adds the answer itself when it is known).
  for (const [field, text] of [
    ["reddit_title", reddit.title],
    ["reddit_body", reddit.body],
  ] as const) {
    const wording = revealWording(text, input);
    if (wording) problems.push(`${field}: ${wording}`);
  }
  // The reveal is yesterday's, never today's (owner brief 2026-10-15).
  const yesterday = previousQotdDate(input.qotd_date);
  if (reveal.qotd_date !== yesterday) {
    problems.push(
      `reveal: is for ${reveal.qotd_date}, not yesterday (${yesterday})`,
    );
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
  if (problems.length > 0 || !tiktokChecked.ok) return { ok: false, problems };
  return {
    ok: true,
    manifest: qotdSocialPostManifestSchema.parse({
      qotd_date: input.qotd_date,
      section: QOTD_SECTION_NAME[input.section_code],
      source: source.kind,
      caption: copy.caption,
      alt_text: copy.alt_text,
      instagram_caption: copy.instagram_caption,
      links: campaignLinks("qotd"),
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
      reddit,
      reveal,
      tiktok: tiktokChecked.post,
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

/**
 * `--date latest`: the newest of `dates` (newest first) whose day the archive serves and whose
 * input passes, or null. A day the archive answers 404 is not published there, as loadYesterday
 * already treats it (a withheld day, or one the index lists before the day endpoint will serve
 * it), so it is skipped like a refused input. Any other failure is rethrown.
 */
export async function pickLatestDay(
  dates: readonly string[],
  load: (date: string) => Promise<Source>,
  log: (line: string) => void,
): Promise<string | null> {
  for (const date of dates) {
    let candidate: Source;
    try {
      candidate = await load(date);
    } catch (e: unknown) {
      if (e instanceof ApiHttpError && e.status === 404) {
        log(
          `qotd-social: latest: skipping ${date} (the archive does not serve it)`,
        );
        continue;
      }
      throw e;
    }
    if (socialInputProblems(candidate.input).length === 0) return date;
    log(`qotd-social: latest: skipping ${date} (input refused)`);
  }
  return null;
}

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

/** The one HTTP shape loadReveal needs, injectable for tests. */
export type ArchiveFetch = (
  url: string,
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/**
 * Yesterday's reveal for `postedDate`: from the PUBLIC archive page data of the day before, and
 * nothing else (owner brief 2026-10-15). A 404 is a day the archive does not publish (a repaired
 * question, owner 2026-10-08): withheld, the notice alone. Anything else that is not a 200, and
 * any payload that does not parse or is not yesterday's, fails the run.
 */
export async function loadReveal(
  baseUrl: string,
  postedDate: string,
  fetchImpl: ArchiveFetch,
): Promise<QotdReveal> {
  return (await loadYesterday(baseUrl, postedDate, fetchImpl)).reveal;
}

/**
 * Yesterday's public archive day and its reveal, read once: the reveal and the TikTok carousel
 * are both built from this one payload (Karl, 2026-10-23). `day` is null when yesterday is
 * withheld or missing (404).
 */
export async function loadYesterday(
  baseUrl: string,
  postedDate: string,
  fetchImpl: ArchiveFetch,
): Promise<{ reveal: QotdReveal; day: QotdArchiveResponse | null }> {
  const yesterday = previousQotdDate(postedDate);
  const res = await fetchImpl(`${baseUrl}/api/public/qotd/${yesterday}`);
  if (res.status === 404) {
    return { reveal: withheldReveal(postedDate), day: null };
  }
  if (!res.ok) {
    throw new Error(
      `GET /api/public/qotd/${yesterday} -> ${res.status} (yesterday's reveal)`,
    );
  }
  const body = z
    .object({ data: qotdArchiveResponseSchema })
    .parse(await res.json());
  const built = buildReveal(body.data, postedDate);
  if (!built.ok) throw new Error(built.problem);
  return { reveal: built.reveal, day: body.data };
}

function archiveFetch(url: string): ReturnType<ArchiveFetch> {
  return fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
}

type CardModule =
  typeof import("../../client/src/components/qotd/QotdSocialCard");
export type SlideModule =
  typeof import("../../client/src/components/qotd/QotdTiktokSlide");

export async function loadCardModule(): Promise<{
  card: CardModule;
  slides: SlideModule;
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
  const slides = (await vite.ssrLoadModule(
    "/src/components/qotd/QotdTiktokSlide.tsx",
  )) as SlideModule;
  return { card, slides, close: () => vite.close() };
}

function fileUrl(path: string): string {
  return pathToFileURL(join(ROOT, path)).href;
}

function fontFaces(): string {
  return [
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
}

function pageHtml(
  card: CardModule,
  input: QotdSocialInput,
  format: QotdSocialFormat,
): string {
  const { width, height } = QOTD_SOCIAL_FORMATS[format];
  const fonts = fontFaces();
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

function tiktokPageHtml(
  slides: SlideModule,
  carousel: QotdTiktokCarousel,
  slide: 1 | 2 | 3,
): string {
  const { width, height } = QOTD_TIKTOK_SIZE;
  const body = renderToStaticMarkup(
    createElement(slides.QotdTiktokSlide, {
      slide,
      carousel,
      logoSrc: fileUrl("client/public/lyceon-logo.png"),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl("node_modules/katex/dist/katex.min.css")}">
<style>${fontFaces()}
html,body{width:${width}px;height:${height}px}
${slides.QOTD_TIKTOK_CSS}</style></head><body>${body}</body></html>`;
}

export type RenderedSlide = {
  slide: 1 | 2 | 3;
  file: string;
  fontPx: number;
  cardText: string;
};

/** The rectangle every slide's content must stay inside, in page pixels. */
export function tiktokSafeRect(): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const px = tiktokSafePx();
  return {
    left: px.left,
    top: px.top,
    right: QOTD_TIKTOK_SIZE.width - px.right,
    bottom: QOTD_TIKTOK_SIZE.height - px.bottom,
  };
}

/**
 * The three slides, each at the largest text size at which nothing overflows and every drawn
 * box stays inside TikTok's safe area. A slide that cannot manage that at 24px is listed in
 * `unfit` and nothing is screenshotted for it. Exported for the layout check
 * (scripts/qotd-social/tiktok-layout.ts).
 */
export async function renderTiktok(
  slides: SlideModule,
  carousel: QotdTiktokCarousel,
  workDir: string,
): Promise<{ rendered: RenderedSlide[]; unfit: number[] }> {
  const executablePath = process.env.QOTD_SOCIAL_CHROMIUM;
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  const rendered: RenderedSlide[] = [];
  const unfit: number[] = [];
  try {
    for (const slide of TIKTOK_SLIDES) {
      const htmlPath = join(workDir, `tiktok-${slide}.html`);
      writeFileSync(htmlPath, tiktokPageHtml(slides, carousel, slide));
      const page = await browser.newPage({
        viewport: { ...QOTD_TIKTOK_SIZE },
        deviceScaleFactor: 1,
      });
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const fontPx = await page.evaluate(
        ({ max, min, safe }) => {
          const body = document.getElementById("qs-body");
          const col = body?.closest(".tt-col");
          if (!body || !col) return -1;
          // Every drawn box inside TikTok's clear band and column (the hidden MathML copy
          // KaTeX keeps for screen readers is not drawn, so it is left out). No named inner
          // functions: the script runner would wrap them in a helper the page does not have.
          const boxes = [col, ...Array.from(col.querySelectorAll("*"))];
          for (let size = max; size >= min; size -= 1) {
            body.style.setProperty("--fs", `${size}px`);
            if (
              body.scrollHeight > body.clientHeight ||
              body.scrollWidth > body.clientWidth ||
              col.scrollHeight > col.clientHeight ||
              col.scrollWidth > col.clientWidth
            ) {
              continue;
            }
            let inside = true;
            for (const el of boxes) {
              if (el.closest(".katex-mathml")) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (
                r.left < safe.left - 0.5 ||
                r.top < safe.top - 0.5 ||
                r.right > safe.right + 0.5 ||
                r.bottom > safe.bottom + 0.5
              ) {
                inside = false;
                break;
              }
            }
            if (inside) return size;
          }
          return -1;
        },
        {
          max: TIKTOK_MAX_FONT_PX,
          min: MIN_FONT_PX,
          safe: tiktokSafeRect(),
        },
      );
      if (fontPx < 0) {
        unfit.push(slide);
      } else {
        const file = join(workDir, `tiktok-${slide}.png`);
        await page.screenshot({ path: file, type: "png" });
        const cardText = await page
          .locator("[data-qotd-tiktok-slide]")
          .innerText();
        rendered.push({ slide, file, fontPx, cardText });
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
    const picked = await pickLatestDay(
      index.data.days.slice(0, LATEST_LOOKBACK_DAYS).map((d) => d.qotd_date),
      (date) => loadSource({ ...args, date }),
      out,
    );
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
  const today = socialRunToday();
  if (input.qotd_date > today) {
    err(
      `qotd-social: refused: ${input.qotd_date} has not begun (today is ${today})`,
    );
    return 2;
  }
  const copy = buildSocialCopy(input);
  const reddit = buildRedditPost(input);
  const yesterday = await loadYesterday(
    args.baseUrl,
    input.qotd_date,
    archiveFetch,
  );
  const { reveal } = yesterday;

  rmSync(args.out, { recursive: true, force: true });
  const workDir = join(args.out, ".render");
  mkdirSync(workDir, { recursive: true });

  const { card, slides, close } = await loadCardModule();
  let result: Awaited<ReturnType<typeof renderFormats>>;
  let tiktok: TiktokBuild;
  let tiktokRendered: RenderedSlide[] = [];
  try {
    result = await renderFormats(card, input, workDir);
    const yesterdayDate = previousQotdDate(input.qotd_date);
    if (yesterday.day === null) {
      tiktok = {
        status: "skipped",
        qotd_date: yesterdayDate,
        reason: "withheld",
      };
    } else {
      const built = buildTiktokCarousel(yesterday.day, input.qotd_date);
      if (!built.ok) {
        tiktok = { status: "refused", problem: built.problem };
      } else {
        const shot = await renderTiktok(slides, built.carousel, workDir);
        if (shot.unfit.length > 0) {
          err(
            `qotd-social: tiktok: slide(s) ${shot.unfit.join(", ")} do not fit at ${MIN_FONT_PX}px: no carousel`,
          );
          tiktok = {
            status: "skipped",
            qotd_date: yesterdayDate,
            reason: "does_not_fit",
          };
        } else {
          tiktokRendered = shot.rendered;
          tiktok = {
            status: "built",
            carouselDay: yesterday.day,
            carousel: built.carousel,
            slides: shot.rendered.map((r) => ({
              slide: r.slide,
              cardText: r.cardText,
            })),
          };
        }
      }
    }
  } finally {
    await close();
  }

  const decision = publishDecision(
    source,
    copy,
    result.rendered,
    today,
    reddit,
    reveal,
    tiktok,
  );
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
  const tiktokPost = decision.manifest.tiktok;
  if (tiktokPost.status === "built") {
    for (const r of tiktokRendered) {
      const name = tiktokPost.slides[r.slide - 1];
      if (name) renameSync(r.file, join(args.out, name));
    }
  }
  rmSync(workDir, { recursive: true, force: true });
  writeFileSync(join(args.out, "caption.txt"), `${copy.caption}\n`);
  writeFileSync(join(args.out, "alt-text.txt"), `${copy.alt_text}\n`);
  writeFileSync(
    join(args.out, "instagram-caption.txt"),
    `${copy.instagram_caption}\n`,
  );
  const links = decision.manifest.links;

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
    "### Instagram caption",
    fenced(copy.instagram_caption),
    `Send to people who comment SAT: ${links.instagram}`,
    "",
    "### Reddit (today's post, with the portrait image)",
    fenced(`${reddit.title}\n\n${reddit.body}`),
    "",
    `### TikTok bio link\n${links.tiktok}`,
    "",
    "### Yesterday's reveal",
    reveal.status === "withheld"
      ? `${reveal.qotd_date}: withheld (not published on the archive), so there is no reveal.`
      : `${reveal.qotd_date}: posted to Slack with the answer and explanation; ${reveal.archive_url}`,
    "",
    "### TikTok carousel (yesterday's question)",
    ...(tiktokPost.status === "built"
      ? [
          `${tiktokPost.qotd_date}: three slides (${tiktokRendered.map((r) => `${r.slide}: text ${r.fontPx}px`).join(", ")}).`,
          "",
          "Title:",
          fenced(tiktokPost.title),
          "",
          "Caption:",
          fenced(tiktokPost.caption),
        ]
      : [
          `${tiktokPost.qotd_date}: no carousel (${tiktokPost.reason === "withheld" ? "yesterday is withheld or missing on the archive" : "yesterday's question does not fit three slides"}).`,
        ]),
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
  const outDir = failureOutDir(process.argv.slice(2));
  main().then(
    (code) => {
      if (code !== 0) writeFailure(outDir);
      process.exit(code);
    },
    (e: unknown) => {
      err(`qotd-social: failed: ${e instanceof Error ? e.message : String(e)}`);
      writeFailure(outDir);
      process.exit(1);
    },
  );
}
