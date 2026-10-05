// @vitest-environment jsdom
/**
 * G5-11 — the guardian's Score breakdown draws what the student's draws, segment for segment.
 *
 * @spec [Guardian_Closure_Plan G5-11; SCL-210 (amends SCL-189: the guardian row is the
 *       student's `{section, domain, segments_filled}`); SCL-180 owner ruling 7 (seven
 *       segments per domain); owner decision 2026-10-05 (option 1)] | @implemented [2026-10-05]
 *
 * plain English: for one session, the student's own report (`ReportBody`, fed the student
 * projection) and the guardian's detail (`GuardianReportBody`, fed the guardian projection)
 * are rendered and switched to their Score breakdown tab. Per domain, in page order: the same
 * domain name, the same number of segments and the same number filled. Presence first: each
 * side draws rows, with seven segments each and some filled. One case uses counts a whole
 * percent cannot separate (1/14, 3/14, 9/14, 4/19).
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DOMAIN_SEGMENT_COUNT } from "@lyceon/shared/exam-domain-segments";
import { toGuardianExamReport } from "@lyceon/shared/exam-guardian-report-schema";
import type { ExamReportPayload } from "@lyceon/shared/exam-report-schema";
import { toStudentExamReport } from "@lyceon/shared/exam-student-report-schema";
import {
  ambiguousScoredReport,
  partialReport,
  scoredReport,
} from "../test-fixtures/report-fixtures";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { display_name: "Test Student" } }),
}));

import { ReportBody } from "./ExamReportPage";
import { GuardianReportBody } from "./GuardianExamResultsPage";

afterEach(cleanup);

type Drawn = { domain: string; segments: number; filled: number };

/** Renders `node`, opens Score breakdown, and reads its omission notes, in page order. */
function notesOf(node: React.ReactElement): string[] {
  const { hook } = memoryLocation({ path: "/x" });
  const { unmount } = render(<Router hook={hook}>{node}</Router>);
  fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
  const notes = screen
    .queryAllByTestId("exam-domain-omitted")
    .map((n) => n.textContent ?? "");
  unmount();
  return notes;
}

/** Renders `node`, opens Score breakdown, and reads each domain row in page order. */
function breakdownOf(node: React.ReactElement): Drawn[] {
  const { hook } = memoryLocation({ path: "/x" });
  const { unmount } = render(<Router hook={hook}>{node}</Router>);
  fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
  const rows = within(screen.getByTestId("exam-domain-breakdown"))
    .getAllByTestId("exam-domain-row")
    .map((row) => {
      const segs = within(row).queryAllByTestId("exam-domain-segment");
      return {
        domain: row.querySelector("span")?.textContent ?? "",
        segments: segs.length,
        filled: segs.filter((s) => s.dataset.filled === "true").length,
      };
    });
  unmount();
  return rows;
}

describe("G5-11 the guardian breakdown is the student's, segment for segment", () => {
  it.each([
    ["scored", scoredReport],
    ["partial score", partialReport],
    ["scored, counts a percent cannot separate", ambiguousScoredReport],
  ] as const)("%s", (_name, report: ExamReportPayload) => {
    const student = breakdownOf(
      <ReportBody payload={toStudentExamReport(report)} />,
    );
    const guardian = breakdownOf(
      <GuardianReportBody report={toGuardianExamReport(report)} />,
    );
    // Presence first: rows, seven segments each, some filled.
    expect(student.length).toBeGreaterThan(0);
    expect(student.every((r) => r.segments === DOMAIN_SEGMENT_COUNT)).toBe(
      true,
    );
    expect(student.some((r) => r.filled > 0)).toBe(true);
    expect(guardian).toEqual(student);
  });

  it("the percent-ambiguous counts fill 1, 2, 5 and 1 on both sides", () => {
    const guardian = breakdownOf(
      <GuardianReportBody
        report={toGuardianExamReport(ambiguousScoredReport)}
      />,
    );
    const filled = Object.fromEntries(
      guardian.map((r) => [r.domain, r.filled]),
    );
    expect(filled).toMatchObject({
      "Craft and Structure": 1,
      "Information and Ideas": 2,
      "Standard English Conventions": 5,
      "Expression of Ideas": 1,
    });
  });

  it("G5-12 partial score: the same note the student sees, for the section with no score", () => {
    const student = notesOf(
      <ReportBody payload={toStudentExamReport(partialReport)} />,
    );
    const guardian = notesOf(
      <GuardianReportBody report={toGuardianExamReport(partialReport)} />,
    );
    // Presence first: the student's note, word for word.
    expect(student).toEqual([
      "Math wasn't completed, so its domains aren't shown.",
    ]);
    expect(guardian).toEqual(student);
  });

  it("G5-12 scored: no note on either side", () => {
    expect(
      notesOf(
        <GuardianReportBody report={toGuardianExamReport(scoredReport)} />,
      ),
    ).toEqual([]);
    expect(
      notesOf(<ReportBody payload={toStudentExamReport(scoredReport)} />),
    ).toEqual([]);
  });
});
