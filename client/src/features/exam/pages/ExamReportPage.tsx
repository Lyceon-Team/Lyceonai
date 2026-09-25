/**
 * The completion screen / score report: /tests/:sessionId/report
 *
 * @spec [Doc-04C_V1.0, §5.1 (states), §8.1 (scored), §9.1-§9.3 (partial), §10.2/§10.4
 *        (failed), §11.4 (not_completed), §11.5 (scoring_pending; estimated_ready_at
 *        is hedged, and null means "Scoring usually takes a few minutes"), §11.5b
 *        (unavailable), §15.1 (disclosure adjacent), §16.1 (/report, /report/status)]
 *       [E7 owner ruling 6 + E7b ruling 4: no "time used", no answered count, no
 *        framing paragraph; "Review your answers" and the Score breakdown tab are
 *        disabled — the tab strip exists so E8 fills it]
 * @implemented [2026-09-25]
 *
 * plain English: one view per report state, each drawing only its payload's fields.
 * A pending report polls the cheap status read and reloads the report when the
 * state changes; the page itself never guesses a score.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "wouter";
import type { ExamReportPayload } from "@lyceon/shared/exam-report-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { fetchExamReport, fetchExamReportStatus } from "../api/exam-api";
import { examKeys } from "../api/keys";
import { sessionPath } from "../lib/exam-position";
import { MODE_SHORT_LABEL } from "../lib/labels";
import { DisclosedScore, DisclosureNote } from "../components/DisclosedScore";
import { ExamLoadError, ExamLoading } from "../components/ExamStatus";
import "../exam.css";

const POLL_MS = 4_000;

function formatDate(iso: string | null): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export default function ExamReportPage() {
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
        await queryClient.invalidateQueries({ queryKey: examKeys.report(sessionId), exact: true });
      }
      return status;
    },
    enabled: pending,
    refetchInterval: pending ? POLL_MS : false,
    refetchOnWindowFocus: false,
  });

  if (report.isPending) return <ExamLoading label="Loading your report…" />;
  if (report.isError) return <ExamLoadError error={report.error} onRetry={() => void report.refetch()} />;
  return <ReportLayout payload={report.data} />;
}

function ReportLayout({ payload }: { payload: ExamReportPayload }) {
  const { user } = useSupabaseAuth();
  return (
    <div className="exam-root min-h-screen">
      <header className="flex h-[60px] items-center justify-between border-b border-[var(--exam-line)] bg-[var(--exam-surface)] px-6 md:px-10">
        <span className="font-serif text-xl font-semibold">Lyceon</span>
        <span className="text-[13px] text-[var(--exam-muted)]">{user?.display_name ?? ""}</span>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 md:px-10" data-testid="exam-report" data-report-state={payload.report_state}>
        <ReportBody payload={payload} />
      </main>
    </div>
  );
}

function Actions({ reviewShown }: { reviewShown: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/dashboard" className="flex min-h-[48px] items-center rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-6 text-[15px] font-medium">
        Back to dashboard
      </Link>
      {reviewShown && (
        <button
          type="button"
          disabled
          aria-describedby="exam-review-later"
          className="min-h-[48px] cursor-not-allowed rounded-full bg-[var(--exam-accent)] px-6 text-[15px] font-semibold text-white opacity-50"
        >
          Review your answers
        </button>
      )}
      {reviewShown && (
        <span id="exam-review-later" className="self-center text-[13px] text-[var(--exam-muted)]">
          Answer review is coming soon.
        </span>
      )}
    </div>
  );
}

function Title({ name, line }: { name: string; line: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-sm text-[var(--exam-muted)]">{line}</p>
      <h1 className="m-0 font-serif text-[30px] font-semibold">{name}</h1>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--exam-muted)]">{label}</dt>
      <dd className="m-0 text-[15px] font-medium">{value}</dd>
    </div>
  );
}

function ScoreTabs({ children }: { children: React.ReactNode }) {
  const [tab] = useState<"sections">("sections");
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Score views" className="flex gap-1 rounded-[10px] bg-[#EAE7E0] p-1">
        <button
          type="button"
          role="tab"
          id="exam-tab-sections"
          aria-selected={tab === "sections"}
          aria-controls="exam-tabpanel-sections"
          className="min-h-[44px] flex-1 rounded-lg bg-[var(--exam-surface)] text-sm font-semibold shadow-sm"
        >
          Section scores
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          disabled
          aria-disabled="true"
          title="Coming soon"
          className="min-h-[44px] flex-1 cursor-not-allowed rounded-lg text-sm font-medium text-[var(--exam-muted)] opacity-60"
        >
          Score breakdown <span className="sr-only">(coming soon)</span>
        </button>
      </div>
      <div role="tabpanel" id="exam-tabpanel-sections" aria-labelledby="exam-tab-sections">
        {children}
      </div>
    </div>
  );
}

function SectionCard({ label, scaled }: { label: string; scaled: number | null }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5" data-testid="exam-section-score">
      <span className="text-sm font-medium text-[var(--exam-muted)]">{label}</span>
      {scaled === null ? (
        <span className="text-[15px] font-medium">Not completed</span>
      ) : (
        <>
          <span className="font-serif text-[34px] font-semibold leading-none">{scaled}</span>
          <span className="text-[12px] text-[var(--exam-muted)]">200–800</span>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-7">
      <h2 className="m-0 font-serif text-[24px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ReportBody({ payload }: { payload: ExamReportPayload }) {
  switch (payload.report_state) {
    case "scored":
      return (
        <>
          <Title name={payload.test_form_name} line={`Completed ${formatDate(payload.completed_at)}`} />
          <DisclosedScore disclosure={payload.disclosure}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <div className="flex flex-col">
                  <span className="font-serif text-[64px] font-semibold leading-none" data-testid="exam-total-score">
                    {payload.score.total_scaled}
                  </span>
                  <span className="text-sm text-[var(--exam-muted)]">Total score · 400–1600</span>
                </div>
                <dl className="m-0 flex gap-8">
                  <Fact label="Timing" value={MODE_SHORT_LABEL[payload.mode]} />
                  <Fact label="Attempt" value={String(payload.attempt_number_for_form)} />
                </dl>
              </div>
              <DisclosureNote disclosure={payload.disclosure} />
            </div>
            <ScoreTabs>
              <div className="flex flex-col gap-3 sm:flex-row">
                {payload.sections.map((s) => (
                  <SectionCard key={s.section} label={EXAM_SECTION_LABEL[s.section]} scaled={s.scaled} />
                ))}
              </div>
            </ScoreTabs>
          </DisclosedScore>
          <Actions reviewShown />
        </>
      );
    case "partial_scored":
      return (
        <>
          <Title name={payload.test_form_name} line={`Ended ${formatDate(payload.abandoned_at)}`} />
          <DisclosedScore disclosure={payload.disclosure}>
            <Panel title="Partial score">
              <p className="m-0 text-[15px] leading-relaxed" data-testid="exam-partial-summary">
                {payload.partial_disclosure.summary}
              </p>
              <DisclosureNote disclosure={payload.disclosure} />
            </Panel>
            <ScoreTabs>
              <div className="flex flex-col gap-3 sm:flex-row">
                {payload.sections.map((s) => (
                  <SectionCard key={s.section} label={EXAM_SECTION_LABEL[s.section]} scaled={s.scoreable ? s.scaled : null} />
                ))}
              </div>
            </ScoreTabs>
          </DisclosedScore>
          <Actions reviewShown />
        </>
      );
    case "scoring_pending":
      return (
        <>
          <Title name={payload.test_form_name} line="Test submitted" />
          <Panel title="Scoring your test">
            <p className="m-0 text-[15px] leading-relaxed" role="status" aria-live="polite">
              {payload.estimated_ready_at === null
                ? "Scoring usually takes a few minutes. This page updates on its own."
                : `Usually ready by about ${formatTime(payload.estimated_ready_at)}. This page updates on its own.`}
            </p>
          </Panel>
          <Actions reviewShown={false} />
        </>
      );
    case "failed_requires_review":
      return (
        <>
          <Title name={payload.test_form_name} line="Test submitted" />
          <Panel title="Your score isn't ready">
            <p className="m-0 text-[15px] leading-relaxed" data-testid="exam-failure-message">
              {payload.failure_summary.student_facing_message}
            </p>
          </Panel>
          <Actions reviewShown={false} />
        </>
      );
    case "unavailable":
      return (
        <>
          <Title name={payload.test_form_name} line="Report" />
          <Panel title="This report isn't available right now">
            <p className="m-0 text-[15px] leading-relaxed">
              {payload.unavailable_reason === "entitlement_lapsed"
                ? "Full-length test reports are part of an active subscription. Your results are kept, and you can see them again when your subscription is active."
                : "This report can't be shown at the moment."}
            </p>
            {payload.resume_action?.url != null && (
              <a href={payload.resume_action.url} className="font-medium text-[var(--exam-accent)] underline">
                Continue
              </a>
            )}
          </Panel>
          <Actions reviewShown={false} />
        </>
      );
    case "not_completed":
      return (
        <>
          <Title name={payload.test_form_name} line="Report" />
          <Panel title={payload.resumable ? "This test isn't finished" : "This attempt ended before it was finished"}>
            <p className="m-0 text-[15px] leading-relaxed">
              {payload.resumable
                ? "Your score appears here once both sections are submitted."
                : "There's no score for this attempt. You can start a new attempt from Tests."}
            </p>
            {payload.resumable && (
              <Link href={sessionPath(payload.session_id)} className="flex min-h-[48px] w-fit items-center rounded-full bg-[var(--exam-accent)] px-6 text-[15px] font-semibold text-white">
                Resume test
              </Link>
            )}
          </Panel>
          <Actions reviewShown={false} />
        </>
      );
  }
}

