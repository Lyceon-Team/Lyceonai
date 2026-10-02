/**
 * The frame of every page about ONE linked student: the guardian shell, with the Dashboard /
 * Calendar tabs centred under the top bar.
 *
 * @spec [Guardian_Closure_Plan Wave 4 layout (Karl, 2026-09-28), G4-01] | @implemented [2026-09-30]
 *
 * plain English: the student comes from the URL (`:studentId`), never from component state,
 * so a refresh or a shared link lands on the same student and tab. The tabs are links, so
 * switching tab is a route change the back button can undo. `aria-current` marks the open
 * tab; exam pages belong to the Dashboard tab (they are reached from its latest-test card).
 */
import * as React from "react";
import { Link, useLocation, useParams } from "wouter";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { guardianPaths } from "./paths";
import { StudentSwitcher } from "./StudentSwitcher";
import { AddStudentButton } from "./AddStudentDialog";
import { studentLabel, useGuardianStudents } from "@/hooks/useGuardianStudents";
import {
  CurrentStudentContext,
  GuardianErrorState,
  GuardianLapsedState,
  GuardianLoadingState,
  GuardianRevokedState,
} from "./GuardianStates";

type GuardianTab = "dashboard" | "calendar";

function GuardianTabs({
  studentId,
  active,
}: {
  studentId: string;
  active: GuardianTab;
}): JSX.Element {
  const tabs: ReadonlyArray<{ id: GuardianTab; label: string; href: string }> =
    [
      {
        id: "dashboard",
        label: "Dashboard",
        href: guardianPaths.dashboard(studentId),
      },
      {
        id: "calendar",
        label: "Calendar",
        href: guardianPaths.calendar(studentId),
      },
    ];
  return (
    <nav
      aria-label="Student views"
      className="flex justify-center border-b border-border bg-background"
      data-testid="guardian-tabs"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={`min-h-[48px] min-w-[140px] px-6 flex items-center justify-center text-base no-underline border-b-[3px] ${
            tab.id === active
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted-foreground"
          }`}
          data-testid={`guardian-tab-${tab.id}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Which tab a guardian URL belongs to. Exam pages sit under the Dashboard. */
export function tabForLocation(location: string): GuardianTab {
  return /^\/guardian\/[^/]+\/calendar(\/|$)/.test(location)
    ? "calendar"
    : "dashboard";
}

/**
 * G4-06: the page-level states, decided before any per-student read is made. The roster is
 * the server's list of this guardian's ACTIVE links, each with the student's entitlement:
 *   - still loading or failed → loading / error, naming nobody (there is nobody yet);
 *   - the URL's student is not in it → revoked (R7), named with the last name seen here;
 *   - the student is not entitled → lapsed, with the named "Choose a plan for …" CTA. Every
 *     per-student read would answer 402, so none is made; the server still refuses them all.
 * Otherwise the page renders, with the student's id and name in `CurrentStudentContext` for
 * every widget's own copy.
 */
function StudentGate({
  studentId,
  children,
}: {
  studentId: string;
  children: React.ReactNode;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = useGuardianStudents();
  const lastName = React.useRef<{ id: string; name: string } | null>(null);
  const student = data?.students.find((s) => s.id === studentId);
  if (student !== undefined) {
    lastName.current = { id: studentId, name: studentLabel(student) };
  }
  const current = React.useMemo(
    () =>
      student === undefined
        ? null
        : { id: studentId, name: studentLabel(student) },
    [student, studentId],
  );

  let body: React.ReactNode;
  // No answer yet — in flight, or not asked because the signed-in user is still resolving
  // (the roster query waits for their id) — is loading, never an error.
  if (isLoading || (!isError && data === undefined)) {
    body = <GuardianLoadingState what="your student" />;
  } else if (isError || data === undefined) {
    body = (
      <GuardianErrorState what="your students" onRetry={() => void refetch()} />
    );
  } else if (student === undefined || current === null) {
    body = (
      <GuardianRevokedState
        name={lastName.current?.id === studentId ? lastName.current.name : null}
      />
    );
  } else if (!student.has_active_entitlement) {
    body = (
      <GuardianLapsedState
        name={current.name}
        studentId={studentId}
        ended={student.entitlement_lapsed}
      />
    );
  } else {
    return (
      <CurrentStudentContext.Provider value={current}>
        {children}
      </CurrentStudentContext.Provider>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {body}
    </div>
  );
}

export function GuardianStudentLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { studentId } = useParams<{ studentId: string }>();
  const [location] = useLocation();
  return (
    <GuardianShell
      center={<StudentSwitcher />}
      actions={<AddStudentButton />}
      subnav={
        <GuardianTabs studentId={studentId} active={tabForLocation(location)} />
      }
    >
      <StudentGate studentId={studentId}>{children}</StudentGate>
    </GuardianShell>
  );
}
