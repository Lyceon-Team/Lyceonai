/**
 * @spec [Doc 07A §6.2 (`signup_source` enum); SCL-201 IS 6; Doc 10 §9.11 (6-month memory);
 *       owner decision 5, 2026-10-05 (scrub the guardian link code)] | @implemented [2026-10-05]
 *
 * plain English: the pure pieces the browser and server share — the first-touch channel
 * grouping, the consent cookie format, and the credential scrubber PostHog's before_send runs.
 */
import { describe, expect, it } from "vitest";
import {
  COOKIE_BANNER_VERSION,
  cookieConsentRecordSchema,
  deriveSignupSource,
  formatConsentCookieValue,
  parseConsentCookieValue,
  signupSourceSchema,
} from "../../packages/shared/src/analytics-consent-schema";
import {
  REDACTED,
  scrubProperties,
  scrubUrl,
} from "../../client/src/lib/analytics/url-scrub";

const HOST = "lyceon.ai";

describe("deriveSignupSource (standard channel grouping)", () => {
  it.each([
    ["?utm_source=google&utm_medium=cpc", "", "paid_ad"],
    ["?utm_medium=paid_social", "", "paid_ad"],
    ["?gclid=abc", "", "paid_ad"],
    ["?fbclid=abc", "https://www.facebook.com/", "paid_ad"],
    ["", "https://www.google.com/", "organic_search"],
    ["", "https://duckduckgo.com/", "organic_search"],
    ["?utm_medium=organic", "", "organic_search"],
    ["?utm_source=newsletter&utm_medium=email", "", "referral"],
    ["", "https://www.reddit.com/r/SAT/", "referral"],
    ["", "", "direct"],
    ["", "https://lyceon.ai/blog/x", "direct"],
    ["", "not a url", "direct"],
  ] as const)("search %j, referrer %j → %s", (search, referrer, expected) => {
    expect(deriveSignupSource(search, referrer, HOST)).toBe(expected);
  });

  it("only ever returns a value the registry enum accepts", () => {
    for (const s of ["", "?utm_medium=cpc", "?utm_source=x"]) {
      expect(
        signupSourceSchema.safeParse(deriveSignupSource(s, "", HOST)).success,
      ).toBe(true);
    }
  });
});

describe("consent cookie", () => {
  const stored = {
    consentId: "0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
    analytics: true,
    bannerVersion: COOKIE_BANNER_VERSION,
    decidedAtSeconds: 1_790_000_000,
  };

  it("round-trips", () => {
    expect(parseConsentCookieValue(formatConsentCookieValue(stored))).toEqual(
      stored,
    );
    const refused = { ...stored, analytics: false };
    expect(parseConsentCookieValue(formatConsentCookieValue(refused))).toEqual(
      refused,
    );
  });

  it("treats another banner version as no choice (the banner asks again)", () => {
    const old = formatConsentCookieValue({
      ...stored,
      bannerVersion: COOKIE_BANNER_VERSION + 1,
    });
    expect(parseConsentCookieValue(old)).toBeNull();
  });

  it.each([
    "",
    "garbage",
    "1.not-a-uuid.a.1",
    "1.0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a.x.1",
  ])("rejects a malformed value %j", (value) => {
    expect(parseConsentCookieValue(value)).toBeNull();
  });

  it("the log body is strict: no extra field can ride along", () => {
    expect(
      cookieConsentRecordSchema.safeParse({
        consent_id: stored.consentId,
        analytics: true,
        banner_version: 1,
        source: "banner",
        user_id: "x",
      }).success,
    ).toBe(false);
  });
});

describe("before_send scrubber", () => {
  const CODE = "LYC-7Q2K-9XZM";

  it("blanks the guardian link code in the page address and drops the fragment", () => {
    const scrubbed = scrubUrl(
      `https://lyceon.ai/guardian?code=${CODE}&tab=1#access_token=abc`,
    );
    expect(scrubbed).toBe(`https://lyceon.ai/guardian?code=${REDACTED}&tab=1`);
  });

  it("scrubs every place PostHog carries a URL — properties, $set_once, element chain, replay meta", () => {
    const props = scrubProperties({
      $current_url: `https://lyceon.ai/guardian?code=${CODE}`,
      $referrer: `https://mail.example.com/?token=${CODE}`,
      $elements_chain: `a:href="/guardian?code=${CODE}"nth-child="1"`,
      $set_once: {
        $initial_current_url: `https://lyceon.ai/guardian?code=${CODE}`,
      },
      $snapshot_data: [
        { type: 4, data: { href: `https://lyceon.ai/guardian?code=${CODE}` } },
        {
          type: 2,
          data: {
            node: {
              childNodes: [
                {
                  tagName: "a",
                  attributes: { href: `/guardian?code=${CODE}` },
                },
              ],
            },
          },
        },
      ],
      unrelated: 3,
    });
    // Presence first: the properties are all still there.
    expect(Object.keys(props).sort()).toEqual([
      "$current_url",
      "$elements_chain",
      "$referrer",
      "$set_once",
      "$snapshot_data",
      "unrelated",
    ]);
    expect(JSON.stringify(props)).not.toContain(CODE);
    expect(props["unrelated"]).toBe(3);
  });

  it("leaves an address with no credential unchanged", () => {
    expect(scrubUrl("https://lyceon.ai/digital-sat?utm_source=x")).toBe(
      "https://lyceon.ai/digital-sat?utm_source=x",
    );
  });
});
