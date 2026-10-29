/**
 * The sign-up channel: the allowlists, the derivation, the server's parse, and the wiring that
 * keeps it free of the analytics cookie.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2] | @implemented [2026-10-28]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSignupAttribution,
  signupAttributionParams,
} from "../../packages/shared/src/signup-attribution";
import { signupAttributionFromQuery } from "../../server/lib/signup-attribution";

const ROOT = resolve(__dirname, "../..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

describe("deriveSignupAttribution", () => {
  it("A1 each known utm_source is its channel", () => {
    const cases: [string, string][] = [
      ["reddit", "reddit"],
      ["reddit.com", "reddit"],
      ["tiktok", "tiktok"],
      ["ig", "instagram"],
      ["instagram", "instagram"],
      ["facebook", "facebook"],
      ["fb", "facebook"],
      ["meta", "facebook"],
      ["newsletter", "email"],
      ["resend", "email"],
    ];
    for (const [source, channel] of cases) {
      expect(
        deriveSignupAttribution(`?utm_source=${source}`).channel,
        source,
      ).toBe(channel);
    }
  });

  it("A2 an email medium is email; any other UTM is other; none is direct", () => {
    expect(
      deriveSignupAttribution("?utm_source=mailchimp&utm_medium=email").channel,
    ).toBe("email");
    expect(deriveSignupAttribution("?utm_source=youtube").channel).toBe(
      "other",
    );
    expect(deriveSignupAttribution("?utm_campaign=qotd").channel).toBe("other");
    expect(deriveSignupAttribution("").channel).toBe("direct");
    // Not UTM: a click id or another parameter is still a direct visit.
    expect(deriveSignupAttribution("?gclid=abc&ref=x").channel).toBe("direct");
  });

  it("A3 only allowlisted campaigns are kept; nothing of the URL survives", () => {
    expect(
      deriveSignupAttribution("?utm_source=reddit&utm_campaign=DEC_COHORT"),
    ).toEqual({ channel: "reddit", campaign: "dec_cohort" });
    expect(
      deriveSignupAttribution("?utm_source=tiktok&utm_campaign=worked_example"),
    ).toEqual({ channel: "tiktok", campaign: "worked_example" });
    const unknown = deriveSignupAttribution(
      "?utm_source=reddit&utm_campaign=jane.doe@example.com",
    );
    expect(unknown).toEqual({ channel: "reddit", campaign: null });
    expect(JSON.stringify(unknown)).not.toContain("example");
  });

  it("A4 a carried touch wins over the page's UTM; a carried value off the list is ignored", () => {
    expect(
      deriveSignupAttribution(
        "?signup_channel=email&signup_campaign=qotd&utm_source=reddit",
      ),
    ).toEqual({ channel: "email", campaign: "qotd" });
    expect(
      deriveSignupAttribution("?signup_channel=myspace&utm_source=reddit"),
    ).toEqual({ channel: "reddit", campaign: null });
  });

  it("A6 a source named like a built-in object member is just an unknown source", () => {
    for (const source of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      const touch = deriveSignupAttribution(`?utm_source=${source}`);
      expect(touch, source).toEqual({ channel: "other", campaign: null });
      expect(signupAttributionParams(touch), source).toEqual({
        signup_channel: "other",
      });
    }
  });

  it("A5 the carry parameters: none for a plain direct visit", () => {
    expect(
      signupAttributionParams({ channel: "direct", campaign: null }),
    ).toEqual({});
    expect(
      signupAttributionParams({ channel: "reddit", campaign: null }),
    ).toEqual({ signup_channel: "reddit" });
  });
});

describe("the server's parse of the Google callback", () => {
  it("S1 the channel must be on the list; an unknown campaign is null", () => {
    expect(signupAttributionFromQuery("tiktok", "dec_cohort")).toEqual({
      channel: "tiktok",
      campaign: "dec_cohort",
    });
    expect(signupAttributionFromQuery("tiktok", "spring")).toEqual({
      channel: "tiktok",
      campaign: null,
    });
    expect(
      signupAttributionFromQuery("https://evil.example", "qotd"),
    ).toBeNull();
    expect(signupAttributionFromQuery(["reddit"], undefined)).toBeNull();
  });
});

describe("wiring: works without the analytics cookie", () => {
  it("W1 the browser module stores nothing and never reads consent", () => {
    const src = read("client/src/lib/signup-attribution.ts");
    // Code, not prose: the storage and cookie APIs, and the consent module's API.
    for (const forbidden of [
      "sessionStorage",
      "localStorage",
      "document.cookie",
      "getConsentSnapshot",
      "subscribeConsent",
      "analytics/consent",
      "posthog",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("W2 both sign-up paths send it and both server paths record it", () => {
    const ctx = read("client/src/contexts/SupabaseAuthContext.tsx");
    expect(ctx).toContain("signupAttribution: signupAttribution(),");
    expect(ctx).toContain(
      "callbackParams.set(SIGNUP_CHANNEL_PARAM, attribution.channel);",
    );
    expect(read("client/src/main.tsx")).toContain(
      "captureSignupAttribution();",
    );
    expect(read("server/routes/supabase-auth-routes.ts")).toContain(
      "validation.data.signupAttribution,",
    );
    expect(read("server/routes/oauth-callback-routes.ts")).toContain(
      "req.query.signup_channel,",
    );
  });
});
