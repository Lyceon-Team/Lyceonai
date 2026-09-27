// @vitest-environment jsdom
/**
 * @spec [Doc-04C_V1.0 §8.1, §9.1, §10.2, §11.4, §11.5, §11.5b, §15.1]
 *       [E7b plant: "the completion screen refuses to render a score without its
 *        disclosure"; owner rulings 4 and 6] | @implemented [2026-09-25]
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ExamReportPayload } from "@lyceon/shared/exam-report-schema";
import { examReportPayloadSchema } from "@lyceon/shared/exam-report-schema";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { display_name: "Test Student" } }),
}));

import { ReportBody } from "./ExamReportPage";

const base = {
  session_id: "5e551011-0000-4000-8000-000000000001",
  test_form_id: "f0f00000-0000-4000-8000-000000000001",
  test_form_name: "Practice Test 2",
};
const disclosure = {
  disclosure_version: "disclosure-v1.0",
  summary: "A Lyceon-modeled estimate, not an official SAT score.",
  full_text_url: "/legal/score-disclosure",
};
const scored = examReportPayloadSchema.parse({
  report_state: "scored",
  ...base,
  mode: "strict",
  completed_at: "2026-09-24T15:00:00Z",
  attempt_number_for_form: 1,
  is_first_seen_form_attempt: true,
  score: {
    total_scaled: 1340,
    rw_scaled: 690,
    math_scaled: 650,
    partial_display_scaled: null,
    scoring_model_version: "v1.0",
    score_run_id: "a0a00000-0000-4000-8000-000000000001",
    scored_at: "2026-09-24T15:00:05Z",
  },
  sections: [
    { section: "RW", section_state: "submitted", scaled: 690, scoreable: true },
    { section: "M", section_state: "submitted", scaled: 650, scoreable: true },
  ],
  disclosure,
  review_unlocked: true,
});

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
    expect(screen.getAllByTestId("exam-section-score").map((e) => e.textContent)).toEqual([
      expect.stringContaining("690"),
      expect.stringContaining("650"),
    ]);
    const note = screen.getAllByTestId("exam-disclosure")[0]!;
    expect(note.textContent).toContain(disclosure.summary);
    expect(screen.getAllByRole("link", { name: "Learn more" })[0]!.getAttribute("href")).toBe(disclosure.full_text_url);
    expect(screen.getByText("Test-day")).toBeTruthy();
    // Ruled out: no time used, no answered count, no framing paragraph.
    expect(document.body.textContent).not.toMatch(/time used|answered|not a count of correct answers/i);
    // Disabled, not absent: the tab strip is E8's.
    expect((screen.getByRole("tab", { name: /Score breakdown/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Review your answers" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("PLANT: refuses to render a score without its disclosure", () => {
    const stripped = { ...scored, disclosure: undefined } as unknown as ExamReportPayload;
    show(stripped);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.queryAllByTestId("exam-section-score")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/1340|690|650/);
    expect(screen.getAllByTestId("exam-score-withheld").length).toBeGreaterThan(0);

    cleanup();
    show({ ...scored, disclosure: { ...disclosure, summary: "" } } as ExamReportPayload);
    expect(document.body.textContent).not.toMatch(/1340/);
  });

  it("scoring_pending: generic copy when estimated_ready_at is null (§11.5)", () => {
    show(
      examReportPayloadSchema.parse({
        report_state: "scoring_pending",
        ...base,
        completed_at: "2026-09-24T15:00:00Z",
        abandoned_at: null,
        estimated_ready_at: null,
        review_unlocked: false,
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("Scoring usually takes a few minutes");
    expect(screen.queryByRole("button", { name: "Review your answers" })).toBeNull();
  });

  it("partial_scored: no total, the partial summary, the incomplete section named", () => {
    show(
      examReportPayloadSchema.parse({
        report_state: "partial_scored",
        ...base,
        mode: "lenient",
        abandoned_at: "2026-09-24T15:00:00Z",
        attempt_number_for_form: 1,
        is_first_seen_form_attempt: true,
        score: {
          total_scaled: null,
          rw_scaled: 690,
          math_scaled: null,
          partial_display_scaled: 690,
          scoring_model_version: "v1.0",
          score_run_id: "a0a00000-0000-4000-8000-000000000001",
          scored_at: "2026-09-24T15:00:05Z",
        },
        sections: [
          { section: "RW", section_state: "submitted", scaled: 690, scoreable: true, incompleteness_reason: null },
          { section: "M", section_state: "module1_submitted", scaled: null, scoreable: false, incompleteness_reason: "module1_only" },
        ],
        completed_sections: ["RW"],
        incomplete_sections: ["M"],
        disclosure,
        partial_disclosure: { summary: "Reading and Writing section score: 690. Math was not completed, so no total score is available." },
        review_unlocked: true,
      }),
    );
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.getByTestId("exam-partial-summary").textContent).toContain("no total score");
    expect(screen.getAllByTestId("exam-section-score")[1]!.textContent).toContain("Not completed");
    expect(screen.getAllByTestId("exam-disclosure").length).toBeGreaterThan(0);
  });

  it("failed_requires_review: the payload's message and reference, nothing internal", () => {
    show(
      examReportPayloadSchema.parse({
        report_state: "failed_requires_review",
        ...base,
        completed_at: "2026-09-24T15:00:00Z",
        abandoned_at: null,
        failure_summary: {
          student_facing_message: "Your test score isn't available yet because of a technical issue on our end. (Reference: INC-1a2b3c4d)",
          incident_reference: "INC-1a2b3c4d",
          recorded_at: "2026-09-24T15:00:05Z",
        },
        review_unlocked: false,
      }),
    );
    expect(screen.getByTestId("exam-failure-message").textContent).toContain("INC-1a2b3c4d");
  });

  it("not_completed and unavailable render without a score", () => {
    show(
      examReportPayloadSchema.parse({
        report_state: "not_completed",
        ...base,
        session_state: "active",
        resumable: true,
        review_unlocked: false,
      }),
    );
    expect(screen.getByRole("link", { name: "Resume test" }).getAttribute("href")).toBe(`/tests/${base.session_id}`);
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
    expect(screen.getByText("This report isn't available right now")).toBeTruthy();
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
  });
});
