/**
 * Post a built Question of the Day to Slack: both images, then the caption and alt text.
 *
 * @spec [Doc 10A §7, §11; owner brief 2026-10-10 (QOTD social assets to Slack: after the daily
 *       build succeeds, post both images as file uploads and the caption and alt text as a
 *       message, with the date and section; bot token as a GitHub secret, channel ID as a
 *       variable; fail loudly, never silently; never post a day with a leak-check failure; no
 *       answers, no personal data)] | @implemented [2026-10-10]
 *
 * Usage:
 *   pnpm exec tsx scripts/qotd-social/post-to-slack.ts [--dir qotd-social-out] [--dry-run]
 *   env: SLACK_BOT_TOKEN (xoxb-…, scopes files:write, chat:write and files:read), SLACK_CHANNEL_ID (C…);
 *   both read by the shared client, scripts/slack/client.ts (docs/runbooks/slack.md).
 *
 * plain English:
 *   * Nothing is posted without post.json, the manifest generate.ts writes only when every
 *     check passed (publishDecision: the input, the caption and alt text, reveal wording, and
 *     socialAssetLeaks for a past day). The manifest is parsed with its schema, and caption.txt,
 *     alt-text.txt and the images must match it, so a hand-edited file is refused too.
 *   * Then, with Slack's standard external-upload API: files.getUploadURLExternal for each
 *     image, the bytes to the returned URL, files.completeUploadExternal to share both in the
 *     channel with the date and section; then chat.postMessage with the caption and alt text in
 *     code blocks (Slack shows a copy button on each). Every Slack response is parsed with Zod.
 *   * A missing token or channel, a refusal, or any Slack error exits 1 with the reason, so the
 *     run fails loudly; the workflow has already uploaded the run download by then.
 *   * --dry-run does every check and builds the message, but sends nothing and needs no token
 *     (pull request runs use it).
 *   * Logs carry status and Slack's error codes only: never the token, never question text.
 *   * After the caption, two more messages for r/satquestions (owner brief 2026-10-15; Reddit
 *     posting stays manual, Doc 10B): today's suggested Reddit title and the question as plain
 *     text, then "Yesterday's reveal" (yesterday's date, section and domain, the answer, the
 *     worked explanation and the archive link), both from post.json, which the generator built
 *     from yesterday's PUBLIC archive data only. A withheld yesterday is the notice alone.
 *   * Last, the TikTok carousel (Karl, 2026-10-23): yesterday's question as three slides, shared
 *     together with its title as the comment, then the title and caption in code blocks. When
 *     post.json says it was skipped (yesterday withheld or missing on the archive, or it does not
 *     fit), one line says so instead. The slides must exist, be PNGs and carry yesterday's date.
 *   * ORDER AND LABELS (owner brief "QOTD #social posts: fixed order, numbered labels", Karl
 *     2026-10-26): every day the same five items, each opening with its numbered label, posted
 *     strictly one after another (slackPostPlan):
 *       1/5 Reddit: comment on yesterday's post (the reveal)
 *       2/5 TikTok: title and caption
 *       3/5 TikTok: carousel (the three slides, in slide order)
 *       4/5 Reddit: today's post
 *       5/5 Today's question images (both images, then the caption and alt text)
 *     A file upload counts as posted only once Slack reports the files shared in the channel
 *     (shareFilesConfirmed polls files.info; bot scope files:read), so nothing overtakes it. An
 *     item with nothing to post keeps its number with a one-line "no … today (reason)". The
 *     content of each message is unchanged; only the order and the label line are new.
 *   * Not idempotent: nothing records that a day was posted, so re-running a run posts it again.
 *     Ruled acceptable by Karl, 2026-10-10 (re-runs are only for failed posts;
 *     docs/runbooks/qotd-slack.md §3).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  qotdSocialPostManifestSchema,
  type QotdSocialPostManifest,
} from "../../packages/shared/src/qotd-schema";
import { formatSocialDate } from "../../shared/qotd/social";
import {
  escapeMrkdwn,
  DEFAULT_SHARE_WAIT,
  postMessage,
  shareFilesConfirmed,
  slackConfig,
  type FetchLike,
  type Result,
  type ShareWait,
  type SlackConfig,
  type SlackUpload,
} from "../slack/client";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type LoadedPost = {
  manifest: QotdSocialPostManifest;
  images: { format: string; file: string; bytes: Buffer }[];
  /** The TikTok slides, in order; empty when the carousel was skipped. */
  tiktokSlides: { file: string; bytes: Buffer }[];
};

/** A PNG that exists, is not empty and is one, or why not. */
function readPng(dir: string, file: string): Result<Buffer> {
  const path = join(dir, file);
  if (!existsSync(path) || statSync(path).size === 0) {
    return { ok: false, error: `${file} is missing` };
  }
  const bytes = readFileSync(path);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, error: `${file} is not a PNG` };
  }
  return { ok: true, value: bytes };
}

/** The day to post, from DIR; refused unless the manifest exists, parses and matches the files. */
export function loadPost(dir: string): Result<LoadedPost> {
  const manifestPath = join(dir, "post.json");
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      error:
        "no post.json: the build did not pass its checks (or did not run), so nothing is posted",
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e: unknown) {
    // The parser's message can quote the file, which holds question text: never logged.
    return {
      ok: false,
      error: `post.json is not valid JSON (${e instanceof Error ? e.name : "error"})`,
    };
  }
  const parsed = qotdSocialPostManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `post.json does not match the manifest schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    };
  }
  const manifest = parsed.data;
  for (const [file, expected] of [
    ["caption.txt", manifest.caption],
    ["alt-text.txt", manifest.alt_text],
  ] as const) {
    const path = join(dir, file);
    if (!existsSync(path)) return { ok: false, error: `${file} is missing` };
    if (readFileSync(path, "utf8").replace(/\n$/, "") !== expected) {
      return { ok: false, error: `${file} does not match post.json` };
    }
  }
  const images: LoadedPost["images"] = [];
  for (const image of manifest.images) {
    if (!image.file.includes(manifest.qotd_date)) {
      return {
        ok: false,
        error: `${image.file} is not ${manifest.qotd_date}'s image`,
      };
    }
    const png = readPng(dir, image.file);
    if (!png.ok) return png;
    images.push({
      format: image.format,
      file: basename(image.file),
      bytes: png.value,
    });
  }
  const tiktokSlides: LoadedPost["tiktokSlides"] = [];
  if (manifest.tiktok.status === "built") {
    for (const file of manifest.tiktok.slides) {
      // The schema already pins each name to the carousel's day (yesterday); checked again here.
      if (!file.includes(manifest.tiktok.qotd_date)) {
        return {
          ok: false,
          error: `${file} is not ${manifest.tiktok.qotd_date}'s slide`,
        };
      }
      const png = readPng(dir, file);
      if (!png.ok) return png;
      tiktokSlides.push({ file: basename(file), bytes: png.value });
    }
  }
  return { ok: true, value: { manifest, images, tiktokSlides } };
}

/** The heading posted with the images: the date and section. */
export function slackImagesComment(m: QotdSocialPostManifest): string {
  return `*SAT Question of the Day* · ${formatSocialDate(m.qotd_date)} · ${m.section}`;
}

/** The message with the copy: the caption and alt text in code blocks, ready to copy. */
export function slackCopyMessage(m: QotdSocialPostManifest): string {
  return [
    `${slackImagesComment(m)}: caption and alt text`,
    "*Caption*",
    "```",
    escapeMrkdwn(m.caption),
    "```",
    "*Alt text*",
    "```",
    escapeMrkdwn(m.alt_text),
    "```",
  ].join("\n");
}

/** Today's suggested Reddit post: the title and the body, each ready to copy. */
export function slackRedditMessage(m: QotdSocialPostManifest): string {
  return [
    `*Reddit (r/satquestions)* · today's post, ${formatSocialDate(m.qotd_date)}`,
    "*Title*",
    "```",
    escapeMrkdwn(m.reddit.title),
    "```",
    "*Body*",
    "```",
    escapeMrkdwn(m.reddit.body),
    "```",
  ].join("\n");
}

/**
 * Yesterday's reveal, for the comment on yesterday's Reddit post. A withheld day (not published
 * on the archive) says so and carries nothing else (owner brief 2026-10-15).
 */
export function slackRevealMessage(m: QotdSocialPostManifest): string {
  const r = m.reveal;
  const heading = `*Yesterday's reveal* · ${formatSocialDate(r.qotd_date)}`;
  if (r.status === "withheld") {
    return `${heading}\nWithheld: yesterday's question is not published on the archive (a repaired question), so there is no reveal to post.`;
  }
  const answer =
    r.answer.kind === "choice"
      ? `${r.answer.letter}) ${r.answer.text}`
      : r.answer.value;
  return [
    `${heading} · ${r.section} · ${r.domain}`,
    "*Answer*",
    "```",
    escapeMrkdwn(answer),
    "```",
    "*Explanation*",
    "```",
    escapeMrkdwn(r.explanation),
    "```",
    `*Archive page:* ${r.archive_url}`,
  ].join("\n");
}

/** The comment shared with the three slides: what they are and whose day. */
export function slackTiktokSlidesComment(m: QotdSocialPostManifest): string {
  return `*TikTok carousel* · yesterday's question, ${formatSocialDate(m.tiktok.qotd_date)} · 3 slides, post in order`;
}

/** The TikTok title and caption, ready to copy (Karl, 2026-10-23). Only for a built carousel. */
export function slackTiktokMessage(m: QotdSocialPostManifest): string {
  const t = m.tiktok;
  // A day with no carousel never reaches here: slackPostPlan posts its numbered "no … today"
  // lines for items 2 and 3 instead (Karl, 2026-10-26).
  if (t.status !== "built") {
    throw new Error("slackTiktokMessage: there is no carousel on this day");
  }
  return [
    `*TikTok carousel* · title and caption (${formatSocialDate(t.qotd_date)})`,
    "*Title*",
    "```",
    escapeMrkdwn(t.title),
    "```",
    "*Caption*",
    "```",
    escapeMrkdwn(t.caption),
    "```",
  ].join("\n");
}

/** The five numbered labels, in posting order (Karl, 2026-10-26). */
export const SLACK_POST_LABELS = [
  "1/5 · Reddit: comment on yesterday's post",
  "2/5 · TikTok: title and caption",
  "3/5 · TikTok: carousel",
  "4/5 · Reddit: today's post",
  "5/5 · Today's question images",
] as const;

/** One step of the day's post: a message, or files shared with a comment. */
export type SlackPostStep =
  | { item: number; label: string; kind: "message"; text: string }
  | {
      item: number;
      label: string;
      kind: "files";
      comment: string;
      files: SlackUpload[];
    };

function labelled(label: string, text: string): string {
  return `*${label}*\n${text}`;
}

/** Why there is no carousel, for the "no … today" lines that keep items 2 and 3 numbered. */
function tiktokSkipReason(m: QotdSocialPostManifest): string {
  return m.tiktok.status === "skipped" && m.tiktok.reason === "does_not_fit"
    ? `yesterday's question (${formatSocialDate(m.tiktok.qotd_date)}) does not fit three slides`
    : `yesterday's question (${formatSocialDate(m.tiktok.qotd_date)}) is withheld or missing on the archive`;
}

/**
 * The day's post as an ordered list of steps: always items 1 to 5, in that order, each opening
 * with its label (Karl, 2026-10-26). Item 5 is two steps (the images, then their caption and alt
 * text), both under its label. Pure: the caller posts the steps one at a time.
 */
export function slackPostPlan(post: LoadedPost): SlackPostStep[] {
  const m = post.manifest;
  const [l1, l2, l3, l4, l5] = SLACK_POST_LABELS;
  const steps: SlackPostStep[] = [
    {
      item: 1,
      label: l1,
      kind: "message",
      text: labelled(l1, slackRevealMessage(m)),
    },
  ];
  if (m.tiktok.status === "built") {
    steps.push(
      {
        item: 2,
        label: l2,
        kind: "message",
        text: labelled(l2, slackTiktokMessage(m)),
      },
      {
        item: 3,
        label: l3,
        kind: "files",
        comment: labelled(l3, slackTiktokSlidesComment(m)),
        files: post.tiktokSlides.map((slide, i) => ({
          filename: slide.file,
          bytes: slide.bytes,
          altText: `SAT Question of the Day TikTok slide ${i + 1} of 3`,
        })),
      },
    );
  } else {
    const why = tiktokSkipReason(m);
    steps.push(
      {
        item: 2,
        label: l2,
        kind: "message",
        text: `*2/5 · TikTok: no title or caption today* (${why})`,
      },
      {
        item: 3,
        label: l3,
        kind: "message",
        text: `*3/5 · TikTok: no carousel today* (${why})`,
      },
    );
  }
  steps.push(
    {
      item: 4,
      label: l4,
      kind: "message",
      text: labelled(l4, slackRedditMessage(m)),
    },
    {
      item: 5,
      label: l5,
      kind: "files",
      comment: labelled(l5, slackImagesComment(m)),
      files: post.images.map((image) => ({
        filename: image.file,
        bytes: image.bytes,
        altText: m.alt_text,
      })),
    },
    {
      item: 5,
      label: l5,
      kind: "message",
      text: labelled(l5, slackCopyMessage(m)),
    },
  );
  return steps;
}

/** What one step left in Slack: a message timestamp, or the shared file IDs. */
export type SlackPostSent = {
  item: number;
  label: string;
  ts?: string;
  files?: string[];
};

/**
 * Post the day's steps strictly in order: each message, and each upload once Slack confirms the
 * files are shared in the channel, completes before the next step starts (Karl, 2026-10-26).
 */
export async function postToSlack(
  config: SlackConfig,
  post: LoadedPost,
  fetchImpl: FetchLike,
  wait: ShareWait = DEFAULT_SHARE_WAIT,
): Promise<SlackPostSent[]> {
  const sent: SlackPostSent[] = [];
  for (const step of slackPostPlan(post)) {
    if (step.kind === "message") {
      const ts = await postMessage(config, step.text, fetchImpl);
      sent.push({ item: step.item, label: step.label, ts });
    } else {
      const files = await shareFilesConfirmed(
        config,
        step.files,
        step.comment,
        fetchImpl,
        wait,
      );
      sent.push({ item: step.item, label: step.label, files });
    }
  }
  return sent;
}

/** The whole command, injectable for tests. Returns the exit code. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  log: { out(line: string): void; err(line: string): void },
  wait: ShareWait = DEFAULT_SHARE_WAIT,
): Promise<number> {
  const dirAt = argv.indexOf("--dir");
  const dir = dirAt >= 0 ? (argv[dirAt + 1] ?? "") : "qotd-social-out";
  const dryRun = argv.includes("--dry-run");

  const post = loadPost(dir);
  if (!post.ok) {
    log.err(`qotd-slack: refused: ${post.error}`);
    return 1;
  }
  const { manifest } = post.value;
  if (dryRun) {
    // Every check, the messages built, nothing sent; the sequence is printed in posting order.
    for (const step of slackPostPlan(post.value)) {
      log.out(
        `qotd-slack: dry run: ${step.label}: ${
          step.kind === "files"
            ? `${step.files.length} file(s), then wait until shared`
            : step.text.split("\n")[0]
        }`,
      );
    }
    log.out(
      `qotd-slack: dry run: ${manifest.qotd_date} (${manifest.section}, ${manifest.source}, leak check: ${manifest.checks.leaks}) would post ${post.value.images.length} image(s), the caption, the Reddit post, yesterday's reveal (${manifest.reveal.qotd_date}: ${manifest.reveal.status}) and the TikTok carousel (${manifest.tiktok.qotd_date}: ${manifest.tiktok.status}, ${post.value.tiktokSlides.length} slide(s)); nothing sent`,
    );
    return 0;
  }
  const config = slackConfig(env);
  if (!config.ok) {
    log.err(`qotd-slack: not posted: ${config.error}`);
    return 1;
  }
  try {
    const sent = await postToSlack(config.value, post.value, fetchImpl, wait);
    log.out(
      `qotd-slack: posted ${manifest.qotd_date} (${manifest.section}, ${manifest.source}, leak check: ${manifest.checks.leaks}; reveal ${manifest.reveal.qotd_date}: ${manifest.reveal.status}; TikTok ${manifest.tiktok.qotd_date}: ${manifest.tiktok.status}), in order: ${sent
        .map((s) =>
          s.files
            ? `${s.label} (${s.files.length} file(s) shared)`
            : `${s.label} (${s.ts ?? ""})`,
        )
        .join("; ")}`,
    );
    return 0;
  } catch (e: unknown) {
    log.err(
      `qotd-slack: NOT POSTED: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(process.argv.slice(2), process.env, (url, init) => fetch(url, init), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(
        `qotd-slack: failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    },
  );
}
