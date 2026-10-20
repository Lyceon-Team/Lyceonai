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
 * schema. It never throws: unset settings, a Slack error or a timeout (3 s) is logged as a WARN
 * carrying only Slack's error code, and the caller's submission has already been stored.
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
  slackConfig,
  type FetchLike,
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

export type FeedbackSlackOutcome = "posted" | "not_configured" | "failed";

export async function postFeedbackToSlack(
  input: FeedbackSlackInput,
  deps: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
    requestId?: string;
  } = {},
): Promise<FeedbackSlackOutcome> {
  const env = feedbackSlackEnvSchema.safeParse(deps.env ?? process.env);
  const config = slackConfig({
    SLACK_BOT_TOKEN: env.success ? env.data.SLACK_BOT_TOKEN : undefined,
    SLACK_CHANNEL_ID: env.success
      ? env.data.SOCIAL_SLACK_CHANNEL_ID
      : undefined,
  });
  if (!config.ok) {
    logger.warn(
      "PRODUCT_FEEDBACK",
      "feedback_slack_not_configured",
      "Feedback stored; no Slack line (SLACK_BOT_TOKEN / SOCIAL_SLACK_CHANNEL_ID not set)",
      { requestId: deps.requestId },
    );
    return "not_configured";
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
      {
        requestId: deps.requestId,
        // SlackCallError carries the method and Slack's code only; never the token or the text.
        reason:
          error instanceof Error ? error.message.slice(0, 120) : "unknown",
      },
    );
    return "failed";
  }
}
