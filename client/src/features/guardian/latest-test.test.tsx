// @vitest-environment jsdom
/**
 * G5-04 — the Dashboard's compact latest-test card (ruling R13).
 *
 * @spec [Guardian_Closure_Plan G5-04, R13 (Karl, 2026-10-02); SCL-199 (the list item's
 *       `total_scaled`); SCL-192 (latest = newest `completed_at`); SCL-182 (the disclosure
 *       summary beside every score)] | @implemented [2026-10-02]
 *
 * plain English: the real app at `/guardian/:id`, served lists built through the real
 * projection (`examListWith`). The card shows the latest completed test's name and date, its
 * total, the change since the previous completed test (latest total minus that test's total,
 * from the list), the Reading and Writing and Math scores, the disclosure summary and "See full
 * report →" to the existing detail page. A drop wears the rust tone, a rise the blue; with no
 * previous test, "First test" and no chip. No counts and no per-domain detail. The previous
 * test's total comes from the list: no second report is requested.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { levelTone } from "@/components/mastery/LevelPill";
import { toGuardianExamReport } from "@lyceon/shared/exam-guardian-report-schema";
import {
  FIXTURE_BREAKDOWN,
  FIXTURE_DISCLOSURE,
  FIXTURE_SESSION_ID,
  inProgressReport,
  pendingReport,
} from "@/features/exam/test-fixtures/report-fixtures";
import {
  EXAM_SECTION_LABEL,
  examReportPayloadSchema,
  type ExamReportPayload,
} from "@lyceon/shared/exam-report-schema";
import {
  ADA,
  examListWith,
  json,
  mountApp,
  net,
  roster,
  serveDashboard,
  type OtherExam,
} from "./test-harness";
import { guardianPaths } from "./paths";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
});
afterEach(cleanup);

const PENDING_SID = "5e551011-0000-4000-8000-000000000109";

/** The fixture's latest test: Practice Test 2, 1340 (690 + 650), completed 2026-09-24. */
const LATEST_COMPLETED = "2026-09-24T15:00:00Z";

function serve(others: readonly OtherExam[]): void {
  net.handlers.push((url) =>
    url === `/api/students/${ADA}/tests`
      ? json(examListWith(others))
      : undefined,
  );
  net.handlers.push(serveDashboard(ADA));
}

const scored = (
  n: number,
  completed_at: string,
  total_scaled: number,
): OtherExam => ({
  session_id: `5e551011-0000-4000-8000-00000000010${n}`,
  name: `Practice Test ${n + 3}`,
  report_state: "scored",
  completed_at,
  total_scaled,
  // A scored item carries both section scores (SCL-199): any valid split will do here.
  rw_scaled: Math.round(total_scaled / 2),
  math_scaled: total_scaled - Math.round(total_scaled / 2),
});

async function card(): Promise<HTMLElement> {
  mountApp(Router, `/guardian/${ADA}`);
  // The card's frame also holds the loading state: wait for the loaded card's meta line.
  await screen.findByTestId("latest-test-meta");
  return screen.getByTestId("latest-test-card");
}

const toneOf = (key: "L1" | "L3"): string[] =>
  levelTone(key)
    .split(" ")
    .filter((c) => !c.startsWith("border-"));

describe("G5-04 the latest-test card", () => {
  it("name and date, total, R&W and Math, the disclosure and the full-report link", async () => {
    serve([scored(1, "2026-09-10T15:00:00Z", 1380)]);
    const root = await card();
    expect(within(root).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Latest full-length test",
    );
    const day = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(LATEST_COMPLETED));
    expect(within(root).getByTestId("latest-test-meta")).toHaveTextContent(
      `Practice Test 2 · ${day}`,
    );
    expect(within(root).getByTestId("latest-test-total")).toHaveTextContent(
      /^1340$/,
    );
    const rw = within(root).getByTestId("latest-test-section-RW");
    expect(rw).toHaveTextContent(EXAM_SECTION_LABEL.RW);
    expect(rw).toHaveTextContent("690");
    const m = within(root).getByTestId("latest-test-section-M");
    expect(m).toHaveTextContent(EXAM_SECTION_LABEL.M);
    expect(m).toHaveTextContent("650");
    expect(
      within(root).getByTestId("latest-test-disclosure"),
    ).toHaveTextContent(FIXTURE_DISCLOSURE.summary);
    const link = within(root).getByRole("link", { name: "See full report →" });
    expect(link.getAttribute("href")).toBe(
      guardianPaths.exam(ADA, FIXTURE_SESSION_ID),
    );
  });

  it("a drop since the previous test wears the rust tone", async () => {
    serve([scored(1, "2026-09-10T15:00:00Z", 1380)]);
    const chip = within(await card()).getByTestId("latest-test-change");
    expect(chip).toHaveTextContent(/^▼ 40 since last test$/);
    expect(chip.getAttribute("data-direction")).toBe("down");
    for (const c of toneOf("L1"))
      expect(chip.className.split(" ")).toContain(c);
  });

  it("a rise since the previous test wears the blue tone", async () => {
    serve([scored(1, "2026-09-10T15:00:00Z", 1300)]);
    const chip = within(await card()).getByTestId("latest-test-change");
    expect(chip).toHaveTextContent(/^▲ 40 since last test$/);
    expect(chip.getAttribute("data-direction")).toBe("up");
    for (const c of toneOf("L3"))
      expect(chip.className.split(" ")).toContain(c);
  });

  it("the previous test is the newest completed before the latest, not the list's order", async () => {
    serve([
      scored(1, "2026-09-20T15:00:00Z", 1300),
      scored(2, "2026-09-01T15:00:00Z", 1500),
    ]);
    expect(
      within(await card()).getByTestId("latest-test-change"),
    ).toHaveTextContent(/^▲ 40 since last test$/);
  });

  it("no previous test: 'First test' and no chip", async () => {
    serve([]);
    const root = await card();
    expect(within(root).getByTestId("latest-test-first")).toHaveTextContent(
      /^First test$/,
    );
    expect(within(root).queryByTestId("latest-test-change")).toBeNull();
  });

  it("a previous test with no score yet: neither a chip nor 'First test'", async () => {
    serve([
      {
        session_id: PENDING_SID,
        name: "Practice Test 9",
        report_state: "scoring_pending",
        completed_at: "2026-09-10T15:00:00Z",
        total_scaled: null,
      },
    ]);
    const root = await card();
    // Presence first: the card drew its total.
    expect(within(root).getByTestId("latest-test-total")).toHaveTextContent(
      "1340",
    );
    expect(within(root).queryByTestId("latest-test-change")).toBeNull();
    expect(within(root).queryByTestId("latest-test-first")).toBeNull();
  });

  it("no counts and no per-domain detail; one report read, the latest's", async () => {
    serve([scored(1, "2026-09-10T15:00:00Z", 1380)]);
    const root = await card();
    expect(within(root).getByTestId("latest-test-total")).toBeTruthy();
    expect(root).not.toHaveTextContent(/\d+ of \d+/);
    expect(root).not.toHaveTextContent(/questions|correct/i);
    for (const row of FIXTURE_BREAKDOWN) {
      expect(root).not.toHaveTextContent(row.domain);
    }
    const reports = net.log.filter((l) => /\/tests\/[^/]+\/report/.test(l));
    expect(reports.length).toBeGreaterThan(0);
    expect(
      reports.every((l) => l.includes(`/tests/${FIXTURE_SESSION_ID}/report`)),
    ).toBe(true);
  });

  it("a latest test still being scored: its name and the being-scored line, no score", async () => {
    serve([
      scored(1, "2026-09-10T15:00:00Z", 1380),
      {
        session_id: PENDING_SID,
        name: "Practice Test 9",
        report_state: "scoring_pending",
        completed_at: "2026-09-28T15:00:00Z",
        total_scaled: null,
      },
    ]);
    net.handlers.unshift((url) =>
      url === `/api/students/${ADA}/tests/${PENDING_SID}/report`
        ? json({
            ok: true,
            report: toGuardianExamReport({
              ...pendingReport,
              session_id: PENDING_SID,
              test_form_name: "Practice Test 9",
              completed_at: "2026-09-28T15:00:00Z",
            }),
            requestId: "r",
          })
        : undefined,
    );
    const root = await card();
    expect(within(root).getByTestId("latest-test-meta")).toHaveTextContent(
      "Practice Test 9",
    );
    // G5-08: the student's report words for this state, naming the student.
    expect(
      within(root).getByTestId("latest-test-state-title"),
    ).toHaveTextContent(/^Scoring Ada's test$/);
    expect(within(root).getByTestId("latest-test-status")).toHaveTextContent(
      /^Scoring usually takes a few minutes\.$/,
    );
    expect(within(root).queryByTestId("latest-test-total")).toBeNull();
    expect(within(root).queryByTestId("latest-test-change")).toBeNull();
  });

  it("G5-08: a scored test after a partial one compares the section they share", async () => {
    serve([
      {
        session_id: PENDING_SID,
        name: "Practice Test 9",
        report_state: "partial_scored",
        completed_at: null,
        abandoned_at: "2026-09-10T15:00:00Z",
        total_scaled: null,
        rw_scaled: 650,
        math_scaled: null,
      },
    ]);
    // The fixture's latest scored test: Reading and Writing 690 (scoredReport).
    expect(
      within(await card()).getByTestId("latest-test-change"),
    ).toHaveTextContent(/^▲ 40 in Reading and Writing since last test$/);
  });

  it("G5-08: an attempt still in progress is the student's 'This test isn't finished'", async () => {
    net.handlers.push((url) =>
      url === `/api/students/${ADA}/tests`
        ? json(
            examListWith(
              [],
              toStudentReportFor({
                report_state: "not_completed",
                session_state: "active",
              }),
            ),
          )
        : url === `/api/students/${ADA}/tests/${FIXTURE_SESSION_ID}/report`
          ? json({
              ok: true,
              report: toGuardianExamReport(
                toStudentReportFor({
                  report_state: "not_completed",
                  session_state: "active",
                }),
              ),
              requestId: "r",
            })
          : undefined,
    );
    net.handlers.push(serveDashboard(ADA));
    const root = await card();
    expect(
      within(root).getByTestId("latest-test-state-title"),
    ).toHaveTextContent(/^This test isn't finished$/);
    expect(within(root).getByTestId("latest-test-status")).toHaveTextContent(
      /^Ada's score appears here once both sections are submitted\.$/,
    );
    expect(within(root).queryByTestId("latest-test-first")).toBeNull();
  });
});

/** The fixture's in-progress report, through the real student schema. */
function toStudentReportFor(over: {
  report_state: "not_completed";
  session_state: "active";
}): ExamReportPayload {
  return examReportPayloadSchema.parse({
    ...inProgressReport,
    ...over,
    session_id: FIXTURE_SESSION_ID,
  });
}
