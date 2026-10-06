// @vitest-environment jsdom
/**
 * First-touch attribution survives a full page load, under the cookie-consent rule.
 *
 * @spec [SCL-201 IS 6; owner report 2026-10-05 (signup_source `direct` after a UTM landing and a
 *       forced redirect); cookie-policy.md §1–§2 (session storage counts as a cookie; analytics
 *       storage needs consent)] | @implemented [2026-10-05]
 *
 * plain English: the real module and the real consent store, with the consent cookie written the
 * way the banner writes it. "A new page load" is simulated by forgetting the in-memory value and
 * changing the address, which is what a full navigation does. Proved: with analytics accepted, a
 * paid landing is still `paid_ad` on /login with no parameters; accepting AFTER landing still
 * keeps it; refused (or GPC) stores nothing and removes what was there; undecided stores nothing;
 * a stored value that is not one of the five channels is ignored.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COOKIE_BANNER_VERSION,
  CONSENT_COOKIE_NAME,
  formatConsentCookieValue,
} from "@lyceon/shared/analytics-consent-schema";
import { refreshConsent } from "./consent";
import {
  captureFirstTouch,
  FIRST_TOUCH_STORAGE_KEY,
  firstTouchSource,
  resetFirstTouchForTests,
} from "./first-touch";

function land(pathAndQuery: string, referrer = ""): void {
  window.history.replaceState(null, "", pathAndQuery);
  Object.defineProperty(document, "referrer", {
    value: referrer,
    configurable: true,
  });
  resetFirstTouchForTests();
  captureFirstTouch();
}

function decide(analytics: boolean | null): void {
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
  if (analytics !== null) {
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
      formatConsentCookieValue({
        bannerVersion: COOKIE_BANNER_VERSION,
        consentId: "00000000-0000-4000-8000-00000000f1f1",
        analytics,
        decidedAtSeconds: Math.floor(Date.now() / 1000),
      }),
    )}; Path=/`;
  }
  refreshConsent();
}

const PAID = "/?utm_source=google&utm_medium=cpc&utm_campaign=sat";

beforeEach(() => {
  // Each test starts as a fresh tab: no stored value and nothing in memory.
  resetFirstTouchForTests();
  window.sessionStorage.clear();
  decide(null);
});
afterEach(() => {
  window.sessionStorage.clear();
});

describe("first-touch attribution", () => {
  it("analytics accepted: a paid landing is still paid_ad after a full load of /login", () => {
    decide(true);
    land(PAID);
    expect(firstTouchSource()).toBe("paid_ad");
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBe(
      "paid_ad",
    );
    land("/login", `${window.location.origin}/`);
    expect(firstTouchSource()).toBe("paid_ad");
  });

  it("accepting on the landing page, after it loaded, still keeps it", () => {
    land(PAID);
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBeNull();
    decide(true);
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBe(
      "paid_ad",
    );
    land("/login", `${window.location.origin}/`);
    expect(firstTouchSource()).toBe("paid_ad");
  });

  it("the first touch wins: a later landing with other parameters does not overwrite it", () => {
    decide(true);
    land(PAID);
    land("/?utm_medium=organic", "https://www.google.com/");
    expect(firstTouchSource()).toBe("paid_ad");
  });

  it("undecided: nothing is stored, so a full load re-derives from its own address", () => {
    land(PAID);
    expect(firstTouchSource()).toBe("paid_ad");
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBeNull();
    land("/login", `${window.location.origin}/`);
    expect(firstTouchSource()).toBe("direct");
  });

  it("refused: nothing is stored, and a value stored under an earlier acceptance is removed", () => {
    decide(true);
    land(PAID);
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBe(
      "paid_ad",
    );
    decide(false);
    expect(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY)).toBeNull();
    land("/login", `${window.location.origin}/`);
    expect(firstTouchSource()).toBe("direct");
  });

  it("a stored value that is not one of the five channels is ignored", () => {
    decide(true);
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, "utm_campaign=sat");
    land("/login", `${window.location.origin}/`);
    expect(firstTouchSource()).toBe("direct");
  });
});
