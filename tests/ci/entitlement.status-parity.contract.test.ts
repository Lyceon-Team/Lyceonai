/**
 * ENTITLEMENT-001 parity — the SQL `entitlement_active` predicate and the SP-25 contract MUST
 * declare the IDENTICAL entitled status set. This catches the exact contract-vs-SQL drift the
 * combined re-audit found: the SQL shipped {active, past_due} while the contract (HALT-1 ruling)
 * locks {active, past_due, trialing}. A single evaluator that is *wrong* is still a defect.
 *
 * @spec [contracts/auth-entitlement-sp25.contract.md §1; SP-25 single evaluator]
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

// Anchor on the canonical CREATE OR REPLACE block so we never read the contract's "before"
// comparison table (which intentionally still shows the old {active,past_due} set).
const ANCHOR = "CREATE OR REPLACE FUNCTION public.entitlement_active";

function extractEntitlementStatusSet(file: string): Set<string> {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const idx = text.indexOf(ANCHOR);
  expect(idx, `'${ANCHOR}' not found in ${file}`).toBeGreaterThanOrEqual(0);
  const after = text.slice(idx);
  const m = /status\s+IN\s*\(([^)]*)\)/i.exec(after);
  expect(
    m,
    `status IN (...) not found after the function in ${file}`,
  ).not.toBeNull();
  const literals = (m as RegExpExecArray)[1].match(/'([^']+)'/g) ?? [];
  return new Set(literals.map((s) => s.replace(/'/g, "").trim()));
}

const SQL_FILE =
  "supabase/migrations/20260616120000_entitlement_active_include_trialing.sql";
const CONTRACT_FILE = "contracts/auth-entitlement-sp25.contract.md";
const EXPECTED = ["active", "past_due", "trialing"];

describe("ENTITLEMENT-001 — entitlement_active SQL ↔ SP-25 contract status parity", () => {
  it("the SQL predicate set is exactly {active, past_due, trialing}", () => {
    expect([...extractEntitlementStatusSet(SQL_FILE)].sort()).toEqual(
      [...EXPECTED].sort(),
    );
  });

  it("the contract set is exactly {active, past_due, trialing}", () => {
    expect([...extractEntitlementStatusSet(CONTRACT_FILE)].sort()).toEqual(
      [...EXPECTED].sort(),
    );
  });

  it("the SQL set and the contract set are equal (no drift)", () => {
    expect([...extractEntitlementStatusSet(SQL_FILE)].sort()).toEqual(
      [...extractEntitlementStatusSet(CONTRACT_FILE)].sort(),
    );
  });
});
