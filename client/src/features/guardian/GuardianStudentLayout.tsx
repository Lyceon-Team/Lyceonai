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

export type GuardianTab = "dashboard" | "calendar";

export function GuardianTabs({
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
          className={`min-h-[48px] min-w-[140px] px-6 flex items-center justify-center text-base border-b-[3px] ${
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

export function GuardianStudentLayout({
  children,
  center,
  actions,
}: {
  children: React.ReactNode;
  center?: React.ReactNode;
  actions?: React.ReactNode;
}): JSX.Element {
  const { studentId } = useParams<{ studentId: string }>();
  const [location] = useLocation();
  return (
    <GuardianShell
      center={center ?? <StudentSwitcher />}
      actions={actions ?? <AddStudentButton />}
      subnav={
        <GuardianTabs studentId={studentId} active={tabForLocation(location)} />
      }
    >
      {children}
    </GuardianShell>
  );
}
