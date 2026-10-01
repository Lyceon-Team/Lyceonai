/**
 * The guardian route table — the ONE list `App.tsx` mounts and the route-walk test walks.
 *
 * @spec [Guardian_Closure_Plan Wave 4 routing table, G4-01; G2-01 (guardian routes admit
 *       guardians only)] | @implemented [2026-09-30]
 *
 * plain English: four guardian routes (plus the exam list), each inside `GuardianShell`. The
 * three retired `/students/:id/*` guardian pages no longer redirect: no email, notification or
 * server-built link ever pointed at them (guardian closeout, owner 2026-10-01). Every entry is `RequireRole allow={["guardian"]}` — a UI
 * courtesy; the API decides access (link AND the student's entitlement) on every read.
 * Order matters: wouter's `Switch` takes the first match, so exact paths come before the
 * `:studentId` catch-alls.
 */
import * as React from "react";

const GuardianHome = React.lazy(() => import("./GuardianHome"));
const GuardianDashboardTab = React.lazy(() => import("./GuardianDashboardTab"));
const GuardianCalendarTab = React.lazy(() => import("./GuardianCalendarTab"));
const GuardianExamsPage = React.lazy(() => import("./GuardianExamsPage"));
const GuardianStudentsPage = React.lazy(() => import("./GuardianStudentsPage"));

type GuardianRoute = {
  path: string;
  /** Rendered inside `RequireRole allow={["guardian"]}` by the mounting switch. */
  Page: React.ComponentType;
};

export const GUARDIAN_ROUTES: readonly GuardianRoute[] = [
  { path: "/guardian", Page: GuardianHome },
  // Before every `:studentId` route: "students" would otherwise match as a student id.
  { path: "/guardian/students", Page: GuardianStudentsPage },
  { path: "/guardian/:studentId/calendar", Page: GuardianCalendarTab },
  { path: "/guardian/:studentId/exams", Page: GuardianExamsPage },
  { path: "/guardian/:studentId/exams/:sessionId", Page: GuardianExamsPage },
  { path: "/guardian/:studentId", Page: GuardianDashboardTab },
];
