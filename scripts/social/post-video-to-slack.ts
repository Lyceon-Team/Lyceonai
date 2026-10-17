/**
 * Post a rendered social video to #social for review: the MP4 as a file, then its caption as a
 * message on its own so it can be copied verbatim.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine, rule 5: Karl's
 *       approval gate), §8.4 (faceless video); owner brief 2026-10-16 (TikTok, October SAT score
 *       release: MP4 plus caption posted to #social by the existing bot, Karl reviews in Slack
 *       before posting)] | @implemented [2026-10-16]
 *
 * Usage:
 *   pnpm exec tsx scripts/social/post-video-to-slack.ts --video out.mp4 --caption share-copy.txt
 *     --title "October SAT score release (TikTok, 9:16)" [--dry-run]
 *   env: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, read by the shared client (docs/runbooks/slack.md).
 *
 * plain English:
 *   * Uses the one Slack client (scripts/slack/client.ts): shareFiles for the MP4 with a
 *     "for review, not posted anywhere" comment, then postMessage with the caption in a code
 *     block. Slack is a review step; publishing to TikTok stays manual, after Karl's approval.
 *   * A missing or empty file, a missing token or channel, or any Slack error exits 1 with the
 *     reason. --dry-run checks the files and builds the messages but sends nothing.
 *   * Logs carry file sizes and Slack's error codes only, never the token.
 *   * Not idempotent: re-running posts again. Re-runs are for failed posts only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  escapeMrkdwn,
  postMessage,
  shareFiles,
  slackConfig,
  type FetchLike,
  type Result,
} from "../slack/client";

export type VideoPost = {
  filename: string;
  bytes: Uint8Array;
  caption: string;
  title: string;
};

const MP4_BRAND = Buffer.from("ftyp", "ascii");

function argValue(argv: readonly string[], name: string): string {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? "") : "";
}

/** Reads and checks the video and caption named on the command line. */
export function loadVideoPost(argv: readonly string[]): Result<VideoPost> {
  const video = argValue(argv, "--video");
  const captionFile = argValue(argv, "--caption");
  const title = argValue(argv, "--title").trim();
  if (video === "" || captionFile === "" || title === "") {
    return { ok: false, error: "--video, --caption and --title are all required" };
  }
  if (!existsSync(video) || statSync(video).size === 0) {
    return { ok: false, error: `${video} is missing or empty` };
  }
  const bytes = readFileSync(video);
  // An MP4 carries its "ftyp" box at byte 4.
  if (!bytes.subarray(4, 8).equals(MP4_BRAND)) {
    return { ok: false, error: `${video} is not an MP4` };
  }
  if (!existsSync(captionFile)) {
    return { ok: false, error: `${captionFile} is missing` };
  }
  const caption = readFileSync(captionFile, "utf-8").trim();
  if (caption === "") return { ok: false, error: `${captionFile} is empty` };
  return { ok: true, value: { filename: basename(video), bytes, caption, title } };
}

export function videoComment(post: VideoPost): string {
  return `*For review:* ${escapeMrkdwn(post.title)}. Not posted anywhere yet; the caption follows.`;
}

export function captionMessage(post: VideoPost): string {
  return `*Caption*\n\`\`\`${escapeMrkdwn(post.caption)}\`\`\``;
}

/** The whole command, injectable for tests. Returns the exit code. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  log: { out(line: string): void; err(line: string): void },
): Promise<number> {
  const post = loadVideoPost(argv);
  if (!post.ok) {
    log.err(`social-video-slack: refused: ${post.error}`);
    return 1;
  }
  const size = `${post.value.filename} (${post.value.bytes.length} bytes)`;
  if (argv.includes("--dry-run")) {
    videoComment(post.value);
    captionMessage(post.value);
    log.out(`social-video-slack: dry run: would post ${size} and the caption; nothing sent`);
    return 0;
  }
  const config = slackConfig(env);
  if (!config.ok) {
    log.err(`social-video-slack: not posted: ${config.error}`);
    return 1;
  }
  try {
    await shareFiles(
      config.value,
      [{ filename: post.value.filename, bytes: post.value.bytes }],
      videoComment(post.value),
      fetchImpl,
    );
    const ts = await postMessage(config.value, captionMessage(post.value), fetchImpl);
    log.out(`social-video-slack: posted ${size}, caption message ${ts}`);
    return 0;
  } catch (e: unknown) {
    log.err(`social-video-slack: NOT POSTED: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.env, (url, init) => fetch(url, init), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(
        `social-video-slack: failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    },
  );
}
