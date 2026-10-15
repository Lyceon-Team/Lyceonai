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
 *   env: SLACK_BOT_TOKEN (xoxb-…, scopes files:write and chat:write), SLACK_CHANNEL_ID (C…);
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
 *   * Not idempotent: nothing records that a day was posted, so re-running a run posts it again.
 *     Ruled acceptable by Karl, 2026-10-10 (re-runs are only for failed posts;
 *     docs/runbooks/qotd-slack.md §3).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  qotdSocialPostManifestSchema,
  type QotdSocialPostManifest,
} from "../../packages/shared/src/qotd-schema";
import { formatSocialDate } from "../../shared/qotd/social";
import {
  SlackCallError,
  escapeMrkdwn,
  postMessage,
  slackCall,
  slackConfig,
  type FetchLike,
  type Result,
  type SlackConfig,
} from "../slack/client";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type LoadedPost = {
  manifest: QotdSocialPostManifest;
  images: { format: string; file: string; bytes: Buffer }[];
};

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
    const path = join(dir, image.file);
    if (!existsSync(path) || statSync(path).size === 0) {
      return { ok: false, error: `${image.file} is missing` };
    }
    const bytes = readFileSync(path);
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { ok: false, error: `${image.file} is not a PNG` };
    }
    images.push({ format: image.format, file: basename(path), bytes });
  }
  return { ok: true, value: { manifest, images } };
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

const uploadUrlOk = z.object({
  ok: z.literal(true),
  upload_url: z.string().url(),
  file_id: z.string().min(1),
});
const completeOk = z.object({
  ok: z.literal(true),
  files: z.array(z.object({ id: z.string() })).min(1),
});

/** Post the day: images (with the date and section) first, then the caption and alt text. */
export async function postToSlack(
  config: SlackConfig,
  post: LoadedPost,
  fetchImpl: FetchLike,
): Promise<{
  imagesShared: number;
  messageTs: string;
  redditTs: string;
  revealTs: string;
}> {
  const { manifest } = post;
  const fileIds: { id: string; title: string }[] = [];
  for (const image of post.images) {
    const target = await slackCall(
      fetchImpl,
      config.token,
      "files.getUploadURLExternal",
      {
        form: {
          filename: image.file,
          length: String(image.bytes.length),
          alt_txt: manifest.alt_text,
        },
      },
      uploadUrlOk,
    );
    // The bytes go only to Slack's own host, over https (the token never goes there at all).
    const uploadUrl = new URL(target.upload_url);
    if (
      uploadUrl.protocol !== "https:" ||
      !uploadUrl.hostname.endsWith(".slack.com")
    ) {
      throw new SlackCallError(
        "files.getUploadURLExternal: upload_url is not a Slack https URL",
      );
    }
    const put = await fetchImpl(target.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(image.bytes),
    });
    if (!put.ok) {
      throw new SlackCallError(`upload of ${image.file}: HTTP ${put.status}`);
    }
    fileIds.push({ id: target.file_id, title: image.file });
  }
  const shared = await slackCall(
    fetchImpl,
    config.token,
    "files.completeUploadExternal",
    {
      json: {
        files: fileIds,
        channel_id: config.channel,
        initial_comment: slackImagesComment(manifest),
      },
    },
    completeOk,
  );
  const messageTs = await postMessage(
    config,
    slackCopyMessage(manifest),
    fetchImpl,
  );
  const redditTs = await postMessage(
    config,
    slackRedditMessage(manifest),
    fetchImpl,
  );
  const revealTs = await postMessage(
    config,
    slackRevealMessage(manifest),
    fetchImpl,
  );
  return {
    imagesShared: shared.files.length,
    messageTs,
    redditTs,
    revealTs,
  };
}

/** The whole command, injectable for tests. Returns the exit code. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
  log: { out(line: string): void; err(line: string): void },
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
    // Every check, the messages built, nothing sent.
    slackCopyMessage(manifest);
    slackRedditMessage(manifest);
    slackRevealMessage(manifest);
    log.out(
      `qotd-slack: dry run: ${manifest.qotd_date} (${manifest.section}, ${manifest.source}, leak check: ${manifest.checks.leaks}) would post ${post.value.images.length} image(s), the caption, the Reddit post and yesterday's reveal (${manifest.reveal.qotd_date}: ${manifest.reveal.status}); nothing sent`,
    );
    return 0;
  }
  const config = slackConfig(env);
  if (!config.ok) {
    log.err(`qotd-slack: not posted: ${config.error}`);
    return 1;
  }
  try {
    const sent = await postToSlack(config.value, post.value, fetchImpl);
    log.out(
      `qotd-slack: posted ${manifest.qotd_date} (${manifest.section}, ${manifest.source}, leak check: ${manifest.checks.leaks}): ${sent.imagesShared} image(s) and the caption, message ${sent.messageTs}; Reddit post ${sent.redditTs}; yesterday's reveal (${manifest.reveal.qotd_date}: ${manifest.reveal.status}) ${sent.revealTs}`,
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
