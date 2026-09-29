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
 *
 * FIXTURES: every guardian payload here is the REAL projection (`toGuardianExamReport`,
 * `toGuardianExamList`) applied to the one set of student payloads in
 * `../test-fixtures/report-fixtures.ts`. No guardian-shaped copy is written by hand, so a
 * fixture here cannot contain a field the projection would drop (guardian schema-truth
 * gate, Rule B).
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  toGuardianExamList,
  toGuardianExamReport,
  type GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  FIXTURE_DISCLOSURE,
  FIXTURE_SESSION_ID,
  failedReport,
  formsListing,
  inProgressReport,
  partialReport,
  pendingReport,
  scoredReport,
} from "../test-fixtures/report-fixtures";
import { HttpApiError } from "@/lib/api-error";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const SID = FIXTURE_SESSION_ID;

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

const scored = toGuardianExamReport(scoredReport);
const partial = toGuardianExamReport(partialReport);

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
    // G2 (SCL-182): the summary alone, no "Learn more" and no link target.
    const note = screen.getByTestId("exam-disclosure");
    expect(note.textContent).toBe(FIXTURE_DISCLOSURE.summary);
    expect(note.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /learn more/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain(
      FIXTURE_DISCLOSURE.full_text_url,
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
    show(toGuardianExamReport(pendingReport));
    expect(screen.getByRole("status").textContent).toContain("being scored");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("exam-disclosure")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /\b[2-9][0-9]{2}\b|1[0-9]{3}/,
    );
    expectNoControls();
  });

  it("failed: a parent's 'score delayed', without the student's message or an incident reference", () => {
    show(toGuardianExamReport(failedReport));
    expect(screen.getByTestId("guardian-exam-delayed").textContent).toContain(
      "technical issue on our end",
    );
    expect(document.body.textContent).not.toMatch(/INC-|we'll email you/i);
    expectNoControls();
  });

  it("not_completed: no resume control", () => {
    show(toGuardianExamReport(inProgressReport));
    expect(screen.getByText("In progress")).toBeTruthy();
    expectNoControls();
  });
});

describe("guardian exam pages against the API", () => {
  it("lists the student's tests, each linking to its result", async () => {
    const tests = toGuardianExamList(formsListing).tests;
    // The never-sat form is not listed: a guardian has nothing to read there.
    expect(tests.map((t) => t.test_form_name)).toEqual(["Practice Test 2"]);
    fetchList.mockResolvedValue(tests);
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
