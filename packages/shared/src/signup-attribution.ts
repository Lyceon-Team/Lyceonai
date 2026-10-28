/**
 * The sign-up channel and campaign: the coarse, allowlisted first touch a new account records.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2: "at sign-up, store one coarse `signup_channel` on the profile from the
 *       landing URL's UTM (`reddit`, `tiktok`, `instagram`, `facebook`, `email`, `direct`, `other`)
 *       plus `signup_campaign` (e.g. `dec_cohort`, `qotd`), first touch only, allowlisted values,
 *       no raw URL. It must work without the analytics cookie."; Public Disclosure Doctrine rule 2
 *       (nothing proprietary) and rule 7 (under-13 excluded)] | @implemented [2026-10-28]
 *
 * plain English: the landing URL's `utm_source` (and `utm_medium` for email) is reduced to one of
 * seven channels, and `utm_campaign` is kept only when it is a name on SIGNUP_CAMPAIGNS. Nothing
 * else of the URL survives. The browser holds the result in memory and, to survive a full page
 * load on the way to sign-up without storing anything on the device, carries it on the link into
 * sign-up as two short parameters (SIGNUP_CHANNEL_PARAM, SIGNUP_CAMPAIGN_PARAM). A carried value
 * is the earlier touch, so it wins over the sign-up page's own UTM. The server re-parses both
 * with the schemas below and writes them once (server/lib/signup-attribution.ts).
 *
 * trade-offs: no cookie or storage, so the channel survives links into sign-up (and in-app
 * navigation) but not a visitor who leaves and comes back later by typing the address: that
 * visit is `direct`, the honest result without storage. A campaign not on the list is null, not
 * `other`: adding a campaign is one line here (the database checks only its shape).
 */
import { z } from "zod";

export const SIGNUP_CHANNELS = [
  "reddit",
  "tiktok",
  "instagram",
  "facebook",
  "email",
  "direct",
  "other",
] as const;
export const signupChannelSchema = z.enum(SIGNUP_CHANNELS);
export type SignupChannel = z.infer<typeof signupChannelSchema>;

/** The campaigns recorded by name. Anything else is recorded as no campaign. */
export const SIGNUP_CAMPAIGNS = ["dec_cohort", "qotd"] as const;
export const signupCampaignSchema = z.enum(SIGNUP_CAMPAIGNS);
export type SignupCampaign = z.infer<typeof signupCampaignSchema>;

export const signupAttributionSchema = z
  .object({
    channel: signupChannelSchema,
    campaign: signupCampaignSchema.nullable(),
  })
  .strict();
export type SignupAttribution = z.infer<typeof signupAttributionSchema>;

/** The parameters that carry the first touch into sign-up (and through the Google callback). */
export const SIGNUP_CHANNEL_PARAM = "signup_channel";
export const SIGNUP_CAMPAIGN_PARAM = "signup_campaign";

/**
 * `utm_source` values, lowercased, and the channel each one is. A Map, not an object literal: the
 * key is visitor-controlled text, and an object would answer `constructor` or `__proto__` with an
 * inherited member instead of "not a known source".
 */
const SOURCE_CHANNEL: ReadonlyMap<string, SignupChannel> = new Map(
  Object.entries({
    reddit: "reddit",
    "reddit.com": "reddit",
    tiktok: "tiktok",
    "tiktok.com": "tiktok",
    instagram: "instagram",
    "instagram.com": "instagram",
    ig: "instagram",
    facebook: "facebook",
    "facebook.com": "facebook",
    fb: "facebook",
    meta: "facebook",
    email: "email",
    newsletter: "email",
    resend: "email",
  } satisfies Record<string, SignupChannel>),
);

/** `utm_medium` values that mean email whatever the source says. */
const EMAIL_MEDIUMS = new Set(["email", "newsletter", "e-mail"]);

function param(params: URLSearchParams, name: string): string {
  return (params.get(name) ?? "").trim().toLowerCase();
}

/** The campaign, if it is an allowlisted name; else null. */
export function allowlistedCampaign(raw: unknown): SignupCampaign | null {
  const parsed = signupCampaignSchema.safeParse(
    typeof raw === "string" ? raw.trim().toLowerCase() : raw,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * The first touch for this page load, from its address alone (`location.search`).
 *
 * In order: a channel carried from an earlier page of the visit wins (with its campaign); else a
 * known `utm_source` is its channel; else an email `utm_medium` is `email`; else any UTM at all
 * is `other`; nothing is `direct`.
 */
export function deriveSignupAttribution(search: string): SignupAttribution {
  const params = new URLSearchParams(search);
  const carried = signupChannelSchema.safeParse(
    param(params, SIGNUP_CHANNEL_PARAM),
  );
  if (carried.success) {
    return {
      channel: carried.data,
      campaign: allowlistedCampaign(param(params, SIGNUP_CAMPAIGN_PARAM)),
    };
  }
  const source = param(params, "utm_source");
  const medium = param(params, "utm_medium");
  const campaign = param(params, "utm_campaign");
  const channel: SignupChannel =
    SOURCE_CHANNEL.get(source) ??
    (EMAIL_MEDIUMS.has(medium)
      ? "email"
      : source.length > 0 || medium.length > 0 || campaign.length > 0
        ? "other"
        : "direct");
  return { channel, campaign: allowlistedCampaign(campaign) };
}

/** The parameters to carry on a link into sign-up; none for a plain `direct` visit. */
export function signupAttributionParams(
  attribution: SignupAttribution,
): Record<string, string> {
  if (attribution.channel === "direct" && attribution.campaign === null) {
    return {};
  }
  return {
    [SIGNUP_CHANNEL_PARAM]: attribution.channel,
    ...(attribution.campaign === null
      ? {}
      : { [SIGNUP_CAMPAIGN_PARAM]: attribution.campaign }),
  };
}
