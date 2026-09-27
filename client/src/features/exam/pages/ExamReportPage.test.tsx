// @vitest-environment jsdom
/**
 * @spec [Doc-04C_V1.0 §8.1, §9.1, §10.2, §11.4, §11.5, §11.5b, §15.1]
 *       [E7b plant: "the completion screen refuses to render a score without its
 *        disclosure"; owner rulings 4 and 6] | @implemented [2026-09-25]
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ExamReportPayload } from "@lyceon/shared/exam-report-schema";
import { examReportPayloadSchema } from "@lyceon/shared/exam-report-schema";
import {
  FIXTURE_DISCLOSURE,
  FIXTURE_FORM_ID,
  FIXTURE_SESSION_ID,
  failedReport,
  inProgressReport,
  partialReport,
  pendingReport,
  scoredReport,
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
const scored = scoredReport;

function show(payload: ExamReportPayload) {
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
    const note = screen.getAllByTestId("exam-disclosure")[0]!;
    expect(note.textContent).toContain(disclosure.summary);
    expect(
      screen
        .getAllByRole("link", { name: "Learn more" })[0]!
        .getAttribute("href"),
    ).toBe(disclosure.full_text_url);
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

  it("G1: the Score breakdown tab shows every domain's correct-of-total, grouped by section", () => {
    show(scored);
    const tab = screen.getByRole("tab", {
      name: "Score breakdown",
    }) as HTMLButtonElement;
    expect(tab.disabled).toBe(false);
    expect(screen.queryByTestId("exam-domain-breakdown")).toBeNull();
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const rows = screen
      .getAllByTestId("exam-domain-row")
      .map((r) => r.textContent);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toBe("Craft and Structure10 of 13 correct");
    expect(rows[7]).toBe("Problem Solving and Data Analysis5 of 9 correct");
    expect(screen.getByText("Reading and Writing")).toBeTruthy();
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
    } as unknown as ExamReportPayload;
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
    } as ExamReportPayload);
    expect(document.body.textContent).not.toMatch(/1340/);
  });

  it("scoring_pending: generic copy when estimated_ready_at is null (§11.5)", () => {
    show(pendingReport);
    expect(screen.getByRole("status").textContent).toContain(
      "Scoring usually takes a few minutes",
    );
    expect(
      screen.queryByRole("button", { name: "Review your answers" }),
    ).toBeNull();
  });

  it("partial_scored: no total, the partial summary, the incomplete section named", () => {
    show(partialReport);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.getByTestId("exam-partial-summary").textContent).toContain(
      "no total score",
    );
    expect(
      screen.getAllByTestId("exam-section-score")[1]!.textContent,
    ).toContain("Not completed");
    expect(screen.getAllByTestId("exam-disclosure").length).toBeGreaterThan(0);
    // G1: only the scored section is broken down; Math has no rows beside its missing score.
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(4);
    expect(screen.queryByText("Math")).toBeNull();
  });

  it("failed_requires_review: the payload's message and reference, nothing internal", () => {
    show(failedReport);
    expect(screen.getByTestId("exam-failure-message").textContent).toContain(
      "INC-1a2b3c4d",
    );
  });

  it("not_completed and unavailable render without a score", () => {
    show(inProgressReport);
    expect(
      screen.getByRole("link", { name: "Resume test" }).getAttribute("href"),
    ).toBe(`/tests/${base.session_id}`);
    cleanup();
    show(
      examReportPayloadSchema.parse({
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
