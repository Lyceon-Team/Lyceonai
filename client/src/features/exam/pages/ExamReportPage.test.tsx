// @vitest-environment jsdom
/**
 * UI-54: the student's exam report on the student tokens.
 *
 * @spec [student-UI register UI-54; DESIGN.md §3 "Report segments", §4 "Exam report"; prototype
 *        Report.dc.html; register §2 (ruling 7: seven segments per domain, no correct/total; a
 *        total = 0 domain is omitted and the report says why), OQ-33 (owner ruling 2026-10-02:
 *        "Review your answers" hidden), OQ-34 (owner ruling 2026-10-02: a lapsed report carries
 *        `renew_entitlement` and the upgrade modal opens from it)]
 *       [Doc-04C_V1.0 §8.1, §9.1, §10.2, §11.4, §11.5, §11.5b, §15.1 (a scaled score is never
 *        drawn without its disclosure)] [E7b plant: "the completion screen refuses to render a
 *        score without its disclosure"; E7 ruling 6 / E7b ruling 4]
 * @implemented [2026-09-25; segments 2026-09-29; rebuilt 2026-10-03, UI-54]
 *
 * FIXTURES FROM REAL PRODUCERS. Every student payload is the server's own serializer
 * (`serializeStudentReport`, server/services/exam-report-service.ts) over a report source,
 * projected by `toStudentExamReport`, the function the /report route applies; or the shared
 * report fixtures, which are that projection of the strict server-side schema.
 *
 * PRESENCE BEFORE ABSENCE: every "never shown" check runs after the page is proven to have
 * drawn the score card and the eight domain rows it sits beside.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ExamDomainBreakdownRow } from "@lyceon/shared/exam-report-schema";
import {
  toStudentExamReport,
  type ExamStudentReportPayload,
} from "@lyceon/shared/exam-student-report-schema";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { FocusShell } from "@/components/layout/FocusShell";
import {
  FIXTURE_BREAKDOWN,
  FIXTURE_DISCLOSURE,
  FIXTURE_FORM_ID,
  FIXTURE_SESSION_ID,
  studentFailedReport,
  studentInProgressReport,
  studentPartialReport,
  studentPendingReport,
} from "../test-fixtures/report-fixtures";

// The service module's read path reaches for a database; only its pure serializers are used.
vi.mock("../../../../../server/services/exam-runtime-service", () => ({
  callExamRpc: () => {
    throw new Error("no database in this test");
  },
}));

const api = vi.hoisted(() => ({
  report: null as unknown,
}));
vi.mock("../api/exam-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/exam-api")>()),
  fetchExamReport: async () => api.report,
}));

import {
  serializeStudentReport,
  type ExamReportSource,
} from "../../../../../server/services/exam-report-service";
import ExamReportPage, { ReportBody } from "./ExamReportPage";
import { ExamLoadError, ExamLoading } from "../components/ExamStatus";
import { HttpApiError } from "@/lib/api-error";

/** A report source as `exam_report_source` returns it: a completed, scored test-day sitting. */
function source(overrides: Partial<ExamReportSource> = {}): ExamReportSource {
  return {
    session: {
      session_id: FIXTURE_SESSION_ID,
      test_form_id: FIXTURE_FORM_ID,
      test_form_name: "Practice Test 1",
      state: "completed",
      mode: "strict",
      grace_expires_at: "2026-09-27T15:00:00Z",
      completed_at: "2026-09-26T15:00:00Z",
      abandoned_at: null,
      attempt_number_for_form: 1,
      is_first_seen_form_attempt: true,
    },
    server_now: "2026-09-26T15:05:00Z",
    sections: [
      { section: "RW", state: "submitted", module2_submitted_by: "student" },
      { section: "M", state: "submitted", module2_submitted_by: "student" },
    ],
    score_run: {
      score_run_id: "a0a00000-0000-4000-8000-000000000054",
      rw_scored: true,
      math_scored: true,
      rw_scaled: 620,
      math_scaled: 500,
      total_scaled: 1120,
      partial_display_scaled: null,
      scoring_model_version: "v1.0",
      scored_at: "2026-09-26T15:00:05Z",
    },
    failure: null,
    disclosure: FIXTURE_DISCLOSURE,
    ...overrides,
  };
}

function scoredFrom(
  breakdown: ReadonlyArray<ExamDomainBreakdownRow>,
): ExamStudentReportPayload {
  return toStudentExamReport(
    serializeStudentReport(source(), "scored", breakdown),
  );
}

const scored = scoredFrom(FIXTURE_BREAKDOWN);

function lapsed(): ExamStudentReportPayload {
  return toStudentExamReport(
    serializeStudentReport(source(), "unavailable", []),
  );
}

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function show(payload: ExamStudentReportPayload) {
  const { hook } = memoryLocation({ path: "/tests/x/report" });
  return render(
    <QueryClientProvider client={client()}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial={false}>
          <ReportBody payload={payload} />
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
}

/** The rendered text with College Board's static weight lines taken out. */
function textWithoutWeightLines(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('[data-testid="exam-domain-weight"]'))
    el.remove();
  return clone.textContent ?? "";
}

afterEach(cleanup);

describe("scored report (DESIGN.md §4: total out of 1600, sections out of 800, the disclosure)", () => {
  it("draws the total, both sections and the disclosure from the payload, with no link", () => {
    show(scored);
    const card = screen.getByTestId("exam-score-card");
    expect(screen.getByTestId("exam-total-score").textContent).toBe("1120");
    expect(card.textContent).toContain("out of 1600");
    expect(
      screen.getAllByTestId("exam-section-score").map((e) => e.textContent),
    ).toEqual(["Reading & Writing620/ 800", "Math500/ 800"]);
    // §15.1 / G2 (SCL-182): the summary stands alone, inside the card, exactly the payload's.
    const note = screen.getByTestId("exam-disclosure");
    expect(card.contains(note)).toBe(true);
    expect(note.textContent).toBe(FIXTURE_DISCLOSURE.summary);
    expect(note.querySelector("a")).toBeNull();
    expect(document.body.innerHTML).not.toContain(
      FIXTURE_DISCLOSURE.full_text_url,
    );
    // The timing it was taken under ("Your report says so").
    expect(card.textContent).toContain("TimingTest-day");
    // E7 ruling 6 / E7b ruling 4: no time used, no answered count, no framing paragraph.
    expect(document.body.textContent).not.toMatch(
      /time used|answered|not a count of correct answers/i,
    );
  });

  it("OQ-33: 'Review your answers' is not on the page", () => {
    show(scored);
    expect(screen.getByTestId("exam-total-score")).toBeTruthy();
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(8);
    expect(screen.queryByText(/review your answers/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /review/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /review/i })).toBeNull();
  });

  it("PLANT: refuses to render a score without its disclosure", () => {
    show({
      ...scored,
      disclosure: undefined,
    } as unknown as ExamStudentReportPayload);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(screen.queryAllByTestId("exam-section-score")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/1120|620|500/);
    expect(screen.getAllByTestId("exam-score-withheld").length).toBeGreaterThan(
      0,
    );

    cleanup();
    show({
      ...scored,
      disclosure: { ...FIXTURE_DISCLOSURE, summary: "" },
    } as ExamStudentReportPayload);
    expect(document.body.textContent).not.toMatch(/1120/);
  });
});

describe("Knowledge and skills (ruling 7: seven flat navy segments per domain from segments_filled)", () => {
  it("draws eight domains of seven segments, filled per the server, in the ink colour", () => {
    show(scored);
    expect(
      screen.getByRole("heading", { name: "Knowledge and skills" }),
    ).toBeTruthy();
    // OQ-62 (b): the section's lead names the full-length test.
    expect(document.body.textContent).toContain(
      "How you did across the eight content domains on this full-length test.",
    );
    // Presence: eight domains, each a bar of exactly seven segments.
    const rows = screen.getAllByTestId("exam-domain-row");
    expect(rows).toHaveLength(8);
    const bars = screen.getAllByTestId("exam-domain-segments");
    expect(
      bars.map(
        (b) => b.querySelectorAll('[data-testid="exam-domain-segment"]').length,
      ),
    ).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    // Filled per the server's segments_filled (fixtures 9/12, 10/13, 6/8, 11/21, 11/13,
    // 12/15, 5/9, 4/7), canonical order within Reading & Writing then Math.
    expect(
      bars.map((b) => b.querySelectorAll('[data-filled="true"]').length),
    ).toEqual([5, 5, 5, 4, 6, 6, 4, 4]);
    expect(
      screen.getByRole("img", { name: "Algebra: 6 of 7 segments filled" }),
    ).toBeTruthy();
    // Navy (--ink-strong) filled, outlined empty; never a mastery colour (DESIGN.md §3).
    const segments = screen.getAllByTestId("exam-domain-segment");
    for (const seg of segments) {
      expect(seg.className).not.toMatch(
        /lv\d|mastery|amber|orange|sky|emerald/,
      );
      expect(seg.className).toContain(
        seg.dataset.filled === "true" ? "bg-lyc-ink-strong" : "bg-transparent",
      );
    }
    const knowledge = screen.getByTestId("exam-knowledge");
    expect(
      Array.from(knowledge.querySelectorAll("h3")).map((h) => h.textContent),
    ).toEqual(["Reading & Writing", "Math"]);
  });

  it("each domain carries College Board's published weight line, the same for every student", () => {
    show(scored);
    const weights = screen
      .getAllByTestId("exam-domain-weight")
      .map((w) => w.textContent);
    expect(weights).toEqual([
      "26% of the section, 12 to 14 questions",
      "28% of the section, 13 to 15 questions",
      "20% of the section, 8 to 12 questions",
      "26% of the section, 11 to 15 questions",
      "35% of the section, 13 to 15 questions",
      "35% of the section, 13 to 15 questions",
      "15% of the section, 5 to 7 questions",
      "15% of the section, 5 to 7 questions",
    ]);
    // Not the student's numbers: a different result draws the same lines.
    cleanup();
    show(scoredFrom(FIXTURE_BREAKDOWN.map((r) => ({ ...r, correct: 0 }))));
    expect(
      screen.getAllByTestId("exam-domain-weight").map((w) => w.textContent),
    ).toEqual(weights);
  });

  it("no %, percentile, 'N of M' or correct count anywhere on the report", () => {
    show(scored);
    // Presence first: the score card and the eight bars are drawn.
    expect(screen.getByTestId("exam-total-score").textContent).toBe("1120");
    expect(screen.getAllByTestId("exam-domain-segments")).toHaveLength(8);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*of\s*\d+/);
    expect(text).not.toMatch(/correct/i);
    expect(text).not.toMatch(/percentile/i);
    // "%" appears only in College Board's static weight lines (asserted verbatim above).
    expect(textWithoutWeightLines()).not.toContain("%");
    // Accessible names too: "N of 7 segments filled" is the segment count, never questions.
    for (const img of screen.getAllByRole("img")) {
      const name = img.getAttribute("aria-label") ?? "";
      expect(name).not.toMatch(/correct|%|percentile|question/i);
    }
  });

  it("a domain the test served no questions from is omitted, with the reason the payload gives", () => {
    const withoutGeometry = scoredFrom(
      FIXTURE_BREAKDOWN.filter((r) => r.domain !== "Geometry and Trigonometry"),
    );
    // The payload says why (presence of the reason first).
    expect(
      withoutGeometry.report_state === "scored" &&
        withoutGeometry.omitted_domains,
    ).toEqual([
      {
        section: "M",
        domain: "Geometry and Trigonometry",
        reason: "no_items_served",
      },
    ]);
    show(withoutGeometry);
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(7);
    expect(screen.getByTestId("exam-domain-omitted").textContent).toBe(
      "Geometry and Trigonometry isn't shown because this full-length test had no questions from it.",
    );
    expect(
      screen.getAllByTestId("exam-domain-name").map((n) => n.textContent),
    ).not.toContain("Geometry and Trigonometry");
  });
});

describe("other states", () => {
  it("partial_scored: no total, the partial summary, the unscored section omitted with its reason", () => {
    show(studentPartialReport);
    expect(screen.getByTestId("exam-partial-summary").textContent).toContain(
      "no total score",
    );
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    expect(
      screen.getAllByTestId("exam-section-score")[1]!.textContent,
    ).toContain("Not completed");
    expect(screen.getAllByTestId("exam-disclosure").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("exam-domain-row")).toHaveLength(4);
    expect(screen.getByTestId("exam-domain-omitted").textContent).toBe(
      "Math wasn't completed, so its domains aren't shown.",
    );
    expect(document.body.textContent).not.toMatch(/\d+\s*of\s*\d+/);
  });

  it("scoring_pending: generic copy when estimated_ready_at is null (§11.5)", () => {
    show(studentPendingReport);
    expect(screen.getByRole("status").textContent).toContain(
      "Scoring usually takes a few minutes",
    );
  });

  // OQ-62 (b) (Karl, 2026-10-05): the sitting is a "full-length test" in the report's states.
  it("OQ-62 (b): the pending and unfinished states name the full-length test", () => {
    show(studentPendingReport);
    expect(document.body.textContent).toContain(
      "Scoring your full-length test",
    );
    cleanup();
    show(studentInProgressReport);
    expect(document.body.textContent).toContain(
      "This full-length test isn't finished",
    );
    expect(document.body.textContent).not.toMatch(/\bThis test\b/);
  });

  it("failed_requires_review: the payload's message and reference", () => {
    show(studentFailedReport);
    expect(screen.getByTestId("exam-failure-message").textContent).toContain(
      "INC-1a2b3c4d",
    );
  });

  it("not_completed: Resume full-length test goes to the session", () => {
    show(studentInProgressReport);
    expect(
      screen
        .getByRole("link", { name: "Resume full-length test" })
        .getAttribute("href"),
    ).toBe(`/tests/${FIXTURE_SESSION_ID}`);
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
  });
});

describe('naming: the section is "Full-Length" (owner ruling, Karl, 2026-10-05)', () => {
  it("an attempt that ended unscored points back to Full-Length by name", () => {
    const payload = toStudentExamReport(
      serializeStudentReport(
        source({
          session: {
            ...source().session,
            state: "abandoned_final",
            completed_at: null,
            abandoned_at: "2026-09-26T15:00:00Z",
          },
          score_run: null,
        }),
        "not_completed",
        [],
      ),
    );
    expect(payload.report_state === "not_completed" && payload.resumable).toBe(
      false,
    );
    show(payload);
    expect(
      screen.getByText(
        "There's no score for this attempt. You can start a new attempt from Full-Length.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bTests\b/);
  });

  it('an exam load error\'s way out is "Back to Full-Length", to /tests', () => {
    const { hook } = memoryLocation({ path: "/tests/x" });
    render(
      <Router hook={hook}>
        <ExamLoadError
          error={new HttpApiError({ status: 404, message: "gone" })}
        />
      </Router>,
    );
    const back = screen.getByRole("link", { name: "Back to Full-Length" });
    expect(back.getAttribute("href")).toBe("/tests");
  });

  // OQ-62 (b) (Karl, 2026-10-05): the sitting is a "full-length test" in every load state.
  it.each([
    [403, "This full-length test isn't available to your account."],
    [404, "We couldn't find this full-length test."],
    [
      500,
      "We couldn't load your full-length test. Check your connection and try again.",
    ],
  ] as const)(
    "OQ-62 (b): a %i load error names the full-length test",
    (status, message) => {
      const { hook } = memoryLocation({ path: "/tests/x" });
      render(
        <Router hook={hook}>
          <ExamLoadError error={new HttpApiError({ status, message: "x" })} />
        </Router>,
      );
      expect(screen.getByRole("alert").textContent).toContain(message);
      // Every whole-token "test" in the alert is the tail of "full-length test".
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text.match(/\btests?\b/gi)?.length).toBe(
        text.match(/\bfull-length tests?\b/gi)?.length,
      );
    },
  );

  it("OQ-62 (b): the default loading line names the full-length test", () => {
    render(<ExamLoading />);
    expect(screen.getByRole("status").textContent).toBe(
      "Loading your full-length test…",
    );
  });
});

describe("OQ-34: a lapsed report opens the upgrade modal for Full-Length", () => {
  it("the server's renew_entitlement action opens the modal on arrival and from Continue", async () => {
    const payload = lapsed();
    // Presence of the action in the real producer's payload first.
    expect(
      payload.report_state === "unavailable" && payload.resume_action,
    ).toEqual({ type: "renew_entitlement", url: null });
    show(payload);
    expect(
      screen.getByText("This report isn't available right now"),
    ).toBeTruthy();
    expect(screen.queryByTestId("exam-total-score")).toBeNull();
    // The modal's view loads on its first open (it is not in the app entry).
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain("Full-length tests");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("exam-report-renew"));
    expect(screen.getByTestId("upgrade-modal").textContent).toContain(
      "Full-length tests",
    );
  });

  it("an unavailable report with no renewal action opens nothing", () => {
    const payload = lapsed();
    show({
      ...payload,
      resume_action: null,
    } as ExamStudentReportPayload);
    expect(
      screen.getByText("This report isn't available right now"),
    ).toBeTruthy();
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    expect(screen.queryByTestId("exam-report-renew")).toBeNull();
  });
});

describe("the page in the Focus shell", () => {
  it("names the report and its date in the top bar; draws no header bar of its own", async () => {
    api.report = scored;
    const { hook } = memoryLocation({
      path: `/tests/${FIXTURE_SESSION_ID}/report`,
    });
    render(
      <QueryClientProvider client={client()}>
        <Router hook={hook}>
          <UpgradeModalProvider autoOpenOnDenial={false}>
            <FocusShell section="Full-Length" sectionHome="/tests">
              <Route path="/tests/:sessionId/report">
                <ExamReportPage />
              </Route>
            </FocusShell>
          </UpgradeModalProvider>
        </Router>
      </QueryClientProvider>,
    );
    const title = await screen.findByTestId("exam-report-title");
    // Owner ruling 2026-10-05: the real serializer's payload keeps the stored "Practice Test 1";
    // the top bar shows it as "Full-Length Test 1" (`displayFormName`).
    expect(scored.test_form_name).toBe("Practice Test 1");
    expect(title.textContent).toBe("Full-Length Test 1 report");
    const bar = screen.getByTestId("focus-context");
    expect(bar.contains(title)).toBe(true);
    expect(bar.textContent).toContain("26 September 2026");
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.queryByText("Lyceon")).toBeNull();
    expect(screen.queryByText(/back to dashboard/i)).toBeNull();
  });
});
