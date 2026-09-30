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
 *   - mastery by domain, grouped by section: `GET …/mastery/domains`, rendered by `DomainGrid`
 *     with no `onOpen`, so there is no Skills drill-down (skills are student-only);
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
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import type { GuardianExamList } from "@lyceon/shared/exam-guardian-report-schema";
import { useGuardianCalendar } from "@/features/calendar/api";
import {
  browserLocalToday,
  daysBetween,
  rangeForView,
  startOfWeek,
} from "@/features/calendar/lib/dates";
import { HeaderFacts } from "@/features/calendar/components/Chrome";
import { DomainGrid } from "@/components/mastery/DomainGrid";
import { fetchMasteryDomains } from "@/lib/masteryApi";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import {
  fetchGuardianExamList,
  fetchGuardianExamReport,
} from "@/features/exam/api/exam-api";
import { examKeys } from "@/features/exam/api/keys";
import { GuardianReportBody } from "@/features/exam/pages/GuardianExamResultsPage";
import { GuardianStudentLayout } from "./GuardianStudentLayout";
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
      <h2 className="m-0 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function WidgetMessage({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <p className="m-0 text-base text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  );
}

function HeaderStrip({ studentId }: { studentId: string }): JSX.Element {
  const today = browserLocalToday();
  const week = rangeForView("week", startOfWeek(today));
  const calendar = useGuardianCalendar(studentId, week.from, week.to);

  if (calendar.isLoading) {
    return (
      <WidgetMessage testId="dashboard-header-loading">Loading…</WidgetMessage>
    );
  }
  if (calendar.isError || calendar.data === undefined) {
    return (
      <WidgetMessage testId="dashboard-header-error">
        We couldn&rsquo;t load this week&rsquo;s plan.
      </WidgetMessage>
    );
  }
  const data = calendar.data;
  if (data.status !== "ready") {
    return (
      <WidgetMessage testId="dashboard-header-not-set-up">
        No study plan yet.
      </WidgetMessage>
    );
  }
  const daysToTest =
    data.target_exam_date === null
      ? null
      : Math.max(0, daysBetween(today, data.target_exam_date));
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-header">
      <div className="lyceon-calendar">
        <HeaderFacts
          viewer="guardian"
          targetScore={data.target_score}
          daysToTest={daysToTest}
          streak={data.streak}
          projection={data.projection}
        />
      </div>
      <p className="m-0 text-base" data-testid="dashboard-week">
        This week&rsquo;s plan:{" "}
        <b>
          {data.facts.blocks_completed} of {data.facts.blocks_total}
        </b>{" "}
        sessions done
      </p>
    </div>
  );
}

function MasteryWidget({ studentId }: { studentId: string }): JSX.Element {
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
  });
  if (mastery.isLoading) {
    return (
      <WidgetMessage testId="dashboard-mastery-loading">Loading…</WidgetMessage>
    );
  }
  if (mastery.isError || mastery.data === undefined) {
    return (
      <WidgetMessage testId="dashboard-mastery-error">
        We couldn&rsquo;t load mastery.
      </WidgetMessage>
    );
  }
  const domains = mastery.data.domains;
  return (
    <div className="flex flex-col gap-5">
      {(["RW", "M"] as const).map((section) => {
        const own = domains.filter((d) => d.section === section);
        if (own.length === 0) return null;
        return (
          <div key={section} className="flex flex-col gap-3">
            <h3 className="m-0 text-base font-semibold text-muted-foreground">
              {EXAM_SECTION_LABEL[section]}
            </h3>
            {/* No `onOpen`: no Skills drill-down on a guardian surface. */}
            <DomainGrid domains={own} />
          </div>
        );
      })}
    </div>
  );
}

function LatestExamWidget({ studentId }: { studentId: string }): JSX.Element {
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

  if (list.isLoading || (latest !== null && report.isLoading)) {
    return (
      <WidgetMessage testId="dashboard-exam-loading">Loading…</WidgetMessage>
    );
  }
  if (list.isError || report.isError) {
    return (
      <WidgetMessage testId="dashboard-exam-error">
        We couldn&rsquo;t load test results.
      </WidgetMessage>
    );
  }
  if (latest === null || report.data === undefined) {
    return (
      <WidgetMessage testId="dashboard-exam-none">
        No full-length practice test completed yet.
      </WidgetMessage>
    );
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
        <HeaderStrip studentId={studentId} />
        <Section title="Mastery by domain" testId="dashboard-mastery">
          <MasteryWidget studentId={studentId} />
        </Section>
        <Section title="Latest full-length test" testId="dashboard-latest-exam">
          <LatestExamWidget studentId={studentId} />
        </Section>
      </div>
    </GuardianStudentLayout>
  );
}
