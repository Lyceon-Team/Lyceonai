/**
 * The one Slack client for repo jobs that post to Slack (the "Lyceon bot" convention).
 *
 * @spec [docs/runbooks/slack.md; owner brief 2026-10-10 (QOTD social assets to Slack: bot token
 *       as a GitHub secret, channel ID as a variable, fail loudly); owner brief "Doc 10B Phase 1"
 *       (Karl, 2026-10-11) scope 4 (batch notification "using the bot-token convention") and
 *       answer 11 ("use one SOCIAL_SLACK_CHANNEL_ID and rename #1186's variable")]
 *       | @implemented [2026-10-11]
 *
 * plain English: extracted from scripts/qotd-social/post-to-slack.ts so every job reads the same
 * two settings the same way and calls Slack the same way:
 *   * `slackConfig(env)`: SLACK_BOT_TOKEN (an `xoxb-` bot token, GitHub secret) and
 *     SLACK_CHANNEL_ID (set in the workflow from the repository variable SOCIAL_SLACK_CHANNEL_ID,
 *     which is #social). Missing or malformed fails; nothing defaults.
 *   * `slackCall`: one Web API call, its response parsed with Zod; a Slack error throws
 *     SlackCallError carrying Slack's error code only (never the token, never the payload).
 *   * `postMessage`: chat.postMessage with link unfurling off.
 *   * `escapeMrkdwn`: Slack's three control characters, and backtick runs inside code blocks.
 */
import { z } from "zod";

export const SLACK_API = "https://slack.com/api";

/** The repository variable that holds the #social channel ID (owner answer 11, 2026-10-11). */
export const SOCIAL_CHANNEL_VARIABLE = "SOCIAL_SLACK_CHANNEL_ID";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type SlackConfig = { token: string; channel: string };

/** The bot token and channel from the environment; missing or malformed fails, never defaults. */
export function slackConfig(env: NodeJS.ProcessEnv): Result<SlackConfig> {
  const token = env.SLACK_BOT_TOKEN?.trim() ?? "";
  const channel = env.SLACK_CHANNEL_ID?.trim() ?? "";
  if (token === "") {
    return {
      ok: false,
      error:
        "SLACK_BOT_TOKEN is not set (GitHub secret SLACK_BOT_TOKEN; see docs/runbooks/slack.md)",
    };
  }
  if (!token.startsWith("xoxb-")) {
    return { ok: false, error: "SLACK_BOT_TOKEN is not a bot token (xoxb-…)" };
  }
  if (!/^[CG][A-Z0-9]{8,}$/.test(channel)) {
    return {
      ok: false,
      error: `SLACK_CHANNEL_ID is not set or is not a channel ID (GitHub variable ${SOCIAL_CHANNEL_VARIABLE}, e.g. C0123456789)`,
    };
  }
  return { ok: true, value: { token, channel } };
}

/**
 * Slack's mrkdwn escaping: &, < and > are its control characters (also inside code). A run of
 * backticks would close a code block early, so a zero-width space breaks each pair up.
 */
export function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`(?=`)/g, "`​");
}

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class SlackCallError extends Error {}

const slackError = z.object({ ok: z.literal(false), error: z.string() });
export const postMessageOk = z.object({ ok: z.literal(true), ts: z.string() });

/** One Slack Web API call; the parsed success payload, or SlackCallError with Slack's code. */
export async function slackCall<T>(
  fetchImpl: FetchLike,
  token: string,
  method: string,
  body: { json: Record<string, unknown> } | { form: Record<string, string> },
  okSchema: z.ZodType<T>,
): Promise<T> {
  const init =
    "json" in body
      ? {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(body.json),
        }
      : {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(body.form).toString(),
        };
  const res = await fetchImpl(`${SLACK_API}/${method}`, init);
  if (!res.ok) throw new SlackCallError(`${method}: HTTP ${res.status}`);
  const payload: unknown = await res.json();
  const good = okSchema.safeParse(payload);
  if (good.success) return good.data;
  const bad = slackError.safeParse(payload);
  throw new SlackCallError(
    `${method}: ${bad.success ? bad.data.error : "unexpected response"}`,
  );
}

/** chat.postMessage, link previews off. Returns the message timestamp. */
export async function postMessage(
  config: SlackConfig,
  text: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const message = await slackCall(
    fetchImpl,
    config.token,
    "chat.postMessage",
    {
      json: {
        channel: config.channel,
        text,
        unfurl_links: false,
        unfurl_media: false,
      },
    },
    postMessageOk,
  );
  return message.ts;
}
