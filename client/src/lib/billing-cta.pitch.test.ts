/**
 * @spec [closure plan W4-11; owner ruling 2026-09-03 (the lapsed state's
 *        remedy is the portal)] | @implemented 2026-09-27
 *
 * plain English: a surface's pitch changes the WORDS a never-paid student
 * sees, and nothing else — not the destination, not the lapsed student's
 * reactivation copy, not any guardian state. LISA's pitch carries Karl's
 * headline verbatim.
 */
import { describe, expect, it } from "vitest";
import { resolveCtaCopy, type BillingCtaState } from "./billing-cta";
import { LISA_UPGRADE_PITCH } from "@/components/tutor/LisaUpgradeCard";

describe("W4-11 — a surface pitch changes only a never-paid student's words", () => {
  it("student_unentitled: the pitch's title, body and label; the destination is still the resolver's", () => {
    const copy = resolveCtaCopy(
      { kind: "student_unentitled" },
      { pitch: LISA_UPGRADE_PITCH },
    );
    expect(copy.title).toBe(LISA_UPGRADE_PITCH.title);
    expect(copy.body).toBe(LISA_UPGRADE_PITCH.body);
    expect(copy.actionLabel).toBe(LISA_UPGRADE_PITCH.actionLabel);
    expect(copy.action).toEqual({ kind: "navigate", to: "/upgrade" });
  });

  it("every other state reads exactly as it does with no pitch", () => {
    const others: BillingCtaState[] = [
      { kind: "student_lapsed" },
      { kind: "guardian_no_link" },
      { kind: "guardian_dashboard" },
      { kind: "guardian_student_unfunded", studentName: "Sam" },
      { kind: "guardian_student_lapsed", studentName: "Sam" },
    ];
    for (const state of others) {
      expect(
        resolveCtaCopy(state, {
          featureBenefit: "LISA",
          pitch: LISA_UPGRADE_PITCH,
        }),
        state.kind,
      ).toEqual(resolveCtaCopy(state, { featureBenefit: "LISA" }));
    }
  });

  it("a lapsed student is still sent to reactivate, not to buy again", () => {
    expect(
      resolveCtaCopy({ kind: "student_lapsed" }, { pitch: LISA_UPGRADE_PITCH })
        .action,
    ).toEqual({ kind: "portal" });
  });

  it("LISA's headline is Karl's, verbatim", () => {
    expect(LISA_UPGRADE_PITCH.title).toBe(
      "A Tutor That Knows The SAT And Knows You",
    );
  });
});
