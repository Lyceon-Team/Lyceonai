/**
 * The visitor's first-touch channel: read at landing, kept for the browser session when the
 * visitor has accepted analytics, sent with the signup.
 *
 * @spec [SCL-201 IS 6 (first-touch UTM captured before signup and carried to the post-signup
 *       handler); Doc 07A §6.2 (`signup_source` enum); plan R11, F10; owner report 2026-10-05
 *       ("persist first-touch attribution for the browser session (e.g. sessionStorage) under the
 *       existing consent rules, so it survives redirects until signup")] | @implemented [2026-10-05]
 *
 * plain English: when the app boots, the landing address and referrer are reduced to one of five
 * coarse channels by the shared `deriveSignupSource`. Held in memory, that value died on the
 * first full page load — the homepage's "Sign in" link is a plain `<a href="/login">`, so a
 * visitor who arrived from an ad was recorded as `direct` (owner's production test, 2026-10-05).
 * It now also lives in sessionStorage under FIRST_TOUCH_STORAGE_KEY, and a later page load in the
 * same tab reads it back before deriving anything, so the FIRST touch wins.
 *
 * THE CONSENT RULE (the existing one, docs/compliance/legal-drafts/cookie-policy.md §1–§2: local
 * and session storage count as cookies; analytics storage needs consent). Attribution is analytics,
 * not strictly necessary, so:
 *   - accepted  → written (now, or the moment the visitor accepts on this page);
 *   - refused, including by Global Privacy Control → never written, and removed if present;
 *   - not yet decided → memory only, as before.
 * A visitor who leaves the landing page before answering the banner therefore arrives at signup
 * with the channel of the page they signed up on — the honest result of not having consented.
 *
 * What is stored is one of five words (`direct`, `referral`, `paid_ad`, `organic_search`,
 * `unknown`): no free-text campaign name, no click id, no URL. It ends when the tab closes.
 *
 * SEO-1 (owner brief "One funnel for every social post", Karl, 2026-10-28): the landing link's
 * channel and campaign tags (`utm_source`, `utm_campaign`) are captured beside it, reduced by the
 * shared `deriveSignupTags` to two short allowlists (e.g. `reddit` / `qotd`; anything else is
 * `other`), under exactly the same consent rule and key lifetime, in FIRST_TOUCH_TAGS_STORAGE_KEY.
 * The first touch wins for them too: a later page in the tab never replaces them.
 */
import {
  deriveSignupSource,
  deriveSignupTags,
  signupCampaignSchema,
  signupChannelSchema,
  signupSourceSchema,
  type SignupSource,
  type SignupTags,
} from "@lyceon/shared/analytics-consent-schema";
import { getConsentSnapshot, subscribeConsent } from "./consent";

export const FIRST_TOUCH_STORAGE_KEY = "lyceon_first_touch";
export const FIRST_TOUCH_TAGS_STORAGE_KEY = "lyceon_first_touch_tags";

let firstTouch: SignupSource | null = null;
let touchTags: SignupTags | null = null;
let subscribed = false;

function readStored(): SignupSource | null {
  try {
    const parsed = signupSourceSchema.safeParse(
      window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : null;
  } catch (err: unknown) {
    // Storage unreadable (blocked, or a private mode that throws): attribution falls back to
    // this page's own address, exactly as before storage was used. No console in product code.
    void err;
    return null;
  }
}

/** Stored as `channel|campaign`, an empty side for no tag; anything else reads as unreadable. */
function readStoredTags(): SignupTags | null {
  try {
    const raw = window.sessionStorage.getItem(FIRST_TOUCH_TAGS_STORAGE_KEY);
    if (raw === null) return null;
    const [channel = "", campaign = "", ...rest] = raw.split("|");
    if (rest.length > 0) return null;
    const c = channel === "" ? null : signupChannelSchema.safeParse(channel);
    const k = campaign === "" ? null : signupCampaignSchema.safeParse(campaign);
    if ((c !== null && !c.success) || (k !== null && !k.success)) return null;
    return { channel: c?.data ?? null, campaign: k?.data ?? null };
  } catch (err: unknown) {
    // Unreadable storage: this page's own address decides, as for the channel word above.
    void err;
    return null;
  }
}

function writeStored(value: SignupSource, tags: SignupTags | null): void {
  try {
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, value);
    if (tags !== null) {
      window.sessionStorage.setItem(
        FIRST_TOUCH_TAGS_STORAGE_KEY,
        `${tags.channel ?? ""}|${tags.campaign ?? ""}`,
      );
    }
  } catch (err: unknown) {
    // Not writable: the value stays in memory for this page, which is the pre-storage behaviour.
    void err;
  }
}

function removeStored(): void {
  try {
    window.sessionStorage.removeItem(FIRST_TOUCH_STORAGE_KEY);
    window.sessionStorage.removeItem(FIRST_TOUCH_TAGS_STORAGE_KEY);
  } catch (err: unknown) {
    // Not writable means nothing could have been written either.
    void err;
  }
}

/** Applies the consent rule above to whatever is in memory now. */
export function syncFirstTouchStorage(): void {
  const consent = getConsentSnapshot().consent;
  if (consent.status === "accepted" && firstTouch !== null) {
    writeStored(firstTouch, touchTags);
  } else if (consent.status === "refused") {
    removeStored();
  }
}

/** Called once from the client entry, before any client-side navigation can change the URL. */
export function captureFirstTouch(): void {
  if (firstTouch === null) {
    // Both come from the same touch: stored together, or derived together from this page.
    const stored = readStored();
    firstTouch =
      stored ??
      deriveSignupSource(
        window.location.search,
        document.referrer,
        window.location.hostname,
      );
    touchTags =
      stored !== null
        ? (readStoredTags() ?? { channel: null, campaign: null })
        : deriveSignupTags(window.location.search);
  }
  if (!subscribed) {
    subscribed = true;
    subscribeConsent(syncFirstTouchStorage);
  }
  syncFirstTouchStorage();
}

export function firstTouchSource(): SignupSource {
  return firstTouch ?? "unknown";
}

/** The first touch's channel and campaign tags (SEO-1); nulls when it had none. */
export function firstTouchTags(): SignupTags {
  return touchTags ?? { channel: null, campaign: null };
}

/** Tests only: forget the in-memory values, as a new page load would. */
export function resetFirstTouchForTests(): void {
  firstTouch = null;
  touchTags = null;
}
