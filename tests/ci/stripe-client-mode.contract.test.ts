/**
 * Stripe mode derivation contract — post-audit fix.
 *
 * @spec [SCL-049 livemode assertion]
 *
 * The mode the webhook asserts against MUST be derived from the secret key the
 * process is actually using. An earlier revision read a separate `STRIPE_ENV`
 * declaration: two independent sources with no coupling, so a misconfigured
 * environment could hold a live key and declare `test` and the assertion would
 * agree with the declaration. `STRIPE_ENV` has since been deleted from Vercel,
 * which would have made that declaration `undefined` at runtime.
 *
 * This suite exercises the REAL module — no mock — because the property under
 * test is precisely "what does this function read".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStripeMode,
  getExpectedLivemode,
} from "../../server/lib/stripe/client";

const saved = { ...process.env };

describe("Stripe mode derivation", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_ENV;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it.each([
    ["sk_live_abc123", "live", true],
    ["sk_test_abc123", "test", false],
    ["rk_live_abc123", "live", true],
    ["rk_test_abc123", "test", false],
  ])("derives %s -> %s", (key, mode, livemode) => {
    process.env.STRIPE_SECRET_KEY = key;
    expect(getStripeMode()).toBe(mode);
    expect(getExpectedLivemode()).toBe(livemode);
  });

  it("ignores STRIPE_ENV entirely — the key wins over any declaration", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    // A stale or wrong declaration must not be able to soften the assertion.
    process.env.STRIPE_ENV = "test";
    expect(getExpectedLivemode()).toBe(true);

    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_ENV = "live";
    expect(getExpectedLivemode()).toBe(false);
  });

  it("throws when the key is absent — no default mode", () => {
    expect(() => getExpectedLivemode()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("throws on an unrecognised key prefix rather than guessing", () => {
    process.env.STRIPE_SECRET_KEY = "pk_live_wrong_key_type";
    expect(() => getExpectedLivemode()).toThrow(/unrecognised prefix/);
  });

  it("never reads STRIPE_ENV in source", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.resolve(__dirname, "..", "..", "server", "lib", "stripe", "client.ts"),
      "utf8",
    );
    expect(src).not.toContain("process.env.STRIPE_ENV");
  });
});
