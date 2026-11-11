/**
 * Posts one worked example to #social: what Karl pastes on TikTok, Instagram and Facebook. Karl
 * posts by hand.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "posts it to #social
 *       as the labelled set 'Worked example · {skill} · {hook_type}' … This is separate from the
 *       QOTD set. Karl posts manually."; SCL-265 (Karl's ruling 2026-11-02): the set in the
 *       SCL-262 format, which replaces the 2026-10-27 items (TikTok title, caption with its first
 *       line "Follow for daily SAT questions 👆") and the 2026-10-28 "Bio link" and "Link to
 *       send to people who comment SAT" blocks] | @implemented [2026-10-27, SCL-262 format
 *       2026-11-02]
 *
 * plain English: `pnpm exec tsx scripts/worked-examples/post-to-slack.ts --dir <out> [--dry-run]`
 * reads <out>/post.json (written by scripts/worked-examples/daily.ts only after every check) and
 * the video it names. In order, each confirmed before the next starts (the QOTD's order,
 * scripts/qotd-social/post-to-slack.ts):
 *   QA         any warning ("SAT date list needs updating"), outside the copy blocks
 *   TikTok     the MP4, its comment the platform line, the label and the review line (outside
 *              the copy blocks); then ONE caption block and a keywords block, one per line
 *   Instagram  its platform line saying it is the same video, then its caption block
 *   Facebook   its platform line saying it is the same video, then its caption block
 * The video is uploaded once: like the QOTD's Facebook post, which uses the images already shared
 * rather than uploading them twice, Instagram and Facebook name the video above instead of
 * re-uploading it (the QOTD re-uploads for Instagram only because its TikTok media, the carousel,
 * differs; here all three platforms post the same MP4). No title, label, link or metadata inside
 * a copy block; the tagged /start links stay in post.json, never in the message (SCL-262). The
 * upload counts as posted only once Slack shows it in the channel (shareFilesConfirmed). Uses the
 * one Slack client (shared/slack/client.ts). --dry-run checks everything and sends nothing. Logs
 * never carry the token.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  workedExamplePostSchema,
  type WorkedExamplePost,
} from "../../packages/shared/src/worked-example-schema";
import {
  DEFAULT_SHARE_WAIT,
  escapeMrkdwn,
  postMessage,
  shareFilesConfirmed,
  slackConfig,
  type FetchLike,
  type ShareWait,
  type SlackConfig,
} from "../../shared/slack/client";

export type WorkedExampleSlackStep =
  | { kind: "video"; comment: string }
  | { kind: "message"; text: string };

/** A copy block: Slack shows a copy button on it. Nothing else goes inside. */
function copyBlock(text: string): string {
  return ["```", escapeMrkdwn(text), "```"].join("\n");
}

/** The platform line that opens a post, as the QOTD's. */
function platformLine(name: "TikTok" | "Instagram" | "Facebook"): string {
  return `*${name}*`;
}

/**
 * One video's #social set: what the message carries besides the video. A worked example is one
 * (workedExampleSlackSteps); so is a QOTD breakdown (scripts/qotd-social/breakdown.ts, SCL-266).
 *
 * Karl's ruling 2026-11-04 ("Copy-paste cleanup for all #social outputs"): outside the copy
 * blocks, one platform header per post (TikTok / Instagram / Facebook) and any QA warnings,
 * nothing else (no label, review line, date, file name or "same video" note); inside them, only
 * what Karl pastes (copyBlockProblems, checked when the post is built).
 */
export type VideoSet = {
  warnings: readonly string[];
  caption: string;
  keywords: readonly string[];
  instagram_caption: string;
  facebook_caption: string;
};

/** The steps for any video set, in order. Text only: the video's bytes are passed separately. */
export function videoSetSlackSteps(set: VideoSet): WorkedExampleSlackStep[] {
  const steps: WorkedExampleSlackStep[] = [];
  if (set.warnings.length > 0)
    steps.push({
      kind: "message",
      text: set.warnings.map((w) => `:warning: ${escapeMrkdwn(w)}`).join("\n"),
    });
  steps.push(
    {
      kind: "video",
      comment: platformLine("TikTok"),
    },
    {
      kind: "message",
      text: [copyBlock(set.caption), copyBlock(set.keywords.join("\n"))].join(
        "\n",
      ),
    },
    {
      kind: "message",
      text: [platformLine("Instagram"), copyBlock(set.instagram_caption)].join(
        "\n",
      ),
    },
    {
      kind: "message",
      text: [platformLine("Facebook"), copyBlock(set.facebook_caption)].join(
        "\n",
      ),
    },
  );
  return steps;
}

/** The steps for one worked example, in order. */
export function workedExampleSlackSteps(
  post: WorkedExamplePost,
): WorkedExampleSlackStep[] {
  return videoSetSlackSteps(post);
}

/** Posts a video set, each step confirmed before the next starts. */
export async function postVideoSet(
  config: SlackConfig,
  steps: readonly WorkedExampleSlackStep[],
  filename: string,
  video: Uint8Array,
  fetchImpl: FetchLike,
  wait: ShareWait = DEFAULT_SHARE_WAIT,
): Promise<void> {
  for (const step of steps) {
    if (step.kind === "video")
      await shareFilesConfirmed(
        config,
        [{ filename, bytes: video }],
        step.comment,
        fetchImpl,
        wait,
      );
    else await postMessage(config, step.text, fetchImpl);
  }
}

export async function postWorkedExample(
  config: SlackConfig,
  post: WorkedExamplePost,
  video: Uint8Array,
  fetchImpl: FetchLike,
  wait: ShareWait = DEFAULT_SHARE_WAIT,
): Promise<void> {
  await postVideoSet(
    config,
    workedExampleSlackSteps(post),
    post.video,
    video,
    fetchImpl,
    wait,
  );
}

/** The platform fetch as the Slack client's FetchLike (bytes sent as a Blob). */
export const nodeFetch: FetchLike = (url, init) =>
  fetch(url, {
    method: init.method,
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body === undefined
      ? {}
      : {
          body:
            typeof init.body === "string"
              ? init.body
              : new Blob([new Uint8Array(init.body)]),
        }),
  });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const k = args.indexOf("--dir");
  const dir = k === -1 ? undefined : args[k + 1];
  if (!dir) throw new Error("usage: post-to-slack.ts --dir <out> [--dry-run]");
  const post = workedExamplePostSchema.parse(
    JSON.parse(readFileSync(join(resolve(dir), "post.json"), "utf8")),
  );
  const video = readFileSync(join(resolve(dir), post.video));
  if (video.byteLength === 0) throw new Error(`${post.video} is empty`);
  if (args.includes("--dry-run")) {
    for (const step of workedExampleSlackSteps(post))
      process.stdout.write(
        step.kind === "video"
          ? `[dry run] video ${post.video} (${video.byteLength} bytes): ${step.comment}\n`
          : `[dry run] message: ${step.text}\n`,
      );
    return;
  }
  const config = slackConfig(process.env);
  if (!config.ok) throw new Error(config.error);
  await postWorkedExample(config.value, post, video, nodeFetch);
  process.stdout.write(`posted ${post.label} to Slack\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `post-to-slack: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
