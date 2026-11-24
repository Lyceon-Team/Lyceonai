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
import { readdirSync } from "fs";

const ROOT = path.resolve(__dirname, "..", "..");

// Anchor on the canonical CREATE OR REPLACE block so we never read the contract's "before"
// comparison table (which intentionally still shows the old {active,past_due} set).
const ANCHOR = "CREATE OR REPLACE FUNCTION public.entitlement_active";
const DEFINITION = /^CREATE OR REPLACE FUNCTION public\.entitlement_active\b/m;

/**
 * The entitled statuses named by the function's body: every literal in a `status IN (...)` list and
 * every `status = '...'` arm. Since SCL-289 the body is `status IN ('active','trialing') OR
 * (status = 'past_due' AND <grace deadline>)`, so reading only the first IN list would drop
 * `past_due` and the parity check would pass for the wrong reason.
 */
function functionBody(file: string): string {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  // At the start of a line only: a rollback note quotes the previous body behind `--`, and
  // reading that would check the old definition instead of the live one.
  const idx = text.search(DEFINITION);
  expect(idx, `'${ANCHOR}' not found in ${file}`).toBeGreaterThanOrEqual(0);
  const after = text.slice(idx);
  // The SQL body ends at its closing `$$;`; the contract's code block ends at its fence.
  const end = after.search(/\$\$;|```/);
  return end > 0 ? after.slice(0, end) : after;
}

function extractEntitlementStatusSet(file: string): Set<string> {
  const body = functionBody(file);
  const found = new Set<string>();
  for (const m of body.matchAll(/status\s+IN\s*\(([^)]*)\)/gi)) {
    for (const lit of m[1]?.match(/'([^']+)'/g) ?? []) {
      found.add(lit.replace(/'/g, "").trim());
    }
  }
  for (const m of body.matchAll(/status\s*=\s*'([^']+)'/gi)) {
    if (m[1]) found.add(m[1].trim());
  }
  expect(found.size, `no entitled status found in ${file}`).toBeGreaterThan(0);
  return found;
}

/**
 * The migration that LAST defines the function: a test pinned to an earlier definer reads a body
 * the pipeline has already replaced (CLAUDE.md, "A migration that replaces a function body
 * orphans its mutations"). Re-pointed 2026-11-24 when 20261211000000 (SCL-289) redefined it.
 */
function lastDefiner(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => DEFINITION.test(readFileSync(path.join(dir, f), "utf8")));
  const last = files[files.length - 1];
  expect(last, "no migration defines entitlement_active").toBeDefined();
  return `supabase/migrations/${last as string}`;
}

const SQL_FILE = lastDefiner();
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

  it("is the 20261211000000 definition, and past_due is entitled only until its grace deadline (SCL-289)", () => {
    expect(SQL_FILE).toBe(
      "supabase/migrations/20261211000000_billing_lapse.sql",
    );
    const body = functionBody(SQL_FILE).replace(/\s+/g, " ");
    expect(body).toContain(
      "e.status = 'past_due' AND (e.grace_period_ends_at IS NULL OR e.grace_period_ends_at > now())",
    );
  });

  it("the SQL set and the contract set are equal (no drift)", () => {
    expect([...extractEntitlementStatusSet(SQL_FILE)].sort()).toEqual(
      [...extractEntitlementStatusSet(CONTRACT_FILE)].sort(),
    );
  });
});
