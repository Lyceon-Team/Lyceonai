/**
 * The guardian's daily summary email switch.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Delivery": "The guardian
 *        can turn the digest email off in their notification settings (default on). Students
 *        can't affect it."; contracts/notifications.contract.md C2A.1, C2A.2 (amended)]
 *        | @implemented [2026-10-13]
 *
 * plain English: two calls over the two SQL functions that own the switch — the read
 * (`guardian_daily_digest_email_enabled`, where "no row" means ON) and the one writer
 * (`set_guardian_daily_digest_email`, which refuses anyone who is not a guardian). The in-app
 * events are not switchable; only the email is. Both answers are parsed against the shared
 * schema before they leave this module.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  guardianDigestPreferenceSchema,
  type GuardianDigestPreference,
} from "../../../packages/shared/src/notifications-schema";

export async function readGuardianDigestPreference(
  guardianId: string,
): Promise<GuardianDigestPreference> {
  const { data, error } = await supabaseServer.rpc(
    "guardian_daily_digest_email_enabled",
    { p_guardian_id: guardianId },
  );
  if (error) {
    throw new Error(
      `guardian_daily_digest_email_enabled failed: ${error.message}`,
    );
  }
  return { enabled: z.boolean().parse(data) };
}

export async function writeGuardianDigestPreference(
  guardianId: string,
  enabled: boolean,
): Promise<GuardianDigestPreference> {
  const { data, error } = await supabaseServer.rpc(
    "set_guardian_daily_digest_email",
    { p_guardian_id: guardianId, p_enabled: enabled },
  );
  if (error) {
    throw new Error(`set_guardian_daily_digest_email failed: ${error.message}`);
  }
  return guardianDigestPreferenceSchema.parse(data);
}
