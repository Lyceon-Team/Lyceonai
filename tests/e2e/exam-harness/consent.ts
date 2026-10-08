/**
 * The cookie banner, already answered, for the exam harness's browser specs.
 *
 * @spec [n/a — e2e test-harness tooling; the banner is Doc 10 §9.11 / SEO Wave 1C
 *        (`CookieConsentRoot`), not a surface these specs prove] | @implemented [2026-10-07]
 *
 * plain English: the site-wide cookie banner shows until a visitor answers it, fixed over the
 * bottom of every page, where it intercepts clicks on whatever sits under it (the calendar's
 * "+ Add block" in calendar-full-length.spec.ts timed out behind it). The specs that drive the
 * exam harness run as a student who has already answered it — "Reject analytics", the strictly
 * necessary `lyceon_consent` cookie only, in the app's own format from the shared schema — the
 * same choice tests/e2e/student-harness/capture.ts and page-csp-flows.spec.ts make. Expected
 * outcome: no banner over the page. Trade-off: the banner itself is not exercised here; the
 * analytics-consent-e2e job owns it.
 */
import type { BrowserContext } from "@playwright/test";
import {
  CONSENT_COOKIE_NAME,
  COOKIE_BANNER_VERSION,
  formatConsentCookieValue,
} from "../../../packages/shared/src/analytics-consent-schema";

/** Stores an answered (analytics refused, current banner version, dated now) consent cookie. */
export async function answerCookieBanner(
  context: BrowserContext,
  baseUrl: string,
): Promise<void> {
  await context.addCookies([
    {
      name: CONSENT_COOKIE_NAME,
      value: encodeURIComponent(
        formatConsentCookieValue({
          consentId: "e7b0c000-0000-4000-8000-00000000c0c0",
          analytics: false,
          bannerVersion: COOKIE_BANNER_VERSION,
          decidedAtSeconds: Math.floor(Date.now() / 1000),
        }),
      ),
      url: baseUrl,
    },
  ]);
}
