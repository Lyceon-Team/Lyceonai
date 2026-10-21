/**
 * The review ask's one follow-up email: the daily rule.
 *
 * @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *        2026-10-20) Behaviour 3; Karl's Step 0 decisions 4 ("one email 3 days after an
 *        unanswered first ask") and 5 (adults only); contracts/notifications.contract.md §2.3,
 *        §6.2] | @implemented [2026-10-20]
 *
 * plain English: one call to `review_ask_email_notify`, the rule's one definition in SQL, which
 * queues a `review_ask` email for every adult whose first ask is 3 to 14 days old and
 * unanswered — once per person, ever. Run by the daily dispatch sweep (14:00 UTC, after quiet
 * hours end) just before it dispatches, so a queued email goes out in the same run; quiet hours
 * and the send-time re-check are the dispatcher's. Logs the count only.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import type { RpcClient } from "../../lib/rpc-client";
import { logger } from "../../logger";

const summarySchema = z.object({ emitted: z.number().int().min(0) }).strict();
export type ReviewAskEmailSummary = z.infer<typeof summarySchema>;

export async function runReviewAskEmailRule(
  now: Date,
  db: RpcClient = supabaseServer,
): Promise<ReviewAskEmailSummary> {
  const { data, error } = await db.rpc("review_ask_email_notify", {
    p_now: now.toISOString(),
  });
  if (error)
    throw new Error(`review_ask_email_notify failed: ${error.message}`);
  const summary = summarySchema.parse(data);
  logger.info(
    "PRODUCT_FEEDBACK",
    "review_ask_email_rule",
    "Review ask email rule ran",
    summary,
  );
  return summary;
}
