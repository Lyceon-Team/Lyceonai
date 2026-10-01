/**
 * Exam report payloads for the page tests — the ONE copy.
 *
 * @spec [Doc-04C §8.1, §9.1, §10.2, §11.4, §11.5 as amended by SCL-180] | @implemented [2026-09-27]
 *
 * plain English: student report payloads, each parsed through the strict student schema so
 * a fixture that drifts from the contract fails at import. The student report test renders
 * them directly; the guardian page test derives ITS payloads from these with the real
 * projection (`toGuardianExamReport`, `toGuardianExamList`) rather than writing a second,
 * guardian-shaped copy — so the two views are tested against the same numbers, and a
 * guardian fixture cannot say something the projection would not produce.
 *
 * Owner ruling 7 (SCL-180 amended 2026-09-29; @implemented [2026-09-29]): the payloads
 * below are the SERVER-SIDE report (correct/total per domain). The student page renders
 * the student projection, `toStudentExamReport` of them (`student*` exports) — the same
 * function the /report route applies — never these directly.
 */
import {
  toStudentExamReport,
  type ExamStudentReportPayload,
} from "@lyceon/shared/exam-student-report-schema";
import {
  examFormsResponseSchema,
  examReportPayloadSchema,
  type ExamFormsResponse,
  type ExamReportPayload,
} from "@lyceon/shared/exam-report-schema";

export const FIXTURE_SESSION_ID = "5e551011-0000-4000-8000-000000000001";
export const FIXTURE_FORM_ID = "f0f00000-0000-4000-8000-000000000001";

const base = {
  session_id: FIXTURE_SESSION_ID,
  test_form_id: FIXTURE_FORM_ID,
  test_form_name: "Practice Test 2",
};

export const FIXTURE_DISCLOSURE = {
  disclosure_version: "disclosure-v1.0",
  summary: "A Lyceon-modeled estimate, not an official SAT score.",
  full_text_url: "/legal/student-terms",
};

export const FIXTURE_RW_ROWS = [
  { section: "RW", domain: "Craft and Structure", correct: 10, total: 13 },
  { section: "RW", domain: "Expression of Ideas", correct: 6, total: 8 },
  { section: "RW", domain: "Information and Ideas", correct: 9, total: 12 },
  {
    section: "RW",
    domain: "Standard English Conventions",
    correct: 11,
    total: 21,
  },
] as const;

export const FIXTURE_BREAKDOWN = [
  ...FIXTURE_RW_ROWS,
  { section: "M", domain: "Advanced Math", correct: 12, total: 15 },
  { section: "M", domain: "Algebra", correct: 11, total: 13 },
  { section: "M", domain: "Geometry and Trigonometry", correct: 4, total: 7 },
  {
    section: "M",
    domain: "Problem Solving and Data Analysis",
    correct: 5,
    total: 9,
  },
] as const;

const scoreRun = {
  scoring_model_version: "v1.0",
  score_run_id: "a0a00000-0000-4000-8000-000000000001",
  scored_at: "2026-09-24T15:00:05Z",
};

export const scoredReport: ExamReportPayload = examReportPayloadSchema.parse({
  report_state: "scored",
  ...base,
  mode: "strict",
  completed_at: "2026-09-24T15:00:00Z",
  attempt_number_for_form: 2,
  is_first_seen_form_attempt: false,
  score: {
    total_scaled: 1340,
    rw_scaled: 690,
    math_scaled: 650,
    partial_display_scaled: null,
    ...scoreRun,
  },
  sections: [
    { section: "RW", section_state: "submitted", scaled: 690, scoreable: true },
    { section: "M", section_state: "submitted", scaled: 650, scoreable: true },
  ],
  domain_breakdown: FIXTURE_BREAKDOWN,
  disclosure: FIXTURE_DISCLOSURE,
  review_unlocked: true,
});

export const partialReport: ExamReportPayload = examReportPayloadSchema.parse({
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
    ...scoreRun,
  },
  sections: [
    {
      section: "RW",
      section_state: "submitted",
      scaled: 690,
      scoreable: true,
      incompleteness_reason: null,
    },
    {
      section: "M",
      section_state: "module1_submitted",
      scaled: null,
      scoreable: false,
      incompleteness_reason: "module1_only",
    },
  ],
  completed_sections: ["RW"],
  incomplete_sections: ["M"],
  domain_breakdown: FIXTURE_RW_ROWS,
  disclosure: FIXTURE_DISCLOSURE,
  partial_disclosure: {
    summary:
      "Reading and Writing section score: 690. Math was not completed, so no total score is available.",
  },
  review_unlocked: true,
});

export const pendingReport: ExamReportPayload = examReportPayloadSchema.parse({
  report_state: "scoring_pending",
  ...base,
  completed_at: "2026-09-24T15:00:00Z",
  abandoned_at: null,
  estimated_ready_at: null,
  review_unlocked: false,
});

export const failedReport: ExamReportPayload = examReportPayloadSchema.parse({
  report_state: "failed_requires_review",
  ...base,
  completed_at: "2026-09-24T15:00:00Z",
  abandoned_at: null,
  failure_summary: {
    student_facing_message:
      "Your test score isn't available yet because of a technical issue on our end. We'll email you when your score is ready. (Reference: INC-1a2b3c4d)",
    incident_reference: "INC-1a2b3c4d",
    recorded_at: "2026-09-24T15:00:05Z",
  },
  review_unlocked: false,
});

export const inProgressReport: ExamReportPayload =
  examReportPayloadSchema.parse({
    report_state: "not_completed",
    ...base,
    session_state: "active",
    resumable: true,
    review_unlocked: false,
  });

/** What the student's /report route sends for each state above (owner ruling 7). */
export const studentScoredReport: ExamStudentReportPayload =
  toStudentExamReport(scoredReport);
export const studentPartialReport: ExamStudentReportPayload =
  toStudentExamReport(partialReport);
export const studentPendingReport: ExamStudentReportPayload =
  toStudentExamReport(pendingReport);
export const studentFailedReport: ExamStudentReportPayload =
  toStudentExamReport(failedReport);
export const studentInProgressReport: ExamStudentReportPayload =
  toStudentExamReport(inProgressReport);

/** The student's forms listing with one sat form and one never sat. */
export const formsListing: ExamFormsResponse = examFormsResponseSchema.parse({
  forms: [
    {
      test_form_id: FIXTURE_FORM_ID,
      name: "Practice Test 2",
      is_selectable: true,
      question_count: 98,
      break_duration_ms: 600_000,
      sections: [],
      latest_session: {
        session_id: FIXTURE_SESSION_ID,
        state: "completed",
        mode: "strict",
        attempt_number_for_form: 2,
        report_state: "scored",
      },
    },
    {
      test_form_id: "f0f00000-0000-4000-8000-000000000002",
      name: "Practice Test 3",
      is_selectable: true,
      question_count: 98,
      break_duration_ms: 600_000,
      sections: [],
      latest_session: null,
    },
  ],
});
