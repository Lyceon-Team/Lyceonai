/**
 * G3-02 / G5-11 — the guardian per-domain breakdown is the student's seven segments, never a
 * count and never a percentage.
 *
 * @spec [Doc 04 Parent Q9 as amended by SCL-180, SCL-189 and SCL-210; Guardian_Closure_Plan
 *   G3-02, G5-11; owner ruling R4; owner decision 2026-10-05 (option 1: the guardian row
 *   carries the student's own `segments_filled`)] | @implemented [2026-09-30; segments
 *   2026-10-05]
 *
 * plain English: the named proof — a strict-schema test that fails if `bar_pct`, `correct` or
 * `total` appear. The guardian rows are derived from a REAL student report run through the
 * real projection (`toGuardianExamReport`) and held to the student's own projection
 * (`toStudentExamReport`) for the same report: same domains, same order, same filled count —
 * including the counts a whole percent cannot tell apart (3 of 14 and 4 of 19 both round to
 * 21%, but fill 2 and 1 segments). Presence first: the rows exist and some are filled.
 */
import { describe, expect, it } from "vitest";
import {
  guardianExamReportSchema,
  toGuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import { toStudentExamReport } from "@lyceon/shared/exam-student-report-schema";
import type { ExamDomainSegmentRow } from "@lyceon/shared/exam-domain-segments";
import { examReportPayloadSchema } from "@lyceon/shared/exam-report-schema";
import {
  ambiguousScoredReport,
  partialReport,
  scoredReport,
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

/** `section|domain|filled` per row, in the order given. */
const rowsOf = (rows: ReadonlyArray<ExamDomainSegmentRow>): string[] =>
  rows.map((r) => `${r.section}|${r.domain}|${r.segments_filled}`);

describe("G5-11 guardian domain rows are the student's segments", () => {
  for (const [name, report] of [
    ["scored", scoredReport],
    ["partial_scored", partialReport],
    ["scored, counts a percent cannot separate", ambiguousScoredReport],
  ] as const) {
    it(`${name}: same domains, order and filled count as the student's own report`, () => {
      const student = toStudentExamReport(
        examReportPayloadSchema.parse(report),
      );
      const guardian = toGuardianExamReport(
        examReportPayloadSchema.parse(report),
      );
      if (
        !("domain_segments" in student) ||
        !("domain_breakdown" in guardian)
      ) {
        throw new Error(guardian.report_state);
      }
      // Presence first: rows exist, and some are filled.
      expect(student.domain_segments.length).toBeGreaterThan(0);
      expect(student.domain_segments.some((r) => r.segments_filled > 0)).toBe(
        true,
      );
      expect(rowsOf(guardian.domain_breakdown)).toEqual(
        rowsOf(student.domain_segments),
      );
    });
  }

  it("the cases a whole percent cannot tell apart fill as the student's do", () => {
    const guardian = toGuardianExamReport(ambiguousScoredReport);
    if (!("domain_breakdown" in guardian))
      throw new Error(guardian.report_state);
    const filled = Object.fromEntries(
      guardian.domain_breakdown.map((r) => [r.domain, r.segments_filled]),
    );
    expect(filled).toMatchObject({
      "Craft and Structure": 1,
      "Information and Ideas": 2,
      "Standard English Conventions": 5,
      "Expression of Ideas": 1,
    });
  });

  for (const [name, report] of [
    ["scored", scoredReport],
    ["partial_scored", partialReport],
  ] as const) {
    it(`${name}: each row is exactly {section, domain, segments_filled}; no bar_pct, correct or total anywhere`, () => {
      const guardian = toGuardianExamReport(
        examReportPayloadSchema.parse(report),
      );
      if (!("domain_breakdown" in guardian))
        throw new Error(guardian.report_state);
      expect(guardian.domain_breakdown.length).toBeGreaterThan(0);
      for (const row of guardian.domain_breakdown) {
        expect(Object.keys(row).sort()).toEqual([
          "domain",
          "section",
          "segments_filled",
        ]);
      }
      const keys = keysAtAnyDepth(JSON.parse(JSON.stringify(guardian)));
      for (const k of ["bar_pct", "correct", "total"]) {
        expect(keys).not.toContain(k);
      }
    });
  }

  it("STRICT: a guardian report with bar_pct, correct or total on a row fails to parse", () => {
    const guardian = toGuardianExamReport(
      examReportPayloadSchema.parse(scoredReport),
    );
    if (guardian.report_state !== "scored") throw new Error("fixture drift");
    expect(guardianExamReportSchema.safeParse(guardian).success).toBe(true);
    const [first, ...rest] = guardian.domain_breakdown;
    if (first === undefined) throw new Error("no rows");
    for (const extra of [{ bar_pct: 50 }, { correct: 3 }, { total: 14 }]) {
      const planted = {
        ...guardian,
        domain_breakdown: [{ ...first, ...extra }, ...rest],
      };
      expect(
        guardianExamReportSchema.safeParse(planted).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
  });

  it("STRICT: a whole guardian report carrying the student's count rows fails to parse", () => {
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
