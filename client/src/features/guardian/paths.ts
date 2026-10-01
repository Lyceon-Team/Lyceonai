/**
 * The guardian surface's URLs — one builder per route, so no page spells a path by hand.
 *
 * @spec [Guardian_Closure_Plan Wave 4 layout (Karl, 2026-09-28): "the selected student and the
 *       tab live in the URL, not in component state"; G4-01] | @implemented [2026-09-30]
 *
 * plain English: refresh, the back button and a deep link all keep the student, because the
 * student id IS the URL; switching students is a route change. The id is encoded, never
 * trusted: every page below reads its data from routes the server scopes and authorises.
 */
const seg = (value: string): string => encodeURIComponent(value);

export const guardianPaths = {
  home: "/guardian",
  /** G4-10: Linked students & billing — not about one student, so no id. */
  students: "/guardian/students",
  /** G4-06: the lapsed state's named call to action — the billing page, this student selected. */
  choosePlan: (studentId: string): string =>
    `/guardian/students?choose=${seg(studentId)}`,
  dashboard: (studentId: string): string => `/guardian/${seg(studentId)}`,
  calendar: (studentId: string): string =>
    `/guardian/${seg(studentId)}/calendar`,
  exams: (studentId: string): string => `/guardian/${seg(studentId)}/exams`,
  exam: (studentId: string, sessionId: string): string =>
    `/guardian/${seg(studentId)}/exams/${seg(sessionId)}`,
} as const;
