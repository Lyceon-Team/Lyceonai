/**
 * THE MATRIX IS ENFORCED, NOT DOCUMENTED.
 *
 * @spec [Stripe Integration End-to-End Flow §0, §9] | @implemented [2026-08-28]
 * @revised [2026-08-31 — owner fixes 1–3]
 *
 * plain English: proves every subscribed event has a row, every cell is filled,
 * every GRANT carries the country gate, every cited call site REALLY CONTAINS
 * the call it claims, and the effect column agrees with the dispatcher by
 * construction. Expected outcome: drift is a failing test, not a stale document.
 *
 * WHY. Three consecutive audits each found the NEXT ungated path — the country
 * evaluator with no caller, then six ungated granting paths, then settlement.
 * The rule was never missing; the enumeration was.
 *
 * WHAT THE 2026-08-31 REVISION FIXED — three defects in this test itself:
 *
 *  1. THE CALL SITE WAS DECORATIVE. The old test asserted only `file:digits`
 *     shape and that the FILE existed, so seven citations pointing at closing
 *     parens passed, and `:999999` would have passed too. It now READS the
 *     cited line and asserts it contains `callSiteExpect`. A citation nobody
 *     checks is worse than no citation: it tells the next reader a claim was
 *     verified when nothing verified it.
 *
 *  2. COMPLETENESS WALKED ONLY HANDLED EVENTS. An event that SHOULD change
 *     entitlement but is ignored could therefore never be missing — which is
 *     exactly how `customer.deleted` stayed invisible. It now walks all 19.
 *
 *  3. THE EFFECT WAS TYPED, so it could contradict `EVENT_DISPOSITION`
 *     (`invoice.payment_succeeded` claimed `extend` while being ignored). It is
 *     now derived, and this test asserts the derivation and its refusal.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_SUBSCRIBED_EVENTS,
  CHECKOUT_ROUTE_TRIGGER,
  ENTITLEMENT_PATHS,
  GATES,
  PRE_DISPATCH_GATES,
  deriveEffect,
  readCitedLine,
  type EntitlementPath,
} from "../../server/lib/stripe/entitlement-paths";
import { EVENT_DISPOSITION } from "../../server/lib/stripe/event-surface";

const ROOT = resolve(__dirname, "../..");

/** Paths that GRANT, EXTEND or RESTORE hand out access, so they must gate country. */
const GRANTING: ReadonlyArray<EntitlementPath["effect"]> = [
  "grant",
  "extend",
  "restore",
];

/** True for a row whose trigger is a webhook event the dispatcher ignores. */
function isIgnoredEventRow(p: EntitlementPath): boolean {
  if (p.trigger === CHECKOUT_ROUTE_TRIGGER) return false;
  return EVENT_DISPOSITION[p.trigger].kind === "ignored";
}

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
      expect(p.callSiteExpect, `${p.path}: callSiteExpect`).toBeTruthy();
    }
  });

  // ---- FIX 1: the citation is read, not trusted --------------------------

  /**
   * The column that was decorative. Every row names a line AND the text that
   * line must contain; this reads the file and checks it. Off-by-one, a moved
   * function, a deleted call, or an invented line number all fail here.
   *
   * It prints what it actually read, so the reviewer sees the evidence rather
   * than a green tick.
   */
  it("every cited call site line really contains the call it claims", () => {
    const read = ENTITLEMENT_PATHS.map((p) => {
      const cited = readCitedLine(ROOT, p.callSite);
      return {
        trigger: p.trigger,
        callSite: p.callSite,
        expected: p.callSiteExpect,
        found: cited.text === null ? "<past end of file>" : cited.text.trim(),
        ok: cited.text !== null && cited.text.includes(p.callSiteExpect),
      };
    });
    // eslint-disable-next-line no-console
    console.table(read);

    const wrong = read
      .filter((r) => !r.ok)
      .map(
        (r) =>
          `${r.trigger}: ${r.callSite} does not contain ${JSON.stringify(
            r.expected,
          )} — line reads: ${JSON.stringify(r.found)}`,
      );
    expect(wrong, "citations that do not match the line they name").toEqual([]);
  });

  it("every gate test named by a row exists on disk", () => {
    for (const p of ENTITLEMENT_PATHS) {
      expect(
        existsSync(resolve(ROOT, p.gateTest)),
        `missing gate test: ${p.gateTest}`,
      ).toBe(true);
    }
  });

  // ---- FIX 2: completeness walks ALL subscribed events -------------------

  /**
   * The hiding place, closed structurally. Previously only HANDLED events
   * needed a row, so an event that ought to change entitlement and did not
   * could never be flagged — `customer.deleted` sat there for three audits.
   * Enumerating all 19 means adding a subscription forces a row, and the row
   * forces the author to state what the event does, including "nothing".
   */
  it("every subscribed event has exactly one matrix row — handled or ignored", () => {
    const counts = new Map<string, number>();
    for (const p of ENTITLEMENT_PATHS) {
      counts.set(p.trigger, (counts.get(p.trigger) ?? 0) + 1);
    }

    const missing = ALL_SUBSCRIBED_EVENTS.filter((e) => !counts.has(e));
    expect(missing, "subscribed events with no matrix row").toEqual([]);

    const duplicated = ALL_SUBSCRIBED_EVENTS.filter(
      (e) => (counts.get(e) ?? 0) > 1,
    );
    expect(duplicated, "subscribed events with more than one row").toEqual([]);

    // Guards the guard: if the surface ever shrinks to nothing this test would
    // pass vacuously.
    expect(ALL_SUBSCRIBED_EVENTS.length).toBeGreaterThan(0);
    expect(ENTITLEMENT_PATHS.length).toBe(ALL_SUBSCRIBED_EVENTS.length + 1);
  });

  it("every matrix trigger is a subscribed event or the named route", () => {
    const subscribed = new Set<string>(ALL_SUBSCRIBED_EVENTS);
    for (const p of ENTITLEMENT_PATHS) {
      if (p.trigger === CHECKOUT_ROUTE_TRIGGER) continue;
      expect(
        subscribed.has(p.trigger),
        `unsubscribed trigger: ${p.trigger}`,
      ).toBe(true);
    }
  });

  // ---- FIX 3: the effect is derived, and cannot contradict the dispatcher --

  it("every row's effect equals the derivation from EVENT_DISPOSITION", () => {
    for (const p of ENTITLEMENT_PATHS) {
      expect(p.effect, `${p.path}: effect disagrees with its derivation`).toBe(
        deriveEffect(p.trigger, p.direction),
      );
    }
  });

  /**
   * An ignored event reaches no handler, so it cannot change entitlement and
   * cannot have cleared any gate past the dispatcher. Both halves asserted:
   * effect is `none`, and the gate list is EXACTLY the pre-dispatch three —
   * which is what catches a row claiming gates that never execute.
   */
  it("ignored events derive effect none and claim only the pre-dispatch gates", () => {
    const ignored = ENTITLEMENT_PATHS.filter(isIgnoredEventRow);
    expect(ignored.length, "no ignored events in the matrix?").toBeGreaterThan(
      0,
    );
    for (const p of ignored) {
      expect(p.direction, `${p.path}: ignored row declares a direction`).toBe(
        null,
      );
      expect(p.effect, `${p.path}: ignored row has a non-none effect`).toBe(
        "none",
      );
      expect(
        [...p.gates],
        `${p.path}: ignored row claims gates it never reaches`,
      ).toEqual([...PRE_DISPATCH_GATES]);
    }
  });

  /**
   * The refusal itself. Without this, `deriveEffect` could be quietly softened
   * to coerce a contradiction to `none` and every other test here would still
   * pass — the contradiction has to be loud, because it means the matrix and
   * the dispatcher disagree about what the code does.
   */
  it("deriveEffect refuses a direction declared for an ignored event", () => {
    const anIgnoredEvent = ALL_SUBSCRIBED_EVENTS.find(
      (e) => EVENT_DISPOSITION[e].kind === "ignored",
    );
    expect(anIgnoredEvent, "expected at least one ignored event").toBeDefined();
    expect(() => deriveEffect(anIgnoredEvent!, "grant")).toThrow(
      /contradicts EVENT_DISPOSITION/,
    );
    expect(deriveEffect(anIgnoredEvent!, null)).toBe("none");
  });

  // ---- The gate asymmetry -------------------------------------------------

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
});
