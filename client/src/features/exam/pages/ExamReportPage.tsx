/**
 * The student's score report: /tests/:sessionId/report (Focus shell).
 *
 * @spec [student-UI register UI-54; DESIGN.md §1 (tokens only, 14px floor), §2 (Focus shell: back
 *        arrow + section name + context), §3 "Report segments", §4 "Exam report" (total out of
 *        1600, sections out of 800, the "Lyceon-modeled SAT score" disclosure, "Knowledge and
 *        skills" with seven segments per domain and College Board's domain weight lines; no
 *        percentiles, no correct/total); prototype Report.dc.html; evidence/wiring-table.md
 *        §8; register §2 (ruling 7; the lapsed report opens the upgrade modal, OQ-5), OQ-33
 *        (owner ruling 2026-10-02: hide "Review your answers"), OQ-34 (owner ruling
 *        2026-10-02: a lapsed report carries `resume_action: {type: "renew_entitlement"}`),
 *        OQ-49 (off the light lock: route-shells.ts), OQ-51 ("Reading & Writing")]
 *       [Doc-04C_V1.0, §5.1 (states), §8.1 (scored), §9.1-§9.3 (partial), §10.2/§10.4
 *        (failed), §11.4 (not_completed), §11.5 (scoring_pending; estimated_ready_at is
 *        hedged, and null means "Scoring usually takes a few minutes"), §11.5b (unavailable),
 *        §15.1 (disclosure adjacent), §16.1 (/report, /report/status)]
 *       [E7 owner ruling 6 + E7b ruling 4: no "time used", no answered count, no framing
 *        paragraph] [SCL-180 (amended 2026-09-29), owner ruling 7: seven segments per domain
 *        from `domain_segments`; no correct-of-total anywhere]
 * @implemented [2026-09-25; segments 2026-09-29; rebuilt on the student tokens 2026-10-03, UI-54]
 *
 * plain English: one view per report state, each drawing only its payload's fields. The top bar
 * (FocusBarContext) names the report ("Practice Test 1 report") and its date. A scored report is
 * a score card (total out of 1600, each section out of 800, the timing it was taken under, the
 * disclosure) beside "Knowledge and skills" (seven segments per domain). A pending report polls
 * the cheap status read and reloads the report when the state changes; the page never guesses a
 * score. A lapsed student's report (`unavailable`, `renew_entitlement`) opens the upgrade modal
 * for Full-Length once, and "Continue" opens it again.
 *
 * ANTI-LEAK / INTEGRITY: the payload is parsed by the strict student schema in `exam-api.ts`, so
 * a `correct`, `total` or `domain_breakdown` key fails the read before anything renders. Every
 * scaled score is drawn inside `DisclosedScore`, which draws none without a valid disclosure. No
 * "Review your answers" (OQ-33): the Doc 04C §16.1 review routes are not built.
 *
 * Replaces the pre-redesign page: its own "Lyceon" header bar with the student's name, the
 * "Back to dashboard" link (the Focus shell's back arrow goes to Full-Length), the Section scores
 * / Score breakdown tabs, the disabled "Review your answers" button with "Answer review is coming
 * soon.", and the exam colour tokens.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type { ExamStudentReportPayload } from "@lyceon/shared/exam-student-report-schema";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { FocusBarContext } from "@/components/layout/FocusShell";
import { Button } from "@/components/ui/button";
import { sectionDisplayLabel } from "@shared/section-display";
import { fetchExamReport, fetchExamReportStatus } from "../api/exam-api";
import { examKeys } from "../api/keys";
import { sessionPath } from "../lib/exam-position";
import { MODE_SHORT_LABEL } from "../lib/labels";
import { dayMonthYear } from "../lib/tests-home-model";
import { DisclosedScore, DisclosureNote } from "../components/DisclosedScore";
import { ExamLoadError, ExamLoading } from "../components/ExamStatus";
import { DomainSegments } from "../components/DomainSegments";

const POLL_MS = 4_000;

const CARD =
  "flex flex-col gap-6 rounded-lg border border-lyc-rule bg-lyc-sheet p-7";
const CARD_H2 = "m-0 text-[15px] font-semibold text-lyc-muted";
const NOTE = "m-0 text-[15px] leading-normal text-lyc-muted";
const BODY = "m-0 text-[17px] leading-relaxed text-lyc-ink";
const PANEL_H2 =
  "m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong";
const WITHHELD =
  "rounded-lg border border-lyc-rule bg-lyc-sheet p-5 text-[17px] text-lyc-ink";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function ExamReportPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: examKeys.report(sessionId),
    queryFn: () => fetchExamReport(sessionId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const pending = report.data?.report_state === "scoring_pending";
  useQuery({
    queryKey: examKeys.reportStatus(sessionId),
    queryFn: async () => {
      const status = await fetchExamReportStatus(sessionId);
      if (status.report_state !== "scoring_pending") {
        await queryClient.invalidateQueries({
          queryKey: examKeys.report(sessionId),
          exact: true,
        });
      }
      return status;
    },
    enabled: pending,
    refetchInterval: pending ? POLL_MS : false,
    refetchOnWindowFocus: false,
  });

  if (report.isPending) return <ExamLoading label="Loading your report…" />;
  if (report.isError)
    return (
      <ExamLoadError
        error={report.error}
        onRetry={() => void report.refetch()}
      />
    );
  return <ReportLayout payload={report.data} />;
}

/** The date the top bar shows: when the test ended, if the payload says. */
function reportDate(payload: ExamStudentReportPayload): string | null {
  switch (payload.report_state) {
    case "scored":
      return payload.completed_at;
    case "partial_scored":
      return payload.abandoned_at;
    case "scoring_pending":
    case "failed_requires_review":
      return payload.completed_at ?? payload.abandoned_at;
    case "unavailable":
    case "not_completed":
      return null;
  }
}

function ReportLayout({
  payload,
}: {
  payload: ExamStudentReportPayload;
}): JSX.Element {
  const date = reportDate(payload);
  return (
    <>
      <FocusBarContext>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
          <span
            aria-hidden="true"
            className="hidden h-7 w-px shrink-0 bg-lyc-rule sm:block"
          />
          <span
            className="min-w-0 truncate font-lyc-serif text-[20px] font-semibold text-lyc-ink-strong"
            data-testid="exam-report-title"
          >
            {payload.test_form_name} report
          </span>
          {date !== null ? (
            <span className="hidden shrink-0 text-lyc-body text-lyc-muted sm:inline">
              {dayMonthYear(date)}
            </span>
          ) : null}
        </div>
      </FocusBarContext>
      <div className="px-4 py-8 sm:px-10 lg:px-[72px] lg:py-12">
        <div
          className="mx-auto w-full max-w-[1180px]"
          data-testid="exam-report"
          data-report-state={payload.report_state}
        >
          <ReportBody payload={payload} />
        </div>
      </div>
    </>
  );
}

function SectionRow({
  label,
  scaled,
}: {
  label: string;
  scaled: number | null;
}): JSX.Element {
  return (
    <div
      className="flex items-baseline justify-between gap-3"
      data-testid="exam-section-score"
    >
      <span className="text-[18px] text-lyc-ink">{label}</span>
      {scaled === null ? (
        <span className="text-[17px] font-medium text-lyc-muted">
          Not completed
        </span>
      ) : (
        <span className="flex items-baseline gap-2">
          <span className="font-lyc-serif text-[34px] font-semibold text-lyc-ink-strong">
            {scaled}
          </span>
          <span className="text-[15px] text-lyc-muted">/ 800</span>
        </span>
      )}
    </div>
  );
}

function TimingFact({
  mode,
}: {
  mode: keyof typeof MODE_SHORT_LABEL;
}): JSX.Element {
  // The practice-timing option promises "Your report says so" (the start choice's copy).
  return (
    <dl className="m-0 flex gap-2 text-[15px]">
      <dt className="text-lyc-muted">Timing</dt>
      <dd className="m-0 font-semibold text-lyc-ink">
        {MODE_SHORT_LABEL[mode]}
      </dd>
    </dl>
  );
}

function KnowledgeAndSkills({
  payload,
}: {
  payload: Extract<
    ExamStudentReportPayload,
    { report_state: "scored" | "partial_scored" }
  >;
}): JSX.Element {
  return (
    <section
      aria-labelledby="exam-ks-h"
      className="flex flex-col gap-7"
      data-testid="exam-knowledge"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="exam-ks-h" className={PANEL_H2}>
          Knowledge and skills
        </h2>
        <p className="m-0 text-[17px] text-lyc-muted">
          How you did across the eight content domains on this full-length test.
        </p>
      </div>
      <DomainSegments
        segments={payload.domain_segments}
        omitted={payload.omitted_domains}
      />
    </section>
  );
}

function StatePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mx-auto flex max-w-[720px] flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet p-7 sm:p-9">
      <h2 className={PANEL_H2}>{title}</h2>
      {children}
    </section>
  );
}

const GRID =
  "grid grid-cols-1 items-start gap-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-12";

export function ReportBody({
  payload,
}: {
  payload: ExamStudentReportPayload;
}): JSX.Element {
  switch (payload.report_state) {
    case "scored":
      return (
        <div className={GRID}>
          <DisclosedScore
            disclosure={payload.disclosure}
            withheldClassName={WITHHELD}
          >
            <section
              aria-labelledby="exam-scores-h"
              className={CARD}
              data-testid="exam-score-card"
            >
              <h2 id="exam-scores-h" className={CARD_H2}>
                Total score
              </h2>
              <div className="-mt-4 flex items-baseline gap-3">
                <span
                  className="font-lyc-serif text-[64px] font-semibold leading-none text-lyc-ink-strong"
                  data-testid="exam-total-score"
                >
                  {payload.score.total_scaled}
                </span>
                <span className="text-lyc-body text-lyc-muted">
                  out of 1600
                </span>
              </div>
              <div className="flex flex-col gap-[18px] border-t border-lyc-rule pt-5">
                <h3 className={CARD_H2}>Section scores</h3>
                {payload.sections.map((s) => (
                  <SectionRow
                    key={s.section}
                    label={sectionDisplayLabel(s.section) ?? ""}
                    scaled={s.scaled}
                  />
                ))}
                <TimingFact mode={payload.mode} />
              </div>
              <div className="border-t border-lyc-rule pt-4">
                <DisclosureNote
                  disclosure={payload.disclosure}
                  className={NOTE}
                />
              </div>
            </section>
          </DisclosedScore>
          <KnowledgeAndSkills payload={payload} />
        </div>
      );
    case "partial_scored":
      return (
        <div className={GRID}>
          <DisclosedScore
            disclosure={payload.disclosure}
            withheldClassName={WITHHELD}
          >
            <section
              aria-labelledby="exam-scores-h"
              className={CARD}
              data-testid="exam-score-card"
            >
              <h2 id="exam-scores-h" className={CARD_H2}>
                Partial score
              </h2>
              <p className={BODY} data-testid="exam-partial-summary">
                {payload.partial_disclosure.summary}
              </p>
              <div className="flex flex-col gap-[18px] border-t border-lyc-rule pt-5">
                <h3 className={CARD_H2}>Section scores</h3>
                {payload.sections.map((s) => (
                  <SectionRow
                    key={s.section}
                    label={sectionDisplayLabel(s.section) ?? ""}
                    scaled={s.scoreable ? s.scaled : null}
                  />
                ))}
                <TimingFact mode={payload.mode} />
              </div>
              <div className="border-t border-lyc-rule pt-4">
                <DisclosureNote
                  disclosure={payload.disclosure}
                  className={NOTE}
                />
              </div>
            </section>
          </DisclosedScore>
          <KnowledgeAndSkills payload={payload} />
        </div>
      );
    case "scoring_pending":
      return (
        <StatePanel title="Scoring your full-length test">
          <p className={BODY} role="status" aria-live="polite">
            {payload.estimated_ready_at === null ||
            payload.estimated_ready_at === undefined
              ? "Scoring usually takes a few minutes. This page updates on its own."
              : `Usually ready by about ${formatTime(payload.estimated_ready_at)}. This page updates on its own.`}
          </p>
        </StatePanel>
      );
    case "failed_requires_review":
      return (
        <StatePanel title="Your score isn't ready">
          <p className={BODY} data-testid="exam-failure-message">
            {payload.failure_summary.student_facing_message}
          </p>
        </StatePanel>
      );
    case "unavailable":
      return <UnavailableReport payload={payload} />;
    case "not_completed":
      return (
        <StatePanel
          title={
            payload.resumable
              ? "This full-length test isn't finished"
              : "This attempt ended before it was finished"
          }
        >
          <p className={BODY}>
            {payload.resumable
              ? "Your score appears here once both sections are submitted."
              : // The section's name (owner naming ruling, Karl, 2026-10-05).
                "There's no score for this attempt. You can start a new attempt from Full-Length."}
          </p>
          {payload.resumable ? (
            <Button
              asChild
              variant="lyc-primary"
              size="lyc-lg"
              className="self-start"
            >
              <Link
                href={sessionPath(payload.session_id)}
                className="no-underline"
              >
                Resume full-length test
              </Link>
            </Button>
          ) : null}
        </StatePanel>
      );
  }
}

/**
 * Doc 04C §11.5b, OQ-34 / OQ-5: a lapsed student's report. `renew_entitlement` opens the
 * upgrade modal for Full-Length once when the payload arrives and again from "Continue"; it is
 * an HTTP 200, so the app-wide denial listener never sees it. Another action with a URL keeps
 * the plain link.
 */
function UnavailableReport({
  payload,
}: {
  payload: Extract<ExamStudentReportPayload, { report_state: "unavailable" }>;
}): JSX.Element {
  const upgrade = useUpgradeModal();
  const renew = payload.resume_action?.type === "renew_entitlement";
  const opened = useRef(false);
  const { open } = upgrade;
  // Opening a dialog in response to a server payload is an external side effect, not derived
  // state; the ref keeps it to once per page visit.
  useEffect(() => {
    if (!renew || opened.current) return;
    opened.current = true;
    open("exam_full_length", "plan");
  }, [renew, open]);

  return (
    <StatePanel title="This report isn't available right now">
      <p className={BODY}>
        {payload.unavailable_reason === "entitlement_lapsed"
          ? "Full-length test reports are part of an active subscription. Your results are kept, and you can see them again when your subscription is active."
          : "This report can't be shown at the moment."}
      </p>
      {renew ? (
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          className="self-start"
          data-testid="exam-report-renew"
          onClick={() => open("exam_full_length", "plan")}
        >
          Continue
        </Button>
      ) : payload.resume_action?.url != null ? (
        <a
          href={payload.resume_action.url}
          className="text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4"
        >
          Continue
        </a>
      ) : null}
    </StatePanel>
  );
}
