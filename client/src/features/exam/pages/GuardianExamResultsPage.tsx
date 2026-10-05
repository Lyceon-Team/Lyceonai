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
 * G5-08 (owner brief 2026-10-02): THE STUDENT'S WORDS. The list, the detail and the
 * Dashboard card say what the student's own surfaces say, from the same producer fields: the
 * card word is the student's `formCardStateLabel` over the same session and report state, the
 * names are the exam surface's ("Full-length tests", "Full-length practice test"), and each
 * report state reads as the student's report does (`ReportBody`). Owner decisions of the same
 * day: where the student's sentence says "you/your", the guardian's names the student; a
 * clause that is false for a guardian is dropped, never reworded (this page does not poll,
 * SCL-181; a guardian cannot resume or start a test, §12.3); the failed state shows its title
 * only (SCL-181 keeps the student-addressed message and incident reference off the guardian
 * wire). What is deliberately absent is the guardian-wide removals: x/y counts (SCL-189),
 * skills (SCL-194), answers and review (§12.3). `real-PG proof: tests/ci/guardian-exam-mirror
 * .handler-pg.ci.test.tsx`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { sectionDisplayLabel } from "@shared/section-display";
import type {
  GuardianExamList,
  GuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  fetchGuardianExamList,
  fetchGuardianExamReport,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import { guardianPaths } from "@/features/guardian/paths";
import {
  GuardianNoExamsState,
  GuardianReadFailureState,
  possessive,
  useCurrentStudentName,
  useGuardianReadFailure,
} from "@/features/guardian/GuardianStates";
import { formCardStateLabel, MODE_SHORT_LABEL } from "../lib/labels";
import { DisclosedScore, DisclosureNote } from "../components/DisclosedScore";
import { ExamLoading } from "../components/ExamStatus";
import { DomainSegments } from "../components/DomainSegments";
import {
  unscoredSectionOmissions,
  type ExamOmittedDomain,
} from "@lyceon/shared/exam-domain-segments";
import {
  examSectionSchema,
  type ExamSection,
} from "@lyceon/shared/exam-runtime-schema";
import {
  Fact,
  Panel,
  ScoreTabs,
  SectionCard,
  Title,
  formatDate,
} from "../components/ExamReportParts";
import "../exam.css";

/**
 * The page body inside the guardian shell (G4-05). The shell brings the only header — logo,
 * student switcher, bell, profile menu and the Dashboard / Calendar tabs — so this page no
 * longer draws its own header or its "Practice tests" link. `exam-root` scopes the exam
 * styles (`--exam-*`) the shared exam components read.
 */
function Shell({
  studentId,
  sessionId,
  children,
}: {
  studentId: string;
  sessionId: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="exam-root">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 md:px-10"
        data-testid="guardian-exam"
      >
        {children}
        <Link
          href={
            sessionId === undefined
              ? guardianPaths.dashboard(studentId)
              : guardianPaths.exams(studentId)
          }
          className="flex min-h-[48px] w-fit items-center self-center rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-6 text-base font-medium sm:self-start"
          data-testid="guardian-exam-back"
        >
          {sessionId === undefined ? "Back to dashboard" : "Full-length tests"}
        </Link>
      </div>
    </div>
  );
}

/**
 * The server's denials, in a parent's words, naming the student (G4-06): a 402 is the lapsed
 * state with its named call to action, a 404 the revoked state (the student's reads are
 * forgotten and the roster refetched), anything else an error with "Try again".
 */
function Denied({
  studentId,
  error,
  what,
  onRetry,
}: {
  studentId: string;
  error: unknown;
  what: string;
  onRetry: () => void;
}) {
  const name = useCurrentStudentName();
  const failure = useGuardianReadFailure(studentId, error);
  return (
    <GuardianReadFailureState
      failure={failure ?? "error"}
      name={name}
      studentId={studentId}
      what={`${possessive(name)} ${what}`}
      onRetry={onRetry}
    />
  );
}

export default function GuardianExamResultsPage() {
  const { studentId, sessionId } = useParams<{
    studentId: string;
    sessionId?: string;
  }>();
  return (
    <Shell studentId={studentId} sessionId={sessionId}>
      {sessionId === undefined ? (
        <ResultsList studentId={studentId} />
      ) : (
        <Result studentId={studentId} sessionId={sessionId} />
      )}
    </Shell>
  );
}

function NoExams() {
  return <GuardianNoExamsState name={useCurrentStudentName()} />;
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
        studentId={studentId}
        what="test results"
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
      {/* The student's own page name (TestsHomePage). */}
      <h1 className="m-0 text-center font-serif text-[32px] font-semibold sm:text-left">
        Full-length tests
      </h1>
      {list.data.length === 0 ? (
        <NoExams />
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-3 p-0"
          data-testid="guardian-exam-list"
        >
          {list.data.map((t) => (
            <li
              key={t.session_id}
              data-testid={`guardian-exam-row-${t.session_id}`}
            >
              <ResultRow studentId={studentId} test={t} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type ListItem = GuardianExamList["tests"][number];

const IN_PROGRESS: ReadonlySet<ListItem["session_state"]> = new Set([
  "created",
  "active",
  "section_break",
]);

/**
 * @spec [Guardian_Closure_Plan G5-08; SCL-181 (5); Doc-04C §12.3] | @implemented [2026-10-02]
 *
 * One attempt, as the student's own card shows it (TestsHomePage `FormCard`): the eyebrow, the
 * form, the student's state word, and "View scores" exactly where the student has it — not for
 * an attempt in progress or one that ended with nothing scored. The card's question count and
 * timing are the student's start controls and are not carried (SCL-181 (5)); Resume, Start and
 * Take again are student actions (§12.3).
 */
function ResultRow({ studentId, test }: { studentId: string; test: ListItem }) {
  const hasReport =
    !IN_PROGRESS.has(test.session_state) &&
    test.session_state !== "abandoned_final";
  return (
    <article
      aria-label={test.test_form_name}
      className="flex flex-col gap-3 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] px-5 py-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left"
    >
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold uppercase tracking-[0.06em] text-[var(--exam-muted)]">
          Full-length practice test
        </span>
        <h2 className="m-0 font-serif text-[22px] font-semibold">
          {test.test_form_name}
        </h2>
      </div>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <span
          className="rounded-full bg-muted px-3 py-1 text-base font-semibold"
          data-testid="guardian-exam-state"
        >
          {formCardStateLabel({
            state: test.session_state,
            report_state: test.report_state,
          })}
        </span>
        {hasReport && (
          <Link
            href={guardianPaths.exam(studentId, test.session_id)}
            className="flex min-h-[44px] items-center rounded-lg border border-[var(--exam-line)] bg-[var(--exam-surface)] px-4 text-base font-semibold"
          >
            View scores
          </Link>
        )}
      </div>
    </article>
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
        studentId={studentId}
        what="test result"
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
    // G5-07 (owner brief 2026-10-03): on a phone the detail centres its lines — title, line,
    // total and facts, disclosure, section cards, panel — as the other guardian pages do (item
    // 10); the per-domain bars stay left (`LeftAligned`). The shared student components are
    // untouched: they inherit the alignment from this guardian-only wrapper.
    <div
      className="flex flex-col gap-7 text-center sm:text-left"
      data-testid="guardian-exam-report"
      data-report-state={report.data.report_state}
    >
      <GuardianReportBody report={report.data} />
    </div>
  );
}

/**
 * @spec [Guardian_Closure_Plan G5-12; Doc-04C §9.1; SCL-180 owner ruling 7] | @implemented
 *       [2026-10-05]
 * plain English: the omissions behind the student's "… wasn't completed, so its domains aren't
 * shown." note, for every section a partial attempt did not score — derived from the payload's
 * own `completed_sections` by the shared `unscoredSectionOmissions`, the function the student
 * projection uses, so the note is the student's sentence from the student's component. No
 * omitted list is sent (no payload change). A section scored but missing a domain's items
 * (`no_items_served`) cannot be told from here; the SQL cannot produce one today.
 */
function unscoredOmissions(
  completed: ReadonlyArray<ExamSection>,
): ExamOmittedDomain[] {
  return examSectionSchema.options
    .filter((s) => !completed.includes(s))
    .flatMap(unscoredSectionOmissions);
}

/** Domain-card content stays left-aligned on a phone (item 10), inside the centred detail. */
/**
 * The type floor for the guardian (Guardian_Closure_Plan R12: no guardian text under 16px). The
 * student's meta sizes (14px, 15px) are raised here only; the student's report keeps its own.
 */
const GUARDIAN_LYC_FLOOR: React.CSSProperties & Record<`--${string}`, string> =
  {
    background: "transparent",
    "--lyc-text-meta": "16px",
    "--lyc-text-meta-lg": "16px",
  };

/**
 * The breakdown panel. `DomainSegments` is drawn on the student tokens (UI-54), which exist only
 * under a .lyc root, so the panel is one — light-locked, with the root's paper background
 * suppressed so it sits on the guardian page's own surface, and the student's meta sizes raised
 * to the guardian's 16px floor (G5-11 parity, R12; merge of PR 1069).
 */
function LeftAligned({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="lyc text-left"
      data-theme-lock="light"
      style={GUARDIAN_LYC_FLOOR}
    >
      {children}
    </div>
  );
}

function AttemptFacts({
  report,
}: {
  report: Extract<GuardianExamReport, { report_state: "scored" }>;
}) {
  return (
    <dl className="m-0 flex flex-wrap justify-center gap-8 sm:justify-start">
      <Fact label="Timing" value={MODE_SHORT_LABEL[report.mode]} />
      <Fact label="Attempt" value={String(report.attempt_number_for_form)} />
    </dl>
  );
}

/**
 * @spec [Guardian_Closure_Plan G5-08; Doc-04C §12.2/§12.3; SCL-181; owner decisions
 *       2026-10-02 ("you/your" names the student; the failed state shows its title only)]
 *       | @implemented [2026-10-02]
 *
 * The student's report words for a state with no score to show (`ReportBody`), said of the
 * student by name. `line` is the student's line above the form name; `title` the panel title;
 * `body` the panel sentence, or null where the guardian has none (the failed state, by owner
 * decision 2026-10-02). Shared by the detail and the Dashboard card, so the two cannot differ.
 */
type GuardianOutcomeCopy = {
  line: string;
  title: string;
  body: string | null;
};

export function guardianOutcomeCopy(
  report: Exclude<
    GuardianExamReport,
    { report_state: "scored" | "partial_scored" }
  >,
  studentName: string,
): GuardianOutcomeCopy {
  const their = possessive(studentName);
  switch (report.report_state) {
    case "scoring_pending":
      // The student's second sentence ("This page updates on its own.") is dropped: the
      // guardian page does not poll (SCL-181). §12.2 keeps `estimated_ready_at` off the wire.
      return {
        line: "Test submitted",
        title: `Scoring ${their} test`,
        body: "Scoring usually takes a few minutes.",
      };
    case "failed_requires_review":
      return {
        line: "Test submitted",
        title: `${their} score isn't ready`,
        body: null,
      };
    case "unavailable":
      return {
        line: "Report",
        title: "This report isn't available right now",
        body:
          report.unavailable_reason === "entitlement_lapsed"
            ? `Full-length test reports are part of an active subscription. ${their} results are kept, and you can see them again when ${their} subscription is active.`
            : "This report can't be shown at the moment.",
      };
    case "not_completed":
      // The student's `resumable` is withheld (§12.2); the session state is what decides it.
      // "You can start a new attempt from Tests." and "Resume test" are the student's actions.
      return report.session_state === "abandoned_final"
        ? {
            line: "Report",
            title: "This attempt ended before it was finished",
            body: "There's no score for this attempt.",
          }
        : {
            line: "Report",
            title: "This test isn't finished",
            body: `${their} score appears here once both sections are submitted.`,
          };
  }
}

/** G4-06: the withheld-score line names the student; the Dashboard card shows it too (G5-04). */
export function guardianWithheldCopy(studentName: string): string {
  return `${possessive(studentName)} score can't be shown right now. Please check back soon.`;
}

export function GuardianReportBody({ report }: { report: GuardianExamReport }) {
  // G4-06: the withheld-score line names the student; the student's own report says "Your".
  const name = useCurrentStudentName();
  const withheld = guardianWithheldCopy(name);
  switch (report.report_state) {
    case "scored":
      return (
        <>
          <Title
            name={report.test_form_name}
            line={`Completed ${formatDate(report.completed_at)}`}
          />
          <DisclosedScore
            disclosure={report.disclosure}
            withheldCopy={withheld}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-center gap-x-10 gap-y-4 sm:justify-start">
                <div className="flex flex-col">
                  <span
                    className="font-serif text-[64px] font-semibold leading-none"
                    data-testid="exam-total-score"
                  >
                    {report.score.total_scaled}
                  </span>
                  {/* The student's words since UI-54 ("Total score", "out of 1600"; G5-08 mirror). */}
                  <span className="text-base text-[var(--exam-muted)]">
                    Total score, out of 1600
                  </span>
                </div>
                <AttemptFacts report={report} />
              </div>
              <DisclosureNote disclosure={report.disclosure} />
            </div>
            <ScoreTabs
              breakdown={
                <LeftAligned>
                  {/* G5-11: the student's own seven-segment rows (SCL-210). */}
                  <DomainSegments
                    segments={report.domain_breakdown}
                    omitted={[]}
                  />
                </LeftAligned>
              }
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <SectionCard
                  label={sectionDisplayLabel("RW") ?? ""}
                  scaled={report.score.rw_scaled}
                />
                <SectionCard
                  label={sectionDisplayLabel("M") ?? ""}
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
          <DisclosedScore
            disclosure={report.disclosure}
            withheldCopy={withheld}
          >
            <Panel title="Partial score">
              <p
                className="m-0 text-base leading-relaxed"
                data-testid="exam-partial-summary"
              >
                {report.partial_disclosure.summary}
              </p>
              <DisclosureNote disclosure={report.disclosure} />
            </Panel>
            <ScoreTabs
              breakdown={
                <LeftAligned>
                  {/* G5-11: the student's own seven-segment rows (SCL-210); G5-12: the
                      student's note for the section with no score. */}
                  <DomainSegments
                    segments={report.domain_breakdown}
                    omitted={unscoredOmissions(report.completed_sections)}
                  />
                </LeftAligned>
              }
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <SectionCard
                  label={sectionDisplayLabel("RW") ?? ""}
                  scaled={report.score.rw_scaled}
                />
                <SectionCard
                  label={sectionDisplayLabel("M") ?? ""}
                  scaled={report.score.math_scaled}
                />
              </div>
            </ScoreTabs>
          </DisclosedScore>
        </>
      );
    default: {
      const copy = guardianOutcomeCopy(report, name);
      return (
        <>
          <Title name={report.test_form_name} line={copy.line} />
          <Panel title={copy.title}>
            {copy.body === null ? null : (
              <p className="m-0 text-base leading-relaxed" role="status">
                {copy.body}
              </p>
            )}
          </Panel>
        </>
      );
    }
  }
}
