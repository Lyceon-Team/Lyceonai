/**
 * Each new piece of private feedback, posted to Slack #social as one line.
 *
 * @spec [owner brief "Trustpilot card on the homepage + 'Feedback' across the site" (final brief,
 *        Karl 2026-10-20) §5: "Post each new piece of feedback to #social through the existing
 *        Lyceon Social bot (chat.postMessage) … Always: type, route pattern, role, age band and
 *        whether a reply is OK. Message text: only for senders aged 18+, and only up to 300
 *        characters (truncated with '…'). Under-18s: never the text. Never: names, emails or IDs.
 *        A failed Slack post never blocks or fails the user's submission"; SCL-237 (amends the
 *        2026-10-05 "stored only, never forwarded" ruling); docs/runbooks/slack.md]
 *        | @implemented [2026-10-20]
 *
 * plain English: `feedbackSlackText` builds the line from facts the server already holds (never
 * the account's name, email or any id) and is the one place the age rule for the text lives.
 * `postFeedbackToSlack` sends it with the shared Slack client (shared/slack/client.ts), reading the
 * bot token and the channel from SLACK_BOT_TOKEN and SOCIAL_SLACK_CHANNEL_ID through the env
 * schema. It never throws, and the caller's submission has already been stored.
 *
 * @spec [owner brief "Feedback → Slack: log the real reason when it can't post" (Karl,
 *        2026-10-21)] | @implemented [2026-10-21]
 *
 * plain English (the logs): in production every refusal used to read "not set", even with both
 * settings present and the channel ID simply in the wrong format. Now one WARN per submission
 * names what is wrong:
 *   * `feedback_slack_misconfigured` with `reason` env_invalid (and the offending `fields`, names
 *     only), token_missing, token_not_bot or channel_invalid (with `channel` redacted to its first
 *     character and length, e.g. "#…(7)", or "unset");
 *   * `feedback_slack_failed` with `reason` slack_error and Slack's own `slack_error` code
 *     (not_in_channel, invalid_auth, http_500, …), or request_failed and the error's class name
 *     (a timeout, a network failure).
 * Never the token or any part of it, never the message text, never a user identifier.
 */
import { feedbackSlackEnvSchema } from "../../packages/shared/src/env";
import {
  FEEDBACK_TYPE_LABELS,
  type FeedbackAgeBand,
  type FeedbackType,
} from "../../packages/shared/src/product-feedback-schema";
import {
  escapeMrkdwn,
  postMessage,
  SlackCallError,
  slackConfig,
  type FetchLike,
  type SlackConfigReason,
} from "../../shared/slack/client";
import { logger } from "../logger";

export const FEEDBACK_SLACK_TEXT_MAX = 300;
const SLACK_TIMEOUT_MS = 3000;

export type FeedbackSlackInput = {
  type: FeedbackType;
  routePattern: string | null;
  role: "student" | "guardian";
  ageBand: FeedbackAgeBand;
  replyOk: boolean;
  body: string;
};

/** The message text, for an 18+ sender only: at most 300 characters, "…" when cut. */
export function feedbackSlackQuote(
  ageBand: FeedbackAgeBand,
  body: string,
): string | null {
  if (ageBand !== "18+") return null;
  const text = body.trim().replace(/\s+/g, " ");
  if (text.length <= FEEDBACK_SLACK_TEXT_MAX) return text;
  return `${text.slice(0, FEEDBACK_SLACK_TEXT_MAX - 1).trimEnd()}…`;
}

export function feedbackSlackText(input: FeedbackSlackInput): string {
  const head = [
    "New feedback",
    FEEDBACK_TYPE_LABELS[input.type],
    input.role,
    input.ageBand,
    input.routePattern ?? "page unknown",
    input.replyOk ? "reply OK" : "no reply",
  ].join(" · ");
  const quote = feedbackSlackQuote(input.ageBand, input.body);
  return quote === null
    ? escapeMrkdwn(head)
    : `${escapeMrkdwn(head)}\n> ${escapeMrkdwn(quote)}`;
}

export type FeedbackSlackOutcome = "posted" | "misconfigured" | "failed";

/** Why a Slack line could not even be attempted. */
export type FeedbackSlackMisconfiguredReason =
  | "env_invalid"
  | SlackConfigReason;

/** A channel ID as a log may show it: its first character and its length, never the rest. */
export function redactChannel(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  return value === "" ? "unset" : `${value.slice(0, 1)}…(${value.length})`;
}

export async function postFeedbackToSlack(
  input: FeedbackSlackInput,
  deps: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
    requestId?: string;
  } = {},
): Promise<FeedbackSlackOutcome> {
  const misconfigured = (
    reason: FeedbackSlackMisconfiguredReason,
    detail: Record<string, unknown> = {},
  ): FeedbackSlackOutcome => {
    logger.warn(
      "PRODUCT_FEEDBACK",
      "feedback_slack_misconfigured",
      "Feedback stored; no Slack line (SLACK_BOT_TOKEN / SOCIAL_SLACK_CHANNEL_ID unusable)",
      { requestId: deps.requestId, reason, ...detail },
    );
    return "misconfigured";
  };
  const env = feedbackSlackEnvSchema.safeParse(deps.env ?? process.env);
  if (!env.success) {
    // Field names only: an issue's message or input could echo the value.
    const fields = [
      ...new Set(env.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    return misconfigured("env_invalid", { fields });
  }
  const config = slackConfig({
    SLACK_BOT_TOKEN: env.data.SLACK_BOT_TOKEN,
    SLACK_CHANNEL_ID: env.data.SOCIAL_SLACK_CHANNEL_ID,
  });
  if (!config.ok) {
    return misconfigured(
      config.reason,
      config.reason === "channel_invalid"
        ? { channel: redactChannel(env.data.SOCIAL_SLACK_CHANNEL_ID) }
        : {},
    );
  }
  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    ((url, init) =>
      // chat.postMessage only ever sends a JSON string body.
      fetch(url, {
        method: init.method,
        ...(init.headers === undefined ? {} : { headers: init.headers }),
        ...(typeof init.body === "string" ? { body: init.body } : {}),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      }));
  try {
    await postMessage(config.value, feedbackSlackText(input), fetchImpl);
    return "posted";
  } catch (error) {
    logger.warn(
      "PRODUCT_FEEDBACK",
      "feedback_slack_failed",
      "Feedback stored; the Slack line failed",
      error instanceof SlackCallError
        ? // Slack's code only (SlackCallError keeps it to [a-z0-9_]); never the token or text.
          {
            requestId: deps.requestId,
            reason: "slack_error",
            slack_error: error.code,
          }
        : // A timeout or network failure: its class name, never its message.
          {
            requestId: deps.requestId,
            reason: "request_failed",
            error_name: error instanceof Error ? error.name : "unknown",
          },
    );
    return "failed";
  }
}
