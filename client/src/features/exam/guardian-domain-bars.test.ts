/**
 * G3-02 — the guardian per-domain breakdown is a bar, never a count.
 *
 * @spec [Doc 04 Parent Q9 as amended by SCL-180 and SCL-189; Guardian_Closure_Plan G3-02,
 *   owner ruling R4] | @implemented [2026-09-30]
 *
 * plain English: the named proof — a strict-schema test that fails if `correct` or `total`
 * appear. The guardian rows are derived from a REAL student report run through the real
 * projection (`toGuardianExamReport`), so the assertions are on what the wire carries, not on
 * a hand-written guardian shape. Presence first: the rows exist and carry a non-trivial bar.
 */
import { describe, expect, it } from "vitest";
import {
  guardianDomainBarRowSchema,
  guardianExamReportSchema,
  toGuardianDomainBars,
  toGuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  examReportPayloadSchema,
  type ExamReportPayload,
} from "@lyceon/shared/exam-report-schema";
import {
  FIXTURE_BREAKDOWN,
  scoredReport,
  partialReport,
} from "./test-fixtures/report-fixtures";

function keysAtAnyDepth(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysAtAnyDepth(v, out));
  else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysAtAnyDepth(v, out);
    }
  return out;
}

describe("G3-02 guardian domain bars", () => {
  for (const [name, report] of [
    ["scored", scoredReport],
    ["partial_scored", partialReport],
  ] as const) {
    it(`${name}: rows present, and no correct or total key anywhere in the guardian report`, () => {
      const student: ExamReportPayload = examReportPayloadSchema.parse(report);
      const guardian = toGuardianExamReport(student);
      if (!("domain_breakdown" in guardian))
        throw new Error(guardian.report_state);
      // Presence before absence.
      expect(guardian.domain_breakdown.length).toBeGreaterThan(0);
      expect(guardian.domain_breakdown.some((r) => r.bar_pct > 0)).toBe(true);
      const keys = keysAtAnyDepth(JSON.parse(JSON.stringify(guardian)));
      expect(keys).not.toContain("correct");
      expect(keys).not.toContain("total");
    });
  }

  it("the bar is the student's fraction, as a whole percent", () => {
    const bars = toGuardianDomainBars(FIXTURE_BREAKDOWN);
    // Same rows, same order, and each bar is the student's own fraction.
    expect(bars.map((b) => `${b.section}|${b.domain}`)).toEqual(
      FIXTURE_BREAKDOWN.map((r) => `${r.section}|${r.domain}`),
    );
    expect(bars.map((b) => b.bar_pct)).toEqual(
      FIXTURE_BREAKDOWN.map((r) => Math.round((r.correct / r.total) * 100)),
    );
    for (const bar of bars) {
      expect(Object.keys(bar).sort()).toEqual(["bar_pct", "domain", "section"]);
    }
  });

  it("STRICT: a row with correct or total fails the guardian schema", () => {
    const [row] = toGuardianDomainBars(FIXTURE_BREAKDOWN);
    expect(guardianDomainBarRowSchema.safeParse(row).success).toBe(true);
    expect(
      guardianDomainBarRowSchema.safeParse({ ...row, correct: 11 }).success,
    ).toBe(false);
    expect(
      guardianDomainBarRowSchema.safeParse({ ...row, total: 13 }).success,
    ).toBe(false);
  });

  it("STRICT: a whole guardian report carrying the student's rows fails to parse", () => {
    const student = examReportPayloadSchema.parse(scoredReport);
    const guardian = toGuardianExamReport(student);
    if (student.report_state !== "scored")
      throw new Error(student.report_state);
    const planted = { ...guardian, domain_breakdown: student.domain_breakdown };
    expect(guardianExamReportSchema.safeParse(planted).success).toBe(false);
  });
});

describe("SCL-192 guardian exam list items carry completed_at", () => {
  it("STRICT: an item without completed_at fails the guardian list schema", async () => {
    const { guardianExamListItemSchema, toGuardianExamList } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const { formsListing, FIXTURE_SESSION_ID } =
      await import("./test-fixtures/report-fixtures");
    const [item] = toGuardianExamList(
      formsListing,
      {},
      { [FIXTURE_SESSION_ID]: 1340 },
    ).tests;
    expect(item).toBeDefined();
    // Presence first: the real projection emits the key (null when no instant is known).
    expect(item).toHaveProperty("completed_at", null);
    const { completed_at: _dropped, ...withoutIt } = item!;
    expect(guardianExamListItemSchema.safeParse(item).success).toBe(true);
    expect(guardianExamListItemSchema.safeParse(withoutIt).success).toBe(false);
  });
});

describe("SCL-199 guardian exam list items carry total_scaled", () => {
  async function scoredItem(): Promise<Record<string, unknown>> {
    const { toGuardianExamList } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const { formsListing, FIXTURE_SESSION_ID } =
      await import("./test-fixtures/report-fixtures");
    const [item] = toGuardianExamList(
      formsListing,
      {},
      { [FIXTURE_SESSION_ID]: 1340 },
    ).tests;
    if (item === undefined) throw new Error("no listed item");
    return item;
  }

  it("a scored item carries its total; without the key it fails the schema", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await scoredItem();
    // Presence first: the real projection emits the scored total.
    expect(item).toMatchObject({ report_state: "scored", total_scaled: 1340 });
    const { total_scaled: _dropped, ...withoutIt } = item;
    expect(guardianExamListItemSchema.safeParse(withoutIt).success).toBe(false);
  });

  it("present exactly when scored: a null total on a scored item, or a total on any other state, fails", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await scoredItem();
    expect(
      guardianExamListItemSchema.safeParse({ ...item, total_scaled: null })
        .success,
    ).toBe(false);
    for (const state of [
      "partial_scored",
      "scoring_pending",
      "failed_requires_review",
      "not_completed",
    ]) {
      expect(
        guardianExamListItemSchema.safeParse({ ...item, report_state: state })
          .success,
      ).toBe(false);
      expect(
        guardianExamListItemSchema.safeParse({
          ...item,
          report_state: state,
          total_scaled: null,
        }).success,
      ).toBe(true);
    }
  });

  it("the projection drops a total the score run holds for a state that is not scored", async () => {
    const { toGuardianExamList } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const { formsListing, FIXTURE_SESSION_ID } =
      await import("./test-fixtures/report-fixtures");
    const partial = {
      forms: formsListing.forms.map((f) =>
        f.latest_session === null
          ? f
          : {
              ...f,
              latest_session: {
                ...f.latest_session,
                report_state: "partial_scored" as const,
              },
            },
      ),
    };
    const [item] = toGuardianExamList(
      partial,
      {},
      { [FIXTURE_SESSION_ID]: 1340 },
    ).tests;
    expect(item).toMatchObject({
      report_state: "partial_scored",
      total_scaled: null,
    });
  });
});
