/**
 * The visitor's first-touch channel, held in memory for the life of the tab.
 *
 * @spec [SCL-201 IS 6 (first-touch UTM captured before signup and carried to the post-signup
 *       handler); Doc 07A §6.2 (`signup_source` enum); plan R11, F10] | @implemented [2026-10-05]
 *
 * plain English: read once, when the app boots, from the landing address and the referrer, and
 * reduced to one of five coarse channels by the shared `deriveSignupSource`. Nothing is written to
 * cookies or storage — it lives in this module's memory — so it needs no consent and leaves no
 * trace on the device. The signup form sends it; the Google button carries it through the
 * callback URL. A visitor who reloads mid-visit is re-read from the reloaded address, which is
 * the standard last-landing behaviour for an unstored first touch.
 */
import {
  deriveSignupSource,
  type SignupSource,
} from "@lyceon/shared/analytics-consent-schema";

let firstTouch: SignupSource | null = null;

/** Called once from the client entry, before any client-side navigation can change the URL. */
export function captureFirstTouch(): void {
  firstTouch ??= deriveSignupSource(
    window.location.search,
    document.referrer,
    window.location.hostname,
  );
}

export function firstTouchSource(): SignupSource {
  return firstTouch ?? "unknown";
}
