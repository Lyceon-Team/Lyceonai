/**
 * A guardian reading a linked student's full-length exam results:
 *   /students/:studentId/tests             the forms the student has sat (latest attempt)
 *   /students/:studentId/tests/:sessionId  one attempt's result
 *
 * @spec [Doc-04C §2.6 (derived access, strict subset), §12.2 (projection), §12.3 (no
 *        review, no resume, no failure internals), §15.1 (disclosure beside every score)]
 *       [Doc 04 Parent Q9 as amended by SCL-180; SCL-181 (the route family)]
 * @implemented [2026-09-27]
 *
 * plain English: the headline of each exam — total, the two section scores, when, which
 * timing, which attempt, whether the form was new — and the same per-domain breakdown the
 * student sees. Expected outcome: a parent can read how the test went and nothing that
 * lets them re-sit, review or act on it.
 *
 * HOW READ-ONLY IS GUARANTEED HERE. Nothing on this page writes: no mutation, no review
 * button, no resume link. It renders only the guardian payload, whose strict schema has no
 * answer, explanation, skill, module, routing, raw-count or timing field to draw — so there
 * is nothing to hide. The server decides access; the 402 and 404 below are its answers.
 *
 * Pending, partial and failed get their own guardian wording: a pending result is "being
 * scored", never a number; a partial one shows only the section that was scored and says
 * why there is no total; a failed one says the score is delayed on our side, without the
 * student-addressed message or incident reference (§12.3).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import type {
  GuardianExamList,
  GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  examErrorStatus,
  fetchGuardianExamList,
  fetchGuardianExamReport,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import { MODE_SHORT_LABEL } from "../lib/labels";
import { DisclosedScore, DisclosureNote } from "../components/DisclosedScore";
import { ExamLoading } from "../components/ExamStatus";
import { DomainBreakdown } from "../components/DomainBreakdown";
import {
  Fact,
  Panel,
  ScoreTabs,
  SectionCard,
  Title,
  formatDate,
} from "./ExamReportPage";
import "../exam.css";

const REPORT_STATE_LABEL: Record<
  GuardianExamList["tests"][number]["report_state"],
  string
> = {
  scored: "Scored",
  scoring_pending: "Being scored",
  partial_scored: "Partial score",
  failed_requires_review: "Score delayed",
  not_completed: "Not finished",
  unavailable: "Unavailable",
  voided: "Unavailable",
};

function Shell({
  studentId,
  children,
}: {
  studentId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="exam-root min-h-screen">
      <header className="flex h-[60px] items-center justify-between border-b border-[var(--exam-line)] bg-[var(--exam-surface)] px-6 md:px-10">
        <span className="font-serif text-xl font-semibold">Lyceon</span>
        <Link
          href={`/students/${studentId}/tests`}
          className="text-[13px] font-medium text-[var(--exam-muted)]"
        >
          Practice tests
        </Link>
      </header>
      <main
        className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 md:px-10"
        data-testid="guardian-exam"
      >
        {children}
        <Link
          href="/guardian"
          className="flex min-h-[48px] w-fit items-center rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-6 text-[15px] font-medium"
        >
          Back to dashboard
        </Link>
      </main>
    </div>
  );
}

/** The server's denials, in a parent's words. */
function Denied({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = examErrorStatus(error);
  const message =
    status === 402
      ? "Full-length practice test results are part of the student's subscription. Their results are kept and appear here again when it is active."
      : status === 404
        ? "We couldn't find this. The student may no longer be linked to your account."
        : "We couldn't load these results. Check your connection and try again.";
  return (
    <Panel title={status === 402 ? "Subscription needed" : "Not available"}>
      <p
        role="alert"
        className="m-0 text-[15px] leading-relaxed"
        data-testid="guardian-exam-denied"
        data-status={status ?? ""}
      >
        {message}
      </p>
      {status !== 402 && status !== 404 && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] w-fit rounded-full bg-[var(--exam-accent)] px-6 text-sm font-medium text-white"
        >
          Try again
        </button>
      )}
    </Panel>
  );
}

export default function GuardianExamResultsPage() {
  const { studentId, sessionId } = useParams<{
    studentId: string;
    sessionId?: string;
  }>();
  return (
    <Shell studentId={studentId}>
      {sessionId === undefined ? (
        <ResultsList studentId={studentId} />
      ) : (
        <Result studentId={studentId} sessionId={sessionId} />
      )}
    </Shell>
  );
}

function ResultsList({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: examKeys.guardianTests(studentId),
    queryFn: () => fetchGuardianExamList(studentId),
    retry: false,
  });
  if (list.isPending) return <ExamLoading label="Loading results…" />;
  if (list.isError) {
    return (
      <Denied
        error={list.error}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: examKeys.guardianTests(studentId),
          })
        }
      />
    );
  }
  return (
    <>
      <Title name="Practice test results" line="Full-length practice tests" />
      {list.data.length === 0 ? (
        <Panel title="No practice tests yet">
          <p className="m-0 text-[15px] leading-relaxed">
            Results appear here after the student takes a full-length practice
            test.
          </p>
        </Panel>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-3 p-0"
          data-testid="guardian-exam-list"
        >
          {list.data.map((t) => (
            <li key={t.session_id}>
              <Link
                href={`/students/${studentId}/tests/${t.session_id}`}
                className="flex min-h-[64px] items-center justify-between gap-4 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] px-5 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">
                    {t.test_form_name}
                  </span>
                  <span className="text-[13px] text-[var(--exam-muted)]">
                    {MODE_SHORT_LABEL[t.mode]} timing · Attempt{" "}
                    {t.attempt_number_for_form}
                  </span>
                </span>
                <span className="text-[13px] font-medium">
                  {REPORT_STATE_LABEL[t.report_state]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Result({
  studentId,
  sessionId,
}: {
  studentId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: examKeys.guardianReport(studentId, sessionId),
    queryFn: () => fetchGuardianExamReport(studentId, sessionId),
    retry: false,
  });
  if (report.isPending) return <ExamLoading label="Loading result…" />;
  if (report.isError) {
    return (
      <Denied
        error={report.error}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: examKeys.guardianReport(studentId, sessionId),
          })
        }
      />
    );
  }
  return (
    <div
      className="flex flex-col gap-7"
      data-report-state={report.data.report_state}
    >
      <GuardianReportBody report={report.data} />
    </div>
  );
}

function AttemptFacts({
  report,
}: {
  report: Extract<
    GuardianExamReport,
    { report_state: "scored" | "partial_scored" }
  >;
}) {
  return (
    <dl className="m-0 flex flex-wrap gap-8">
      <Fact label="Timing" value={MODE_SHORT_LABEL[report.mode]} />
      <Fact label="Attempt" value={String(report.attempt_number_for_form)} />
      <Fact
        label="This form"
        value={
          report.is_first_seen_form_attempt
            ? "New to the student"
            : "Seen before"
        }
      />
    </dl>
  );
}

export function GuardianReportBody({ report }: { report: GuardianExamReport }) {
  switch (report.report_state) {
    case "scored":
      return (
        <>
          <Title
            name={report.test_form_name}
            line={`Completed ${formatDate(report.completed_at)}`}
          />
          <DisclosedScore disclosure={report.disclosure}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <div className="flex flex-col">
                  <span
                    className="font-serif text-[64px] font-semibold leading-none"
                    data-testid="exam-total-score"
                  >
                    {report.score.total_scaled}
                  </span>
                  <span className="text-sm text-[var(--exam-muted)]">
                    Total score · 400–1600
                  </span>
                </div>
                <AttemptFacts report={report} />
              </div>
              <DisclosureNote disclosure={report.disclosure} />
            </div>
            <ScoreTabs
              breakdown={<DomainBreakdown rows={report.domain_breakdown} />}
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <SectionCard
                  label={EXAM_SECTION_LABEL.RW}
                  scaled={report.score.rw_scaled}
                />
                <SectionCard
                  label={EXAM_SECTION_LABEL.M}
                  scaled={report.score.math_scaled}
                />
              </div>
            </ScoreTabs>
          </DisclosedScore>
        </>
      );
    case "partial_scored":
      return (
        <>
          <Title
            name={report.test_form_name}
            line={`Ended ${formatDate(report.abandoned_at)}`}
          />
          <DisclosedScore disclosure={report.disclosure}>
            <Panel title="Partial score">
              <p
                className="m-0 text-[15px] leading-relaxed"
                data-testid="exam-partial-summary"
              >
                {report.partial_disclosure.summary}
              </p>
              <AttemptFacts report={report} />
              <DisclosureNote disclosure={report.disclosure} />
            </Panel>
            <ScoreTabs
              breakdown={<DomainBreakdown rows={report.domain_breakdown} />}
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <SectionCard
                  label={EXAM_SECTION_LABEL.RW}
                  scaled={report.score.rw_scaled}
                />
                <SectionCard
                  label={EXAM_SECTION_LABEL.M}
                  scaled={report.score.math_scaled}
                />
              </div>
            </ScoreTabs>
          </DisclosedScore>
        </>
      );
    case "scoring_pending":
      return (
        <>
          <Title name={report.test_form_name} line="Test submitted" />
          <Panel title="Being scored">
            <p className="m-0 text-[15px] leading-relaxed" role="status">
              This test has been submitted and is being scored. Scores usually
              appear within a few minutes.
            </p>
          </Panel>
        </>
      );
    case "failed_requires_review":
      return (
        <>
          <Title name={report.test_form_name} line="Test submitted" />
          <Panel title="Score delayed">
            <p
              className="m-0 text-[15px] leading-relaxed"
              data-testid="guardian-exam-delayed"
            >
              A technical issue on our end delayed this score. Our team is
              looking into it, and the score will appear here once it's ready.
            </p>
          </Panel>
        </>
      );
    case "not_completed":
      return (
        <>
          <Title name={report.test_form_name} line="Practice test" />
          <Panel
            title={
              report.session_state === "abandoned_final"
                ? "Not finished"
                : "In progress"
            }
          >
            <p className="m-0 text-[15px] leading-relaxed">
              {report.session_state === "abandoned_final"
                ? "This attempt ended before it was finished, so it has no score."
                : "A score appears here once both sections are submitted."}
            </p>
          </Panel>
        </>
      );
    case "unavailable":
      return (
        <>
          <Title name={report.test_form_name} line="Practice test" />
          <Panel title="Not available right now">
            <p className="m-0 text-[15px] leading-relaxed">
              This result can't be shown at the moment.
            </p>
          </Panel>
        </>
      );
  }
}
