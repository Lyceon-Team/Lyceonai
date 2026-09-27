// @vitest-environment jsdom
/**
 * G1 — the guardian's exam results page.
 *
 * @spec [Doc-04C §12.2, §12.3, §15.1; Doc 04 Parent Q9 as amended by SCL-180; SCL-181]
 * @implemented [2026-09-27]
 *
 * plain English: each guardian state renders from the guardian payload alone; pending and
 * partial never draw a number that is not a real section score; nothing on the page is a
 * control that writes, reviews or resumes; the server's 402 and 404 read as a parent's copy.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  guardianExamReportSchema,
  type GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import { HttpApiError } from "@/lib/api-error";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const SID = "5e551011-0000-4000-8000-000000000001";

const fetchList = vi.fn();
const fetchReport = vi.fn();
vi.mock("../api/exam-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api/exam-api")>();
  return {
    ...real,
    fetchGuardianExamList: (...a: unknown[]) => fetchList(...a),
    fetchGuardianExamReport: (...a: unknown[]) => fetchReport(...a),
  };
});

import GuardianExamResultsPage, {
  GuardianReportBody,
} from "./GuardianExamResultsPage";

const base = {
  session_id: SID,
  test_form_id: "f0f00000-0000-4000-8000-000000000001",
  test_form_name: "Practice Test 2",
};
const disclosure = {
  disclosure_version: "disclosure-v1.0",
  summary: "A Lyceon-modeled estimate, not an official SAT score.",
  full_text_url: "/legal/student-terms",
};
const RW_ROWS = [
  { section: "RW", domain: "Craft and Structure", correct: 10, total: 13 },
  { section: "RW", domain: "Expression of Ideas", correct: 6, total: 8 },
  { section: "RW", domain: "Information and Ideas", correct: 9, total: 12 },
  {
    section: "RW",
    domain: "Standard English Conventions",
    correct: 11,
    total: 21,
  },
];
const M_ROWS = [
  { section: "M", domain: "Advanced Math", correct: 12, total: 15 },
  { section: "M", domain: "Algebra", correct: 11, total: 13 },
  { section: "M", domain: "Geometry and Trigonometry", correct: 4, total: 7 },
  {
    section: "M",
    domain: "Problem Solving and Data Analysis",
    correct: 5,
    total: 9,
  },
];

const scored = guardianExamReportSchema.parse({
  report_state: "scored",
  ...base,
  mode: "strict",
  completed_at: "2026-09-24T15:00:00Z",
  attempt_number_for_form: 2,
  is_first_seen_form_attempt: false,
  score: { total_scaled: 1340, rw_scaled: 690, math_scaled: 650 },
  domain_breakdown: [...RW_ROWS, ...M_ROWS],
  disclosure,
});

const partial = guardianExamReportSchema.parse({
  report_state: "partial_scored",
  ...base,
  mode: "lenient",
  abandoned_at: "2026-09-24T15:00:00Z",
  attempt_number_for_form: 1,
  is_first_seen_form_attempt: true,
  score: { rw_scaled: 690, math_scaled: null },
  completed_sections: ["RW"],
  incomplete_sections: ["M"],
  domain_breakdown: RW_ROWS,
  disclosure,
  partial_disclosure: {
    summary:
      "Reading and Writing section score: 690. Math was not completed, so no total score is available.",
  },
});

function show(report: GuardianExamReport) {
  const { hook } = memoryLocation({
    path: `/students/${STUDENT}/tests/${SID}`,
  });
  return render(
    <Router hook={hook}>
      <GuardianReportBody report={report} />
    </Router>,
  );
}

function mountPage(path: string) {
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route
          path="/students/:studentId/tests"
          component={GuardianExamResultsPage}
        />
        <Route
          path="/students/:studentId/tests/:sessionId"
          component={GuardianExamResultsPage}
        />
      </Router>
    </QueryClientProvider>,
  );
}

/** Nothing a guardian can press that writes, reviews or resumes (§12.3). */
function expectNoControls(): void {
  const buttons = screen
    .queryAllByRole("button")
    .map((b) => b.textContent ?? "");
  expect(
    buttons.filter((t) => /review|resume|start|retake|submit/i.test(t)),
  ).toEqual([]);
  const links = screen
    .queryAllByRole("link")
    .map((l) => l.getAttribute("href"));
  expect(
    links.filter((h) => h !== null && /^\/tests\b|review/.test(h)),
  ).toEqual([]);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("guardian exam result", () => {
  it("scored: total, both sections, the facts, the disclosure, and the same breakdown the student sees", () => {
    show(scored);
    expect(screen.getByTestId("exam-total-score").textContent).toBe("1340");
    expect(
      screen.getAllByTestId("exam-section-score").map((e) => e.textContent),
    ).toEqual([expect.stringContaining("690"), expect.stringContaining("650")]);
    expect(screen.getByText("Test-day")).toBeTruthy();
    expect(screen.getByText("Seen before")).toBeTruthy();
    expect(screen.getByTestId("exam-disclosure").textContent).toContain(
      disclosure.summary,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    const rows = screen
      .getAllByTestId("exam-domain-row")
      .map((r) => r.textContent);
    expect(rows).toHaveLength(8);
    expect(rows).toContain("Algebra11 of 13 correct");
    expectNoControls();
  });

  it("PLANT: no score is drawn without its disclosure", () => {
    show({ ...scored, disclosure: undefined } as unknown as GuardianExamReport);
    expect(document.body.textContent).not.toMatch(/1340|690|650/);
    expect(screen.getByTestId("exam-score-withheld")).toBeTruthy();
  });

  it("partial: no total anywhere, Math not completed, only the scored section broken down", () => {
    show(partial);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.getByTestId("exam-partial-summary").textContent).toContain(
      "no total score",
    );
    expect(screen.getAllByTestId("exam-section-score")[1]!.textContent).toBe(
      "MathNot completed",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(4);
    // No phantom number: the only digits on the page are the real RW score, its range,
    // the attempt, the breakdown counts, and the date.
    expect(document.body.textContent).not.toMatch(/1[0-9]{3}\b/);
    expectNoControls();
  });

  it("pending: 'being scored', no number, no disclosure, no tabs", () => {
    show(
      guardianExamReportSchema.parse({
        report_state: "scoring_pending",
        ...base,
        completed_at: "2026-09-24T15:00:00Z",
        abandoned_at: null,
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("being scored");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("exam-disclosure")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /\b[2-9][0-9]{2}\b|1[0-9]{3}/,
    );
    expectNoControls();
  });

  it("failed: a parent's 'score delayed', without the student's message or an incident reference", () => {
    show(
      guardianExamReportSchema.parse({
        report_state: "failed_requires_review",
        ...base,
        completed_at: "2026-09-24T15:00:00Z",
        abandoned_at: null,
      }),
    );
    expect(screen.getByTestId("guardian-exam-delayed").textContent).toContain(
      "technical issue on our end",
    );
    expect(document.body.textContent).not.toMatch(/INC-|we'll email you/i);
    expectNoControls();
  });

  it("not_completed: no resume control", () => {
    show(
      guardianExamReportSchema.parse({
        report_state: "not_completed",
        ...base,
        session_state: "active",
      }),
    );
    expect(screen.getByText("In progress")).toBeTruthy();
    expectNoControls();
  });
});

describe("guardian exam pages against the API", () => {
  it("lists the student's tests, each linking to its result", async () => {
    fetchList.mockResolvedValue([
      {
        session_id: SID,
        test_form_id: base.test_form_id,
        test_form_name: "Practice Test 2",
        mode: "strict",
        attempt_number_for_form: 2,
        report_state: "scored",
      },
    ]);
    mountPage(`/students/${STUDENT}/tests`);
    const link = await screen.findByRole("link", { name: /Practice Test 2/ });
    expect(link.getAttribute("href")).toBe(`/students/${STUDENT}/tests/${SID}`);
    expect(fetchList).toHaveBeenCalledWith(STUDENT);
    expectNoControls();
  });

  it.each([
    [402, "Subscription needed"],
    [404, "Not available"],
  ])(
    "the server's %i reads as a parent's copy, with no retry",
    async (status, title) => {
      fetchReport.mockRejectedValue(
        new HttpApiError({ status, message: "denied" }),
      );
      mountPage(`/students/${STUDENT}/tests/${SID}`);
      expect(
        (await screen.findByTestId("guardian-exam-denied")).dataset.status,
      ).toBe(String(status));
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(document.body.textContent).not.toMatch(/1340/);
    },
  );
});
