/**
 * THE MATRIX IS ENFORCED, NOT DOCUMENTED.
 *
 * @spec [Stripe Integration End-to-End Flow §0, §9] | @implemented [2026-08-28]
 *
 * plain English: proves every entitlement-changing path is enumerated, every
 * cell is filled, every GRANT carries the country gate, and every named call
 * site and gate test actually exists on disk.
 *
 * WHY. Three consecutive audits each found the NEXT ungated path — the country
 * evaluator with no caller, then six ungated granting paths, then settlement.
 * The rule was never missing; the enumeration was. A matrix that is only a
 * document drifts silently, so this test is what converts "an empty cell is a
 * defect" from a sentence into a failure.
 *
 * It prints the matrix so a reviewer reads the real state rather than a claim.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENTITLEMENT_PATHS,
  GATES,
  type EntitlementPath,
} from "../../server/lib/stripe/entitlement-paths";
import {
  SUBSCRIBED_EVENTS,
  EVENT_DISPOSITION,
} from "../../server/lib/stripe/event-surface";

const ROOT = resolve(__dirname, "../..");

/** Paths that GRANT, EXTEND or RESTORE hand out access, so they must gate country. */
const GRANTING: ReadonlyArray<EntitlementPath["effect"]> = [
  "grant",
  "extend",
  "restore",
];

describe("entitlement path matrix (§9)", () => {
  it("prints the matrix", () => {
    const rows = ENTITLEMENT_PATHS.map((p) => ({
      path: p.path,
      trigger: p.trigger,
      effect: p.effect,
      gates: p.gates.length,
      country: p.gates.includes(GATES.COUNTRY) ? "yes" : "—",
      callSite: p.callSite,
    }));
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("fills every cell — an empty cell is a defect, not an omission", () => {
    for (const p of ENTITLEMENT_PATHS) {
      expect(p.path, "path").toBeTruthy();
      expect(p.trigger, `${p.path}: trigger`).toBeTruthy();
      expect(p.effect, `${p.path}: effect`).toBeTruthy();
      expect(p.gates.length, `${p.path}: gates`).toBeGreaterThan(0);
      expect(p.writer, `${p.path}: writer`).toBeTruthy();
      expect(p.idempotency, `${p.path}: idempotency`).toBeTruthy();
      expect(p.gateTest, `${p.path}: gateTest`).toBeTruthy();
      expect(p.callSite, `${p.path}: callSite`).toMatch(/^[\w./-]+:\d+$/);
    }
  });

  /**
   * THE ONE THAT MATTERS. Codex found six granting paths with no country gate.
   * This makes a seventh a failing test rather than an audit finding.
   */
  it("every GRANT/EXTEND/RESTORE path carries the INV-03-08 country gate", () => {
    const ungated = ENTITLEMENT_PATHS.filter(
      (p) => GRANTING.includes(p.effect) && !p.gates.includes(GATES.COUNTRY),
    );
    expect(
      ungated.map((p) => `${p.path} (${p.trigger})`),
      "granting paths missing the country gate",
    ).toEqual([]);
  });

  /**
   * The asymmetry, asserted so nobody "fixes" it into symmetry: a REVOKE must
   * NOT be blocked by a country check. Refusing to revoke because a country
   * cannot be established would leave premium in place — the exact failure the
   * gate exists to prevent.
   */
  it("no REVOKE path is gated on country", () => {
    const gated = ENTITLEMENT_PATHS.filter(
      (p) => p.effect === "revoke" && p.gates.includes(GATES.COUNTRY),
    );
    expect(
      gated.map((p) => p.path),
      "revoke paths wrongly country-gated",
    ).toEqual([]);
  });

  it("every named call site and gate test exists on disk", () => {
    for (const p of ENTITLEMENT_PATHS) {
      const file = p.callSite.split(":")[0]!;
      expect(
        existsSync(resolve(ROOT, file)),
        `missing call site file: ${file}`,
      ).toBe(true);
      expect(
        existsSync(resolve(ROOT, p.gateTest)),
        `missing gate test: ${p.gateTest}`,
      ).toBe(true);
    }
  });

  /**
   * The completeness claim, tied to the event surface rather than to my memory:
   * every HANDLED webhook event must appear as a trigger. A newly handled event
   * that changes entitlement cannot be added without a matrix row.
   */
  it("every HANDLED webhook event appears in the matrix", () => {
    const triggers = new Set(ENTITLEMENT_PATHS.map((p) => p.trigger));
    const handled = SUBSCRIBED_EVENTS.filter(
      (e) => EVENT_DISPOSITION[e].kind === "handled",
    );
    const missing = handled.filter((e) => !triggers.has(e));
    expect(missing, "handled events with no matrix row").toEqual([]);
  });

  it("every matrix trigger is a subscribed event or a named route", () => {
    const subscribed = new Set<string>(SUBSCRIBED_EVENTS);
    for (const p of ENTITLEMENT_PATHS) {
      if (p.trigger.startsWith("POST ")) continue;
      expect(
        subscribed.has(p.trigger),
        `unsubscribed trigger: ${p.trigger}`,
      ).toBe(true);
    }
  });
});
