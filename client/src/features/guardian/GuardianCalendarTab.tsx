/**
 * `/guardian/:studentId/calendar` — the Calendar tab: the student's own read-only calendar,
 * full width inside the guardian shell (R11; G4-04 finishes it).
 *
 * @spec [Guardian_Closure_Plan G4-01, G4-04; Doc 05F §16] | @implemented [2026-09-30]
 */
import GuardianStudentCalendarPage from "@/pages/guardian-student-calendar";
import { GuardianStudentLayout } from "./GuardianStudentLayout";

export default function GuardianCalendarTab(): JSX.Element {
  return (
    <GuardianStudentLayout>
      <GuardianStudentCalendarPage />
    </GuardianStudentLayout>
  );
}
