// @vitest-environment jsdom
/**
 * @spec [Doc-04C_V1.0 §8.1, §9.1, §10.2, §11.4, §11.5, §11.5b, §15.1]
 *       [E7b plant: "the completion screen refuses to render a score without its
 *        disclosure"; owner rulings 4 and 6] | @implemented [2026-09-25]
 *       [SCL-180 (amended 2026-09-29), owner ruling 7: seven segments per domain, no
 *        correct-of-total anywhere] | @implemented [2026-09-29]
 *
 * FIXTURES: the student payloads are `toStudentExamReport` of the shared server-side
 * fixtures — the same projection the /report route applies.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  examStudentReportPayloadSchema,
  type ExamStudentReportPayload,
} from "@lyceon/shared/exam-student-report-schema";
import {
  FIXTURE_DISCLOSURE,
  FIXTURE_FORM_ID,
  FIXTURE_SESSION_ID,
  studentFailedReport,
  studentInProgressReport,
  studentPartialReport,
  studentPendingReport,
  studentScoredReport,
} from "../test-fixtures/report-fixtures";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { display_name: "Test Student" } }),
}));

import { ReportBody } from "./ExamReportPage";

const base = {
  session_id: FIXTURE_SESSION_ID,
  test_form_id: FIXTURE_FORM_ID,
  test_form_name: "Practice Test 2",
};
const disclosure = FIXTURE_DISCLOSURE;
const scored = studentScoredReport;

function show(payload: ExamStudentReportPayload) {
  const { hook } = memoryLocation({ path: "/tests/x/report" });
  return render(
    <Router hook={hook}>
      <ReportBody payload={payload} />
    </Router>,
  );
}

afterEach(cleanup);

describe("report screen", () => {
  it("scored: total, both sections, the facts, and the disclosure from the payload", () => {
    show(scored);
    expect(screen.getByTestId("exam-total-score").textContent).toBe("1340");
    expect(
      screen.getAllByTestId("exam-section-score").map((e) => e.textContent),
    ).toEqual([expect.stringContaining("690"), expect.stringContaining("650")]);
    // G2 (SCL-182): the summary stands alone — exactly the payload's text, no link,
    // and the payload's full_text_url is not rendered anywhere.
    const note = screen.getAllByTestId("exam-disclosure")[0]!;
    expect(note.textContent).toBe(disclosure.summary);
    expect(note.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /learn more/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain(disclosure.full_text_url);
    expect(screen.getByText("Test-day")).toBeTruthy();
    // Ruled out: no time used, no answered count, no framing paragraph.
    expect(document.body.textContent).not.toMatch(
      /time used|answered|not a count of correct answers/i,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Review your answers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("ruling 7: the Score breakdown tab draws seven segments per domain and no question counts", () => {
    show(scored);
    const tab = screen.getByRole("tab", {
      name: "Score breakdown",
    }) as HTMLButtonElement;
    expect(tab.disabled).toBe(false);
    expect(screen.queryByTestId("exam-domain-breakdown")).toBeNull();
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    // Presence first: eight domains, each a bar of exactly seven segments.
    const rows = screen.getAllByTestId("exam-domain-row");
    expect(rows).toHaveLength(8);
    const bars = screen.getAllByTestId("exam-domain-segments");
    expect(
      bars.map(
        (b) => b.querySelectorAll('[data-testid="exam-domain-segment"]').length,
      ),
    ).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    // Filled per the server's segments_filled (fixtures: 10/13, 6/8, 9/12, 11/21, 12/15,
    // 11/13, 4/7, 5/9), in canonical order within RW then Math.
    expect(
      bars.map((b) => b.querySelectorAll('[data-filled="true"]').length),
    ).toEqual([5, 5, 5, 4, 6, 6, 4, 4]);
    expect(rows[0]!.textContent).toBe("Information and Ideas");
    expect(
      screen.getByRole("img", { name: "Algebra: 6 of 7 segments filled" }),
    ).toBeTruthy();
    expect(screen.getByText("Reading and Writing")).toBeTruthy();
    // Then absence: no "N of M" count and no "correct" anywhere in the rendered text.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*of\s*\d+/);
    expect(text).not.toMatch(/correct/i);
    expect(screen.queryAllByTestId("exam-domain-omitted")).toHaveLength(0);
    // Keyboard: Left from the second tab returns to Section scores.
    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    expect(
      screen
        .getByRole("tab", { name: "Section scores" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getAllByTestId("exam-section-score")).toHaveLength(2);
  });

  it("PLANT: refuses to render a score without its disclosure", () => {
    const stripped = {
      ...scored,
      disclosure: undefined,
    } as unknown as ExamStudentReportPayload;
    show(stripped);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.queryAllByTestId("exam-section-score")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/1340|690|650/);
    expect(screen.getAllByTestId("exam-score-withheld").length).toBeGreaterThan(
      0,
    );

    cleanup();
    show({
      ...scored,
      disclosure: { ...disclosure, summary: "" },
    } as ExamStudentReportPayload);
    expect(document.body.textContent).not.toMatch(/1340/);
  });

  it("scoring_pending: generic copy when estimated_ready_at is null (§11.5)", () => {
    show(studentPendingReport);
    expect(screen.getByRole("status").textContent).toContain(
      "Scoring usually takes a few minutes",
    );
    expect(
      screen.queryByRole("button", { name: "Review your answers" }),
    ).toBeNull();
  });

  it("partial_scored: no total, the partial summary, the incomplete section named", () => {
    show(studentPartialReport);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.getByTestId("exam-partial-summary").textContent).toContain(
      "no total score",
    );
    expect(
      screen.getAllByTestId("exam-section-score")[1]!.textContent,
    ).toContain("Not completed");
    expect(screen.getAllByTestId("exam-disclosure").length).toBeGreaterThan(0);
    // Ruling 7: only the scored section is drawn; Math's domains are omitted and the
    // report says why, with no segment bar beside its missing score.
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(4);
    expect(screen.getAllByTestId("exam-domain-segments")).toHaveLength(4);
    expect(screen.getByTestId("exam-domain-omitted").textContent).toBe(
      "Math wasn't completed, so its domains aren't shown.",
    );
    expect(document.body.textContent).not.toMatch(/\d+\s*of\s*\d+/);
  });

  it("failed_requires_review: the payload's message and reference, nothing internal", () => {
    show(studentFailedReport);
    expect(screen.getByTestId("exam-failure-message").textContent).toContain(
      "INC-1a2b3c4d",
    );
  });

  it("not_completed and unavailable render without a score", () => {
    show(studentInProgressReport);
    expect(
      screen.getByRole("link", { name: "Resume test" }).getAttribute("href"),
    ).toBe(`/tests/${base.session_id}`);
    cleanup();
    show(
      examStudentReportPayloadSchema.parse({
        report_state: "unavailable",
        ...base,
        unavailable_reason: "entitlement_lapsed",
        unavailable_at: null,
        resume_action: null,
        review_unlocked: false,
      }),
    );
    expect(
      screen.getByText("This report isn't available right now"),
    ).toBeTruthy();
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
  });
});
