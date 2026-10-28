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
 * `unknown`): no campaign name, no click id, no URL. It ends when the tab closes.
 */
import {
  deriveSignupSource,
  signupSourceSchema,
  type SignupSource,
} from "@lyceon/shared/analytics-consent-schema";
import { getConsentSnapshot, subscribeConsent } from "./consent";

export const FIRST_TOUCH_STORAGE_KEY = "lyceon_first_touch";

let firstTouch: SignupSource | null = null;
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

function writeStored(value: SignupSource): void {
  try {
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, value);
  } catch (err: unknown) {
    // Not writable: the value stays in memory for this page, which is the pre-storage behaviour.
    void err;
  }
}

function removeStored(): void {
  try {
    window.sessionStorage.removeItem(FIRST_TOUCH_STORAGE_KEY);
  } catch (err: unknown) {
    // Not writable means nothing could have been written either.
    void err;
  }
}

/** Applies the consent rule above to whatever is in memory now. */
export function syncFirstTouchStorage(): void {
  const consent = getConsentSnapshot().consent;
  if (consent.status === "accepted" && firstTouch !== null) {
    writeStored(firstTouch);
  } else if (consent.status === "refused") {
    removeStored();
  }
}

/** Called once from the client entry, before any client-side navigation can change the URL. */
export function captureFirstTouch(): void {
  firstTouch ??=
    readStored() ??
    deriveSignupSource(
      window.location.search,
      document.referrer,
      window.location.hostname,
    );
  if (!subscribed) {
    subscribed = true;
    subscribeConsent(syncFirstTouchStorage);
  }
  syncFirstTouchStorage();
}

export function firstTouchSource(): SignupSource {
  return firstTouch ?? "unknown";
}

/** Tests only: forget the in-memory value, as a new page load would. */
export function resetFirstTouchForTests(): void {
  firstTouch = null;
}
