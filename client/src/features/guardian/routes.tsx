/**
 * The guardian route table — the ONE list `App.tsx` mounts and the route-walk test walks.
 *
 * @spec [Guardian_Closure_Plan Wave 4 routing table, G4-01; G2-01 (guardian routes admit
 *       guardians only)] | @implemented [2026-09-30]
 *
 * plain English: four guardian routes (plus the exam list), each inside `GuardianShell`, and
 * the three old `/students/:id/*` guardian pages redirected to their new homes, keeping the
 * student and the exam session. Every entry is `RequireRole allow={["guardian"]}` — a UI
 * courtesy; the API decides access (link AND the student's entitlement) on every read.
 * Order matters: wouter's `Switch` takes the first match, so exact paths come before the
 * `:studentId` catch-alls.
 */
import * as React from "react";
import { Redirect, useParams } from "wouter";
import { guardianPaths } from "./paths";

const GuardianHome = React.lazy(() => import("./GuardianHome"));
const GuardianDashboardTab = React.lazy(() => import("./GuardianDashboardTab"));
const GuardianCalendarTab = React.lazy(() => import("./GuardianCalendarTab"));
const GuardianExamsPage = React.lazy(() => import("./GuardianExamsPage"));
const GuardianStudentsPage = React.lazy(() => import("./GuardianStudentsPage"));

function RedirectStudent({
  to,
}: {
  to: (studentId: string) => string;
}): JSX.Element {
  const { studentId } = useParams<{ studentId: string }>();
  return <Redirect to={to(studentId)} replace />;
}

function RedirectExam(): JSX.Element {
  const { studentId, sessionId } = useParams<{
    studentId: string;
    sessionId: string;
  }>();
  return <Redirect to={guardianPaths.exam(studentId, sessionId)} replace />;
}

export type GuardianRoute = {
  path: string;
  /** Rendered inside `RequireRole allow={["guardian"]}` by the mounting switch. */
  Page: React.ComponentType;
  /** A redirect from a retired path, not a page. */
  redirect?: true;
};

export const GUARDIAN_ROUTES: readonly GuardianRoute[] = [
  { path: "/guardian", Page: GuardianHome },
  // Before every `:studentId` route: "students" would otherwise match as a student id.
  { path: "/guardian/students", Page: GuardianStudentsPage },
  { path: "/guardian/:studentId/calendar", Page: GuardianCalendarTab },
  { path: "/guardian/:studentId/exams", Page: GuardianExamsPage },
  { path: "/guardian/:studentId/exams/:sessionId", Page: GuardianExamsPage },
  { path: "/guardian/:studentId", Page: GuardianDashboardTab },
  // Retired guardian pages (G4-01): each redirects to its new home.
  {
    path: "/students/:studentId/calendar",
    Page: () => <RedirectStudent to={guardianPaths.calendar} />,
    redirect: true,
  },
  {
    path: "/students/:studentId/tests",
    Page: () => <RedirectStudent to={guardianPaths.exams} />,
    redirect: true,
  },
  {
    path: "/students/:studentId/tests/:sessionId",
    Page: RedirectExam,
    redirect: true,
  },
];
