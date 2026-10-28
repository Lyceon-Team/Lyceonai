/**
 * Records the visitor's first-touch channel on a new account.
 *
 * @spec [SCL-201 IS 6 ("`user_signed_up.signup_source` is set server-side from the visitor's
 *       first-touch UTM, captured before signup and carried to the post-signup handler"); Doc 07A
 *       §6.2 (the enum); plan R11, F10] | @implemented [2026-10-05]
 *
 * plain English: the browser derives the channel in memory (nothing stored on the device) and
 * sends it with the email signup or carries it through the Google callback. This writes it to
 * `profiles.signup_source` — once, and only on an account that has not completed onboarding, so a
 * returning user signing in through the same path cannot rewrite where they came from. The
 * database enforces set-once as well (trigger profiles_analytics_fields_set_once).
 *
 * edge cases: an unparseable value is ignored (the event then reports `unknown`); a write failure
 * is logged and the signup carries on — attribution is never worth an account.
 *
 * SEO-1 (owner brief "One funnel for every social post", Karl, 2026-10-28): the same write also
 * records `signup_channel` and `signup_campaign`, the allowlisted `utm_source` / `utm_campaign` of
 * the link the visitor came by (packages/shared deriveSignupTags). Each is re-parsed here against
 * the same allowlist; an absent or unknown value is left NULL. Same set-once rule, same guard (a
 * not-yet-onboarded account), same trigger-backed immutability (profiles_signup_tags_set_once).
 */
import { getSupabaseAdmin } from "../../middleware/supabase-auth";
import {
  signupCampaignSchema,
  signupChannelSchema,
  signupSourceSchema,
} from "../../../packages/shared/src/analytics-consent-schema";
import { logger } from "../../logger";

/** What the browser sent for the channel and campaign; re-parsed here, never trusted. */
export type RawSignupTags = { channel: unknown; campaign: unknown };

/** The columns a sign-up's tags write: allowlisted values only, absent ones left out. */
export function signupTagColumns(raw: RawSignupTags | undefined): {
  signup_channel?: string;
  signup_campaign?: string;
} {
  const channel = signupChannelSchema.safeParse(raw?.channel);
  const campaign = signupCampaignSchema.safeParse(raw?.campaign);
  return {
    ...(channel.success ? { signup_channel: channel.data } : {}),
    ...(campaign.success ? { signup_campaign: campaign.data } : {}),
  };
}

export async function recordSignupSource(
  profileId: string,
  raw: unknown,
  requestId: string | undefined,
  rawTags?: RawSignupTags,
): Promise<void> {
  const parsed = signupSourceSchema.safeParse(raw);
  if (!parsed.success) return;
  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .update({ signup_source: parsed.data, ...signupTagColumns(rawTags) })
    .eq("id", profileId)
    .is("signup_source", null)
    .is("profile_completed_at", null);
  if (error) {
    logger.warn(
      "ANALYTICS",
      "signup_source_write_failed",
      "signup_source not recorded",
      {
        code: error.code ?? "unknown",
        requestId,
      },
    );
  }
}
