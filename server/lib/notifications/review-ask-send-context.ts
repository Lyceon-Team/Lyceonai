/**
 * What a `review_ask` email needs at send time that its payload does not carry: the signed
 * "Stop review requests" link, the Trustpilot review URL, and a fresh read of the ask.
 *
 * @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *        2026-10-20) Behaviour 3 ("respects opt-outs"); Karl's Step 0 decisions 4 ("one email 3
 *        days after an unanswered first ask"), 5 (the signed one-click link) and 6
 *        (VITE_TRUSTPILOT_REVIEW_URL)] | @implemented [2026-10-20]
 *
 * plain English: the digest send context's twin (guardian-digest-send-context.ts). The ask is
 * re-read through `product_review_prompt_state_for`, so a person who answered it in the app, or
 * used "Stop review requests", after the sweep queued the email is not sent it (failed at once,
 * never retried). The stop link is built with the shared signing primitive
 * (`qotd-email-links.ts`, action `review_ask_stop`) and never stored.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { trustpilotReviewUrlFrom } from "../../../packages/shared/src/product-feedback-schema";
import { reviewAskStopUrl } from "../../services/qotd/qotd-email-links";
import type { RenderContext } from "./templates";

const askSchema = z
  .object({
    last_response: z.string().nullable(),
    reviewed_at: z.string().nullable(),
  })
  .passthrough()
  .nullable();

export async function reviewAskSendContext(
  recipientProfileId: string,
  siteUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<
  Result<
    NonNullable<RenderContext["reviewAskEmail"]>,
    { reason: string; final: boolean }
  >
> {
  try {
    const { data, error } = await supabaseServer.rpc(
      "product_review_prompt_state_for",
      { p_profile_id: recipientProfileId },
    );
    if (error)
      throw new Error(
        `product_review_prompt_state_for failed: ${error.message}`,
      );
    const ask = askSchema.parse(data);
    if (
      ask === null ||
      ask.last_response !== null ||
      ask.reviewed_at !== null
    ) {
      return err({
        reason:
          "review_ask: the ask was answered or stopped after the email was queued (withdrawn, not sent)",
        final: true,
      });
    }
    return ok({
      stopUrl: reviewAskStopUrl(siteUrl, recipientProfileId),
      trustpilotUrl: trustpilotReviewUrlFrom(env.VITE_TRUSTPILOT_REVIEW_URL),
    });
  } catch (error) {
    return err({
      reason: `review_ask send context failed: ${error instanceof Error ? error.message : "unknown"}`,
      final: false,
    });
  }
}
