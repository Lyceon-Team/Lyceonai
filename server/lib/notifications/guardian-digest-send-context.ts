/**
 * What a `guardian_daily_digest` email needs at send time that its payload deliberately does not
 * carry: the guardian's signed one-click unsubscribe link, and a fresh read of the switch.
 *
 * @spec [Karl's rulings on #1223 (2026-10-13) item 5: "Add one-click unsubscribe to the digest: a
 *        signed link + List-Unsubscribe (and List-Unsubscribe-Post one-click) header, setting the
 *        SAME guardian preference as Settings (one writer). Follow the existing QOTD-email
 *        one-click unsubscribe pattern exactly"; contracts/notifications.contract.md C2A.3 (as
 *        amended)] | @implemented [2026-10-13]
 *
 * plain English: the QOTD send context's twin (qotd-daily-send-context.ts). The switch is re-read
 * through its one definition (`guardian_daily_digest_email_enabled`), so a guardian who turned
 * the email off — in Settings or by the link — after the 18:00 rule queued it is not sent it
 * (failed at once, never retried). The link is built here with the shared signing primitive
 * (`qotd-email-links.ts`, action `guardian_digest_unsubscribe`) and never stored.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { guardianDigestUnsubscribeUrl } from "../../services/qotd/qotd-email-links";
import type { RenderContext } from "./templates";

export async function guardianDigestSendContext(
  recipientProfileId: string,
  siteUrl: string,
): Promise<
  Result<
    NonNullable<RenderContext["guardianDigestEmail"]>,
    { reason: string; final: boolean }
  >
> {
  try {
    const { data, error } = await supabaseServer.rpc(
      "guardian_daily_digest_email_enabled",
      { p_guardian_id: recipientProfileId },
    );
    if (error)
      throw new Error(
        `guardian_daily_digest_email_enabled failed: ${error.message}`,
      );
    if (!z.boolean().parse(data)) {
      return err({
        reason:
          "guardian_daily_digest: the email is off for this guardian (withdrawn, not sent)",
        final: true,
      });
    }
    return ok({
      unsubscribeUrl: guardianDigestUnsubscribeUrl(siteUrl, recipientProfileId),
    });
  } catch (error) {
    return err({
      reason: `guardian_daily_digest send context failed: ${error instanceof Error ? error.message : "unknown"}`,
      final: false,
    });
  }
}
