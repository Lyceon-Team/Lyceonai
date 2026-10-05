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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import { domainWeightLine } from "../lib/domain-weights";

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
    path: `/guardian/${STUDENT}/exams/${SID}`,
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
          path="/guardian/:studentId/exams"
          component={GuardianExamResultsPage}
        />
        <Route
          path="/guardian/:studentId/exams/:sessionId"
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
    // G5-08: the student's report shows Timing and Attempt only; "This form" was guardian-only.
    expect(document.body.textContent).not.toMatch(
      /This form|Seen before|New to the student/,
    );
    // G2 (SCL-182): the summary alone, no "Learn more" and no link target.
    const note = screen.getByTestId("exam-disclosure");
    expect(note.textContent).toBe(FIXTURE_DISCLOSURE.summary);
    expect(note.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /learn more/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain(
      FIXTURE_DISCLOSURE.full_text_url,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score breakdown" }));
    const rowEls = screen.getAllByTestId("exam-domain-row");
    const rows = rowEls.map(
      (r) => within(r).getByTestId("exam-domain-name").textContent,
    );
    expect(rows).toHaveLength(8);
    // G3-02 (R4, SCL-189) / G5-11 (SCL-210): the domain and the student's seven segments; no
    // "N of M correct" anywhere. Since the UI-54 restyle each row also carries College Board's
    // published weight line for the domain (a fact about the SAT, the same for every student):
    // it is checked against that table, and everything else in the row carries no digit.
    expect(rows).toContain("Algebra");
    for (const row of rowEls) {
      const name =
        within(row).getByTestId("exam-domain-name").textContent ?? "";
      const weight = within(row).queryByTestId("exam-domain-weight");
      if (weight) {
        expect(weight.textContent).toBe(
          domainWeightLine("RW", name) ?? domainWeightLine("M", name),
        );
        weight.remove();
      }
      expect(row.textContent).not.toMatch(/\d|correct/);
    }
    const algebra = screen
      .getAllByTestId("exam-domain-row")
      .find(
        (r) =>
          within(r).getByTestId("exam-domain-name").textContent === "Algebra",
      );
    // 11 of 13 → round half up of 11 × 7 / 13 = 5.92 → 6 of 7 filled, the student's rule.
    const segs = within(algebra!).getAllByTestId("exam-domain-segment");
    expect(segs).toHaveLength(7);
    expect(segs.filter((x) => x.dataset.filled === "true")).toHaveLength(6);
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
    // the attempt, and the date (G3-02: the breakdown carries no counts).
    expect(document.body.textContent).not.toMatch(/1[0-9]{3}\b/);
    expectNoControls();
  });

  it("pending: the student's 'Scoring your test', naming the student; no number, no disclosure, no tabs", () => {
    show(toGuardianExamReport(pendingReport));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Scoring your student's test",
    );
    // The student's "This page updates on its own." is dropped: this page does not poll.
    expect(screen.getByRole("status").textContent).toBe(
      "Scoring usually takes a few minutes.",
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("exam-disclosure")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /\b[2-9][0-9]{2}\b|1[0-9]{3}/,
    );
    expectNoControls();
  });

  it("failed: the student's title, naming the student; no message, no incident reference", () => {
    show(toGuardianExamReport(failedReport));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "your student's score isn't ready",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /INC-|we'll email you|technical issue/i,
    );
    expectNoControls();
  });

  it("not_completed: the student's 'This test isn't finished'; no resume control", () => {
    show(toGuardianExamReport(inProgressReport));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "This test isn't finished",
    );
    expectNoControls();
  });
});

describe("guardian exam pages against the API", () => {
  it("lists the student's tests, each linking to its result", async () => {
    // SCL-192: completion instants come from the same `exam_list_forms` read, by session id.
    const tests = toGuardianExamList(formsListing, {
      [SID]: {
        completed_at: "2026-09-20T15:00:00.000Z",
        abandoned_at: null,
      },
    }).tests;
    // The never-sat form is not listed: a guardian has nothing to read there.
    expect(tests.map((t) => t.test_form_name)).toEqual(["Practice Test 2"]);
    fetchList.mockResolvedValue(tests);
    mountPage(`/guardian/${STUDENT}/exams`);
    const row = await screen.findByRole("article", { name: "Practice Test 2" });
    // G5-08: the student's card word and the student's "View scores".
    expect(within(row).getByTestId("guardian-exam-state").textContent).toBe(
      "Scored",
    );
    const link = within(row).getByRole("link", { name: "View scores" });
    // G4-05: the guardian routes (G4-01); the retired /students/:id/tests paths redirect here.
    expect(link.getAttribute("href")).toBe(`/guardian/${STUDENT}/exams/${SID}`);
    expect(fetchList).toHaveBeenCalledWith(STUDENT);
    expectNoControls();
  });

  // G4-06: the guardian surface's shared states. Mounted without the student layout, the page
  // has no roster name, so the copy falls back to "your student" (the layout names them; see
  // `client/src/features/guardian/state-matrix.test.tsx`).
  it.each([
    [402, "guardian-state-lapsed", "your student's subscription has ended"],
    [404, "guardian-state-revoked", "This student is no longer linked"],
  ])(
    "the server's %i reads as a parent's copy, with no retry",
    async (status, testId, title) => {
      fetchReport.mockRejectedValue(
        new HttpApiError({ status, message: "denied" }),
      );
      mountPage(`/guardian/${STUDENT}/exams/${SID}`);
      expect(await screen.findByTestId(testId)).toBeTruthy();
      expect(screen.getByText(title, { exact: false })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(document.body.textContent).not.toMatch(/1340/);
    },
  );
});
