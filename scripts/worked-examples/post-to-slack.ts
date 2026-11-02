/**
 * Posts one worked example to #social as its labelled set: the video, the TikTok title, the
 * caption. Karl posts to TikTok by hand.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "posts it to #social
 *       as the labelled set 'Worked example · {skill} · {hook_type}': the video, a TikTok title
 *       (≤ 90 characters, starts with 'SAT') and a caption whose first line is 'Follow for daily
 *       SAT questions 👆'. This is separate from the QOTD set. Karl posts manually."]
 *       | @implemented [2026-10-27]
 *
 * plain English: `pnpm exec tsx scripts/worked-examples/post-to-slack.ts --dir <out> [--dry-run]`
 * reads <out>/post.json (written by scripts/worked-examples/daily.ts only after every check) and
 * the video it names. Three items, in this order, each confirmed before the next starts: the MP4
 * with the label as its comment (shareFilesConfirmed waits until Slack shows it in the channel),
 * then the title in a code block, then the caption in a code block, so each copies verbatim.
 * Uses the one Slack client (shared/slack/client.ts). --dry-run checks everything and sends
 * nothing. Logs never carry the token.
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

/** The four items, in order. Text only: the video's bytes are passed separately. */
export function workedExampleSlackSteps(
  post: WorkedExamplePost,
): WorkedExampleSlackStep[] {
  return [
    {
      kind: "video",
      comment: `*${escapeMrkdwn(post.label)}*\nFor review: posts on ${post.post_on}. Karl posts to TikTok by hand.`,
    },
    {
      kind: "message",
      text: `*${escapeMrkdwn(post.label)} · TikTok title*\n\`\`\`${escapeMrkdwn(post.title)}\`\`\``,
    },
    {
      kind: "message",
      text: `*${escapeMrkdwn(post.label)} · TikTok caption*\n\`\`\`${escapeMrkdwn(post.caption)}\`\`\`\n*Bio link*\n\`\`\`${escapeMrkdwn(post.links.tiktok)}\`\`\``,
    },
    // Owner brief "One funnel for every social post" (Karl, 2026-10-28) item 2.
    {
      kind: "message",
      text: `*${escapeMrkdwn(post.label)} · Instagram caption*\n\`\`\`${escapeMrkdwn(post.instagram_caption)}\`\`\`\n*Link to send to people who comment SAT*\n\`\`\`${escapeMrkdwn(post.links.instagram)}\`\`\``,
    },
  ];
}

export async function postWorkedExample(
  config: SlackConfig,
  post: WorkedExamplePost,
  video: Uint8Array,
  fetchImpl: FetchLike,
  wait: ShareWait = DEFAULT_SHARE_WAIT,
): Promise<void> {
  for (const step of workedExampleSlackSteps(post)) {
    if (step.kind === "video")
      await shareFilesConfirmed(
        config,
        [{ filename: post.video, bytes: video }],
        step.comment,
        fetchImpl,
        wait,
      );
    else await postMessage(config, step.text, fetchImpl);
  }
}

/** The platform fetch as the Slack client's FetchLike (bytes sent as a Blob). */
const nodeFetch: FetchLike = (url, init) =>
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
