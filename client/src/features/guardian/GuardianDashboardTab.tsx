/**
 * `/guardian/:studentId` — the Dashboard tab.
 *
 * @spec [Guardian_Closure_Plan G4-03 (R2, R3, R11), Q-L1 contents; endpoint map as updated by
 *       the owner 2026-09-30 (the header reads the calendar route; no kpi/overall call);
 *       SCL-188/189/192; G-NEW-16] | @implemented [2026-09-30]
 *
 * plain English: the student's week at a glance, built from the STUDENT's own components shown
 * read-only (R11), one endpoint per widget:
 *   - header strip — streak (as of today), projected band, target, test-date countdown — and
 *     this week's sessions done of planned: ONE read of `GET /api/students/:id/calendar` for
 *     the current week, rendered by `HeaderFacts`, the calendar header's own readouts;
 *   - mastery by domain: `GET …/mastery/domains`, rendered by the guardian-only
 *     `GuardianMasteryCard` (G5-03, R13) — two columns by section, all eight domains, the live
 *     `levelTone`, no skills (SCL-194);
 *   - the latest full-length test: `GET …/tests` (the newest `completed_at`, SCL-192), then its
 *     report, rendered by the guardian exam report body — bars only (SCL-189) — with "See all
 *     results" to the list.
 * Removed by ruling, and absent by construction: the 7-day question and accuracy tiles (R3,
 * the server no longer sends them), skills, x/y counts (R4), answers, LISA, any act control.
 *
 * edge cases: every widget owns its loading and error. The full state matrix (lapsed, revoked,
 * not set up, no exams yet) is G4-06; the Dashboard never renders a zero it did not read.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type { GuardianExamList } from "@lyceon/shared/exam-guardian-report-schema";
import { useGuardianCalendar } from "@/features/calendar/api";
import {
  browserLocalToday,
  daysBetween,
  rangeForView,
  startOfWeek,
} from "@/features/calendar/lib/dates";
import { HeaderFacts } from "@/features/calendar/components/Chrome";
import { fetchMasteryDomains } from "@/lib/masteryApi";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import {
  fetchGuardianExamList,
  fetchGuardianExamReport,
} from "@/features/exam/api/exam-api";
import { examKeys } from "@/features/exam/api/keys";
import { GuardianReportBody } from "@/features/exam/pages/GuardianExamResultsPage";
import { GuardianMasteryCard } from "./GuardianMasteryCard";
import { GuardianScoreStrip } from "./GuardianScoreStrip";
import { GuardianStudentLayout } from "./GuardianStudentLayout";
import { GuardianWeekPlan } from "./GuardianWeekPlan";
import {
  GuardianLoadingState,
  GuardianNoExamsState,
  GuardianNotSetUpState,
  GuardianReadFailureState,
  possessive,
  useCurrentStudentName,
  useGuardianReadFailure,
} from "./GuardianStates";
import { guardianPaths } from "./paths";
import "@/features/calendar/calendar.css";
import "@/features/exam/exam.css";

type ExamListItem = GuardianExamList["tests"][number];

/** The newest completed attempt, by `completed_at` (owner ruling 2026-09-30). */
export function latestCompletedExam(
  tests: readonly ExamListItem[],
): ExamListItem | null {
  let latest: ExamListItem | null = null;
  for (const t of tests) {
    if (t.completed_at === null) continue;
    if (
      latest === null ||
      Date.parse(t.completed_at) > Date.parse(latest.completed_at ?? "")
    ) {
      latest = t;
    }
  }
  return latest;
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
      data-testid={testId}
    >
      {/* Headings centre on a phone (owner decision 2026-10-01, item 10). */}
      <h2 className="m-0 text-center text-xl font-semibold sm:text-left">
        {title}
      </h2>
      {children}
    </section>
  );
}

function HeaderStrip({ studentId }: { studentId: string }): JSX.Element {
  const name = useCurrentStudentName();
  const today = browserLocalToday();
  const week = rangeForView("week", startOfWeek(today));
  const calendar = useGuardianCalendar(studentId, week.from, week.to);
  const failure = useGuardianReadFailure(studentId, calendar.error);

  if (calendar.isLoading) {
    return <GuardianLoadingState what={`${possessive(name)} week`} />;
  }
  if (failure !== null || calendar.data === undefined) {
    return (
      <GuardianReadFailureState
        failure={failure ?? "error"}
        name={name}
        studentId={studentId}
        what={`${possessive(name)} week`}
        onRetry={() => void calendar.refetch()}
      />
    );
  }
  const data = calendar.data;
  if (data.status !== "ready") return <GuardianNotSetUpState name={name} />;
  const daysToTest =
    data.target_exam_date === null
      ? null
      : Math.max(0, daysBetween(today, data.target_exam_date));
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-header">
      {/* G5-01 (R13): the score strip, from this same week's read — one calendar request, one
          widget, one error state. */}
      <GuardianScoreStrip data={data} studentName={name} today={today} />
      {/* The calendar header's own readouts (`.lyceon-calendar` scopes their styles), laid out
          as one strip: the calendar places them in its top-bar slots, the Dashboard in a row. */}
      <div className="lyceon-calendar rounded-2xl border border-border px-5 py-4 [&_.header-facts]:flex [&_.header-facts]:flex-wrap [&_.header-facts]:items-baseline [&_.header-facts]:justify-center [&_.header-facts]:gap-x-10 [&_.header-facts]:gap-y-2 sm:[&_.header-facts]:justify-start">
        <HeaderFacts
          viewer="guardian"
          targetScore={data.target_score}
          daysToTest={daysToTest}
          streak={data.streak}
          projection={data.projection}
        />
      </div>
      {/* G5-02 (R13): this week's plan, from the same read's facts — the numbers the
          Calendar footer counts. */}
      <GuardianWeekPlan
        completed={data.facts.blocks_completed}
        total={data.facts.blocks_total}
      />
    </div>
  );
}

function MasteryWidget({ studentId }: { studentId: string }): JSX.Element {
  const name = useCurrentStudentName();
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
  });
  const failure = useGuardianReadFailure(studentId, mastery.error);
  if (mastery.isLoading) {
    return <GuardianLoadingState what={`${possessive(name)} mastery`} />;
  }
  if (failure !== null || mastery.data === undefined) {
    return (
      <GuardianReadFailureState
        failure={failure ?? "error"}
        name={name}
        studentId={studentId}
        what={`${possessive(name)} mastery`}
        onRetry={() => void mastery.refetch()}
      />
    );
  }
  // G5-03 (R13): the guardian-only card, all eight domains, no skills (SCL-194).
  return <GuardianMasteryCard domains={mastery.data.domains} />;
}

function LatestExamWidget({ studentId }: { studentId: string }): JSX.Element {
  const name = useCurrentStudentName();
  const list = useQuery({
    queryKey: examKeys.guardianTests(studentId),
    queryFn: () => fetchGuardianExamList(studentId),
  });
  const latest =
    list.data === undefined ? null : latestCompletedExam(list.data);
  const report = useQuery({
    queryKey: examKeys.guardianReport(studentId, latest?.session_id ?? ""),
    queryFn: () => fetchGuardianExamReport(studentId, latest?.session_id ?? ""),
    enabled: latest !== null,
  });
  const failure = useGuardianReadFailure(studentId, list.error ?? report.error);

  if (list.isLoading || (latest !== null && report.isLoading)) {
    return <GuardianLoadingState what={`${possessive(name)} test results`} />;
  }
  if (failure !== null) {
    return (
      <GuardianReadFailureState
        failure={failure}
        name={name}
        studentId={studentId}
        what={`${possessive(name)} test results`}
        onRetry={() => void list.refetch()}
      />
    );
  }
  if (latest === null || report.data === undefined) {
    return <GuardianNoExamsState name={name} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div
        className="exam-root flex flex-col gap-5"
        data-testid="dashboard-exam"
      >
        <GuardianReportBody report={report.data} />
      </div>
      <Link
        href={guardianPaths.exams(studentId)}
        className="w-fit text-base font-semibold underline"
        data-testid="dashboard-exam-all"
      >
        See all results →
      </Link>
    </div>
  );
}

export default function GuardianDashboardTab(): JSX.Element {
  const { studentId } = useParams<{ studentId: string }>();
  return (
    <GuardianStudentLayout>
      <div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6"
        data-testid="guardian-dashboard-tab"
      >
        <div data-testid="dashboard-header-strip">
          <HeaderStrip studentId={studentId} />
        </div>
        <div data-testid="dashboard-mastery">
          <MasteryWidget studentId={studentId} />
        </div>
        <Section title="Latest full-length test" testId="dashboard-latest-exam">
          <LatestExamWidget studentId={studentId} />
        </Section>
      </div>
    </GuardianStudentLayout>
  );
}
