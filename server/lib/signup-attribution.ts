/**
 * Records the sign-up channel and campaign on a new account.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2: "at sign-up, store one coarse `signup_channel` on the profile ...
 *       plus `signup_campaign` ..., first touch only, allowlisted values, no raw URL. It must work
 *       without the analytics cookie."] | @implemented [2026-10-28]
 *
 * plain English: the browser sends the first touch it derived from the landing address
 * (packages/shared/src/signup-attribution.ts) with the email sign-up, or on the Google callback
 * URL. This re-parses it against the same allowlists and writes `profiles.signup_channel` and
 * `signup_campaign` once, only on an account that has not completed onboarding and has no channel
 * yet, so a returning user cannot rewrite where they came from. The database also enforces
 * set-once and clears both for an under-13 profile (trigger profiles_zz_signup_attribution).
 * Nothing here reads or needs the analytics cookie.
 *
 * edge cases: an unknown channel drops the whole value (nothing written); a campaign not on the
 * list is recorded as no campaign, the channel still counts; a write failure is logged
 * without the values and the sign-up carries on: attribution is never worth an account.
 */
import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { z } from "zod";
import {
  allowlistedCampaign,
  signupChannelSchema,
  type SignupAttribution,
} from "../../packages/shared/src/signup-attribution";
import { logger } from "../logger";

/** The attribution from the Google callback's query (`signup_channel`, `signup_campaign`). */
export function signupAttributionFromQuery(
  channel: unknown,
  campaign: unknown,
): SignupAttribution | null {
  const parsed = signupChannelSchema.safeParse(channel);
  return parsed.success
    ? { channel: parsed.data, campaign: allowlistedCampaign(campaign) }
    : null;
}

/** The body field: the channel must be one of the seven; a campaign not on the list is null. */
const signupAttributionBodySchema = z
  .object({ channel: signupChannelSchema, campaign: z.unknown().optional() })
  .transform(
    (v): SignupAttribution => ({
      channel: v.channel,
      campaign: allowlistedCampaign(v.campaign),
    }),
  );

export async function recordSignupAttribution(
  profileId: string,
  raw: unknown,
  requestId: string | undefined,
): Promise<void> {
  const parsed = signupAttributionBodySchema.safeParse(raw);
  if (!parsed.success) return;
  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .update({
      signup_channel: parsed.data.channel,
      signup_campaign: parsed.data.campaign,
    })
    .eq("id", profileId)
    .is("signup_channel", null)
    .is("profile_completed_at", null);
  if (error) {
    logger.warn(
      "ANALYTICS",
      "signup_attribution_write_failed",
      "signup channel not recorded",
      { code: error.code ?? "unknown", requestId },
    );
  }
}
