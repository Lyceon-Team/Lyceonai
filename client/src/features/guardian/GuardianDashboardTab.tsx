/**
 * `/guardian/:studentId` — the Dashboard tab.
 *
 * @spec [Guardian_Closure_Plan G4-03 (R2, R3), Q-L1 contents; G5-01..G5-05 and ruling R13
 *       (Karl, 2026-10-02: this tab is guardian-only and follows the design, superseding R11 for
 *       the Dashboard only; the Calendar tab keeps R11); the canvas boards "Wave 5 — BUILD
 *       TARGET"; endpoint map as updated by the owner 2026-09-30 (the header reads the calendar
 *       route; no kpi/overall call); SCL-188/189/192/199; G-NEW-16]
 *       | @implemented [2026-09-30; redesigned 2026-10-02]
 *
 * plain English: the student's week at a glance, as the design draws it — four blocks in a
 * 1200px column (phone: one column, 16px gutters), one endpoint per widget:
 *   - the score strip (G5-01) — projected band, target, test date, streak — and this week's
 *     plan (G5-02): ONE read of `GET /api/students/:id/calendar` for the current week;
 *   - mastery by domain: `GET …/mastery/domains`, rendered by the guardian-only
 *     `GuardianMasteryCard` (G5-03, R13) — two columns by section, all eight domains, the live
 *     `levelTone`, no skills (SCL-194);
 *   - the latest full-length test: `GET …/tests` (the newest `completed_at`, SCL-192), then its
 *     report, rendered by the guardian-only `GuardianLatestTestCard` (G5-04, R13): total, the
 *     change since the previous test from the list's `total_scaled` (SCL-199), section scores,
 *     the disclosure and "See full report →" to the detail page, which holds the full report
 *     (G5-05 removed the embedded copy and the calendar's flat `HeaderFacts` strip).
 * Removed by ruling, and absent by construction: the 7-day question and accuracy tiles (R3,
 * the server no longer sends them), skills, x/y counts (R4), answers, LISA, any act control.
 *
 * edge cases: every widget owns its loading and error. The full state matrix (lapsed, revoked,
 * not set up, no exams yet) is G4-06; the Dashboard never renders a zero it did not read.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import type { GuardianExamList } from "@lyceon/shared/exam-guardian-report-schema";
import { useGuardianCalendar } from "@/features/calendar/api";
import {
  browserLocalToday,
  rangeForView,
  startOfWeek,
} from "@/features/calendar/lib/dates";
import { fetchMasteryDomains } from "@/lib/masteryApi";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import {
  fetchGuardianExamList,
  fetchGuardianExamReport,
} from "@/features/exam/api/exam-api";
import { examKeys } from "@/features/exam/api/keys";
import {
  changeSinceLast,
  GuardianLatestTestCard,
  LatestTestShell,
} from "./GuardianLatestTestCard";
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
  return (
    <div
      className="flex flex-col gap-4 sm:gap-6"
      data-testid="dashboard-header"
    >
      {/* G5-01 (R13): the score strip, from this same week's read — one calendar request, one
          widget, one error state. */}
      <GuardianScoreStrip data={data} studentName={name} today={today} />
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
    return (
      <LatestTestShell>
        <GuardianLoadingState what={`${possessive(name)} test results`} />
      </LatestTestShell>
    );
  }
  if (failure !== null) {
    return (
      <LatestTestShell>
        <GuardianReadFailureState
          failure={failure}
          name={name}
          studentId={studentId}
          what={`${possessive(name)} test results`}
          onRetry={() => void list.refetch()}
        />
      </LatestTestShell>
    );
  }
  if (
    list.data === undefined ||
    latest === null ||
    latest.completed_at === null ||
    report.data === undefined
  ) {
    return (
      <LatestTestShell>
        <GuardianNoExamsState name={name} />
      </LatestTestShell>
    );
  }
  // G5-04 (R13): the compact card; the change comes from the list (SCL-199). The full report
  // is on the detail page, one link away (G5-05).
  return (
    <GuardianLatestTestCard
      report={report.data}
      completedAt={latest.completed_at}
      change={changeSinceLast(list.data, latest)}
      studentName={name}
      href={guardianPaths.exam(studentId, latest.session_id)}
    />
  );
}

export default function GuardianDashboardTab(): JSX.Element {
  const { studentId } = useParams<{ studentId: string }>();
  return (
    <GuardianStudentLayout>
      <div
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pb-10 pt-5 sm:gap-6 sm:px-8 sm:pb-14 sm:pt-8 xl:px-0"
        data-testid="guardian-dashboard-tab"
      >
        <div data-testid="dashboard-header-strip">
          <HeaderStrip studentId={studentId} />
        </div>
        <div data-testid="dashboard-mastery">
          <MasteryWidget studentId={studentId} />
        </div>
        <div data-testid="dashboard-latest-exam">
          <LatestExamWidget studentId={studentId} />
        </div>
      </div>
    </GuardianStudentLayout>
  );
}
