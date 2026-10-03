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

/** One session's list facts as `exam_list_forms` reads them (SCL-192, SCL-199). */
const SCORED_FACTS = {
  completed_at: null,
  abandoned_at: null,
  total_scaled: 1340,
  rw_scaled: 690,
  math_scaled: 650,
} as const;

async function listItem(
  reportState?: "partial_scored" | "scoring_pending",
): Promise<Record<string, unknown>> {
  const { toGuardianExamList } =
    await import("@lyceon/shared/exam-guardian-report-schema");
  const { formsListing, FIXTURE_SESSION_ID } =
    await import("./test-fixtures/report-fixtures");
  const forms =
    reportState === undefined
      ? formsListing
      : {
          forms: formsListing.forms.map((f) =>
            f.latest_session === null
              ? f
              : {
                  ...f,
                  latest_session: {
                    ...f.latest_session,
                    report_state: reportState,
                  },
                },
          ),
        };
  const [item] = toGuardianExamList(forms, {
    [FIXTURE_SESSION_ID]: SCORED_FACTS,
  }).tests;
  if (item === undefined) throw new Error("no listed item");
  return item;
}

describe("SCL-192 guardian exam list items carry completed_at", () => {
  it("STRICT: an item without completed_at fails the guardian list schema", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await listItem();
    // Presence first: the real projection emits the key (null when no instant is known).
    expect(item).toHaveProperty("completed_at", null);
    const { completed_at: _dropped, ...withoutIt } = item;
    expect(guardianExamListItemSchema.safeParse(item).success).toBe(true);
    expect(guardianExamListItemSchema.safeParse(withoutIt).success).toBe(false);
  });
});

describe("SCL-199 / G5-08 guardian exam list items carry the student's scores and state", () => {
  it("a scored item carries its total, both sections and its session state; each key is required", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await listItem();
    // Presence first: the real projection emits all of them.
    expect(item).toMatchObject({
      report_state: "scored",
      session_state: "completed",
      abandoned_at: null,
      total_scaled: 1340,
      rw_scaled: 690,
      math_scaled: 650,
    });
    for (const key of [
      "session_state",
      "abandoned_at",
      "total_scaled",
      "rw_scaled",
      "math_scaled",
    ]) {
      const { [key]: _dropped, ...withoutIt } = item;
      expect(guardianExamListItemSchema.safeParse(withoutIt).success, key).toBe(
        false,
      );
    }
  });

  it("scores match the state: all three when scored, sections only when partial, none otherwise", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await listItem();
    const ok = (over: Record<string, unknown>): boolean =>
      guardianExamListItemSchema.safeParse({ ...item, ...over }).success;
    expect(ok({})).toBe(true);
    expect(ok({ total_scaled: null })).toBe(false);
    expect(ok({ rw_scaled: null })).toBe(false);
    const partial = { report_state: "partial_scored", total_scaled: null };
    expect(ok({ ...partial, math_scaled: null })).toBe(true);
    expect(ok({ ...partial, rw_scaled: null })).toBe(true);
    expect(ok({ ...partial, rw_scaled: null, math_scaled: null })).toBe(false);
    expect(ok({ report_state: "partial_scored" })).toBe(false);
    const none = { total_scaled: null, rw_scaled: null, math_scaled: null };
    for (const state of [
      "scoring_pending",
      "failed_requires_review",
      "not_completed",
    ]) {
      expect(ok({ report_state: state }), state).toBe(false);
      expect(ok({ report_state: state, ...none }), state).toBe(true);
    }
  });

  it("the projection keeps only what the student's report shows for the state", async () => {
    expect(await listItem("partial_scored")).toMatchObject({
      report_state: "partial_scored",
      total_scaled: null,
      rw_scaled: 690,
      math_scaled: 650,
    });
    expect(await listItem("scoring_pending")).toMatchObject({
      report_state: "scoring_pending",
      total_scaled: null,
      rw_scaled: null,
      math_scaled: null,
    });
  });
});
