/**
 * `ci/env-example-stripe-parity` — the `.env.example` Stripe block must match
 * the canonical Zod env schema exactly.
 *
 * @spec [Coding Standards §7.3 "Validate Environment Variables at Startup";
 *        SCL-049 livemode derives from the key, so there is no STRIPE_ENV]
 * @implemented 2026-08-20
 *
 * Why this exists: `server/.env.example` advertised `STRIPE_SECRET_KEY_TEST` /
 * `_LIVE` and `STRIPE_PUBLISHABLE_KEY_TEST` / `_LIVE` long after the code stopped
 * reading them, plus `STRIPE_ENV` after the mode moved to the key prefix. Nothing
 * caught it — an external audit did. The file's only job is to be an accurate
 * name reference, and it failed at it silently.
 *
 * Names are the contract; values stay empty and are never read here.
 *
 * SCOPE — deliberately the Stripe block only, not the whole file. Two reasons,
 * both measured rather than assumed:
 *   1. `server/.env.example` carries 83 names; the canonical schema declares 14.
 *      Whole-file parity would require enumerating all 83 in
 *      `packages/shared/src/env.ts`, whose own header carries a HARD GATE against
 *      expanding it before the Doc 06A/06B reconciliation. Breaching that gate to
 *      satisfy this check would trade one silent drift for another.
 *   2. A "is this name read anywhere in source" check was measured and rejected:
 *      it false-positives on `STRIPE_PRICE_PARENT_*`, which ARE read, dynamically,
 *      through the `PRICE_ENV_VAR` record in `server/lib/stripe/client.ts`. Static
 *      reachability cannot see a computed `process.env[name]` lookup, so it would
 *      fail on correct code.
 * Whole-file parity is the right end state and is recorded for the env workstream;
 * this check covers the surface this vertical owns.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STRIPE_ENV_VAR_NAMES } from "../../packages/shared/src/env";

const ENV_EXAMPLE = path.resolve(__dirname, "..", "..", "server", ".env.example");

/** Variable NAMES only. Values are never read, returned, or asserted on. */
function declaredNames(): string[] {
  return readFileSync(ENV_EXAMPLE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter((name) => name.length > 0);
}

describe("ci/env-example-stripe-parity", () => {
  it("declares every Stripe variable the canonical schema defines", () => {
    const declared = new Set(declaredNames());
    const missing = STRIPE_ENV_VAR_NAMES.filter((n) => !declared.has(n));

    expect(
      missing,
      `server/.env.example is missing Stripe variables the code reads: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("declares no Stripe variable the canonical schema does not define", () => {
    const schemaNames = new Set(STRIPE_ENV_VAR_NAMES);
    const stale = declaredNames()
      .filter((n) => n.startsWith("STRIPE_"))
      .filter((n) => !schemaNames.has(n));

    expect(
      stale,
      "server/.env.example advertises Stripe variables no code reads. " +
        "This is the exact failure this check exists to catch — a stale name " +
        "here is configuration advice that sends the next person down a dead " +
        `path. Remove: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("never advertises STRIPE_ENV — the mode derives from the key prefix (SCL-049)", () => {
    expect(declaredNames()).not.toContain("STRIPE_ENV");
  });

  it("never advertises a _LIVE or _TEST key variant", () => {
    const variants = declaredNames().filter((n) =>
      /^STRIPE_.*_(LIVE|TEST)$/.test(n),
    );
    expect(variants).toEqual([]);
  });
});
