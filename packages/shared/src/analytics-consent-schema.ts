/**
 * Cookie consent and first-touch signup source — the shapes the browser and the server share.
 *
 * @spec [Doc 10 §9.11 (one-click accept / refuse, granular, 6-month do-not-re-ask, browser
 *       signal honoured, consent log with timestamp + category, withdrawal in settings);
 *       `docs/compliance/legal-drafts/cookie-banner-text.md` Version 1 (the wording);
 *       Doc 07A §6.2 (`signup_source` enum); SCL-201 IS 1 and IS 6; plan R11, F10, F11; owner
 *       Step 0 decisions 2026-10-05 (nothing loads or sends before Accept)] | @implemented [2026-10-05]
 *
 * plain English:
 *  - The consent cookie holds the visitor's choice: a random consent id, accepted or refused, the
 *    banner version and when. It is strictly necessary (it records the choice the law requires us
 *    to ask for) and lasts 6 months, after which the banner asks again (Doc 10 §9.11).
 *  - Each choice is also POSTed to the server's consent log with the same id, so the log can
 *    evidence a choice without identifying who made it.
 *  - The signup source is a coarse channel derived from the landing URL's UTM parameters and the
 *    referrer, using the standard channel grouping (paid, organic search, referral, direct). It is
 *    held in memory only — nothing is stored on the device for it — and sent with the signup.
 *
 * trade-offs: GPC is not logged — it is the browser's standing signal, not a choice made on our
 * banner — and it only ever refuses, so there is nothing to evidence.
 */
import { z } from "zod";

/** The banner text version in `cookie-banner-text.md`. Bump with the text. */
export const COOKIE_BANNER_VERSION = 1;

/** Strictly necessary; listed in the Cookie Policy §3 as "Cookie consent record", 6 months. */
export const CONSENT_COOKIE_NAME = "lyceon_consent";

/** 6 months, in seconds (182 days). Doc 10 §9.11's do-not-re-ask period. */
export const CONSENT_MAX_AGE_SECONDS = 182 * 24 * 60 * 60;

export const consentSourceSchema = z.enum(["banner", "settings"]);
export type ConsentChoiceSource = z.infer<typeof consentSourceSchema>;

/** `POST /api/public/cookie-consent` body. */
export const cookieConsentRecordSchema = z
  .object({
    consent_id: z.string().uuid(),
    analytics: z.boolean(),
    banner_version: z.number().int().positive(),
    source: consentSourceSchema,
  })
  .strict();
export type CookieConsentRecord = z.infer<typeof cookieConsentRecordSchema>;

/** The consent cookie's value, parsed. */
export type StoredConsent = {
  consentId: string;
  analytics: boolean;
  bannerVersion: number;
  decidedAtSeconds: number;
};

/**
 * Cookie value: `<version>.<consent id>.<a|r>.<unix seconds>`. Anything else — including an older
 * banner version — parses to null, which means "no valid choice": the banner shows again.
 */
export function parseConsentCookieValue(value: string): StoredConsent | null {
  const match = /^(\d+)\.([0-9a-f-]{36})\.([ar])\.(\d+)$/.exec(value);
  if (!match) return null;
  const [, version, consentId, choice, decided] = match;
  if (version === undefined || consentId === undefined || decided === undefined)
    return null;
  const bannerVersion = Number(version);
  if (bannerVersion !== COOKIE_BANNER_VERSION) return null;
  if (!z.string().uuid().safeParse(consentId).success) return null;
  return {
    consentId,
    analytics: choice === "a",
    bannerVersion,
    decidedAtSeconds: Number(decided),
  };
}

export function formatConsentCookieValue(consent: StoredConsent): string {
  return `${consent.bannerVersion}.${consent.consentId}.${consent.analytics ? "a" : "r"}.${consent.decidedAtSeconds}`;
}

/** Doc 07A §6.2 `user_signed_up.signup_source`. */
export const signupSourceSchema = z.enum([
  "direct",
  "referral",
  "paid_ad",
  "organic_search",
  "unknown",
]);
export type SignupSource = z.infer<typeof signupSourceSchema>;

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "paidsearch",
  "paid_search",
  "paid-search",
  "paidsocial",
  "paid_social",
  "paid-social",
  "display",
  "cpm",
  "cpv",
  "banner",
]);

/** Click identifiers the major ad platforms append to paid traffic. */
const PAID_CLICK_IDS = [
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "ttclid",
] as const;

const SEARCH_ENGINE_HOST =
  /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|naver|brave)\.[a-z.]+$/;

/**
 * The visitor's first-touch channel, from the landing URL and the referrer.
 *
 * Standard channel grouping, in order: a paid medium or an ad click id is `paid_ad`; an
 * `organic` medium or a search-engine referrer is `organic_search`; any other campaign tag or
 * another site's referrer is `referral`; nothing at all is `direct`.
 */
export function deriveSignupSource(
  landingSearch: string,
  referrer: string,
  ownHost: string,
): SignupSource {
  const params = new URLSearchParams(landingSearch);
  const medium = (params.get("utm_medium") ?? "").trim().toLowerCase();
  const source = (params.get("utm_source") ?? "").trim().toLowerCase();
  if (PAID_MEDIUMS.has(medium) || PAID_CLICK_IDS.some((id) => params.has(id))) {
    return "paid_ad";
  }
  // `document.referrer` is an absolute URL or empty; a host is read without `new URL`, so a
  // malformed value yields no host (treated as no referrer) instead of a throw.
  const referrerHost = (
    /^https?:\/\/([^/?#:@]+)/i.exec(referrer)?.[1] ?? ""
  ).toLowerCase();
  const externalReferrer =
    referrerHost.length > 0 && referrerHost !== ownHost.toLowerCase()
      ? referrerHost
      : "";
  if (medium === "organic" || SEARCH_ENGINE_HOST.test(externalReferrer)) {
    return "organic_search";
  }
  if (medium.length > 0 || source.length > 0 || externalReferrer.length > 0) {
    return "referral";
  }
  return "direct";
}
