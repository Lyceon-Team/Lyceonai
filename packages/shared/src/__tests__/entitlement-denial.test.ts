/**
 * @spec [Doc-01_V8 §26.1, §27.2; SCL-185 (UI-01)] | @implemented [2026-09-29]
 *
 * plain English: the parts of the denial contract that do not need a route. (1) The feature
 * enum IS the genesis seed — read from the migration, not restated — so a seeded key cannot be
 * missing from the enum and the enum cannot invent one. (2) The reader keys on `code`: a body
 * that is a denial in every other respect but carries another code, or no `details.feature`,
 * or a feature outside the seed, is not a denial. The per-surface real bodies are exercised in
 * `tests/ci/{exam-runtime,tutor-runtime}.entitlement-denial.contract.test.ts`,
 * `tests/ci/calendar.routes.contract.test.ts` and `tests/ci/student-resources.contract.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_FEATURE_KEYS,
  readEntitlementDenial,
} from "../entitlement-denial";

const GENESIS = path.resolve(
  __dirname,
  "../../../../supabase/migrations/00000000000000_genesis.sql",
);

function seededFeatureKeys(): string[] {
  const sql = fs.readFileSync(GENESIS, "utf-8");
  const start = sql.indexOf("INSERT INTO public.entitlement_features");
  expect(start).toBeGreaterThan(-1);
  // The statement ends at the first `;` that ends a LINE: the tutor row's description itself
  // contains a semicolon ("LISA AI tutor access; blocked during live exam").
  const statement = sql.slice(start, sql.indexOf(";\n", start));
  return [
    ...statement.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(?:free|premium)'/g),
  ].map((m) => m[1] ?? "");
}

describe("the feature enum is the genesis seed", () => {
  it("lists exactly the seeded feature keys, in seed order", () => {
    const seeded = seededFeatureKeys();
    // Presence before equality: an empty parse would make the comparison vacuous.
    expect(seeded.length).toBe(8);
    expect([...ENTITLEMENT_FEATURE_KEYS]).toEqual(seeded);
  });
});

describe("readEntitlementDenial keys on code, not on shape alone", () => {
  it("rejects a nested body with another code", () => {
    expect(
      readEntitlementDenial({
        error: {
          code: "forbidden",
          message: "x",
          details: { feature: "exam_full_length" },
        },
      }),
    ).toBeNull();
  });

  it("rejects the pre-UI-01 flat PAYMENT_REQUIRED body (the guardian-view 402 still sends it)", () => {
    expect(
      readEntitlementDenial({
        error: "Subscription required",
        code: "PAYMENT_REQUIRED",
        message: "x",
        requestId: "r",
      }),
    ).toBeNull();
  });

  it("rejects a denial with no details.feature, or a feature outside the seed", () => {
    expect(
      readEntitlementDenial({
        error: { code: "entitlement_required", message: "x" },
      }),
    ).toBeNull();
    expect(
      readEntitlementDenial({
        error: "Subscription required",
        code: "entitlement_required",
        message: "x",
        details: { feature: "not_a_feature" },
      }),
    ).toBeNull();
  });

  it("rejects non-objects", () => {
    for (const body of [null, undefined, "entitlement_required", 403, []]) {
      expect(readEntitlementDenial(body)).toBeNull();
    }
  });
});
