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

/** One session's list facts as `exam_list_forms` reads them (SCL-192, SCL-199): instants only. */
const SESSION_FACTS = {
  completed_at: null,
  abandoned_at: null,
} as const;

async function listItem(
  reportState?:
    | "partial_scored"
    | "scoring_pending"
    | "failed_requires_review"
    | "not_completed",
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
    [FIXTURE_SESSION_ID]: SESSION_FACTS,
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

/** A key that names a score: any `*_scaled`, or anything with "score" in it. */
const SCORE_KEY = /scaled|score/i;

describe("SCL-199 (narrowed) / G5-08 guardian exam list items carry the student's state", () => {
  it("each item carries its session state and abandonment instant; each key is required", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await listItem();
    // Presence first: the real projection emits both.
    expect(item).toMatchObject({
      report_state: "scored",
      session_state: "completed",
      abandoned_at: null,
    });
    for (const key of ["session_state", "abandoned_at"]) {
      const { [key]: _dropped, ...withoutIt } = item;
      expect(guardianExamListItemSchema.safeParse(withoutIt).success, key).toBe(
        false,
      );
    }
  });
});

/**
 * G5-09 (owner brief 2026-10-03): scores reach a guardian only through the report route. This
 * fails if any guardian list item, in any report state, carries a score field — from the real
 * projection, and at the schema, which refuses a planted one.
 */
describe("G5-09 no guardian list item carries a score field", () => {
  it.each([
    "scored",
    "partial_scored",
    "scoring_pending",
    "failed_requires_review",
    "not_completed",
  ] as const)("%s: the projected item has no score key", async (state) => {
    const item = await listItem(state === "scored" ? undefined : state);
    // Presence first: a real item, of that state.
    expect(item).toHaveProperty("report_state", state);
    expect(Object.keys(item).length).toBeGreaterThan(5);
    expect(Object.keys(item).filter((k) => SCORE_KEY.test(k))).toEqual([]);
  });

  it("the schema refuses an item with any score key planted", async () => {
    const { guardianExamListItemSchema } =
      await import("@lyceon/shared/exam-guardian-report-schema");
    const item = await listItem();
    expect(guardianExamListItemSchema.safeParse(item).success).toBe(true);
    for (const key of [
      "total_scaled",
      "rw_scaled",
      "math_scaled",
      "score",
      "partial_display_scaled",
    ]) {
      expect(
        guardianExamListItemSchema.safeParse({ ...item, [key]: 650 }).success,
        key,
      ).toBe(false);
    }
  });
});
